// queue_store.go — durable download queue: the jobs the user enqueued survive
// closing the application. Only the in-memory JobQueue existed before, so
// quitting mid-download dropped the whole queue and the partial file with it.
package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"godsend/models"
)

// Suffixes of the sidecar files the download layer writes next to a partial
// archive. They live here so the startup scratch cleanup can protect them
// without importing infrastructure/download (which imports this package).
const (
	DownloadResumeSuffix   = ".xbox-companion-resume.json"
	DownloadCompleteSuffix = ".xbox-companion-complete.json"
)

// PersistedJob is everything needed to re-issue a queued download after the
// application is closed and reopened.
type PersistedJob struct {
	Game        string `json:"game"`
	State       string `json:"state"`
	Message     string `json:"message,omitempty"`
	Platform    string `json:"platform,omitempty"`
	InstallType string `json:"install_type,omitempty"`
	Priority    string `json:"priority,omitempty"`
	// Scratch is the partial download this job owns and URL is where it came
	// from. The startup cleanup keeps the file (and its resume markers) so the
	// transfer continues where it stopped, and the URL says which provider owns
	// it so the resume tries that source first.
	Scratch    string                 `json:"scratch,omitempty"`
	URL        string                 `json:"url,omitempty"`
	Connection *models.XboxConnection `json:"connection,omitempty"`
	UpdatedAt  time.Time              `json:"updated_at"`
}

// queueStoreMu serialises the read-modify-write cycles below. Status changes
// arrive from every pipeline goroutine at once.
var queueStoreMu sync.Mutex

// queueJobFile names a record after a hash of the game: titles carry
// characters Windows rejects in filenames, and a hash never collides with the
// sanitised name of a different title.
func queueJobFile(game string) string {
	sum := sha256.Sum256([]byte(game))
	return hex.EncodeToString(sum[:12]) + ".json"
}

// queueJobsIn reads every record in dir. It takes the directory instead of
// reading a.QueueDir so SetupPaths can consult the queue before that field is
// assigned.
func queueJobsIn(dir string) []PersistedJob {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var jobs []PersistedJob
	for _, e := range entries {
		if e.IsDir() || !strings.EqualFold(filepath.Ext(e.Name()), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var job PersistedJob
		if json.Unmarshal(data, &job) != nil || job.Game == "" {
			continue
		}
		jobs = append(jobs, job)
	}
	return jobs
}

func (a *App) queueJobPath(game string) string {
	return filepath.Join(a.QueueDir, queueJobFile(game))
}

func (a *App) loadQueueJobLocked(game string) (PersistedJob, bool) {
	data, err := os.ReadFile(a.queueJobPath(game))
	if err != nil {
		return PersistedJob{}, false
	}
	var job PersistedJob
	if json.Unmarshal(data, &job) != nil || job.Game == "" {
		return PersistedJob{}, false
	}
	return job, true
}

func (a *App) saveQueueJobLocked(job PersistedJob) {
	job.UpdatedAt = time.Now()
	data, err := json.Marshal(job)
	if err != nil {
		return
	}
	if err := os.WriteFile(a.queueJobPath(job.Game), data, 0644); err != nil {
		a.Logf("[WARN] Could not persist queue job %q: %v", job.Game, err)
	}
}

// SaveQueueJob records a launch so a restart can resume it. A download already
// on file is kept: the pipeline only reports it once the destination is known,
// and losing it here would expose the partial file to the next startup cleanup.
func (a *App) SaveQueueJob(job PersistedJob) {
	if a.QueueDir == "" || job.Game == "" {
		return
	}
	queueStoreMu.Lock()
	defer queueStoreMu.Unlock()
	if job.Scratch == "" {
		if prev, ok := a.loadQueueJobLocked(job.Game); ok {
			job.Scratch = prev.Scratch
			job.URL = prev.URL
		}
	}
	a.saveQueueJobLocked(job)
}

// SetQueueJobDownload records the partial download a queued job owns and the
// source it came from.
func (a *App) SetQueueJobDownload(game, urlStr, path string) {
	if a.QueueDir == "" || game == "" || path == "" {
		return
	}
	queueStoreMu.Lock()
	defer queueStoreMu.Unlock()
	job, ok := a.loadQueueJobLocked(game)
	if !ok || (job.Scratch == path && job.URL == urlStr) {
		return
	}
	job.Scratch = path
	job.URL = urlStr
	a.saveQueueJobLocked(job)
}

// DeleteQueueJob drops the record: the job finished, or the user removed it.
func (a *App) DeleteQueueJob(game string) {
	if a.QueueDir == "" || game == "" {
		return
	}
	queueStoreMu.Lock()
	defer queueStoreMu.Unlock()
	os.Remove(a.queueJobPath(game))
}

// LoadQueueJobs reads every job left behind by a previous session.
func (a *App) LoadQueueJobs() []PersistedJob {
	if a.QueueDir == "" {
		return nil
	}
	queueStoreMu.Lock()
	defer queueStoreMu.Unlock()
	return queueJobsIn(a.QueueDir)
}

// persistJobState mirrors a state transition onto the record so a restart
// restores the queue as the user last saw it. It never creates a record:
// only a launch knows the platform and priority needed to re-issue the job.
func (a *App) persistJobState(game, state, message string) {
	if a.QueueDir == "" {
		return
	}
	switch state {
	case "Ready":
		// Delivered. Nothing left to resume.
		a.DeleteQueueJob(game)
		return
	case "Pending FTP":
		// The pending-FTP store owns this job from here and main.go already
		// resumes it; two resume paths would transfer the game twice.
		a.DeleteQueueJob(game)
		return
	}
	queueStoreMu.Lock()
	defer queueStoreMu.Unlock()
	job, ok := a.loadQueueJobLocked(game)
	if !ok || job.State == state {
		return
	}
	job.State = state
	job.Message = message
	a.saveQueueJobLocked(job)
}
