package http

import (
	"encoding/json"
	stdhttp "net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"godsend/app"
	"godsend/models"
	"godsend/services/local"
	"godsend/services/pipeline"
)

func TestHandleQueueRetry(t *testing.T) {
	a := &app.App{
		ToolsDir: t.TempDir(),
		TempDir:  t.TempDir(),
	}
	a.SetupPaths()
	t.Cleanup(func() {
		a.ReleaseHomeLock()
	})

	deps := &Deps{
		App:      a,
		Pipeline: &pipeline.Service{App: a},
		Local:    &local.Service{App: a},
	}

	game := "Test Game Retry"

	// Store connection info
	a.XboxConnections.Store(game, models.XboxConnection{
		GameName: game,
		Platform: "xbox360",
		Mode:     "ftp",
		IP:       "192.168.1.100",
		Drive:    "Hdd1:",
	})
	a.InstallTypeMap.Store(game, "god")
	a.JobQueue.Store(game, models.GameStatus{State: "Error", Message: "Simulated error"})

	req := httptest.NewRequest(stdhttp.MethodPost, "/queue/retry?game="+url.QueryEscape(game), nil)
	rr := httptest.NewRecorder()

	handler := deps.wrap(deps.handleQueueRetry)
	handler.ServeHTTP(rr, req)

	if rr.Code != stdhttp.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse JSON response: %v", err)
	}

	if resp["status"] != "triggered" {
		t.Fatalf("expected status 'triggered', got %v", resp["status"])
	}

	// Ensure background job terminates before test completes and cleans up TempDir
	a.CancelGameJob(game)
	for i := 0; i < 50; i++ {
		if val, ok := a.JobQueue.Load(game); ok {
			st := val.(models.GameStatus)
			if st.State == "Error" || st.State == "Ready" {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestHandleQueueRetryAdoptsMountedLocalDevice(t *testing.T) {
	a := &app.App{
		ToolsDir: t.TempDir(),
		TempDir:  t.TempDir(),
	}
	a.SetupPaths()
	t.Cleanup(func() {
		a.ReleaseHomeLock()
	})

	pipeSvc := &pipeline.Service{App: a}
	deps := &Deps{
		App:      a,
		Pipeline: pipeSvc,
		Local:    &local.Service{App: a},
	}

	game := "Test Local Retry"
	usbRoot := t.TempDir()
	newID, err := pipeline.PrepareLocalDevice(usbRoot)
	if err != nil {
		t.Fatal(err)
	}

	// Stored connection has an old stale ID (e.g. from before pendrive format)
	a.XboxConnections.Store(game, models.XboxConnection{
		GameName:      game,
		Platform:      "xbox360",
		Mode:          "local",
		LocalRoot:     usbRoot,
		LocalDeviceID: "stale-old-id-before-format",
	})
	a.InstallTypeMap.Store(game, "god")
	a.JobQueue.Store(game, models.GameStatus{State: "Error", Message: "Simulated error"})

	req := httptest.NewRequest(stdhttp.MethodPost, "/queue/retry?game="+url.QueryEscape(game), nil)
	rr := httptest.NewRecorder()

	handler := deps.wrap(deps.handleQueueRetry)
	handler.ServeHTTP(rr, req)

	if rr.Code != stdhttp.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify that the connection now has newID
	val, ok := a.XboxConnections.Load(game)
	if !ok {
		t.Fatal("connection not found")
	}
	conn := val.(models.XboxConnection)
	if conn.LocalDeviceID != newID {
		t.Fatalf("expected LocalDeviceID to be updated to %s, got %s", newID, conn.LocalDeviceID)
	}

	a.CancelGameJob(game)
	for i := 0; i < 50; i++ {
		if val, ok := a.JobQueue.Load(game); ok {
			st := val.(models.GameStatus)
			if st.State == "Error" || st.State == "Ready" {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
}
