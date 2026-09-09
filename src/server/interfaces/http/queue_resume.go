// queue_resume.go — durable download queue: record a launch, and re-issue the
// jobs a previous session left unfinished.
package http

import (
	"runtime"
	"strings"

	"godsend/app"
	"godsend/models"
	pipelineService "godsend/services/pipeline"
)

// saveQueueRecord persists a launch so closing the application mid-download no
// longer loses the queue. Called before RegisterGameJob, whose "Queued" status
// is the first transition the record has to mirror.
func (d *Deps) saveQueueRecord(game, platform, installType, priority string) {
	job := app.PersistedJob{
		Game:        game,
		State:       "Queued",
		Platform:    platform,
		InstallType: installType,
		Priority:    priority,
	}
	if v, ok := d.App.XboxConnections.Load(game); ok {
		conn := v.(models.XboxConnection)
		job.Connection = &conn
	}
	d.App.SaveQueueJob(job)
}

// relaunchGame re-runs the pipeline for a game whose registration already lives
// in the in-memory maps: the Retry button, or a job restored from a previous
// session. platformHint is used only when no registration carries a platform.
// Returns the source label of the pipeline it started.
func (d *Deps) relaunchGame(game, platformHint, priorityParam, logTag string) string {
	d.App.SuppressedJobs.Delete(game)

	var conn models.XboxConnection
	hasConn := false
	if v, ok := d.App.XboxConnections.Load(game); ok {
		conn = v.(models.XboxConnection)
		hasConn = true
	}

	if hasConn && conn.Mode == "local" && conn.LocalRoot != "" {
		// Verify against the ID this job was registered with, never adopt the
		// device currently mounted there. On a mismatch the old ID is kept and
		// the pipeline's own device guard waits for the right one.
		if id, err := pipelineService.VerifyLocalDevice(conn.LocalRoot, conn.LocalDeviceID); err == nil {
			conn.LocalDeviceID = id
			d.App.XboxConnections.Store(game, conn)
		} else {
			d.App.Logf("%s: destino local de %q nao confere (%v) — aguardando o dispositivo correto", logTag, game, err)
		}
	}

	platform := "xbox360"
	if hasConn && conn.Platform != "" {
		platform = conn.Platform
	} else if platformHint != "" {
		platform = platformHint
	}

	installType := "god"
	if it, ok := d.App.InstallTypeMap.Load(game); ok {
		installType = it.(string)
	} else {
		d.App.InstallTypeMap.Store(game, installType)
	}

	// Delete from JobQueue so it can restart cleanly
	d.App.JobQueue.Delete(game)

	launcher := func(fn func()) {
		d.saveQueueRecord(game, platform, installType, priorityParam)
		jobToken := d.App.RegisterGameJob(game)
		go func() {
			if !d.App.AcquireGameJob(game, jobToken) {
				return
			}
			defer d.App.ReleaseGameJob(game, jobToken)
			defer func() {
				if rec := recover(); rec != nil {
					d.App.Logf("PANIC (%s) processing %s: %v", logTag, game, rec)
					buf := make([]byte, 4096)
					n := runtime.Stack(buf, false)
					d.App.Logf("STACK: %s", string(buf[:n]))
					d.App.LogStatus(game, "Error", "Server crashed during processing")
				}
			}()
			fn()
		}()
	}

	// Check local ISO
	if (platform == "xbox360" || platform == "xbox" || platform == "local") && d.Local != nil {
		if iso := d.Local.FindLocalISO(game); iso != "" {
			d.App.Logf("%s: Local ISO found for '%s'", logTag, game)
			launcher(func() { d.Pipeline.ProcessLocalISO(game, iso) })
			return "local"
		}
	}

	// ROM
	if strings.HasPrefix(platform, "rom_") {
		sysid := strings.TrimPrefix(platform, "rom_")
		if _, ok := app.ROMSystems[sysid]; ok {
			d.App.Logf("%s: ROM system %s for '%s'", logTag, sysid, game)
			launcher(func() { d.Pipeline.ProcessROM(game, sysid) })
			return "edgeemu"
		}
	}

	var providers []string
	if priorityParam != "" {
		providers = strings.Split(priorityParam, ",")
	} else {
		providers = []string{"huggingface", "ia", "minerva"}
	}

	d.App.Logf("%s: Game fallback pipeline for '%s' (%s, installType=%s)", logTag, game, platform, installType)
	launcher(func() { d.Pipeline.ProcessGameWithFallback(game, platform, providers) })
	return "retry"
}

// downloadProvider names the fallback provider that owns a download URL. A
// resumed job has to try that source first: with the default priority the
// provider ahead of it would fail, and the scratch cleanup between providers
// would then delete the very file the job was resuming.
func downloadProvider(rawURL string) string {
	switch u := strings.ToLower(rawURL); {
	case strings.Contains(u, "huggingface.co"):
		return "huggingface"
	case strings.Contains(u, "archive.org"):
		return "ia"
	}
	return ""
}

// resumePriority moves the provider that owns the partial download to the front
// of the priority list, leaving the rest of the user's order untouched.
func resumePriority(priority, rawURL string) string {
	owner := downloadProvider(rawURL)
	if owner == "" {
		return priority
	}
	list := []string{"huggingface", "ia", "minerva"}
	if priority != "" {
		list = strings.Split(priority, ",")
	}
	ordered := []string{owner}
	for _, p := range list {
		if strings.TrimSpace(strings.ToLower(p)) != owner {
			ordered = append(ordered, p)
		}
	}
	return strings.Join(ordered, ",")
}

// ResumeQueuedJobs restores the download queue saved by the previous session.
// Unfinished jobs are relaunched — the download layer picks the partial file up
// from its resume marker — while a job that had already failed comes back as an
// Error row so the user decides whether to retry it.
func (d *Deps) ResumeQueuedJobs() {
	jobs := d.App.LoadQueueJobs()
	if len(jobs) == 0 {
		return
	}
	// Oldest first: the processing lane is serial, so restoring in the order the
	// user queued them keeps the original priority.
	for i := 0; i < len(jobs); i++ {
		for j := i + 1; j < len(jobs); j++ {
			if jobs[j].UpdatedAt.Before(jobs[i].UpdatedAt) {
				jobs[i], jobs[j] = jobs[j], jobs[i]
			}
		}
	}
	for _, job := range jobs {
		if job.Connection != nil {
			d.App.XboxConnections.Store(job.Game, *job.Connection)
		}
		if job.InstallType != "" {
			d.App.InstallTypeMap.Store(job.Game, job.InstallType)
		}
		if job.State == "Error" {
			message := job.Message
			if message == "" {
				message = "Interrompido na sessao anterior."
			}
			d.App.JobQueue.Store(job.Game, models.GameStatus{State: "Error", Message: message})
			d.App.Logf("QUEUE RESUME: %q restaurado como Erro (use Tentar novamente)", job.Game)
			continue
		}
		d.App.Logf("QUEUE RESUME: retomando %q da sessao anterior", job.Game)
		d.relaunchGame(job.Game, job.Platform, resumePriority(job.Priority, job.URL), "QUEUE RESUME")
	}
}
