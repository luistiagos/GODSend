package cache

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"godsend/app"
	"godsend/models"
)

type fakeMinervaValidator struct {
	valid   []models.MinervaEntry
	missing []string
	err     error
}

func (f fakeMinervaValidator) ValidateMinervaEntries(_ string, _ []models.MinervaEntry) ([]models.MinervaEntry, []string, error) {
	return f.valid, f.missing, f.err
}

func TestScrapeMinervaPageSupportsCurrentAndLegacyLinks(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`
<div class="entry"><a href="/rom?id=1207829">Batman &amp; Robin (USA).zip</a></div>
<div class="entry"><a href="/rom?name=Archive%2FLegacy%20Game.7z">Legacy Game.7z</a></div>
<div class="entry"><a href="/browse/other">Not a ROM.rar</a></div>`))
	}))
	defer server.Close()

	service := &MinervaService{App: app.NewApp()}
	entries, err := service.ScrapeMinervaPage(server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("expected 2 entries, got %d: %#v", len(entries), entries)
	}
	if entries[0].FileName != "Batman & Robin (USA).zip" || entries[0].PathParam != "id=1207829" {
		t.Fatalf("current Minerva link parsed incorrectly: %#v", entries[0])
	}
	if entries[1].FileName != "Legacy Game.7z" || entries[1].PathParam != "name=Archive%2FLegacy%20Game.7z" {
		t.Fatalf("legacy Minerva link parsed incorrectly: %#v", entries[1])
	}
}

func TestMinervaBuildPreservesCacheWhenScrapeIsEmpty(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<html><body><p>No matching entries</p></body></html>`))
	}))
	defer server.Close()

	const platform = "test-empty"
	previousURL, existed := app.MinervaPageURLs[platform]
	app.MinervaPageURLs[platform] = server.URL
	t.Cleanup(func() {
		if existed {
			app.MinervaPageURLs[platform] = previousURL
		} else {
			delete(app.MinervaPageURLs, platform)
		}
	})

	toolsDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(toolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	a := app.NewApp()
	a.ToolsDir = toolsDir
	oldEntry := models.MinervaEntry{FileName: "Existing Game.zip", PathParam: "id=1", Platform: platform}
	a.MinervaGameCache[platform] = []string{"Existing Game"}
	a.MinervaEntryMap["existing game"] = oldEntry
	service := &MinervaService{App: a}
	service.SaveCacheToDisk(platform, a.MinervaGameCache[platform], map[string]models.MinervaEntry{"existing game": oldEntry})

	service.Build(platform)

	if games := a.MinervaGameCache[platform]; len(games) != 1 || games[0] != "Existing Game" {
		t.Fatalf("empty scrape replaced live cache: %#v", games)
	}
	data, err := os.ReadFile(filepath.Join(toolsDir, "cache", "minerva_"+platform+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 || !bytes.Contains(data, []byte("Existing Game")) {
		t.Fatalf("empty scrape replaced disk cache: %s", data)
	}
}

func TestMinervaBuildPreservesCacheWhenTorrentValidationFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<a href="/rom?id=10">Fresh Game.zip</a>`))
	}))
	defer server.Close()

	const platform = "test-validation-error"
	previousURL, existed := app.MinervaPageURLs[platform]
	app.MinervaPageURLs[platform] = server.URL
	t.Cleanup(func() {
		if existed {
			app.MinervaPageURLs[platform] = previousURL
		} else {
			delete(app.MinervaPageURLs, platform)
		}
	})

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.ToolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	a.MinervaGameCache[platform] = []string{"Existing Game"}
	service := &MinervaService{App: a, Torrent: fakeMinervaValidator{err: errors.New("torrent unavailable")}}

	service.Build(platform)

	if games := a.MinervaGameCache[platform]; len(games) != 1 || games[0] != "Existing Game" {
		t.Fatalf("failed torrent validation replaced cache: %#v", games)
	}
}

func TestMinervaBuildPublishesOnlyEntriesPresentInTorrent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`
<a href="/rom?id=10">Valid Game.zip</a>
<a href="/rom?id=11">Page Only Game.zip</a>`))
	}))
	defer server.Close()

	const platform = "test-validation-filter"
	previousURL, existed := app.MinervaPageURLs[platform]
	app.MinervaPageURLs[platform] = server.URL
	t.Cleanup(func() {
		if existed {
			app.MinervaPageURLs[platform] = previousURL
		} else {
			delete(app.MinervaPageURLs, platform)
		}
	})

	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.ToolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	valid := models.MinervaEntry{FileName: "Valid Game.zip", PathParam: "id=10", Platform: platform}
	service := &MinervaService{
		App: a,
		Torrent: fakeMinervaValidator{
			valid:   []models.MinervaEntry{valid},
			missing: []string{"Page Only Game.zip"},
		},
	}

	service.Build(platform)

	if games := a.MinervaGameCache[platform]; len(games) != 1 || games[0] != "Valid Game" {
		t.Fatalf("unexpected published Minerva games: %#v", games)
	}
	if _, ok := a.MinervaEntryMap["page only game"]; ok {
		t.Fatal("page-only item was published without a torrent file")
	}
}
