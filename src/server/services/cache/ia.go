// ia.go — Internet Archive cache persistence, build, and lookup.
package cache

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"godsend/app"
	"godsend/infrastructure/telemetry"
	"godsend/models"
)

// reportTelemetry is telemetry.Report; tests swap it so nothing reaches the
// production endpoint.
var reportTelemetry = telemetry.Report

// errIACollectionGone marks a collection id archive.org no longer serves:
// /metadata/<id> answers 404, or 200 with `{}` (no "files"). Retrying it is
// pointless and it is a configuration problem worth its own telemetry error.
var errIACollectionGone = errors.New("HTTP 404")

// iaMetadataBaseURL is overridden in tests.
var iaMetadataBaseURL = "https://archive.org/metadata/"

// IAService manages the Internet Archive game cache.
type IAService struct {
	App *app.App

	// FetchCollectionEntriesFn is an optional test hook for cache rebuilds.
	FetchCollectionEntriesFn func(string) ([]models.IAGameEntry, error)
}

// ==========================================
// CACHE — DISK PERSISTENCE
// ==========================================

func (s *IAService) cacheFilePath(platform string) string {
	return filepath.Join(s.App.ToolsDir, "cache", platform+".json")
}

func (s *IAService) SaveCacheToDisk(platform string, games []string, entries map[string]models.IAGameEntry) {
	pc := models.PlatformCache{
		Games:       games,
		GameEntries: entries,
		BuildTime:   time.Now(),
	}
	data, err := json.MarshalIndent(pc, "", "  ")
	if err != nil {
		s.App.Logf("CACHE SAVE ERROR %s: %v", platform, err)
		return
	}
	if err := os.WriteFile(s.cacheFilePath(platform), data, 0644); err != nil {
		s.App.Logf("CACHE SAVE ERROR %s: %v", platform, err)
		return
	}
	s.App.Logf("CACHE: Saved %s (%d games) to disk", platform, len(games))
}

// LoadCacheFromDisk returns true if a usable cache was loaded and still matches
// app.IACollections. When the IA renames collections, entries of the retired ones
// are dropped (their URLs 404), the rest is loaded so the catalog is not empty,
// and false is returned so the caller rebuilds.
func (s *IAService) LoadCacheFromDisk(platform string) bool {
	data, err := os.ReadFile(s.cacheFilePath(platform))
	if err != nil {
		return false
	}
	var pc models.PlatformCache
	if err := json.Unmarshal(data, &pc); err != nil {
		return false
	}
	if len(pc.Games) == 0 {
		return false
	}
	if strings.HasPrefix(platform, "hf_") {
		var removed int
		pc.Games, pc.GameEntries, removed = sanitizeHuggingFaceCache(platform, pc.Games, pc.GameEntries)
		if len(pc.Games) == 0 {
			return false
		}
		if removed > 0 {
			s.App.Logf("HUGGINGFACE CACHE: removed %d invalid packaged item(s)", removed)
		}
	}

	current := true
	if colls, ok := app.IACollections[platform]; ok && !strings.HasPrefix(platform, "hf_") {
		covered := make(map[string]bool, len(colls))
		for _, c := range colls {
			covered[c] = false
		}
		retired := 0
		for key, e := range pc.GameEntries {
			if _, configured := covered[e.CollectionID]; !configured {
				delete(pc.GameEntries, key)
				retired++
				continue
			}
			covered[e.CollectionID] = true
		}
		if retired > 0 {
			games := pc.Games[:0]
			for _, g := range pc.Games {
				if _, ok := pc.GameEntries[strings.ToLower(g)]; ok {
					games = append(games, g)
				}
			}
			pc.Games = games
		}
		var missing []string
		for _, c := range colls {
			if !covered[c] {
				missing = append(missing, c)
			}
		}
		if retired > 0 || len(missing) > 0 {
			current = false
			s.App.Logf("CACHE [%s]: disk cache is stale (%d entries from retired collections dropped, %d configured collection(s) missing: %s); rebuilding",
				platform, retired, len(missing), strings.Join(missing, ", "))
		}
		if len(pc.Games) == 0 {
			return false
		}
	}

	s.replaceMemoryCache(platform, pc.Games, pc.GameEntries)

	s.SetBuildState(platform, "ready", int32(len(pc.Games)), int32(len(pc.Games)))
	return current
}

func (s *IAService) replaceMemoryCache(platform string, games []string, entries map[string]models.IAGameEntry) {
	s.App.IAGameCacheMu.Lock()
	s.App.IAGameCache[platform] = games
	s.App.IAGameCacheMu.Unlock()

	s.App.GameEntryMapMu.Lock()
	if strings.HasPrefix(platform, "hf_") {
		prefix := platform + "\x00"
		for key := range s.App.GameEntryMap {
			if strings.HasPrefix(key, prefix) {
				delete(s.App.GameEntryMap, key)
			}
		}
	} else {
		collections := make(map[string]struct{}, len(app.IACollections[platform]))
		for _, collectionID := range app.IACollections[platform] {
			collections[collectionID] = struct{}{}
		}
		for key, entry := range s.App.GameEntryMap {
			if _, owned := collections[entry.CollectionID]; owned {
				delete(s.App.GameEntryMap, key)
			}
		}
	}
	for key, entry := range entries {
		s.App.GameEntryMap[key] = entry
	}
	s.App.GameEntryMapMu.Unlock()
}

func (s *IAService) preserveExistingCache(platform, provider string, cause error) {
	s.App.IAGameCacheMu.RLock()
	existing := len(s.App.IAGameCache[platform])
	s.App.IAGameCacheMu.RUnlock()
	if existing > 0 {
		s.App.Logf("%s CACHE ERROR [%s]: %v; preserving %d cached games", provider, platform, cause, existing)
		s.SetBuildState(platform, "ready", int32(existing), int32(existing))
		return
	}
	s.App.Logf("%s CACHE ERROR [%s]: %v; no previous cache is available", provider, platform, cause)
	s.SetBuildState(platform, "error", 0, 1)
}

// ==========================================
// CACHE — BUILD PROGRESS
// ==========================================

func (s *IAService) GetBuildState(platform string) *models.BuildState {
	s.App.BuildStatesMu.Lock()
	st, ok := s.App.BuildStates[platform]
	if !ok {
		st = &models.BuildState{State: "idle"}
		s.App.BuildStates[platform] = st
	}
	s.App.BuildStatesMu.Unlock()
	return st
}

func (s *IAService) SetBuildState(platform, state string, loaded, total int32) {
	st := s.GetBuildState(platform)
	atomic.StoreInt32(&st.Loaded, loaded)
	atomic.StoreInt32(&st.Total, total)
	s.App.BuildStatesMu.Lock()
	st.State = state
	s.App.BuildStatesMu.Unlock()
}

// ==========================================
// CACHE — BUILD (PARALLEL FETCH)
// ==========================================

// iaMetaResponse is the top-level shape of https://archive.org/metadata/<id>
type iaMetaResponse struct {
	Files []struct {
		Name   string `json:"name"`
		Source string `json:"source"`
		Format string `json:"format"`
	} `json:"files"`
}

// archiveExts lists the file extensions we treat as downloadable game archives.
var archiveExts = map[string]bool{".zip": true, ".rar": true, ".7z": true}

// IAFetchSem is a global semaphore capping simultaneous archive.org metadata
// requests across ALL platform cache builds.
var IAFetchSem = make(chan struct{}, 6)

const (
	MaxIARetries  = 4
	IABaseTimeout = 60 * time.Second
)

// IARetryBackoff is the wait before each retry attempt (index 0 = first retry).
var IARetryBackoff = []time.Duration{3 * time.Second, 8 * time.Second, 20 * time.Second, 40 * time.Second}

// DoIAMetaFetch performs one HTTP GET of the IA metadata API and returns parsed entries.
func (s *IAService) DoIAMetaFetch(collectionID string) ([]models.IAGameEntry, error) {
	IAFetchSem <- struct{}{} // acquire slot
	defer func() { <-IAFetchSem }()

	apiURL := iaMetadataBaseURL + collectionID
	client := &http.Client{Timeout: IABaseTimeout}
	req, _ := http.NewRequest("GET", apiURL, nil)
	s.App.ApplyArchiveOrgHeaders(req)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", collectionID, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("%s: %w", collectionID, errIACollectionGone)
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("%s: HTTP %d", collectionID, resp.StatusCode)
	}

	var meta iaMetaResponse
	if err := json.NewDecoder(resp.Body).Decode(&meta); err != nil {
		return nil, fmt.Errorf("%s: JSON decode: %w", collectionID, err)
	}
	if len(meta.Files) == 0 {
		// archive.org answers 200 `{}` for an id that does not exist.
		return nil, fmt.Errorf("%s: metadata sem files (200 {}): %w", collectionID, errIACollectionGone)
	}

	var entries []models.IAGameEntry
	for _, f := range meta.Files {
		if f.Source != "original" {
			continue
		}
		ext := strings.ToLower(filepath.Ext(f.Name))
		if !archiveExts[ext] {
			continue
		}
		entries = append(entries, models.IAGameEntry{
			CollectionID: collectionID,
			FileName:     f.Name,
		})
	}
	return entries, nil
}

// FetchIACollectionEntries wraps DoIAMetaFetch with exponential-backoff retries.
func (s *IAService) FetchIACollectionEntries(collectionID string) ([]models.IAGameEntry, error) {
	if s.FetchCollectionEntriesFn != nil {
		return s.FetchCollectionEntriesFn(collectionID)
	}
	entries, err := s.DoIAMetaFetch(collectionID)
	if err == nil || errors.Is(err, errIACollectionGone) {
		return entries, err
	}
	for attempt := 0; attempt < len(IARetryBackoff); attempt++ {
		wait := IARetryBackoff[attempt]
		s.App.Logf("CACHE RETRY [%s] attempt %d/%d in %v: %v",
			collectionID, attempt+1, MaxIARetries-1, wait, err)
		time.Sleep(wait)
		entries, err = s.DoIAMetaFetch(collectionID)
		if err == nil {
			return entries, nil
		}
	}
	return nil, fmt.Errorf("%s: gave up after %d attempts: %w", collectionID, MaxIARetries, err)
}

// Build fetches all collections for a platform sequentially
// (controlled by the global semaphore) so archive.org isn't overwhelmed.
func (s *IAService) Build(platform string) {
	s.App.IACacheBuildMu.Lock()
	if s.App.IACacheBuilding[platform] {
		s.App.IACacheBuildMu.Unlock()
		return
	}
	s.App.IACacheBuilding[platform] = true
	s.App.IACacheBuildMu.Unlock()

	defer func() {
		s.App.IACacheBuildMu.Lock()
		s.App.IACacheBuilding[platform] = false
		s.App.IACacheBuildMu.Unlock()
	}()

	colls, ok := app.IACollections[platform]
	if !ok {
		return
	}

	total := int32(len(colls))
	s.SetBuildState(platform, "building", 0, total)
	s.App.Logf("CACHE: Building %s — %d collections...", platform, total)

	type result struct {
		entries      []models.IAGameEntry
		collectionID string
		err          error
	}
	ch := make(chan result, len(colls))

	for _, coll := range colls {
		go func(c string) {
			entries, err := s.FetchIACollectionEntries(c)
			ch <- result{entries, c, err}
		}(coll)
	}

	newEntries := map[string]models.IAGameEntry{}
	var allGames []string
	var loaded int32
	var failedCollections []string

	for range colls {
		r := <-ch
		loaded++
		s.SetBuildState(platform, "building", loaded, total)

		if r.err != nil {
			s.App.Logf("CACHE WARN [%s]: %v", platform, r.err)
			failedCollections = append(failedCollections, r.collectionID)
			if errors.Is(r.err, errIACollectionGone) {
				s.reportGoneCollection(platform, r.collectionID, r.err.Error())
			}
			continue
		}
		if len(r.entries) == 0 {
			s.App.Logf("CACHE WARN [%s]: %s returned no downloadable archives", platform, r.collectionID)
			failedCollections = append(failedCollections, r.collectionID)
			s.reportGoneCollection(platform, r.collectionID, "no downloadable archives")
			continue
		}
		for _, e := range r.entries {
			ext := filepath.Ext(e.FileName)
			name := strings.TrimSuffix(e.FileName, ext)
			if models.IsDemoTitle(name) {
				continue
			}
			lower := strings.ToLower(name)
			newEntries[lower] = e
			allGames = append(allGames, name)
		}
		s.App.Logf("CACHE [%s] %d/%d: %s (%d files)", platform, loaded, total, r.collectionID, len(r.entries))
	}
	if len(failedCollections) > 0 {
		s.preserveExistingCache(platform, "INTERNET ARCHIVE", fmt.Errorf("incomplete rebuild: %d/%d collection(s) failed (%s)", len(failedCollections), len(colls), strings.Join(failedCollections, ", ")))
		return
	}
	if len(allGames) == 0 {
		s.preserveExistingCache(platform, "INTERNET ARCHIVE", fmt.Errorf("rebuild returned no games"))
		return
	}

	sort.Strings(allGames)
	s.SetBuildState(platform, "ready", total, total)
	s.App.Logf("CACHE: %s complete — %d games", platform, len(allGames))

	s.replaceMemoryCache(platform, allGames, newEntries)
	s.SaveCacheToDisk(platform, allGames, newEntries)
}

// reportGoneCollection sends one telemetry error per dead collection. The
// message is stable per collection so the session dedup in telemetry.Report
// and the panel group it, instead of one "not found" per title.
func (s *IAService) reportGoneCollection(platform, collectionID, reason string) {
	reportTelemetry("cache", "ia.go", "Build",
		fmt.Sprintf("Coleção IA sumiu: %s (%s): %s", collectionID, platform, reason),
		"", nil, false)
}

// ==========================================
// CACHE — LOOKUP
// ==========================================

// FindEntry returns the IAGameEntry for a game, searching cached data.
// Falls back to a live per-letter search if cache is empty.
func (s *IAService) FindEntry(gameName, platform string) (models.IAGameEntry, error) {
	lower := strings.ToLower(gameName)

	s.App.GameEntryMapMu.RLock()
	entry, ok := s.App.GameEntryMap[lower]
	s.App.GameEntryMapMu.RUnlock()
	if ok {
		return entry, nil
	}

	// Fuzzy matching handles source-specific region and language suffixes.
	s.App.GameEntryMapMu.RLock()
	var bestEntry models.IAGameEntry
	bestKey := ""
	bestScore := -1
	for k, e := range s.App.GameEntryMap {
		if strings.Contains(k, "\x00") {
			continue
		}
		score := titleMatchScore(k, gameName)
		if score > bestScore || (score == bestScore && score >= 0 && k < bestKey) {
			bestEntry = e
			bestKey = k
			bestScore = score
		}
	}
	s.App.GameEntryMapMu.RUnlock()
	if bestScore >= 0 {
		return bestEntry, nil
	}

	// Live fetch from the relevant collection page(s)
	entry, err := s.LiveSearchIA(gameName, platform)
	if errors.Is(err, errIACollectionUnavailable) {
		return models.IAGameEntry{}, fmt.Errorf("not found in Internet Archive: %s (%w)", gameName, err)
	}
	if err != nil {
		return models.IAGameEntry{}, fmt.Errorf("not found in Internet Archive: %s", gameName)
	}
	return entry, nil
}

// errIACollectionUnavailable: every candidate collection failed or came back
// empty, so "no match" would hide that the title was never searched.
var errIACollectionUnavailable = errors.New("coleção IA indisponível")

// LiveSearchIA searches IA collections via the Metadata API when the cache is cold.
func (s *IAService) LiveSearchIA(gameName, platform string) (models.IAGameEntry, error) {
	colls, ok := app.IACollections[platform]
	if !ok {
		return models.IAGameEntry{}, fmt.Errorf("unknown platform: %s", platform)
	}

	// Narrow by first letter for Redump-style collections
	candidates := colls
	if len(gameName) > 0 {
		firstLetter := strings.ToLower(string([]rune(gameName)[0]))
		var narrowed []string
		for _, c := range colls {
			lc := strings.ToLower(c)
			if strings.HasSuffix(lc, "_"+firstLetter) ||
				strings.Contains(lc, "_"+firstLetter+"_part") ||
				((firstLetter >= "0" && firstLetter <= "9") && strings.HasSuffix(lc, "_numberssymbols")) {
				narrowed = append(narrowed, c)
			}
		}
		if len(narrowed) > 0 {
			candidates = narrowed
		}
	}

	var bestEntry models.IAGameEntry
	bestName := ""
	bestScore := -1
	var unavailable []string
	for _, coll := range candidates {
		entries, err := s.DoIAMetaFetch(coll)
		if err != nil || len(entries) == 0 {
			unavailable = append(unavailable, coll)
			continue
		}
		for _, e := range entries {
			name := strings.TrimSuffix(filepath.Base(e.FileName), filepath.Ext(e.FileName))
			score := titleMatchScore(name, gameName)
			if score > bestScore || (score == bestScore && score >= 0 && name < bestName) {
				bestEntry = e
				bestName = name
				bestScore = score
			}
		}
	}
	if bestScore >= 0 {
		return bestEntry, nil
	}
	if len(candidates) > 0 && len(unavailable) == len(candidates) {
		return models.IAGameEntry{}, fmt.Errorf("%w: %s", errIACollectionUnavailable, strings.Join(unavailable, ", "))
	}
	return models.IAGameEntry{}, fmt.Errorf("no match for '%s'", gameName)
}
