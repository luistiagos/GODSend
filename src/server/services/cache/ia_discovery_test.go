package cache

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"godsend/app"
	"godsend/models"
)

// fakeIASearch serves advancedsearch.php with these identifiers (status 200),
// or with the given HTTP status when ids is nil. It returns the request count.
func fakeIASearch(t *testing.T, status int, ids []string) func() int {
	t.Helper()
	var mu sync.Mutex
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
		if ids == nil {
			w.WriteHeader(status)
			return
		}
		type doc struct {
			Identifier string `json:"identifier"`
		}
		var body struct {
			Response struct {
				Docs []doc `json:"docs"`
			} `json:"response"`
		}
		for _, id := range ids {
			body.Response.Docs = append(body.Response.Docs, doc{id})
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	t.Cleanup(server.Close)
	previous := iaAdvancedSearchURL
	iaAdvancedSearchURL = server.URL + "/advancedsearch.php"
	t.Cleanup(func() { iaAdvancedSearchURL = previous })
	return func() int {
		mu.Lock()
		defer mu.Unlock()
		return calls
	}
}

// recordFetches is a FetchCollectionEntriesFn that answers one archive per id
// and records which ids were requested.
func recordFetches() (func(string) ([]models.IAGameEntry, error), func() []string) {
	var mu sync.Mutex
	var got []string
	return func(id string) ([]models.IAGameEntry, error) {
			mu.Lock()
			got = append(got, id)
			mu.Unlock()
			return []models.IAGameEntry{{CollectionID: id, FileName: id + " Game.zip"}}, nil
		}, func() []string {
			mu.Lock()
			defer mu.Unlock()
			out := append([]string(nil), got...)
			sort.Strings(out)
			return out
		}
}

// What the real search returned on 2026-11-25, trimmed.
var searchXbox = []string{
	"microsoft_xbox_a",
	"microsoft_xbox_c_part1", "microsoft_xbox_c_part2",
	"microsoft_xbox_devkit_hdds",
	"Microsoft_XBOX_360_Remote_Recovery_Software_Archive",
	"microsoft_xbox_r", "microsoft_xbox_r_part1",
}

func TestIACollectionLetterAcceptsOnlyThePlatformGameSets(t *testing.T) {
	cases := map[string]string{
		"microsoft_xbox360_a":                              "a",
		"microsoft_xbox360_d_part3":                        "d",
		"microsoft_xbox360_numberssymbols":                 "numberssymbols",
		"microsoft_xbox360_digital_part1":                  "",
		"microsoft_xbox360_title-updates":                  "",
		"microsoft_xbox360_TRAD_BR_2026_romsbrasil_parte1": "",
		"microsoft_xbox_a":                                 "", // other platform
	}
	for id, want := range cases {
		got, ok := iaCollectionLetter("microsoft_xbox360_", id)
		if got != want || ok != (want != "") {
			t.Errorf("%s: got (%q, %v), want %q", id, got, ok, want)
		}
	}
	if _, ok := iaCollectionLetter("microsoft_xbox_", "microsoft_xbox_devkit_hdds"); ok {
		t.Error("devkit_hdds is not a game set")
	}
	if _, ok := iaCollectionLetter("microsoft_xbox_", "microsoft_xbox360_a"); ok {
		t.Error("an Xbox 360 id matched the Original Xbox prefix")
	}
}

func TestDiscoverIACollectionsReplacesRenamedAndKeepsLettersTheSearchMissed(t *testing.T) {
	fakeIASearch(t, 200, searchXbox)
	withIACollections(t, "xbox", []string{"microsoft_xbox_a", "microsoft_xbox_b", "microsoft_xbox_c"})
	service := &IAService{App: newIATestApp(t)}

	got, err := service.discoverIACollections("xbox")
	if err != nil {
		t.Fatal(err)
	}
	want := "microsoft_xbox_a,microsoft_xbox_b,microsoft_xbox_c_part1,microsoft_xbox_c_part2,microsoft_xbox_r,microsoft_xbox_r_part1"
	if strings.Join(got, ",") != want {
		t.Fatalf("got  %s\nwant %s", strings.Join(got, ","), want)
	}
}

func TestDiscoverIACollectionsFailsOnHTTPErrorAndOnNoMatch(t *testing.T) {
	service := &IAService{App: newIATestApp(t)}
	fakeIASearch(t, http.StatusServiceUnavailable, nil)
	if _, err := service.discoverIACollections("xbox"); err == nil {
		t.Fatal("503 must be an error, not an empty list")
	}
	fakeIASearch(t, 200, []string{"microsoft_xbox_devkit_hdds"})
	if _, err := service.discoverIACollections("xbox"); err == nil {
		t.Fatal("a search without any game set must fall back, not empty the platform")
	}
	if _, err := service.discoverIACollections("xbla"); err == nil {
		t.Fatal("platforms outside the Redump pattern have no discovery")
	}
}

func TestIABuildUsesDiscoveredCollectionsAndPersistsThem(t *testing.T) {
	fakeIASearch(t, 200, searchXbox)
	withIACollections(t, "xbox", []string{"microsoft_xbox_a", "microsoft_xbox_c"})
	fetch, fetched := recordFetches()
	a := newIATestApp(t)
	a.GameEntryMap["old c"] = models.IAGameEntry{CollectionID: "microsoft_xbox_c", FileName: "Old C.zip"}
	service := &IAService{App: a, FetchCollectionEntriesFn: fetch}

	service.Build("xbox")

	want := "microsoft_xbox_a,microsoft_xbox_c_part1,microsoft_xbox_c_part2,microsoft_xbox_r,microsoft_xbox_r_part1"
	if got := strings.Join(fetched(), ","); got != want {
		t.Fatalf("fetched %s\nwant    %s", got, want)
	}
	if _, ok := a.GameEntryMap["old c"]; ok {
		t.Fatal("entry of the retired microsoft_xbox_c survived the rebuild")
	}
	if got, _ := service.CollectionsFor("xbox"); strings.Join(got, ",") != want {
		t.Fatalf("collections in use: %v", got)
	}

	reloaded := &IAService{App: newIATestApp(t)}
	reloaded.App.ToolsDir = a.ToolsDir
	if !reloaded.LoadCacheFromDisk("xbox") {
		t.Fatal("cache built from the discovered list must load as current, not against the config")
	}
	if got, _ := reloaded.CollectionsFor("xbox"); strings.Join(got, ",") != want {
		t.Fatalf("persisted list not restored: %v", got)
	}
}

func TestIABuildFallsBackToConfigWhenDiscoveryFails(t *testing.T) {
	fakeIASearch(t, http.StatusBadGateway, nil)
	withIACollections(t, "xbox", []string{"microsoft_xbox_a", "microsoft_xbox_b"})
	fetch, fetched := recordFetches()
	service := &IAService{App: newIATestApp(t), FetchCollectionEntriesFn: fetch}

	service.Build("xbox")

	if got := strings.Join(fetched(), ","); got != "microsoft_xbox_a,microsoft_xbox_b" {
		t.Fatalf("fetched %s, want the configured list", got)
	}
}

func TestRebuildIfCollectionsChanged(t *testing.T) {
	withIACollections(t, "xbox", []string{"microsoft_xbox_a", "microsoft_xbox_c"})

	t.Run("same list does nothing", func(t *testing.T) {
		fakeIASearch(t, 200, []string{"microsoft_xbox_a", "microsoft_xbox_c"})
		fetch, fetched := recordFetches()
		service := &IAService{App: newIATestApp(t), FetchCollectionEntriesFn: fetch}
		service.RebuildIfCollectionsChanged("xbox")
		if got := fetched(); len(got) != 0 {
			t.Fatalf("rebuilt with an unchanged list: %v", got)
		}
	})

	t.Run("renamed collection rebuilds", func(t *testing.T) {
		fakeIASearch(t, 200, []string{"microsoft_xbox_a", "microsoft_xbox_c_part1"})
		fetch, fetched := recordFetches()
		service := &IAService{App: newIATestApp(t), FetchCollectionEntriesFn: fetch}
		service.RebuildIfCollectionsChanged("xbox")
		if got := strings.Join(fetched(), ","); got != "microsoft_xbox_a,microsoft_xbox_c_part1" {
			t.Fatalf("fetched %s", got)
		}
	})

	t.Run("recent failure on the same list waits", func(t *testing.T) {
		fakeIASearch(t, 200, []string{"microsoft_xbox_a", "microsoft_xbox_c_part1"})
		fetch, fetched := recordFetches()
		service := &IAService{App: newIATestApp(t), FetchCollectionEntriesFn: fetch}
		service.recordIncompleteBuild("xbox", []string{"microsoft_xbox_a", "microsoft_xbox_c_part1"}, []string{"microsoft_xbox_c_part1"})
		service.RebuildIfCollectionsChanged("xbox")
		if got := fetched(); len(got) != 0 {
			t.Fatalf("repeated a rebuild that just failed on the same list: %v", got)
		}
	})

	t.Run("discovery failure keeps the cache", func(t *testing.T) {
		fakeIASearch(t, http.StatusInternalServerError, nil)
		fetch, fetched := recordFetches()
		service := &IAService{App: newIATestApp(t), FetchCollectionEntriesFn: fetch}
		service.RebuildIfCollectionsChanged("xbox")
		if got := fetched(); len(got) != 0 {
			t.Fatalf("rebuilt without a list: %v", got)
		}
	})

	t.Run("platform without discovery makes no request", func(t *testing.T) {
		calls := fakeIASearch(t, 200, searchXbox)
		service := &IAService{App: newIATestApp(t)}
		service.RebuildIfCollectionsChanged("xbla")
		if calls() != 0 {
			t.Fatal("xbla has a fixed list and must not query archive.org")
		}
	})
}

// A collection that stays down must not cost a full rebuild on every start.
func TestLoadCacheFromDiskWaitsAfterAFailedRebuildOnTheSameList(t *testing.T) {
	const platform = "test-ia-wait"
	colls := []string{"coll_a", "coll_b"}
	withIACollections(t, platform, colls)
	newLoaded := func(t *testing.T) *IAService {
		a := app.NewApp()
		a.ToolsDir = t.TempDir()
		writeIADiskCache(t, a, platform, []string{"Alpha"},
			map[string]models.IAGameEntry{"alpha": {CollectionID: "coll_a", FileName: "Alpha.zip"}})
		return &IAService{App: a}
	}
	writeAttempt := func(t *testing.T, s *IAService, at time.Time, list []string) {
		data, _ := json.Marshal(iaBuildAttempt{At: at, Collections: list, Failed: []string{"coll_b"}})
		if err := os.WriteFile(filepath.Join(s.App.ToolsDir, "cache", platform+".attempt.json"), data, 0644); err != nil {
			t.Fatal(err)
		}
	}

	t.Run("recent attempt, same list: no rebuild", func(t *testing.T) {
		s := newLoaded(t)
		writeAttempt(t, s, time.Now().Add(-time.Hour), colls)
		if !s.LoadCacheFromDisk(platform) {
			t.Fatal("rebuild requested again 1 h after it failed on the same collection")
		}
	})
	t.Run("attempt older than the interval: rebuild", func(t *testing.T) {
		s := newLoaded(t)
		writeAttempt(t, s, time.Now().Add(-IARebuildRetryInterval-time.Minute), colls)
		if s.LoadCacheFromDisk(platform) {
			t.Fatal("expired wait must allow the retry")
		}
	})
	t.Run("attempt on another list: rebuild", func(t *testing.T) {
		s := newLoaded(t)
		writeAttempt(t, s, time.Now(), []string{"coll_a", "coll_old"})
		if s.LoadCacheFromDisk(platform) {
			t.Fatal("a new collection list is new information and must be tried")
		}
	})
	t.Run("no record: rebuild", func(t *testing.T) {
		if newLoaded(t).LoadCacheFromDisk(platform) {
			t.Fatal("missing collection without a failed attempt must rebuild")
		}
	})
}
