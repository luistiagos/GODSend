package cache

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godsend/app"
	"godsend/models"
)

func TestIABuildPreservesCompleteCacheWhenOneCollectionFails(t *testing.T) {
	const platform = "test-ia-preserve"
	previous, existed := app.IACollections[platform]
	app.IACollections[platform] = []string{"collection-ok", "collection-failed"}
	t.Cleanup(func() {
		if existed {
			app.IACollections[platform] = previous
		} else {
			delete(app.IACollections, platform)
		}
	})

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.ToolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	a.IAGameCache[platform] = []string{"Existing Game"}
	a.GameEntryMap["existing game"] = models.IAGameEntry{CollectionID: "collection-ok", FileName: "Existing Game.zip"}

	service := &IAService{App: a, FetchCollectionEntriesFn: func(collectionID string) ([]models.IAGameEntry, error) {
		if collectionID == "collection-failed" {
			return nil, errors.New("provider unavailable")
		}
		return []models.IAGameEntry{{CollectionID: collectionID, FileName: "Replacement Game.zip"}}, nil
	}}
	service.Build(platform)

	if games := a.IAGameCache[platform]; len(games) != 1 || games[0] != "Existing Game" {
		t.Fatalf("partial rebuild replaced complete cache: %#v", games)
	}
	if _, ok := a.GameEntryMap["replacement game"]; ok {
		t.Fatal("partial rebuild leaked an entry into the live catalog")
	}
}

func TestIABuildPublishesCompleteCacheAndRemovesStaleEntries(t *testing.T) {
	const platform = "test-ia-publish"
	previous, existed := app.IACollections[platform]
	app.IACollections[platform] = []string{"collection-one", "collection-two"}
	t.Cleanup(func() {
		if existed {
			app.IACollections[platform] = previous
		} else {
			delete(app.IACollections, platform)
		}
	})

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.ToolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	a.IAGameCache[platform] = []string{"Stale Game"}
	a.GameEntryMap["stale game"] = models.IAGameEntry{CollectionID: "collection-one", FileName: "Stale Game.zip"}

	service := &IAService{App: a, FetchCollectionEntriesFn: func(collectionID string) ([]models.IAGameEntry, error) {
		return []models.IAGameEntry{{CollectionID: collectionID, FileName: collectionID + ".zip"}}, nil
	}}
	service.Build(platform)

	if games := a.IAGameCache[platform]; len(games) != 2 {
		t.Fatalf("expected complete replacement, got %#v", games)
	}
	if _, ok := a.GameEntryMap["stale game"]; ok {
		t.Fatal("successful rebuild retained a stale platform entry")
	}
}

func TestHuggingFaceBuildPreservesCacheOnEmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer server.Close()

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.ToolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	a.IAGameCache["hf_xbox360"] = []string{"Existing Game"}
	a.GameEntryMap["hf_xbox360\x00existing game"] = models.IAGameEntry{CollectionID: "1 GiB", FileName: "https://example.com/Existing%20Game.7z"}
	ia := &IAService{App: a}
	service := &HuggingFaceService{App: a, IA: ia, CatalogURL: server.URL}

	service.Build("xbox360")

	if games := a.IAGameCache["hf_xbox360"]; len(games) != 1 || games[0] != "Existing Game" {
		t.Fatalf("empty response replaced HuggingFace cache: %#v", games)
	}
}

func TestHuggingFaceBuildPublishesFreshCacheInMemory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{
  "console":"xbox360rgh",
  "link":"https://example.com/Fresh%20Game.7z",
  "path":"Fresh Game.7z",
  "size":"2 GiB"
}]`))
	}))
	defer server.Close()

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.ToolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	a.IAGameCache["hf_xbox360"] = []string{"Stale Game"}
	a.GameEntryMap["hf_xbox360\x00stale game"] = models.IAGameEntry{CollectionID: "1 GiB", FileName: "https://example.com/Stale%20Game.7z"}
	ia := &IAService{App: a}
	service := &HuggingFaceService{App: a, IA: ia, CatalogURL: server.URL}

	service.Build("xbox360")

	if games := a.IAGameCache["hf_xbox360"]; len(games) != 1 || games[0] != "Fresh Game" {
		t.Fatalf("fresh response was not published in memory: %#v", games)
	}
	if _, ok := a.GameEntryMap["hf_xbox360\x00stale game"]; ok {
		t.Fatal("fresh response retained stale HuggingFace entry")
	}
	if _, ok := a.GameEntryMap["hf_xbox360\x00fresh game"]; !ok {
		t.Fatal("fresh HuggingFace entry missing from live map")
	}
}

func TestHuggingFaceBuildRejectsIncompleteGTA5(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
{
  "console":"xbox360rgh",
  "link":"https://huggingface.co/datasets/luistiagos/xbx/resolve/main/GTA%205%20%287.61%29.7z",
  "path":"GTA 5 (7.61).7z",
  "size":"6758.12MB"
},
{
  "console":"xbox360rgh",
  "link":"https://archive.org/download/mx360gcpt3-x360-ztm/Grand.Theft.Auto.5.EUR.X360-ZTM.rar",
  "path":"Grand Theft Auto 5.rar",
  "size":"14.36 GiB"
}
]`))
	}))
	defer server.Close()

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.ToolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	ia := &IAService{App: a}
	service := &HuggingFaceService{App: a, IA: ia, CatalogURL: server.URL}

	service.Build("xbox360")

	// The incomplete 7.61 GB URL must not be in the entry map
	for k, v := range a.GameEntryMap {
		if strings.Contains(v.FileName, "GTA%205%20%287.61%29.7z") {
			t.Fatalf("entry %s has incomplete GTA 5 URL: %s", k, v.FileName)
		}
	}
	// GTA 5 should point to the complete Grand Theft Auto 5 release
	entry, ok := a.GameEntryMap["hf_xbox360\x00gta 5"]
	if !ok {
		t.Fatal("expected hf_xbox360\x00gta 5 to be aliased to the full release")
	}
	if !strings.Contains(entry.FileName, "Grand.Theft.Auto.5") {
		t.Fatalf("expected full ZTM release, got %s", entry.FileName)
	}
}

// Both releases are listed as Grand Theft Auto V and deliver Sleeping Dogs: "OG ONLINE" is a
// Sleeping Dogs rar, and the PT-BR one keeps Sleeping Dogs' default.xex at the root of the zip,
// which the XEX path installs as the game. The links are the API's own, encoding included.
const (
	hfGTA5OGOnlineSleepingDogs = "https://huggingface.co/datasets/luisluis123/xboxrghgames/resolve/main/Grand%20Theft%20Auto%20V%E2%84%A2%20OG%20ONLINE%20%2B%20DLC%20FULL%20%28%20XBOX%20360%20RGH%20%29.zip"
	hfGTA5PTBRSleepingDogsRoot = "https://huggingface.co/datasets/luisluis123/xboxrghgames/resolve/main/GTA%205%20PT-BR%20%2B%20DLC%20%2B%20TU%20%2B%20SAVE%20100%20%25%20.GOD%20%28%20XBOX%20360%20RGH%20%29.zip"
)

func TestHuggingFaceBuildRejectsGTA5ReleasesThatShipSleepingDogs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
{"console":"Xbox 360 RGH","link":"` + hfGTA5OGOnlineSleepingDogs + `","path":"Grand Theft Auto V OG ONLINE + DLC FULL ( XBOX 360 RGH ).zip","size":"4.98 GiB"},
{"console":"Xbox 360 RGH","link":"` + hfGTA5PTBRSleepingDogsRoot + `","path":"GTA 5 PT-BR + DLC + TU + SAVE 100 % .GOD ( XBOX 360 RGH ).zip","size":"21.96 GiB"},
{"console":"Xbox 360 RGH","link":"https://archive.org/download/mx360gcpt3-x360-ztm/Grand.Theft.Auto.5.EUR.X360-ZTM.rar","path":"Grand Theft Auto 5.rar","size":"14.36 GiB"}
]`))
	}))
	defer server.Close()

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.ToolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	service := &HuggingFaceService{App: a, IA: &IAService{App: a}, CatalogURL: server.URL}

	service.Build("xbox360")

	for k, v := range a.GameEntryMap {
		if v.FileName == hfGTA5OGOnlineSleepingDogs || v.FileName == hfGTA5PTBRSleepingDogsRoot {
			t.Fatalf("entry %q points to a release that ships Sleeping Dogs: %s", k, v.FileName)
		}
	}
	if games := a.IAGameCache["hf_xbox360"]; strings.Join(games, ",") != "GTA 5,Grand Theft Auto 5" {
		t.Fatalf("expected only the ZTM release and its alias, got %v", games)
	}
}

func TestSanitizeHuggingFaceCacheRemovesGTA5ReleasesThatShipSleepingDogs(t *testing.T) {
	games := []string{"GTA 5 PT-BR + DLC + TU + SAVE 100 % .GOD ( XBOX 360 RGH )", "Grand Theft Auto V OG ONLINE + DLC FULL ( XBOX 360 RGH )"}
	entries := map[string]models.IAGameEntry{
		"xbox360\x00gta 5 pt-br + dlc + tu + save 100 % .god ( xbox 360 rgh )": {CollectionID: "21.96 GiB", FileName: hfGTA5PTBRSleepingDogsRoot},
		"xbox360\x00grand theft auto v og online + dlc full ( xbox 360 rgh )":   {CollectionID: "4.98 GiB", FileName: hfGTA5OGOnlineSleepingDogs},
	}

	cleanGames, cleanEntries, _ := sanitizeHuggingFaceCache("xbox360", games, entries)
	if len(cleanGames) != 0 || len(cleanEntries) != 0 {
		t.Fatalf("a cache saved before the filter kept them: games=%v entries=%v", cleanGames, cleanEntries)
	}
}

func TestSanitizeHuggingFaceCacheRemovesIncompleteGTA5(t *testing.T) {
	games := []string{"GTA 5", "Grand Theft Auto 5"}
	entries := map[string]models.IAGameEntry{
		"xbox360\x00gta 5": {
			CollectionID: "6758.12MB",
			FileName:     "https://huggingface.co/datasets/luistiagos/xbx/resolve/main/GTA%205%20%287.61%29.7z",
		},
		"xbox360\x00grand theft auto 5": {
			CollectionID: "14.36 GiB",
			FileName:     "https://archive.org/download/mx360gcpt3-x360-ztm/Grand.Theft.Auto.5.EUR.X360-ZTM.rar",
		},
	}

	cleanGames, cleanEntries, _ := sanitizeHuggingFaceCache("xbox360", games, entries)
	gtaEntry, ok := cleanEntries["xbox360\x00gta 5"]
	if !ok {
		t.Fatal("gta 5 entry missing from clean entries")
	}
	if strings.Contains(gtaEntry.FileName, "7.61") {
		t.Fatalf("incomplete GTA 5 URL was not sanitized: %s", gtaEntry.FileName)
	}
	if !strings.Contains(gtaEntry.FileName, "Grand.Theft.Auto.5") {
		t.Fatalf("gta 5 should alias to full release: %s", gtaEntry.FileName)
	}
	// A queued job named "GTA 5" is relaunched by that name, so the row has to stay listed.
	if strings.Join(cleanGames, ",") != "GTA 5,Grand Theft Auto 5" {
		t.Fatalf("expected both rows to stay listed, got %v", cleanGames)
	}
}
