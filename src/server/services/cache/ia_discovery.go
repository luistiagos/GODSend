// ia_discovery.go — which Internet Archive collections a platform's cache is
// built from, and when a failed rebuild may be retried.
//
// The IA renames and splits collections (2026-11: microsoft_xbox_{c,d,m,n,o,s,t}
// became _part1/_part2, and microsoft_xbox360_r gained _r_part1). A list
// compiled into the binary only recovers with a new app version, so Redump-style
// platforms ask archive.org for the current list, with app.IACollections as the
// fallback for every letter the search does not return.
package cache

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"godsend/app"
)

// iaAdvancedSearchURL is overridden in tests.
var iaAdvancedSearchURL = "https://archive.org/advancedsearch.php"

// iaDiscoveryPrefixes lists the platforms whose collections follow the Redump
// per-letter naming (<prefix><letter>[_partN], <prefix>numberssymbols). Only
// these are discovered; the others keep app.IACollections.
var iaDiscoveryPrefixes = map[string]string{
	"xbox":    "microsoft_xbox_",
	"xbox360": "microsoft_xbox360_",
}

// iaLetterCollectionRe matches what follows the prefix. It is strict on
// purpose: the same search returns microsoft_xbox_devkit_hdds,
// microsoft_xbox360_digital_partN (platform "digital"), _title-updates and
// _TRAD_BR_*, which are not this platform's game sets.
var iaLetterCollectionRe = regexp.MustCompile(`^(numberssymbols|[a-z])(?:_part[0-9]+)?$`)

// IARebuildRetryInterval is the minimum wait before startup retries a rebuild
// that failed on the same collection list.
var IARebuildRetryInterval = 6 * time.Hour

const iaDiscoveryTimeout = 30 * time.Second

// iaCollectionLetter returns the letter group ("a".."z", "numberssymbols") of
// a collection id of the platform with this prefix.
func iaCollectionLetter(prefix, collectionID string) (string, bool) {
	if prefix == "" || !strings.HasPrefix(collectionID, prefix) {
		return "", false
	}
	m := iaLetterCollectionRe.FindStringSubmatch(collectionID[len(prefix):])
	if m == nil {
		return "", false
	}
	return m[1], true
}

// CollectionsFor returns the collection list in use for a platform: the one
// its cache was last built from, or app.IACollections.
func (s *IAService) CollectionsFor(platform string) ([]string, bool) {
	s.App.IAEffectiveCollectionsMu.RLock()
	colls, ok := s.App.IAEffectiveCollections[platform]
	s.App.IAEffectiveCollectionsMu.RUnlock()
	if ok && len(colls) > 0 {
		return colls, true
	}
	colls, ok = app.IACollections[platform]
	return colls, ok
}

// setCollections stores a copy. Stored slices are never mutated, so callers
// may keep what CollectionsFor returned.
func (s *IAService) setCollections(platform string, colls []string) {
	if _, ok := iaDiscoveryPrefixes[platform]; !ok || len(colls) == 0 {
		return
	}
	cp := append([]string(nil), colls...)
	s.App.IAEffectiveCollectionsMu.Lock()
	if s.App.IAEffectiveCollections == nil {
		s.App.IAEffectiveCollections = make(map[string][]string)
	}
	s.App.IAEffectiveCollections[platform] = cp
	s.App.IAEffectiveCollectionsMu.Unlock()
}

func (s *IAService) collectionsToBuild(platform string) []string {
	if _, ok := iaDiscoveryPrefixes[platform]; ok {
		found, err := s.discoverIACollections(platform)
		if err == nil {
			return found
		}
		s.App.Logf("CACHE [%s]: collection discovery failed (%v); using the last known list", platform, err)
	}
	colls, _ := s.CollectionsFor(platform)
	return colls
}

// discoverIACollections asks archive.org which collections of the platform
// exist, and merges the answer with app.IACollections letter by letter: a
// letter the search found uses every id found for it (while a letter is being
// split, "_r" and "_r_part1" coexist and both are kept, Build dedupes the
// titles); a letter the search did not return keeps the configured ids, so a
// lagging index never drops a letter. The list comes back sorted.
func (s *IAService) discoverIACollections(platform string) ([]string, error) {
	prefix, ok := iaDiscoveryPrefixes[platform]
	if !ok {
		return nil, fmt.Errorf("no discovery for platform %s", platform)
	}
	q := url.Values{}
	q.Set("q", "identifier:"+prefix+"*")
	q.Add("fl[]", "identifier")
	q.Set("rows", "1000")
	q.Set("output", "json")
	req, err := http.NewRequest("GET", iaAdvancedSearchURL+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	s.App.ApplyArchiveOrgHeaders(req)
	resp, err := (&http.Client{Timeout: iaDiscoveryTimeout}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("advancedsearch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("advancedsearch: HTTP %d", resp.StatusCode)
	}
	var body struct {
		Response struct {
			Docs []struct {
				Identifier string `json:"identifier"`
			} `json:"docs"`
		} `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("advancedsearch: JSON decode: %w", err)
	}
	found := map[string][]string{}
	for _, d := range body.Response.Docs {
		if letter, ok := iaCollectionLetter(prefix, d.Identifier); ok {
			found[letter] = append(found[letter], d.Identifier)
		}
	}
	if len(found) == 0 {
		return nil, fmt.Errorf("advancedsearch: no %s<letter> collection in %d result(s)", prefix, len(body.Response.Docs))
	}
	return mergeDiscoveredCollections(prefix, app.IACollections[platform], found), nil
}

func mergeDiscoveredCollections(prefix string, configured []string, found map[string][]string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(id string) {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	for _, c := range configured {
		letter, ok := iaCollectionLetter(prefix, c)
		if !ok {
			add(c)
			continue
		}
		if _, hit := found[letter]; !hit {
			add(c)
		}
	}
	for _, ids := range found {
		for _, id := range ids {
			add(id)
		}
	}
	sort.Strings(out)
	return out
}

// RebuildIfCollectionsChanged runs one discovery after startup loaded a valid
// cache, and rebuilds when archive.org's list differs from the one the cache
// was built from. This is what lets a renamed collection download again
// without a new app version. A rebuild that already failed on the same list
// less than IARebuildRetryInterval ago is not repeated.
func (s *IAService) RebuildIfCollectionsChanged(platform string) {
	if _, ok := iaDiscoveryPrefixes[platform]; !ok {
		return
	}
	found, err := s.discoverIACollections(platform)
	if err != nil {
		s.App.Logf("CACHE [%s]: collection discovery failed (%v); keeping the loaded cache", platform, err)
		return
	}
	current, _ := s.CollectionsFor(platform)
	if sameCollections(found, current) {
		return
	}
	if attempt, recent := s.recentIncompleteBuild(platform); recent && sameCollections(attempt.Collections, found) {
		s.App.Logf("CACHE [%s]: collection list changed on archive.org, but the rebuild at %s failed on it; next attempt after %s",
			platform, attempt.At.Format(time.RFC3339), attempt.At.Add(IARebuildRetryInterval).Format(time.RFC3339))
		return
	}
	s.App.Logf("CACHE [%s]: collection list changed on archive.org (%d -> %d); rebuilding", platform, len(current), len(found))
	s.build(platform, found)
}

func sameCollections(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	x := append([]string(nil), a...)
	y := append([]string(nil), b...)
	sort.Strings(x)
	sort.Strings(y)
	for i := range x {
		if x[i] != y[i] {
			return false
		}
	}
	return true
}

// iaBuildAttempt is cache/<platform>.attempt.json: the last rebuild that did
// not cover every collection. A complete rebuild deletes it.
type iaBuildAttempt struct {
	At          time.Time `json:"at"`
	Collections []string  `json:"collections"`
	Failed      []string  `json:"failed"`
}

func (s *IAService) attemptFilePath(platform string) string {
	return filepath.Join(s.App.ToolsDir, "cache", platform+".attempt.json")
}

func (s *IAService) recordIncompleteBuild(platform string, colls, failed []string) {
	data, err := json.MarshalIndent(iaBuildAttempt{At: time.Now(), Collections: colls, Failed: failed}, "", "  ")
	if err == nil {
		err = os.WriteFile(s.attemptFilePath(platform), data, 0644)
	}
	if err != nil {
		s.App.Logf("CACHE [%s]: could not record the incomplete rebuild: %v", platform, err)
	}
}

func (s *IAService) clearIncompleteBuild(platform string) {
	if err := os.Remove(s.attemptFilePath(platform)); err != nil && !os.IsNotExist(err) {
		s.App.Logf("CACHE [%s]: could not clear the incomplete-rebuild record: %v", platform, err)
	}
}

// recentIncompleteBuild returns the last incomplete rebuild and whether it is
// younger than IARebuildRetryInterval. A missing or unreadable record means
// "retry".
func (s *IAService) recentIncompleteBuild(platform string) (iaBuildAttempt, bool) {
	var attempt iaBuildAttempt
	data, err := os.ReadFile(s.attemptFilePath(platform))
	if err != nil || json.Unmarshal(data, &attempt) != nil {
		return iaBuildAttempt{}, false
	}
	return attempt, time.Since(attempt.At) < IARebuildRetryInterval
}
