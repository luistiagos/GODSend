package telemetry

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// setVersion bypasses initOnce: tests set the package state directly.
func setVersion(t *testing.T, v string) {
	t.Helper()
	prev := version
	version = v
	t.Cleanup(func() { version = prev })
}

func TestBuildReportCarriesVersionInUserAgent(t *testing.T) {
	setVersion(t, "9.9.9")
	r := buildReport("pipeline", "f.go", "m", "msg", "", nil)
	if r.UserAgent != "pipeline v9.9.9" {
		t.Fatalf("user_agent = %q, want %q", r.UserAgent, "pipeline v9.9.9")
	}
	if r.Project != "xbox-360-companion/pipeline" {
		t.Fatalf("project = %q", r.Project)
	}
}

func TestBuildReportWithoutVersionKeepsComponent(t *testing.T) {
	setVersion(t, "")
	if ua := buildReport("pipeline", "f.go", "m", "msg", "", nil).UserAgent; ua != "pipeline" {
		t.Fatalf("user_agent = %q, want %q", ua, "pipeline")
	}
}

func TestBuildReportCapsMessageAndLogs(t *testing.T) {
	setVersion(t, "9.9.9")
	logs := make([]string, 25)
	r := buildReport("pipeline", "f.go", "m", strings.Repeat("x", 5000), "", logs)
	if len(r.Message) != 4000 {
		t.Fatalf("message len = %d, want 4000", len(r.Message))
	}
	if len(r.Logs) != 20 {
		t.Fatalf("logs = %d, want 20", len(r.Logs))
	}
}

func TestReportPostsVersionedUserAgent(t *testing.T) {
	var got ErrorReport
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			_ = json.NewDecoder(r.Body).Decode(&got)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	prevEnabled, prevEndpoint := enabled, endpoint
	enabled, endpoint = true, srv.URL
	t.Cleanup(func() { enabled, endpoint = prevEnabled, prevEndpoint })
	setVersion(t, "9.9.9")

	Report("pipeline", "f.go", "m", "TestReportPostsVersionedUserAgent", "", nil, true)

	if got.UserAgent != "pipeline v9.9.9" || got.Project != "xbox-360-companion/pipeline" {
		t.Fatalf("received user_agent=%q project=%q", got.UserAgent, got.Project)
	}
}
