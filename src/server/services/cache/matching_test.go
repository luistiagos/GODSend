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

// A region-less request is the name HuggingFace publishes. When HuggingFace failed, the
// fallback ranked variants only by how few tags they carry, so the one-country release won:
// "Red Dead Redemption" became the Japanese disc while the USA/Europe one sat beside it.
func TestRegionlessRequestFallsBackToEnglishRelease(t *testing.T) {
	a := app.NewApp()
	want := models.IAGameEntry{CollectionID: "ia", FileName: "Red Dead Redemption (USA, Europe) (En,Fr,De,Es,It).zip"}
	a.GameEntryMap["red dead redemption (japan)"] = models.IAGameEntry{CollectionID: "ia", FileName: "Red Dead Redemption (Japan).zip"}
	a.GameEntryMap["red dead redemption (usa, europe) (en,fr,de,es,it)"] = want

	got, err := (&IAService{App: a}).FindEntry("Red Dead Redemption", "xbox360")
	if err != nil || got != want {
		t.Fatalf("expected the English release, got %#v, %v", got, err)
	}
}

func TestPinnedRequestKeepsItsRegion(t *testing.T) {
	requested := "Red Dead Redemption (Japan)"
	if titleMatchScore("Red Dead Redemption (Japan) (En,Ja)", requested) <= titleMatchScore("Red Dead Redemption (USA)", requested) {
		t.Fatal("a request that names its region must keep it")
	}
}

func TestRegionlessDiscRequestKeepsItsDisc(t *testing.T) {
	requested := "Battlefield 4 (Disc 2)"
	if titleMatchScore("Battlefield 4 (Japan) (Disc 2)", requested) <= titleMatchScore("Battlefield 4 (USA, Europe) (Disc 1)", requested) {
		t.Fatal("the requested disc must outrank the preferred region")
	}
	if titleMatchScore("Battlefield 4 (USA, Europe) (Disc 2)", requested) <= titleMatchScore("Battlefield 4 (Japan) (Disc 2)", requested) {
		t.Fatal("among discs with the requested number, the English release must win")
	}
}

// Pairs that shared one key in the packaged catalogs: the browse merge listed only one of
// each, and the fallback scored every one of them as an exact match for the other.
func TestDottedTitlesKeepTheirDistinctGames(t *testing.T) {
	distinct := [][2]string{
		{"WWE SmackDown vs. Raw 2011 (USA, Europe) (En,Fr,De,Es,It)", "WWE SmackDown vs. Raw 2007 (USA, Europe)"},
		{"F.E.A.R. 2 - Project Origin (USA, Korea) (En,Fr,De,Es,It)", "F.E.A.R. 3 (World) (En,Ja,Fr,De,Es,It,Pt,Ko,Pl,Ru)"},
		{"Plants vs. Zombies (USA) (En,Ja,Fr,De,Es,It)", "Plants vs. Zombies - Garden Warfare (USA, Europe) (En,Ja,Fr,De,Es,It,Pt)"},
		{"L.A. Noire (USA, Europe) (Disc 1)", "L.A. Noire - The Complete Edition (USA, Europe) (En,Fr,De,Es,It) (Disc 1)"},
		{"Disney Infinity 2.0 Edition (USA) (En,Fr,Es,Pt)", "Disney Infinity 3.0 Edition (USA) (En,Fr,Es)"},
	}
	for _, pair := range distinct {
		if TitleMatches(pair[0], pair[1]) {
			t.Errorf("%q and %q are different games", pair[0], pair[1])
		}
	}
	if !TitleMatches("WWE SmackDown vs. Raw 2011 (USA, Europe) (En,Fr,De,Es,It)", "WWE SmackDown vs. Raw 2011") {
		t.Error("a dotted title must still match its region-less request")
	}
	if !TitleMatches("007 Legends (USA, Europe) (En,Fr,De).zip", "007 Legends") {
		t.Error("an archive extension must still be ignored")
	}
}

// The English preference must not hand the fallback a demo or beta, nor a European release
// whose language list leaves English out: "Conan" became "(USA) (Demo)" and "Assassins Creed
// Brotherhood" became "(Europe) (It,Pl,Ru)" with the English releases in the same catalog.
func TestRegionlessRequestSkipsDemosAndNonEnglishEurope(t *testing.T) {
	if titleMatchScore("Conan (World) (En,Fr,De,Es,It)", "Conan") <= titleMatchScore("Conan (USA) (Demo)", "Conan") {
		t.Error("the retail release must outrank the demo")
	}
	request := "Assassins Creed Brotherhood"
	english := "Assassin's Creed - Brotherhood (USA, Europe) (En,Fr,De,Es,It,Nl,Pt,Sv,No,Da)"
	if titleMatchScore(english, request) <= titleMatchScore("Assassin's Creed - Brotherhood (Europe) (It,Pl,Ru)", request) {
		t.Error("a European release without English must not count as English")
	}
	if !PreferVariant("Grid (USA, Europe) (En,Fr,De,Es,It)", "Grid (USA) (En,Fr,De,Es,It) (Demo)") {
		t.Error("the listing must show the retail release, not the demo")
	}
}

func TestPreferVariantListsTheReleaseTheFallbackDownloads(t *testing.T) {
	japan := "Assassin's Creed (Japan)"
	usa := "Assassin's Creed (USA, Europe) (En,Fr,De,Es,It)"
	if !PreferVariant(usa, japan) || PreferVariant(japan, usa) {
		t.Fatal("the listing must show the English release")
	}
}
