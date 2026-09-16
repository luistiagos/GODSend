package app

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestAcquireHomeLockSuccess(t *testing.T) {
	dir := t.TempDir()
	a := &App{ToolsDir: dir}
	defer a.ReleaseHomeLock()

	if err := a.AcquireHomeLock(); err != nil {
		t.Fatalf("AcquireHomeLock failed: %v", err)
	}

	if !a.HasHomeLock() {
		t.Fatal("expected HasHomeLock() to be true")
	}

	lockPath := filepath.Join(dir, homeLockFileName)
	data, err := os.ReadFile(lockPath)
	if err != nil {
		t.Fatalf("failed to read lock file: %v", err)
	}

	expectedPID := strconv.Itoa(os.Getpid())
	if strings.TrimSpace(string(data)) != expectedPID {
		t.Errorf("expected PID %s in lock file, got %q", expectedPID, string(data))
	}
}

func TestAcquireHomeLockConflict(t *testing.T) {
	dir := t.TempDir()
	a1 := &App{ToolsDir: dir}
	defer a1.ReleaseHomeLock()

	if err := a1.AcquireHomeLock(); err != nil {
		t.Fatalf("a1.AcquireHomeLock failed: %v", err)
	}

	a2 := &App{ToolsDir: dir}
	defer a2.ReleaseHomeLock()

	err := a2.AcquireHomeLock()
	if err == nil {
		t.Fatal("expected a2.AcquireHomeLock to fail on already locked directory, got nil")
	}

	expectedPID := strconv.Itoa(os.Getpid())
	if !strings.Contains(err.Error(), expectedPID) {
		t.Errorf("expected error message to identify owner pid %s, got %v", expectedPID, err)
	}

	if a2.HasHomeLock() {
		t.Fatal("expected a2.HasHomeLock() to be false")
	}
}

func TestReleaseHomeLockAllowsReacquisition(t *testing.T) {
	dir := t.TempDir()
	a1 := &App{ToolsDir: dir}

	if err := a1.AcquireHomeLock(); err != nil {
		t.Fatalf("a1.AcquireHomeLock failed: %v", err)
	}

	a1.ReleaseHomeLock()

	if a1.HasHomeLock() {
		t.Fatal("expected a1.HasHomeLock() to be false after release")
	}

	a2 := &App{ToolsDir: dir}
	defer a2.ReleaseHomeLock()

	if err := a2.AcquireHomeLock(); err != nil {
		t.Fatalf("a2.AcquireHomeLock should succeed after a1 released: %v", err)
	}

	if !a2.HasHomeLock() {
		t.Fatal("expected a2.HasHomeLock() to be true")
	}
}

func TestMarkScratchOwnerPreservesActiveOwner(t *testing.T) {
	dir := t.TempDir()
	ownerFile := filepath.Join(dir, scratchOwnerFile)

	// Simulate an active process owner (current process PID)
	activePID := os.Getpid()
	if err := os.WriteFile(ownerFile, []byte(strconv.Itoa(activePID)), 0644); err != nil {
		t.Fatalf("failed to write initial owner file: %v", err)
	}

	// Calling markScratchOwner with current PID should be fine
	if err := markScratchOwner(dir); err != nil {
		t.Fatalf("markScratchOwner failed: %v", err)
	}

	data, _ := os.ReadFile(ownerFile)
	if strings.TrimSpace(string(data)) != strconv.Itoa(activePID) {
		t.Fatalf("owner file changed unexpectedly: %s", string(data))
	}
}
