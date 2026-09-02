// huggingface.go — HuggingFace rom list fetching and caching.
package cache

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"godsend/app"
	"godsend/models"
)

// HuggingFaceService manages the HuggingFace game cache.
type HuggingFaceService struct {
	App        *app.App
	IA         *IAService
	CatalogURL string
}

type HFAPIItem struct {
	Console string `json:"console"`
	Link    string `json:"link"`
	Path    string `json:"path"`
	Size    string `json:"size"`
}

// Build fetches the game list from emuladores.pythonanywhere.com API and caches it.
func (s *HuggingFaceService) Build(platform string) {
	s.App.IACacheBuildMu.Lock()
	if s.App.IACacheBuilding["hf_"+platform] {
		s.App.IACacheBuildMu.Unlock()
		return
	}
	s.App.IACacheBuilding["hf_"+platform] = true
	s.App.IACacheBuildMu.Unlock()
	defer func() {
		s.App.IACacheBuildMu.Lock()
		s.App.IACacheBuilding["hf_"+platform] = false
		s.App.IACacheBuildMu.Unlock()
	}()

	s.IA.SetBuildState("hf_"+platform, "building", 0, 1)
	s.App.Logf("HUGGINGFACE CACHE: Building %s...", platform)

	client := &http.Client{Timeout: 30 * time.Second}
	catalogURL := s.CatalogURL
	if catalogURL == "" {
		catalogURL = "https://emuladores.pythonanywhere.com/api/rom/list?system=xbox360rgh&source_id=1"
	}
	resp, err := client.Get(catalogURL)
	if err != nil {
		s.IA.SetBuildState("hf_"+platform, "error", 0, 1)
		s.App.Logf("HUGGINGFACE CACHE ERROR: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		s.IA.SetBuildState("hf_"+platform, "error", 0, 1)
		s.App.Logf("HUGGINGFACE CACHE ERROR: HTTP %d", resp.StatusCode)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		s.IA.SetBuildState("hf_"+platform, "error", 0, 1)
		s.App.Logf("HUGGINGFACE CACHE ERROR: %v", err)
		return
	}

	var items []HFAPIItem
	if err := json.Unmarshal(body, &items); err != nil {
		s.IA.SetBuildState("hf_"+platform, "error", 0, 1)
		s.App.Logf("HUGGINGFACE CACHE ERROR: %v", err)
		return
	}

	var games []string
	entries := make(map[string]models.IAGameEntry)
	seen := make(map[string]bool)

	for _, item := range items {
		if !validHuggingFaceDownloadURL(item.Link) {
			s.App.Logf("HUGGINGFACE CACHE: ignoring invalid item path=%q link=%q", item.Path, item.Link)
			continue
		}
		name := item.Path
		for _, suffix := range []string{".7z", ".zip", ".rar", " 7z", " zip", " rar"} {
			if strings.HasSuffix(strings.ToLower(name), suffix) {
				name = name[:len(name)-len(suffix)]
				break
			}
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}

		lower := strings.ToLower(name)
		seenKey := NormalizeTitleForMatching(name)
		if seenKey == "" {
			seenKey = lower
		}
		if !seen[seenKey] {
			seen[seenKey] = true
			games = append(games, name)
			entries["hf_"+platform+"\x00"+lower] = models.IAGameEntry{
				CollectionID: item.Size,
				FileName:     item.Link,
			}
		}
	}
	if len(games) == 0 {
		s.IA.preserveExistingCache("hf_"+platform, "HUGGINGFACE", fmt.Errorf("rebuild returned no valid downloadable games"))
		return
	}

	sort.Strings(games)
	s.IA.replaceMemoryCache("hf_"+platform, games, entries)
	s.IA.SaveCacheToDisk("hf_"+platform, games, entries)
	s.IA.SetBuildState("hf_"+platform, "ready", 1, 1)
	s.App.Logf("HUGGINGFACE CACHE: Complete — %d games", len(games))
}

func validHuggingFaceDownloadURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return false
	}
	switch strings.ToLower(filepath.Ext(parsed.Path)) {
	case ".zip", ".rar", ".7z":
		return true
	default:
		return false
	}
}

func sanitizeHuggingFaceCache(platform string, games []string, entries map[string]models.IAGameEntry) ([]string, map[string]models.IAGameEntry, int) {
	prefix := platform + "\x00"
	cleanEntries := make(map[string]models.IAGameEntry, len(entries))
	for key, entry := range entries {
		if strings.HasPrefix(key, prefix) && validHuggingFaceDownloadURL(entry.FileName) {
			cleanEntries[key] = entry
		}
	}
	cleanGames := make([]string, 0, len(games))
	seen := make(map[string]struct{}, len(games))
	for _, game := range games {
		key := prefix + strings.ToLower(strings.TrimSpace(game))
		if _, ok := cleanEntries[key]; !ok {
			continue
		}
		normalized := NormalizeTitleForMatching(game)
		if _, duplicate := seen[normalized]; duplicate {
			continue
		}
		seen[normalized] = struct{}{}
		cleanGames = append(cleanGames, game)
	}
	return cleanGames, cleanEntries, len(games) - len(cleanGames)
}

func HasHuggingFaceCatalog(a *app.App, platform string) bool {
	prefix := "hf_" + platform + "\x00"
	a.GameEntryMapMu.RLock()
	defer a.GameEntryMapMu.RUnlock()
	for k := range a.GameEntryMap {
		if strings.HasPrefix(k, prefix) {
			return true
		}
	}
	return false
}

func FindHuggingFaceEntry(a *app.App, gameName, platform string) (models.IAGameEntry, bool) {
	prefix := "hf_" + platform + "\x00"
	exactKey := prefix + strings.ToLower(strings.TrimSpace(gameName))

	a.GameEntryMapMu.RLock()
	defer a.GameEntryMapMu.RUnlock()

	if entry, ok := a.GameEntryMap[exactKey]; ok {
		return entry, true
	}
	var bestEntry models.IAGameEntry
	bestKey := ""
	bestScore := -1
	for k, entry := range a.GameEntryMap {
		if !strings.HasPrefix(k, prefix) {
			continue
		}
		name := k[len(prefix):]
		score := titleMatchScore(name, gameName)
		if score > bestScore || (score == bestScore && score >= 0 && name < bestKey) {
			bestEntry = entry
			bestKey = name
			bestScore = score
		}
	}
	if bestScore >= 0 {
		return bestEntry, true
	}
	return models.IAGameEntry{}, false
}
