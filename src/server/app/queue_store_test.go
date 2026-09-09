package app

import (
	"os"
	"path/filepath"
	"testing"

	"godsend/models"
)

func newQueueApp(t *testing.T) *App {
	t.Helper()
	a := NewApp()
	a.QueueDir = t.TempDir()
	return a
}

func TestQueueRecordSurvivesRestartAndTracksState(t *testing.T) {
	a := newQueueApp(t)
	conn := models.XboxConnection{Mode: "local", LocalRoot: "E:/", Platform: "xbox360"}
	a.XboxConnections.Store("GTA V", conn)
	a.SaveQueueJob(PersistedJob{
		Game: "GTA V", State: "Queued", Platform: "xbox360",
		InstallType: "xex", Priority: "huggingface,ia", Connection: &conn,
	})
	a.SetQueueJobDownload("GTA V", "https://archive.org/download/x/GTA V.7z", "D:/godsend-temp/proc/GTA V.7z")
	// Progress lines reuse the Processing state and must not rewrite the record.
	a.LogStatus("GTA V", "Processing", "Downloading: 12%")
	a.LogStatus("GTA V", "Processing", "Downloading: 13%")

	// A restart reads the record back from disk with nothing lost.
	restarted := NewApp()
	restarted.QueueDir = a.QueueDir
	jobs := restarted.LoadQueueJobs()
	if len(jobs) != 1 {
		t.Fatalf("expected 1 persisted job, got %d", len(jobs))
	}
	job := jobs[0]
	if job.Game != "GTA V" || job.State != "Processing" {
		t.Fatalf("unexpected job identity/state: %+v", job)
	}
	if job.Scratch != "D:/godsend-temp/proc/GTA V.7z" {
		t.Fatalf("partial download path was lost: %q", job.Scratch)
	}
	if job.InstallType != "xex" || job.Priority != "huggingface,ia" || job.Platform != "xbox360" {
		t.Fatalf("relaunch parameters were lost: %+v", job)
	}
	if job.Connection == nil || job.Connection.LocalRoot != "E:/" {
		t.Fatalf("destination was lost: %+v", job.Connection)
	}
	if job.URL != "https://archive.org/download/x/GTA V.7z" {
		t.Fatalf("download source was lost: %q", job.URL)
	}
}

func TestQueueRecordKeepsScratchWhenLaunchIsResaved(t *testing.T) {
	a := newQueueApp(t)
	a.SaveQueueJob(PersistedJob{Game: "GTA V", State: "Queued"})
	a.SetQueueJobDownload("GTA V", "https://archive.org/download/x/GTA V.7z", "D:/proc/GTA V.7z")
	// A retry re-saves the launch before the pipeline reports a destination.
	a.SaveQueueJob(PersistedJob{Game: "GTA V", State: "Queued"})
	jobs := a.LoadQueueJobs()
	if len(jobs) != 1 || jobs[0].Scratch != "D:/proc/GTA V.7z" || jobs[0].URL == "" {
		t.Fatalf("re-saving the launch dropped the partial download: %+v", jobs)
	}
}

func TestQueueRecordClearedOnDelivery(t *testing.T) {
	for _, state := range []string{"Ready", "Pending FTP"} {
		a := newQueueApp(t)
		a.SaveQueueJob(PersistedJob{Game: "GTA V", State: "Processing"})
		a.LogStatus("GTA V", state, "done")
		if jobs := a.LoadQueueJobs(); len(jobs) != 0 {
			t.Fatalf("state %q left a record behind: %+v", state, jobs)
		}
	}
}

func TestQueueRecordIsNotCreatedByStatusAlone(t *testing.T) {
	a := newQueueApp(t)
	// DLC/TU downloads report status without ever registering a queue launch.
	a.LogStatus("Some DLC", "Processing", "Downloading...")
	if jobs := a.LoadQueueJobs(); len(jobs) != 0 {
		t.Fatalf("status alone created a resumable job: %+v", jobs)
	}
}

func TestCleanupStaleScratchPreservesQueuedPartialDownload(t *testing.T) {
	root := t.TempDir()
	scratch := filepath.Join(root, "proc")
	if err := os.MkdirAll(scratch, 0755); err != nil {
		t.Fatal(err)
	}
	partial := filepath.Join(scratch, "GTA V.7z")
	for _, path := range []string{partial, partial + DownloadResumeSuffix, partial + DownloadCompleteSuffix} {
		if err := os.WriteFile(path, []byte("keep"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	stale := filepath.Join(scratch, "Abandoned.iso")
	if err := os.WriteFile(stale, []byte("remove"), 0644); err != nil {
		t.Fatal(err)
	}

	a := NewApp()
	a.QueueDir = filepath.Join(root, "pending_queue")
	if err := os.MkdirAll(a.QueueDir, 0755); err != nil {
		t.Fatal(err)
	}
	a.SaveQueueJob(PersistedJob{Game: "GTA V", State: "Processing", Scratch: partial})

	a.cleanupStaleScratchDir(scratch, protectedScratchPaths(root))

	for _, path := range []string{partial, partial + DownloadResumeSuffix, partial + DownloadCompleteSuffix} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("startup cleanup wiped a queued download (%s): %v", filepath.Base(path), err)
		}
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("scratch with no queue record was kept: %v", err)
	}
}

func TestCleanupStaleScratchReclaimsRemovedJobDownload(t *testing.T) {
	root := t.TempDir()
	scratch := filepath.Join(root, "proc")
	if err := os.MkdirAll(scratch, 0755); err != nil {
		t.Fatal(err)
	}
	partial := filepath.Join(scratch, "GTA V.7z")
	if err := os.WriteFile(partial, []byte("remove"), 0644); err != nil {
		t.Fatal(err)
	}

	a := NewApp()
	a.QueueDir = filepath.Join(root, "pending_queue")
	if err := os.MkdirAll(a.QueueDir, 0755); err != nil {
		t.Fatal(err)
	}
	a.SaveQueueJob(PersistedJob{Game: "GTA V", State: "Processing", Scratch: partial})
	a.DeleteQueueJob("GTA V")

	a.cleanupStaleScratchDir(scratch, protectedScratchPaths(root))
	if _, err := os.Stat(partial); !os.IsNotExist(err) {
		t.Fatalf("download of a removed job was kept forever: %v", err)
	}
}
