package cache

import (
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

func TestFindHuggingFaceEntryMatchesRegionalSelection(t *testing.T) {
	a := app.NewApp()
	want := models.IAGameEntry{CollectionID: "hf", FileName: "007 Legends.7z"}
	a.GameEntryMap["hf_xbox360\x00007 legends"] = want

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
