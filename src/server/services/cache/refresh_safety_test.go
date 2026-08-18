package cache

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
