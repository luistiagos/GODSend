package pipeline

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"godsend/infrastructure/telemetry"
	"godsend/utils"
)

var (
	extractionHeartbeatInterval = 30 * time.Second
	extractionStallTimeout      = 5 * time.Minute
	extractionTelemetryReport   = telemetry.Report
	extractionLogf              = func(s *Service, format string, args ...interface{}) {
		if s != nil && s.App != nil {
			s.App.Logf(format, args...)
		}
	}
)

func extractionVolumeInfo(destDir string) (string, uint64, bool) {
	if destDir == "" {
		return "", 0, false
	}
	volume := filepath.VolumeName(destDir)
	query := destDir
	if volume != "" {
		query = volume + string(filepath.Separator)
	} else {
		volume = destDir
	}
	free, err := freeSpaceBytes(query)
	if err != nil {
		return volume, 0, false
	}
	return volume, free, true
}

func formatFreeSpaceLabel(free uint64, ok bool) string {
	if !ok {
		return "desconhecido"
	}
	return fmt.Sprintf("%.2f GB", float64(free)/1073741824)
}

func formatEntryProgress(p utils.ExtractionProgress) string {
	if p.CurrentFileSize >= 0 {
		return fmt.Sprintf("%.1f/%.1f MiB", float64(p.CurrentFileBytes)/(1024*1024), float64(p.CurrentFileSize)/(1024*1024))
	}
	return fmt.Sprintf("%.1f MiB", float64(p.CurrentFileBytes)/(1024*1024))
}

func formatExtractionQueueMessage(p utils.ExtractionProgress, volume, suffix string) string {
	prefix := "Extraindo arquivos"
	if volume != "" {
		prefix = fmt.Sprintf("Extraindo arquivos (%s)", volume)
	}
	message := fmt.Sprintf("%s: %.1f MiB; %d arquivos concluidos", prefix, float64(p.Bytes)/(1024*1024), p.Files)
	if suffix != "" {
		message += suffix
	}
	if p.Done {
		message += " (100%)"
	} else if p.TotalBytes >= 0 {
		percent := 0
		if p.TotalBytes > 0 {
			percent = int(100 * float64(p.Bytes) / float64(p.TotalBytes))
		}
		// Written bytes can reach the total before CRC, Sync and Rename.
		// QueuePage rounds percentages, so never publish 100 until success.
		if percent > 99 {
			percent = 99
		}
		message += fmt.Sprintf(" (%d%%)", percent)
	}
	return message
}

func (s *Service) archiveExtractionProgress(gameName string) func(utils.ExtractionProgress) {
	return s.archiveExtractionProgressForDir(gameName, "")
}

func (s *Service) archiveExtractionProgressForDir(gameName, destDir string) func(utils.ExtractionProgress) {
	volume := ""
	if destDir != "" {
		volume = filepath.VolumeName(destDir)
	}
	return func(p utils.ExtractionProgress) {
		s.App.LogStatus(gameName, "Processing", formatExtractionQueueMessage(p, volume, ""))
	}
}

func (s *Service) startExtractionMonitor(gameName, phase, archivePath, destDir string, snapshot func() utils.ExtractionProgress) func() {
	heartbeatEvery := extractionHeartbeatInterval
	if heartbeatEvery <= 0 {
		heartbeatEvery = 30 * time.Second
	}
	stallAfter := extractionStallTimeout
	if stallAfter <= 0 {
		stallAfter = 5 * time.Minute
	}
	tickInterval := heartbeatEvery
	if half := stallAfter / 2; half < tickInterval {
		tickInterval = half
	}
	if tickInterval < 5*time.Millisecond {
		tickInterval = 5 * time.Millisecond
	}

	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	start := time.Now()

	go func() {
		defer close(doneCh)
		ticker := time.NewTicker(tickInterval)
		defer ticker.Stop()

		lastHeartbeat := start
		lastAdvanceAt := start
		var lastBytes int64
		var lastFiles int
		var lastHeartbeatBytes int64
		stalledReported := false

		for {
			select {
			case <-stopCh:
				return
			case now := <-ticker.C:
				snap := snapshot()
				if snap.Bytes != lastBytes || snap.Files != lastFiles {
					lastBytes = snap.Bytes
					lastFiles = snap.Files
					lastAdvanceAt = now
					stalledReported = false
				}
				op := snap.ActiveOp
				if op == "" {
					op = "idle"
				}
				volume, free, freeOK := extractionVolumeInfo(destDir)

				if now.Sub(lastHeartbeat) >= heartbeatEvery {
					elapsed := now.Sub(lastHeartbeat).Seconds()
					rateMiBs := 0.0
					if elapsed > 0 && snap.Bytes >= lastHeartbeatBytes {
						rateMiBs = float64(snap.Bytes-lastHeartbeatBytes) / (1024 * 1024) / elapsed
					}
					extractionLogf(s, "EXTRACT PROGRESS [%s] (%s): %.1f MiB | taxa %.2f MiB/s | %d arquivos | arquivo=%q (%s) | op=%s | vol=%s livre=%s",
						gameName, phase, float64(snap.Bytes)/(1024*1024), rateMiBs, snap.Files, snap.CurrentFile, formatEntryProgress(snap), op, volume, formatFreeSpaceLabel(free, freeOK))
					lastHeartbeat = now
					lastHeartbeatBytes = snap.Bytes
				}

				if !snap.Done && !stalledReported && now.Sub(lastAdvanceAt) >= stallAfter {
					stalledReported = true
					stallFor := now.Sub(lastAdvanceAt).Round(time.Millisecond)
					if stallFor >= time.Second {
						stallFor = stallFor.Round(time.Second)
					}
					diagMsg := fmt.Sprintf("EXTRACT STALL [%s] (%s): sem progresso ha %s em %s | %.1f MiB (%d arquivos) | arquivo=%q (%s) | op=%s | origem=%s | vol=%s livre=%s",
						gameName, phase, stallFor, destDir, float64(snap.Bytes)/(1024*1024), snap.Files, snap.CurrentFile, formatEntryProgress(snap), op, archivePath, volume, formatFreeSpaceLabel(free, freeOK))
					extractionLogf(s, "%s", diagMsg)

					volLabel := filepath.VolumeName(destDir)
					suffix := fmt.Sprintf(" — sem progresso ha %s em %s", stallFor, op)
					if snap.CurrentFile != "" {
						suffix = fmt.Sprintf(" — sem progresso ha %s em %s (%s)", stallFor, op, filepath.Base(snap.CurrentFile))
					}
					s.App.LogStatus(gameName, "Processing", formatExtractionQueueMessage(snap, volLabel, suffix))

					extractionTelemetryReport("pipeline", "extraction_progress.go", "startExtractionMonitor",
						fmt.Sprintf("Extração parada (%s) em %s (%s): arquivo %q travado em op=%s", phase, volume, gameName, snap.CurrentFile, op),
						"", []string{diagMsg}, false)
				}
			}
		}
	}()

	return func() {
		close(stopCh)
		<-doneCh
	}
}

func (s *Service) runMonitoredExtraction(gameName, phase, archivePath, destDir string, snapshot func() utils.ExtractionProgress, run func() error) error {
	var archiveMiB float64
	if st, err := os.Stat(archivePath); err == nil {
		archiveMiB = float64(st.Size()) / (1024 * 1024)
	}
	volume, free, freeOK := extractionVolumeInfo(destDir)
	extractionLogf(s, "EXTRACT START [%s] (%s): origem=%s (%.1f MiB) dest=%s vol=%s livre=%s",
		gameName, phase, archivePath, archiveMiB, destDir, volume, formatFreeSpaceLabel(free, freeOK))

	start := time.Now()
	stop := s.startExtractionMonitor(gameName, phase, archivePath, destDir, snapshot)
	err := run()
	stop()

	elapsed := time.Since(start).Round(time.Millisecond)
	snap := snapshot()
	endVolume, endFree, endFreeOK := extractionVolumeInfo(destDir)
	if err == nil {
		extractionLogf(s, "EXTRACT END [%s] (%s): concluido em %s | %.1f MiB | %d arquivos | vol=%s livre=%s",
			gameName, phase, elapsed, float64(snap.Bytes)/(1024*1024), snap.Files, endVolume, formatFreeSpaceLabel(endFree, endFreeOK))
		return nil
	}
	op := snap.ActiveOp
	if op == "" {
		op = "idle"
	}
	extractionLogf(s, "EXTRACT END [%s] (%s): interrompido em %s (%v) | %.1f MiB | %d arquivos | ultimo=%q op=%s | vol=%s livre=%s",
		gameName, phase, elapsed, err, float64(snap.Bytes)/(1024*1024), snap.Files, snap.CurrentFile, op, endVolume, formatFreeSpaceLabel(endFree, endFreeOK))
	return err
}

// Checkpoints hash every output byte. Keep that separate from extraction so a
// large archive does not leave the UI sitting at 100% during this second pass.
// The callback is synchronous and scoped to one pass, with no background ticker
// that could overwrite a later stage or a terminal job state.
func (s *Service) stageVerificationProgress(gameName string) func(int) {
	var bytes int64
	var last time.Time
	return func(n int) {
		bytes += int64(n)
		now := time.Now()
		if now.Sub(last) >= time.Second {
			last = now
			s.App.LogStatus(gameName, "Processing", fmt.Sprintf("Verificando arquivos processados: %.1f MiB conferidos...", float64(bytes)/(1024*1024)))
		}
	}
}

type stageProgressWriter func(int)

func (w stageProgressWriter) Write(b []byte) (int, error) {
	w(len(b))
	return len(b), nil
}
