package http

import (
	"encoding/json"
	stdhttp "net/http"
	"net/http/httptest"
	"net/url"
	"testing"

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
}
