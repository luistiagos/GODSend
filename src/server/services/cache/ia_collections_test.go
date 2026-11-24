package cache

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"godsend/app"
	"godsend/models"
)

func writeIADiskCache(t *testing.T, a *app.App, platform string, games []string, entries map[string]models.IAGameEntry) {
	t.Helper()
	dir := filepath.Join(a.ToolsDir, "cache")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(models.PlatformCache{Games: games, GameEntries: entries})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, platform+".json"), data, 0644); err != nil {
		t.Fatal(err)
	}
}

func withIACollections(t *testing.T, platform string, colls []string) {
	t.Helper()
	previous, existed := app.IACollections[platform]
	app.IACollections[platform] = colls
	t.Cleanup(func() {
		if existed {
			app.IACollections[platform] = previous
		} else {
			delete(app.IACollections, platform)
		}
	})
}

// The IA split microsoft_xbox_c into _c_part1/_c_part2: a disk cache built
// before that points at a 404 collection and must not be served as current.
func TestLoadCacheFromDiskDropsRetiredCollectionsAndAsksRebuild(t *testing.T) {
	const platform = "test-ia-retired"
	withIACollections(t, platform, []string{"coll_a", "coll_c_part1", "coll_c_part2"})

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	writeIADiskCache(t, a, platform,
		[]string{"Alpha", "Crash Old", "Crash New", "Crash Two"},
		map[string]models.IAGameEntry{
			"alpha":     {CollectionID: "coll_a", FileName: "Alpha.zip"},
			"crash old": {CollectionID: "coll_c", FileName: "Crash Old.zip"},
			"crash new": {CollectionID: "coll_c_part1", FileName: "Crash New.zip"},
			"crash two": {CollectionID: "coll_c_part2", FileName: "Crash Two.zip"},
		})

	service := &IAService{App: a}
	if service.LoadCacheFromDisk(platform) {
		t.Fatal("stale cache reported as current; startup would skip the rebuild")
	}
	if _, ok := a.GameEntryMap["crash old"]; ok {
		t.Fatal("entry from retired collection loaded; its download URL is a 404")
	}
	for _, key := range []string{"alpha", "crash new", "crash two"} {
		if _, ok := a.GameEntryMap[key]; !ok {
			t.Fatalf("valid entry %q dropped", key)
		}
	}
	if games := a.IAGameCache[platform]; len(games) != 3 {
		t.Fatalf("catalog should keep the 3 valid games while rebuilding, got %#v", games)
	}
}

func TestLoadCacheFromDiskAsksRebuildWhenConfiguredCollectionIsMissing(t *testing.T) {
	const platform = "test-ia-missing"
	withIACollections(t, platform, []string{"coll_a", "coll_c_part1"})

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	writeIADiskCache(t, a, platform, []string{"Alpha"},
		map[string]models.IAGameEntry{"alpha": {CollectionID: "coll_a", FileName: "Alpha.zip"}})

	service := &IAService{App: a}
	if service.LoadCacheFromDisk(platform) {
		t.Fatal("cache without coll_c_part1 reported as current")
	}
	if games := a.IAGameCache[platform]; len(games) != 1 {
		t.Fatalf("partial cache should still be served, got %#v", games)
	}
}

func TestLoadCacheFromDiskAcceptsCompleteCache(t *testing.T) {
	const platform = "test-ia-complete"
	withIACollections(t, platform, []string{"coll_a", "coll_b"})

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	writeIADiskCache(t, a, platform, []string{"Alpha", "Beta"},
		map[string]models.IAGameEntry{
			"alpha": {CollectionID: "coll_a", FileName: "Alpha.zip"},
			"beta":  {CollectionID: "coll_b", FileName: "Beta.zip"},
		})

	service := &IAService{App: a}
	if !service.LoadCacheFromDisk(platform) {
		t.Fatal("complete cache rejected; every startup would rebuild it")
	}
}

// TestRemoteIACollectionsExist is an opt-in network check that every collection
// in app.IACollections still answers with downloadable archives. It is the
// check that would have caught the 2026-11 split of microsoft_xbox_{c,d,m,n,o,s,t}.
func TestRemoteIACollectionsExist(t *testing.T) {
	if os.Getenv("GODSEND_REMOTE_CATALOG_AUDIT") != "1" {
		t.Skip("set GODSEND_REMOTE_CATALOG_AUDIT=1 to verify every configured IA collection")
	}
	service := &IAService{App: app.NewApp()}
	for platform, colls := range app.IACollections {
		for _, coll := range colls {
			entries, err := service.DoIAMetaFetch(coll)
			if err != nil {
				t.Errorf("%s: %s: %v", platform, coll, err)
				continue
			}
			if len(entries) == 0 {
				t.Errorf("%s: %s: no downloadable archives (collection gone or renamed?)", platform, coll)
			}
		}
	}
}
