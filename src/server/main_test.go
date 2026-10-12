package main

import (
	"encoding/json"
	"os"
	"testing"
)

// appVersion must follow the version bump in package.json: it is what the
// telemetry reports carry ([[pipeline-report-de-telemetria-do-backend-nao-carrega-versao-do-app_2026-10-10T23-30]]).
func TestAppVersionMatchesPackageJSON(t *testing.T) {
	data, err := os.ReadFile("../../package.json")
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct {
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		t.Fatal(err)
	}
	if appVersion != pkg.Version {
		t.Fatalf("appVersion = %q, package.json version = %q", appVersion, pkg.Version)
	}
}
