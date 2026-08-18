package cache

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godsend/app"
	"godsend/models"
)

func TestFindEntry(t *testing.T) {
	a := app.NewApp()
	svc := &MinervaService{App: a}

	// Populate MinervaEntryMap with test entries across platforms
	a.MinervaEntryMapMu.Lock()
	a.MinervaEntryMap["teenage mutant ninja turtles - out of the shadows (world) (xbla)"] = models.MinervaEntry{
		FileName:  "Teenage Mutant Ninja Turtles - Out of the Shadows (World) (XBLA).zip",
		PathParam: "xbla_tmnt",
		Platform:  "xbla",
	}
	a.MinervaEntryMap["teenage mutant ninja turtles (usa, europe)"] = models.MinervaEntry{
		FileName:  "Teenage Mutant Ninja Turtles (USA, Europe).zip",
		PathParam: "360_tmnt",
		Platform:  "xbox360",
	}
	a.MinervaEntryMapMu.Unlock()

	// Case 1: Search "Teenage Mutant Ninja Turtles" under "xbox360"
	entry, ok := svc.FindEntry("Teenage Mutant Ninja Turtles", "xbox360")
	if !ok {
		t.Fatalf("expected to find Teenage Mutant Ninja Turtles")
	}
	if entry.Platform != "xbox360" {
		t.Errorf("expected platform xbox360, got %s (file: %s)", entry.Platform, entry.FileName)
	}

	// Case 2: Search "Teenage Mutant Ninja Turtles Out of the Shadows" under "xbla"
	entry2, ok2 := svc.FindEntry("Teenage Mutant Ninja Turtles Out of the Shadows", "xbla")
	if !ok2 {
		t.Fatalf("expected to find Teenage Mutant Ninja Turtles Out of the Shadows")
	}
	if entry2.Platform != "xbla" {
		t.Errorf("expected platform xbla, got %s (file: %s)", entry2.Platform, entry2.FileName)
	}
}

func TestFindEntryMatchesGOTYAliasAndPrefersDiscOne(t *testing.T) {
	a := app.NewApp()
	svc := &MinervaService{App: a}
	a.MinervaEntryMap["batman - arkham city - game of the year edition (usa, europe) (disc 2)"] = models.MinervaEntry{
		FileName: "Batman - Arkham City - Game of the Year Edition (USA, Europe) (Disc 2).zip",
		Platform: "xbox360",
	}
	a.MinervaEntryMap["batman - arkham city - game of the year edition (usa, europe) (disc 1)"] = models.MinervaEntry{
		FileName: "Batman - Arkham City - Game of the Year Edition (USA, Europe) (Disc 1).zip",
		Platform: "xbox360",
	}

	entry, ok := svc.FindEntry("Batman Arkham City GOTY", "xbox360")
	if !ok {
		t.Fatal("expected GOTY alias to resolve in Minerva")
	}
	if !strings.Contains(entry.FileName, "Disc 1") {
		t.Fatalf("expected deterministic Disc 1 fallback, got %q", entry.FileName)
	}
}

func TestLoadCacheFromDiskMigratesSchema2(t *testing.T) {
	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	cacheDir := filepath.Join(a.ToolsDir, "cache")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		t.Fatal(err)
	}

	oldCache := models.MinervaPlatformCache{
		Schema: 2,
		Games:  []string{"007 Legends (USA, Europe) (En,Fr,De)"},
		Entries: map[string]models.MinervaEntry{
			"007 legends (usa, europe) (en,fr,de)": {
				FileName:  "007 Legends (USA, Europe) (En,Fr,De).zip",
				PathParam: "007-legends",
			},
		},
	}
	data, err := json.Marshal(oldCache)
	if err != nil {
		t.Fatal(err)
	}
	cacheFile := filepath.Join(cacheDir, "minerva_xbox360.json")
	if err := os.WriteFile(cacheFile, data, 0644); err != nil {
		t.Fatal(err)
	}

	svc := &MinervaService{App: a}
	if !svc.LoadCacheFromDisk("xbox360") {
		t.Fatal("expected schema 2 cache to be migrated and loaded")
	}
	entry, ok := svc.FindEntry("007 Legends", "xbox360")
	if !ok || entry.Platform != "xbox360" {
		t.Fatalf("expected migrated lookup with platform, got %#v, %v", entry, ok)
	}

	migratedData, err := os.ReadFile(cacheFile)
	if err != nil {
		t.Fatal(err)
	}
	var migrated models.MinervaPlatformCache
	if err := json.Unmarshal(migratedData, &migrated); err != nil {
		t.Fatal(err)
	}
	if migrated.Schema != app.MinervaCacheSchema {
		t.Fatalf("expected schema %d, got %d", app.MinervaCacheSchema, migrated.Schema)
	}
}
