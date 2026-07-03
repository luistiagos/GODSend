// huggingface.go — HuggingFace rom list fetching and caching.
package cache

import (
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"godsend/app"
	"godsend/models"
)

// HuggingFaceService manages the HuggingFace game cache.
type HuggingFaceService struct {
	App *app.App
	IA  *IAService
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
	resp, err := client.Get("https://emuladores.pythonanywhere.com/api/rom/list?system=xbox360rgh&source_id=1")
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
		if !seen[lower] {
			seen[lower] = true
			games = append(games, name)
			entries["hf_"+platform+"\x00"+lower] = models.IAGameEntry{
				CollectionID: item.Size,
				FileName:     item.Link,
			}
		}
	}

	sort.Strings(games)
	s.IA.SaveCacheToDisk("hf_"+platform, games, entries)
	s.IA.SetBuildState("hf_"+platform, "ready", 1, 1)
	s.App.Logf("HUGGINGFACE CACHE: Complete — %d games", len(games))
}
