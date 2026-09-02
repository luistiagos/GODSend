package models

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func loadEmbeddedTitleNames(t *testing.T) map[uint32]string {
	t.Helper()
	path := filepath.Join("..", "data", "iso2god_titles.jsonl")
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	names := make(map[uint32]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var row struct {
			TitleID string `json:"TitleID"`
			Name    string `json:"Name"`
		}
		if json.Unmarshal(scanner.Bytes(), &row) != nil {
			continue
		}
		var id uint32
		if _, err := fmtSscanfHex(row.TitleID, &id); err == nil {
			names[id] = row.Name
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return names
}

func fmtSscanfHex(value string, target *uint32) (int, error) {
	return fmt.Sscanf(value, "%08X", target)
}

func TestDiscCompatTableUsesRealCatalogTitleIDs(t *testing.T) {
	names := loadEmbeddedTitleNames(t)
	expectedTitleToken := map[uint32]string{
		0x5345085E: "alien", 0x555308C2: "assassin", 0x57520802: "arkham city", 0x57520828: "arkham origins",
		0x454109BA: "battlefield 4", 0x545407D8: "bioshock", 0x54540861: "bioshock 2", 0x5454085D: "bioshock infinite",
		0x41560914: "advanced warfare", 0x415608FC: "ghosts", 0x465307E4: "dark souls ii", 0x425307E3: "dishonored",
		0x43430814: "dark arisen", 0x425307D1: "oblivion", 0x425307E6: "skyrim", 0x425307D5: "fallout 3",
		0x425307E0: "new vegas", 0x4D5307EA: "forza motorsport 2", 0x4D53084D: "forza motorsport 3",
		0x4D530910: "forza motorsport 4", 0x545408A7: "gta v", 0x545407E6: "mafia ii", 0x4D5307E8: "mass effect",
		0x4B4E085E: "phantom pain", 0x5451086D: "saints row: the third", 0x4B4D07F6: "saints row iv", 0x555308B6: "splinter cell blacklist",
	}
	if len(DiscCompatTable) < 25 {
		t.Fatalf("compatibility table unexpectedly small: %d", len(DiscCompatTable))
	}
	for key, rec := range DiscCompatTable {
		name := names[key.TitleID]
		if name == "" {
			t.Errorf("TitleID %08X disc %d is absent from embedded title catalog", key.TitleID, key.DiscNumber)
		} else if token := expectedTitleToken[key.TitleID]; token == "" || !strings.Contains(strings.ToLower(name), token) {
			t.Errorf("TitleID %08X resolves to unrelated title %q; expected token %q", key.TitleID, name, token)
		}
		if key.DiscNumber == 0 || (rec.InstallType != "god" && rec.InstallType != "content" && rec.InstallType != "xex") {
			t.Errorf("invalid compatibility row %08X disc %d: %+v", key.TitleID, key.DiscNumber, rec)
		}
	}
	for _, hint := range titleNameHints {
		if names[hint.titleID] == "" {
			t.Errorf("name hint uses unknown TitleID %08X", hint.titleID)
		}
	}
}

func TestKnownInstallDiscs(t *testing.T) {
	tests := []struct {
		id   uint32
		disc byte
		want string
	}{
		{0x5345085E, 1, "content"}, // Alien: Isolation install disc comes first.
		{0x454109BA, 1, "content"}, // Battlefield 4 install disc comes first.
		{0x545408A7, 1, "content"}, // GTA V install disc comes first.
		{0x4B4E085E, 1, "content"}, // MGSV install disc comes first.
		{0x4D5307EA, 2, "content"},
		{0x4D53084D, 2, "content"},
		{0x4D530910, 2, "content"},
		{0x555308C2, 2, "xex"}, // AC IV multiplayer disc is explicitly No GOD.
		{0x555308B6, 2, "god"}, // Mixed disc remains playable as GOD.
	}
	for _, test := range tests {
		if got := DiscCompat(test.id, test.disc).InstallType; got != test.want {
			t.Errorf("%08X disc %d: got %q, want %q", test.id, test.disc, got, test.want)
		}
	}
}

func TestUnknownContinuationDiscDefaultsToGOD(t *testing.T) {
	if got := DiscCompat(0, 2).InstallType; got != "god" {
		t.Fatalf("unknown Disc 2 defaulted to %q; want safe GOD continuation", got)
	}
}

func TestCatalogMultiDiscNamesAlwaysProduceSafeRecommendation(t *testing.T) {
	repoRoot := filepath.Join("..", "..", "..")
	total := 0
	for _, fileName := range []string{"xbox360.json", "hf_xbox360.json", "minerva_xbox360.json"} {
		data, err := os.ReadFile(filepath.Join(repoRoot, "cache", fileName))
		if err != nil {
			t.Fatal(err)
		}
		var catalog struct {
			Games []string `json:"games"`
		}
		if err := json.Unmarshal(data, &catalog); err != nil {
			t.Fatal(err)
		}
		for _, game := range catalog.Games {
			disc := DiscNumberFromName(game)
			if disc < 2 {
				continue
			}
			total++
			rec := DiscCompat(GuessTitleIDFromMultiDiscName(game), disc)
			if rec.InstallType != "god" && rec.InstallType != "content" && rec.InstallType != "xex" {
				t.Errorf("%s: invalid recommendation %q", game, rec.InstallType)
			}
		}
	}
	if total < 250 {
		t.Fatalf("audited only %d multi-disc catalog rows; expected at least 250", total)
	}
	t.Logf("audited %d Disc 2+ rows across the packaged Xbox 360 catalogs", total)
}

func TestUnsupportedCustomLayoutsAreBlocked(t *testing.T) {
	if reason := UnsupportedMultiDiscReason("Watch_Dogs (USA, Europe) (Disc 2)"); reason == "" {
		t.Fatal("Watch Dogs custom two-disc layout was not blocked")
	}
	if reason := UnsupportedMultiDiscReason("Watch Dogs (Disc 1)"); reason != "" {
		t.Fatalf("Disc 1 catalog name should not be treated as a Disc 2+ selection: %s", reason)
	}
}

func TestGuessTitleIDFromCatalogNames(t *testing.T) {
	tests := map[string]uint32{
		"Forza Motorsport 3 (USA) (Disc 2) (Content Install Disc)":    0x4D53084D,
		"Forza Motorsport 4 (Europe) (Disc 2) (Content Install Disc)": 0x4D530910,
		"Batman - Arkham City - Game of the Year Edition (Disc 2)":    0x57520802,
		"Fallout - New Vegas - Ultimate Edition (Disc 2)":             0x425307E0,
		"Borderlands - The Pre-Sequel (Disc 2)":                       0,
	}
	for name, want := range tests {
		if got := GuessTitleIDFromMultiDiscName(name); got != want {
			t.Errorf("%q: got %08X, want %08X", name, got, want)
		}
	}
}

func TestDiscNumberFromName(t *testing.T) {
	for name, want := range map[string]byte{
		"Game (Disc 2)": 2,
		"Game [DVD3]":   3,
		"Game CD 4":     4,
		"Game Disc 1":   0,
	} {
		if got := DiscNumberFromName(name); got != want {
			t.Errorf("%q: got %d, want %d", name, got, want)
		}
	}
}

func TestNameHintsDoNotMatchSequelsAccidentally(t *testing.T) {
	for _, name := range []string{"Mass Effect 2 (Disc 2)", "Mass Effect 3 (Disc 2)", "BioShock 2 Infinite"} {
		if got := GuessTitleIDFromMultiDiscName(name); got != 0 {
			t.Errorf("%q matched unrelated TitleID %08X", name, got)
		}
	}
}
