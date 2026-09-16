package app

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestCleanupStaleScratchPreservesPendingFTPSource(t *testing.T) {
	root := t.TempDir()
	scratch := filepath.Join(root, "proc")
	protected := filepath.Join(scratch, "Pending_GOD")
	if err := os.MkdirAll(protected, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(protected, "Data0000"), []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	stale := filepath.Join(scratch, "Interrupted_hf.rar")
	if err := os.WriteFile(stale, []byte("remove"), 0644); err != nil {
		t.Fatal(err)
	}

	a := NewApp()
	a.cleanupStaleScratchDir(scratch, []string{protected})
	if _, err := os.Stat(filepath.Join(protected, "Data0000")); err != nil {
		t.Fatalf("pending FTP source was removed: %v", err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale archive still exists: %v", err)
	}
}

func TestCleanupStaleScratchPreservesLiveOwner(t *testing.T) {
	scratch := t.TempDir()
	marker := filepath.Join(scratch, scratchOwnerFile)
	if err := os.WriteFile(marker, []byte(strconv.Itoa(os.Getpid())), 0644); err != nil {
		t.Fatal(err)
	}
	active := filepath.Join(scratch, "active.part")
	if err := os.WriteFile(active, []byte("active"), 0644); err != nil {
		t.Fatal(err)
	}

	a := NewApp()
	a.cleanupStaleScratchDir(scratch, nil)
	if _, err := os.Stat(active); err != nil {
		t.Fatalf("live owner's scratch was removed: %v", err)
	}
}

func TestCancelledQueuedGameDoesNotAcquireProcessingLane(t *testing.T) {
	a := NewApp()
	token := a.RegisterGameJob("Batman Arkham City GOTY")
	a.CancelGameJob("Batman Arkham City GOTY")
	if a.AcquireGameJob("Batman Arkham City GOTY", token) {
		a.ReleaseGameJob("Batman Arkham City GOTY", token)
		t.Fatal("cancelled queued game acquired processing lane")
	}
}

func TestRequeueDoesNotUncancelOlderRunningLaunch(t *testing.T) {
	a := NewApp()
	oldToken := a.RegisterGameJob("Batman Arkham City GOTY")
	if !a.AcquireGameJob("Batman Arkham City GOTY", oldToken) {
		t.Fatal("first launch did not acquire processing lane")
	}
	a.CancelGameJob("Batman Arkham City GOTY")
	newToken := a.RegisterGameJob("Batman Arkham City GOTY")
	if !a.IsGameJobCancelled("Batman Arkham City GOTY") {
		t.Fatal("new queue token revived the older running launch")
	}
	a.ReleaseGameJob("Batman Arkham City GOTY", oldToken)

	if !a.AcquireGameJob("Batman Arkham City GOTY", newToken) {
		t.Fatal("replacement launch did not acquire processing lane")
	}
	if a.IsGameJobCancelled("Batman Arkham City GOTY") {
		t.Fatal("replacement launch inherited cancellation")
	}
	a.ReleaseGameJob("Batman Arkham City GOTY", newToken)
}

func TestEnsureWorkingVolumeWhenValid(t *testing.T) {
	root := t.TempDir()
	a := NewApp()
	a.ToolsDir = root
	a.TempDir = filepath.Join(root, "Temp")
	a.TorrentTempDir = filepath.Join(a.TempDir, "torrent-dl")

	if failed := a.EnsureWorkingVolume(); failed != "" {
		t.Fatalf("expected no fallback, but got failed volume: %s", failed)
	}
	if a.TempDir != filepath.Join(root, "Temp") {
		t.Fatalf("expected TempDir unchanged, got %s", a.TempDir)
	}
}

func TestEnsureWorkingVolumeFallbackWhenUnavailable(t *testing.T) {
	root := t.TempDir()
	a := NewApp()
	a.ToolsDir = root
	// Point TempDir to an un-creatable/invalid path
	invalidTemp := "Z:\\godsend-temp-unmounted-device\\proc"
	a.TempDir = invalidTemp
	a.TorrentTempDir = "Z:\\godsend-temp-unmounted-device\\torrent-dl"

	failed := a.EnsureWorkingVolume()
	if failed != invalidTemp {
		t.Fatalf("expected failed volume %s, got %s", invalidTemp, failed)
	}
	expectedDefault := filepath.Join(root, "Temp")
	if a.TempDir != expectedDefault {
		t.Fatalf("expected TempDir reverted to %s, got %s", expectedDefault, a.TempDir)
	}
	expectedTorrentDefault := filepath.Join(expectedDefault, "torrent-dl")
	if a.TorrentTempDir != expectedTorrentDefault {
		t.Fatalf("expected TorrentTempDir reverted to %s, got %s", expectedTorrentDefault, a.TorrentTempDir)
	}
	// Verify directory was created and owner marked
	if _, err := os.Stat(filepath.Join(expectedDefault, scratchOwnerFile)); err != nil {
		t.Fatalf("scratch owner marker was not created in fallback dir: %v", err)
	}
}

func TestAcquireGameJobTriggersEnsureWorkingVolume(t *testing.T) {
	root := t.TempDir()
	a := NewApp()
	a.ToolsDir = root
	invalidTemp := "Z:\\godsend-temp-unmounted\\proc"
	a.TempDir = invalidTemp
	a.TorrentTempDir = "Z:\\godsend-temp-unmounted\\torrent-dl"

	token := a.RegisterGameJob("Lego Batman 1")
	if !a.AcquireGameJob("Lego Batman 1", token) {
		t.Fatal("failed to acquire game job")
	}
	defer a.ReleaseGameJob("Lego Batman 1", token)

	expectedDefault := filepath.Join(root, "Temp")
	if a.TempDir != expectedDefault {
		t.Fatalf("AcquireGameJob did not revert unavailable TempDir: got %s, want %s", a.TempDir, expectedDefault)
	}
}
