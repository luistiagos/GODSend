package cache

import (
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"godsend/app"
)

// TestPackagedXbox360CatalogResolvesEveryPublishedTitle guards the contract of
// the browse screen: every title it publishes must resolve back to at least the
// provider that contributed it.
func TestPackagedXbox360CatalogResolvesEveryPublishedTitle(t *testing.T) {
	repoRoot, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	a := app.NewApp()
	a.ToolsDir = repoRoot
	ia := &IAService{App: a}
	minerva := &MinervaService{App: a}

	if !ia.LoadCacheFromDisk("xbox360") {
		t.Fatal("packaged Internet Archive xbox360 cache did not load")
	}
	if !ia.LoadCacheFromDisk("hf_xbox360") {
		t.Fatal("packaged HuggingFace xbox360 cache did not load")
	}
	if !minerva.LoadCacheFromDisk("xbox360") {
		t.Fatal("packaged Minerva xbox360 cache did not load")
	}

	resolveIA := func(game string) bool {
		if _, ok := a.GameEntryMap[strings.ToLower(game)]; ok {
			return true
		}
		for key := range a.GameEntryMap {
			if !strings.Contains(key, "\x00") && TitleMatches(key, game) {
				return true
			}
		}
		return false
	}

	checks := []struct {
		name    string
		games   []string
		resolve func(string) bool
	}{
		{"huggingface", a.IAGameCache["hf_xbox360"], func(game string) bool {
			_, ok := FindHuggingFaceEntry(a, game, "xbox360")
			return ok
		}},
		{"internet-archive", a.IAGameCache["xbox360"], resolveIA},
		{"minerva", a.MinervaGameCache["xbox360"], func(game string) bool {
			_, ok := minerva.FindEntry(game, "xbox360")
			return ok
		}},
	}

	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			var missing []string
			for _, game := range check.games {
				if !check.resolve(game) {
					missing = append(missing, game)
					if len(missing) == 20 {
						break
					}
				}
			}
			if len(missing) > 0 {
				t.Fatalf("%d+ published title(s) do not resolve: %s", len(missing), fmt.Sprint(missing))
			}
		})
	}

	t.Run("provider-entry-fields", func(t *testing.T) {
		for key, entry := range a.GameEntryMap {
			if strings.HasPrefix(key, "hf_xbox360\x00") {
				parsed, parseErr := url.Parse(entry.FileName)
				if parseErr != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
					t.Errorf("invalid HuggingFace URL for %q: %q", key, entry.FileName)
				}
				continue
			}
			if entry.CollectionID == "" || entry.FileName == "" {
				t.Errorf("incomplete Internet Archive entry for %q: %#v", key, entry)
			}
		}
		for key, entry := range a.MinervaEntryMap {
			if entry.FileName == "" || entry.PathParam == "" || entry.Platform == "" {
				t.Errorf("incomplete Minerva entry for %q: %#v", key, entry)
			}
		}
	})
}
