package cache

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"godsend/app"
	"godsend/models"
)

// captureTelemetry swaps the reporter so tests never reach the production
// endpoint, and returns the messages reported.
func captureTelemetry(t *testing.T) func() []string {
	t.Helper()
	var mu sync.Mutex
	var got []string
	previous := reportTelemetry
	reportTelemetry = func(component, file, method, message, pageURL string, logs []string, terminal bool) {
		mu.Lock()
		defer mu.Unlock()
		got = append(got, component+"|"+message)
	}
	t.Cleanup(func() { reportTelemetry = previous })
	return func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), got...)
	}
}

func newIATestApp(t *testing.T) *app.App {
	t.Helper()
	a := app.NewApp()
	a.ToolsDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(a.ToolsDir, "cache"), 0755); err != nil {
		t.Fatal(err)
	}
	a.IAAuthorizationHeader = "test" // skips the real archive.org auto-login
	return a
}

// fakeIAMetadata serves /metadata/<id>: "gone_404" → 404, "gone_empty" → 200 {},
// "flaky" → 503, anything else → one archive named after the id.
func fakeIAMetadata(t *testing.T) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/metadata/")
		switch id {
		case "gone_404":
			http.NotFound(w, r)
		case "gone_empty":
			_, _ = w.Write([]byte(`{}`))
		case "flaky":
			w.WriteHeader(http.StatusServiceUnavailable)
		default:
			fmt.Fprintf(w, `{"files":[{"name":"%s Game.zip","source":"original"}]}`, id)
		}
	}))
	t.Cleanup(server.Close)
	previous := iaMetadataBaseURL
	iaMetadataBaseURL = server.URL + "/metadata/"
	t.Cleanup(func() { iaMetadataBaseURL = previous })
}

func TestDoIAMetaFetchMarksMissingCollectionAsGone(t *testing.T) {
	fakeIAMetadata(t)
	service := &IAService{App: newIATestApp(t)}

	for _, id := range []string{"gone_404", "gone_empty"} {
		if _, err := service.DoIAMetaFetch(id); !errors.Is(err, errIACollectionGone) {
			t.Fatalf("%s: want errIACollectionGone, got %v", id, err)
		}
	}
	if _, err := service.DoIAMetaFetch("flaky"); err == nil || errors.Is(err, errIACollectionGone) {
		t.Fatalf("503 must stay a transient error, got %v", err)
	}
}

func TestIABuildReportsGoneCollectionOnce(t *testing.T) {
	const platform = "test-ia-gone"
	withIACollections(t, platform, []string{"coll_ok", "coll_404", "coll_empty", "coll_timeout"})
	reported := captureTelemetry(t)

	service := &IAService{App: newIATestApp(t), FetchCollectionEntriesFn: func(id string) ([]models.IAGameEntry, error) {
		switch id {
		case "coll_404":
			return nil, fmt.Errorf("%s: %w", id, errIACollectionGone)
		case "coll_empty":
			return nil, nil
		case "coll_timeout":
			return nil, fmt.Errorf("%s: gave up after 4 attempts: context deadline exceeded", id)
		}
		return []models.IAGameEntry{{CollectionID: id, FileName: "Game.zip"}}, nil
	}}
	service.Build(platform)

	got := strings.Join(reported(), "\n")
	for _, want := range []string{
		"cache|Coleção IA sumiu: coll_404 (test-ia-gone)",
		"cache|Coleção IA sumiu: coll_empty (test-ia-gone)",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing report %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "coll_timeout") || strings.Contains(got, "coll_ok") {
		t.Errorf("transient failure or healthy collection was reported:\n%s", got)
	}
}

func TestFindEntryNamesUnavailableCollection(t *testing.T) {
	fakeIAMetadata(t)
	const platform = "test-ia-live-gone"
	withIACollections(t, platform, []string{"gone_404", "gone_empty"})
	service := &IAService{App: newIATestApp(t)}

	_, err := service.FindEntry("Some Game", platform)
	if err == nil || !errors.Is(err, errIACollectionUnavailable) {
		t.Fatalf("want errIACollectionUnavailable, got %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "not found in Internet Archive: Some Game") ||
		!strings.Contains(msg, "gone_404") || !strings.Contains(msg, "gone_empty") {
		t.Fatalf("message must keep the prefix and name the collections: %q", msg)
	}
}

func TestFindEntryTitleMissingFromLiveCollectionStaysNotFound(t *testing.T) {
	fakeIAMetadata(t)
	const platform = "test-ia-live-ok"
	withIACollections(t, platform, []string{"coll_alive"})
	service := &IAService{App: newIATestApp(t)}

	_, err := service.FindEntry("Zzz Nothing Like It", platform)
	if err == nil || errors.Is(err, errIACollectionUnavailable) {
		t.Fatalf("a live collection without the title is a plain not-found, got %v", err)
	}
	if err.Error() != "not found in Internet Archive: Zzz Nothing Like It" {
		t.Fatalf("unexpected message %q", err.Error())
	}
}
