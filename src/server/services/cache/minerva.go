// minerva.go — Minerva Archive cache persistence, scraping, build, and lookup.
package cache

import (
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"godsend/app"
	"godsend/infrastructure/helpers"
	"godsend/models"
)

type MinervaTorrentValidator interface {
	ValidateMinervaEntries(platform string, entries []models.MinervaEntry) ([]models.MinervaEntry, []string, error)
}

// MinervaService manages the Minerva Archive game cache.
type MinervaService struct {
	App     *app.App
	Torrent MinervaTorrentValidator
}

// ==========================================
// MINERVA CACHE — DISK PERSISTENCE
// ==========================================

func (s *MinervaService) cacheFilePath(platform string) string {
	return filepath.Join(s.App.ToolsDir, "cache", "minerva_"+platform+".json")
}

func (s *MinervaService) SaveCacheToDisk(platform string, games []string, entries map[string]models.MinervaEntry) {
	mc := models.MinervaPlatformCache{
		Schema:    app.MinervaCacheSchema,
		Games:     games,
		Entries:   entries,
		BuildTime: time.Now(),
	}
	data, err := json.MarshalIndent(mc, "", "  ")
	if err != nil {
		s.App.Logf("MINERVA CACHE SAVE ERROR %s: %v", platform, err)
		return
	}
	if err := os.WriteFile(s.cacheFilePath(platform), data, 0644); err != nil {
		s.App.Logf("MINERVA CACHE SAVE ERROR %s: %v", platform, err)
		return
	}
	s.App.Logf("MINERVA CACHE: Saved %s (%d games) to disk", platform, len(games))
}

func (s *MinervaService) LoadCacheFromDisk(platform string) bool {
	data, err := os.ReadFile(s.cacheFilePath(platform))
	if err != nil {
		return false
	}
	var mc models.MinervaPlatformCache
	if err := json.Unmarshal(data, &mc); err != nil {
		return false
	}
	if len(mc.Games) == 0 {
		return false
	}
	migrated := false
	if mc.Schema < app.MinervaCacheSchema {
		// Schema 3 only added platform ownership to entries. Schema 2 caches
		// already contain all lookup data and can be upgraded without a rebuild.
		if mc.Schema == 2 && app.MinervaCacheSchema == 3 && len(mc.Entries) > 0 {
			migrated = true
			s.App.Logf("MINERVA CACHE: Migrating %s schema 2 to 3", platform)
		} else {
			s.App.Logf("MINERVA CACHE: %s schema=%d < %d - rebuilding", platform, mc.Schema, app.MinervaCacheSchema)
			return false
		}
	}

	s.App.MinervaGameCacheMu.Lock()
	s.App.MinervaGameCache[platform] = mc.Games
	s.App.MinervaGameCacheMu.Unlock()

	entries := make(map[string]models.MinervaEntry, len(mc.Entries)*2)
	for k, v := range mc.Entries {
		if v.Platform == "" {
			v.Platform = platform
		}
		entries[k] = v
		if dk := strings.ToLower(helpers.DecodeMinervaName(k)); dk != k {
			if _, taken := entries[dk]; !taken {
				entries[dk] = v
			}
		}
	}
	s.App.MinervaEntryMapMu.Lock()
	for k, v := range entries {
		s.App.MinervaEntryMap[k] = v
	}
	s.App.MinervaEntryMapMu.Unlock()

	s.SetBuildState(platform, "ready", int32(len(mc.Games)), int32(len(mc.Games)))
	if migrated {
		s.SaveCacheToDisk(platform, mc.Games, entries)
	}
	return true
}

// ==========================================
// MINERVA CACHE — BUILD STATE
// ==========================================

func (s *MinervaService) GetBuildState(platform string) *models.BuildState {
	s.App.MinervaBuildStatesMu.Lock()
	st, ok := s.App.MinervaBuildStates[platform]
	if !ok {
		st = &models.BuildState{State: "idle"}
		s.App.MinervaBuildStates[platform] = st
	}
	s.App.MinervaBuildStatesMu.Unlock()
	return st
}

func (s *MinervaService) SetBuildState(platform, state string, loaded, total int32) {
	st := s.GetBuildState(platform)
	atomic.StoreInt32(&st.Loaded, loaded)
	atomic.StoreInt32(&st.Total, total)
	s.App.MinervaBuildStatesMu.Lock()
	st.State = state
	s.App.MinervaBuildStatesMu.Unlock()
}

func (s *MinervaService) preserveExistingCache(platform string, cause error) {
	s.App.MinervaGameCacheMu.RLock()
	existing := len(s.App.MinervaGameCache[platform])
	s.App.MinervaGameCacheMu.RUnlock()
	if existing > 0 {
		s.App.Logf("MINERVA CACHE ERROR [%s]: %v; preserving %d cached games", platform, cause, existing)
		s.SetBuildState(platform, "ready", int32(existing), int32(existing))
		return
	}
	s.App.Logf("MINERVA CACHE ERROR [%s]: %v; no previous cache is available", platform, cause)
	s.SetBuildState(platform, "error", 0, 1)
}

// ==========================================
// MINERVA CACHE — SCRAPE + BUILD
// ==========================================

// ScrapeMinervaPage fetches one Minerva browse URL and returns file entries.
// tagFilters, if non-empty, restricts results to filenames containing AT LEAST
// ONE of the listed substrings (any-match).
func (s *MinervaService) ScrapeMinervaPage(browseURL string, tagFilters []string) ([]models.MinervaEntry, error) {
	client := &http.Client{Timeout: 120 * time.Second}
	req, err := http.NewRequest("GET", browseURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch %s: %w", browseURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("fetch %s: HTTP %d", browseURL, resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", browseURL, err)
	}

	matches := app.MinervaROMAnchorRe.FindAllSubmatch(body, -1)
	var entries []models.MinervaEntry
	for _, m := range matches {
		hrefVal := html.UnescapeString(string(m[1]))
		parsed, err := url.Parse(hrefVal)
		if err != nil || parsed.Path != "/rom" {
			continue
		}
		pathParam := parsed.RawQuery
		fileName := strings.TrimSpace(html.UnescapeString(string(m[2])))
		if fileName == "" {
			fileName = parsed.Query().Get("name")
		}
		ext := strings.ToLower(filepath.Ext(fileName))
		if ext != ".zip" && ext != ".7z" && ext != ".rar" {
			continue
		}
		if len(tagFilters) > 0 {
			match := false
			for _, t := range tagFilters {
				if strings.Contains(fileName, t) {
					match = true
					break
				}
			}
			if !match {
				continue
			}
		}
		entries = append(entries, models.MinervaEntry{
			FileName:  fileName,
			PathParam: pathParam,
		})
	}
	return entries, nil
}

// Build scrapes the Minerva browse page for one platform and caches results.
func (s *MinervaService) Build(platform string) {
	s.App.MinervaCacheBuildMu.Lock()
	if s.App.MinervaCacheBuilding[platform] {
		s.App.MinervaCacheBuildMu.Unlock()
		return
	}
	s.App.MinervaCacheBuilding[platform] = true
	s.App.MinervaCacheBuildMu.Unlock()

	defer func() {
		s.App.MinervaCacheBuildMu.Lock()
		s.App.MinervaCacheBuilding[platform] = false
		s.App.MinervaCacheBuildMu.Unlock()
	}()

	browseURL, ok := app.MinervaPageURLs[platform]
	if !ok {
		return
	}
	tagFilters := app.MinervaTagFilters[platform]

	s.SetBuildState(platform, "building", 0, 1)
	s.App.Logf("MINERVA CACHE: Building %s (filters=%v) ...", platform, tagFilters)

	entries, err := s.ScrapeMinervaPage(browseURL, tagFilters)
	if err != nil {
		s.App.Logf("MINERVA CACHE ERROR [%s]: %v", platform, err)
		s.SetBuildState(platform, "error", 0, 1)
		return
	}
	if len(entries) == 0 {
		s.preserveExistingCache(platform, fmt.Errorf("scrape returned no games"))
		return
	}
	if s.Torrent == nil {
		s.preserveExistingCache(platform, fmt.Errorf("torrent validator is unavailable"))
		return
	}
	validated, missing, err := s.Torrent.ValidateMinervaEntries(platform, entries)
	if err != nil {
		s.preserveExistingCache(platform, fmt.Errorf("torrent validation failed: %w", err))
		return
	}
	if len(missing) > 0 {
		s.App.Logf("MINERVA CACHE WARN [%s]: excluded %d page item(s) absent from the torrent", platform, len(missing))
	}
	entries = validated
	if len(entries) == 0 {
		s.preserveExistingCache(platform, fmt.Errorf("no scraped item exists in the collection torrent"))
		return
	}

	newEntries := make(map[string]models.MinervaEntry, len(entries)*2)
	var allGames []string
	for _, e := range entries {
		name := strings.TrimSuffix(e.FileName, filepath.Ext(e.FileName))
		lower := strings.ToLower(name)
		if _, dup := newEntries[lower]; dup {
			continue
		}
		me := models.MinervaEntry{FileName: e.FileName, PathParam: e.PathParam, Platform: platform}
		newEntries[lower] = me
		if dec := strings.ToLower(helpers.DecodeMinervaName(name)); dec != lower {
			if _, taken := newEntries[dec]; !taken {
				newEntries[dec] = models.MinervaEntry{FileName: me.FileName, PathParam: me.PathParam, Platform: platform}
			}
		}
		allGames = append(allGames, name)
	}
	sort.Strings(allGames)
	s.SetBuildState(platform, "ready", 1, 1)
	s.App.Logf("MINERVA CACHE: %s complete — %d games", platform, len(allGames))

	s.App.MinervaGameCacheMu.Lock()
	s.App.MinervaGameCache[platform] = allGames
	s.App.MinervaGameCacheMu.Unlock()

	s.App.MinervaEntryMapMu.Lock()
	for key, entry := range s.App.MinervaEntryMap {
		if entry.Platform == platform {
			delete(s.App.MinervaEntryMap, key)
		}
	}
	for k, v := range newEntries {
		s.App.MinervaEntryMap[k] = v
	}
	s.App.MinervaEntryMapMu.Unlock()

	s.SaveCacheToDisk(platform, allGames, newEntries)
}

// ==========================================
// MINERVA CACHE — LOOKUP
// ==========================================

// FindEntry looks up a game in the Minerva cache.
// Returns the entry and true if found, or false if not found.
func (s *MinervaService) FindEntry(gameName, platform string) (models.MinervaEntry, bool) {
	keys := MinervaLookupKeys(gameName)

	torrentMatches := func(e models.MinervaEntry) bool {
		if e.Platform == "" || platform == "" {
			return true
		}
		urlTarget := app.MinervaTorrentURLs[platform]
		urlEntry := app.MinervaTorrentURLs[e.Platform]
		return urlTarget == "" || urlEntry == "" || urlTarget == urlEntry
	}

	s.App.MinervaEntryMapMu.RLock()
	defer s.App.MinervaEntryMapMu.RUnlock()

	// 1. Exact key match with matching torrent collection
	for _, key := range keys {
		if key == "" {
			continue
		}
		if e, ok := s.App.MinervaEntryMap[key]; ok && torrentMatches(e) {
			return e, true
		}
	}

	// 2. Exact key match across any platform
	for _, key := range keys {
		if key == "" {
			continue
		}
		if e, ok := s.App.MinervaEntryMap[key]; ok {
			return e, true
		}
	}

	findBestMatch := func(requireTorrentMatch bool) (models.MinervaEntry, bool) {
		var best models.MinervaEntry
		bestScore := -1
		found := false
		for k, entry := range s.App.MinervaEntryMap {
			if requireTorrentMatch && !torrentMatches(entry) {
				continue
			}
			score := titleMatchScore(k, gameName)
			if score < 0 {
				continue
			}
			if !found || score > bestScore || (score == bestScore && preferMinervaEntry(entry, best)) {
				best = entry
				bestScore = score
				found = true
			}
		}
		return best, found
	}

	// 3. Best title/metadata match with matching torrent collection
	if entry, ok := findBestMatch(true); ok {
		return entry, true
	}

	// 4. Best title/metadata match across any platform
	if entry, ok := findBestMatch(false); ok {
		return entry, true
	}

	// Trigger a background build if the cache is empty for this platform
	s.App.MinervaGameCacheMu.RLock()
	isEmpty := len(s.App.MinervaGameCache[platform]) == 0
	s.App.MinervaGameCacheMu.RUnlock()
	if isEmpty {
		go s.Build(platform)
	}
	return models.MinervaEntry{}, false
}

func preferMinervaEntry(candidate, current models.MinervaEntry) bool {
	candidateName := strings.ToLower(helpers.DecodeMinervaName(candidate.FileName))
	currentName := strings.ToLower(helpers.DecodeMinervaName(current.FileName))
	candidateDiscOne := strings.Contains(candidateName, "disc 1") || strings.Contains(candidateName, "disc1") || strings.Contains(candidateName, "dvd1")
	currentDiscOne := strings.Contains(currentName, "disc 1") || strings.Contains(currentName, "disc1") || strings.Contains(currentName, "dvd1")
	if candidateDiscOne != currentDiscOne {
		return candidateDiscOne
	}
	return candidateName < currentName
}

// ==========================================
// MINERVA LOOKUP HELPERS
// ==========================================

// MinervaLookupKeys returns distinct lowercased index keys for a Minerva display/file base name.
func MinervaLookupKeys(name string) []string {
	name = strings.TrimSpace(name)
	raw := strings.ToLower(name)
	dec := strings.ToLower(helpers.DecodeMinervaName(name))
	if raw == dec {
		return []string{raw}
	}
	return []string{raw, dec}
}
