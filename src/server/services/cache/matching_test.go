package cache

import (
	"strings"
	"testing"

	"godsend/app"
	"godsend/models"
)

func TestNormalizeTitleForMatchingRegionalVariants(t *testing.T) {
	tests := [][2]string{
		{"007 Legends", "007 Legends (USA, Europe) (En,Fr,De)"},
		{"Split/Second - Velocity", "Split-Second - Velocity (Russia)"},
		{"NASCAR '15", "NASCAR 15 (USA)"},
		{"Batman Arkham City GOTY", "Batman - Arkham City - Game of the Year Edition (USA, Europe) (Disc 1)"},
		{
			"Forza Horizon 2 (Europe) (En,Ja,Fr,De,Es,It,Pt,Zh,Pl,Ru)",
			"Forza Horizon 2 (Europe) (En,Ja,Fr,De,Es,It,Pt,Zh,Pl,Ru) (En,Ja,Pl,Ru)",
		},
	}
	for _, tt := range tests {
		if !TitleMatches(tt[0], tt[1]) {
			t.Errorf("expected %q to match %q", tt[0], tt[1])
		}
	}
	if NormalizeTitleForMatching("Batman Arkham City") == NormalizeTitleForMatching("Batman Arkham City GOTY") {
		t.Fatal("edition words must remain part of the normalized title")
	}
}

func TestIAFindEntryMatchesMinervaForzaVariant(t *testing.T) {
	a := app.NewApp()
	spain := models.IAGameEntry{
		CollectionID: "microsoft_xbox360_f_part2",
		FileName:     "Forza Horizon 2 (Spain) (En,Ja,Fr,De,Es,It,Pt,Zh,Pl,Ru).zip",
	}
	want := models.IAGameEntry{
		CollectionID: "microsoft_xbox360_f_part2",
		FileName:     "Forza Horizon 2 (Europe) (En,Ja,Fr,De,Es,It,Pt,Zh,Pl,Ru).zip",
	}
	a.GameEntryMap[strings.ToLower(strings.TrimSuffix(spain.FileName, ".zip"))] = spain
	a.GameEntryMap[strings.ToLower(strings.TrimSuffix(want.FileName, ".zip"))] = want

	selected := "Forza Horizon 2 (Europe) (En,Ja,Fr,De,Es,It,Pt,Zh,Pl,Ru) (En,Ja,Pl,Ru)"
	got, err := (&IAService{App: a}).FindEntry(selected, "xbox360")
	if err != nil || got != want {
		t.Fatalf("expected Internet Archive fallback for Minerva title, got %#v, %v", got, err)
	}
}

func TestTitleMatchScorePrefersRegionAndDisc(t *testing.T) {
	requested := "Forza Horizon 2 (Europe) (En,Ja,Fr,De,Es,It,Pt,Zh,Pl,Ru) (En,Ja,Pl,Ru)"
	europe := "Forza Horizon 2 (Europe) (En,Ja,Fr,De,Es,It,Pt,Zh,Pl,Ru)"
	spain := "Forza Horizon 2 (Spain) (En,Ja,Fr,De,Es,It,Pt,Zh,Pl,Ru)"
	if titleMatchScore(europe, requested) <= titleMatchScore(spain, requested) {
		t.Fatal("expected the European catalog variant to outrank the Spanish variant")
	}
	if titleMatchScore("Example (Disc 2)", "Example (Disc 2)") <= titleMatchScore("Example (Disc 1)", "Example (Disc 2)") {
		t.Fatal("expected the requested disc number to outrank another disc")
	}
}

func TestFindHuggingFaceEntryMatchesRegionalSelection(t *testing.T) {
	a := app.NewApp()
	want := models.IAGameEntry{CollectionID: "hf", FileName: "007 Legends (USA, Europe).7z"}
	a.GameEntryMap["hf_xbox360\x00007 legends (japan)"] = models.IAGameEntry{CollectionID: "hf", FileName: "007 Legends (Japan).7z"}
	a.GameEntryMap["hf_xbox360\x00007 legends (usa, europe)"] = want

	got, ok := FindHuggingFaceEntry(a, "007 Legends (USA, Europe) (En,Fr,De)", "xbox360")
	if !ok || got != want {
		t.Fatalf("expected HuggingFace regional match, got %#v, %v", got, ok)
	}
}

func TestIAFindEntryIgnoresHuggingFaceKeys(t *testing.T) {
	a := app.NewApp()
	a.GameEntryMap["hf_xbox360\x00007 legends"] = models.IAGameEntry{CollectionID: "hf", FileName: "hf.7z"}
	want := models.IAGameEntry{CollectionID: "ia", FileName: "007 Legends (USA).zip"}
	a.GameEntryMap["007 legends (usa)"] = want

	got, err := (&IAService{App: a}).FindEntry("007 Legends (USA, Europe) (En,Fr,De)", "xbox360")
	if err != nil || got != want {
		t.Fatalf("expected Internet Archive match, got %#v, %v", got, err)
	}
}
