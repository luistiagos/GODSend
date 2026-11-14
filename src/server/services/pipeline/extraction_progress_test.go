package pipeline

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"godsend/app"
	"godsend/models"
	"godsend/utils"
)

func extractionTestArchive(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "game.zip")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	for _, name := range []string{"disc/game.iso", "readme.txt"} {
		entry, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(entry, "payload"); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func extractionQueueStatus(t *testing.T, s *Service) models.GameStatus {
	t.Helper()
	value, ok := s.App.JobQueue.Load("Example")
	if !ok {
		t.Fatal("extraction did not publish queue status")
	}
	status := value.(models.GameStatus)
	if status.State != "Processing" {
		t.Fatalf("unexpected state: %+v", status)
	}
	return status
}

func TestArchiveExtractionPublishesQueueProgress(t *testing.T) {
	s := &Service{App: app.NewApp()}
	report := s.archiveExtractionProgress("Example")
	var messages []string
	err := utils.ExtractArchiveWithProgress(extractionTestArchive(t), t.TempDir(), func(p utils.ExtractionProgress) {
		report(p)
		messages = append(messages, extractionQueueStatus(t, s).Message)
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) < 2 || !strings.Contains(messages[0], "(0%)") || !strings.Contains(messages[len(messages)-1], "(100%)") {
		t.Fatalf("missing extraction status sequence: %q", messages)
	}
	// This is the percentage syntax consumed by QueuePage, without a renderer change.
	pct := regexp.MustCompile(`\((\d+\.?\d*)%\)`)
	for _, message := range messages {
		if !pct.MatchString(message) {
			t.Fatalf("QueuePage cannot parse: %q", message)
		}
	}
}

func TestExtractionMessageDoesNotInventCompletionOrTotal(t *testing.T) {
	s := &Service{App: app.NewApp()}
	report := s.archiveExtractionProgress("Example")
	for _, total := range []int64{0, 100} {
		report(utils.ExtractionProgress{Bytes: total, TotalBytes: total})
		if strings.Contains(extractionQueueStatus(t, s).Message, "(100%)") {
			t.Fatal("reported completion before validation")
		}
	}
	report(utils.ExtractionProgress{Bytes: 4 * 1024 * 1024, TotalBytes: -1, Files: 3})
	message := extractionQueueStatus(t, s).Message
	if strings.Contains(message, "%") || !strings.Contains(message, "4.0 MiB") || !strings.Contains(message, "3 arquivos") {
		t.Fatalf("missing honest RAR counters: %q", message)
	}
}

func TestResilientExtractionCompletesAndReusesCheckpoint(t *testing.T) {
	for _, isoOnly := range []bool{false, true} {
		t.Run(map[bool]string{false: "archive", true: "iso"}[isoOnly], func(t *testing.T) {
			s := &Service{App: app.NewApp()}
			source := extractionTestArchive(t)
			root := t.TempDir()
			for attempt := 0; attempt < 2; attempt++ {
				s.App.JobQueue.Delete("Example")
				var err error
				if isoOnly {
					_, _, err = s.extractISOResilient("Example", "game", source, root)
				} else {
					err = s.extractArchiveResilient("Example", source, filepath.Join(root, "extracted"))
				}
				if err != nil {
					t.Fatal(err)
				}
				if got := extractionQueueStatus(t, s).Message; got != "Extracao verificada (100%)" {
					t.Fatalf("attempt %d: %q", attempt, got)
				}
			}
		})
	}
}

func TestCheckpointHashPublishesVerificationActivity(t *testing.T) {
	s := &Service{App: app.NewApp()}
	file := filepath.Join(t.TempDir(), "output.bin")
	if err := os.WriteFile(file, []byte("payload"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := hashStageFile(file, s.stageVerificationProgress("Example")); err != nil {
		t.Fatal(err)
	}
	if got := extractionQueueStatus(t, s).Message; !strings.HasPrefix(got, "Verificando arquivos processados:") {
		t.Fatalf("hashing left a stale extraction message: %q", got)
	}
}

func largeMultiEntryZip(t *testing.T, entries int) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "multi.zip")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	isoPayload := bytes.Repeat([]byte("A"), 24*1024*1024)
	for i := 0; i < entries; i++ {
		name := fmt.Sprintf("files/part-%03d.bin", i)
		data := []byte("payload")
		if i == 0 {
			name = "game.iso"
			data = isoPayload
		}
		entry, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestResilientExtractionCancelsQuicklyAndReleasesProcessingLane(t *testing.T) {
	for _, isoOnly := range []bool{false, true} {
		t.Run(map[bool]string{false: "archive", true: "iso"}[isoOnly], func(t *testing.T) {
			s := &Service{App: app.NewApp()}
			source := largeMultiEntryZip(t, 64)
			root := t.TempDir()
			destDir := filepath.Join(root, "extracted")

			// Missing local device ensures cancellation skips device wait and retries.
			s.App.XboxConnections.Store("Example", models.XboxConnection{
				Mode:          "local",
				LocalRoot:     filepath.Join(root, "usb"),
				LocalDeviceID: "missing-device-id",
			})

			token1 := s.App.RegisterGameJob("Example")
			if !s.App.AcquireGameJob("Example", token1) {
				t.Fatal("failed to acquire initial job")
			}

			extractErrCh := make(chan error, 1)
			go func() {
				defer s.App.ReleaseGameJob("Example", token1)
				if isoOnly {
					_, _, err := s.extractISOResilient("Example", "game", source, root)
					extractErrCh <- err
					return
				}
				extractErrCh <- s.extractArchiveResilient("Example", source, destDir)
			}()

			// Wait until extraction actually begins before cancelling the active job.
			deadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(deadline) {
				if raw, ok := s.App.JobQueue.Load("Example"); ok {
					if status, ok := raw.(models.GameStatus); ok && strings.HasPrefix(status.Message, "Extraindo arquivos") {
						break
					}
				}
				runtime.Gosched()
			}
			s.App.CancelGameJob("Example")

			laneAcquired := make(chan struct{})
			token2 := s.App.RegisterGameJob("NextGame")
			go func() {
				if s.App.AcquireGameJob("NextGame", token2) {
					close(laneAcquired)
					s.App.ReleaseGameJob("NextGame", token2)
				}
			}()

			select {
			case err := <-extractErrCh:
				if !errors.Is(err, app.ErrJobCancelled) {
					t.Fatalf("expected app.ErrJobCancelled, got %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("extraction did not abort promptly after CancelGameJob")
			}

			select {
			case <-laneAcquired:
			case <-time.After(time.Second):
				t.Fatal("next game remained blocked on gameProcessingMu after cancellation")
			}

			if got := s.invalidateDownloadedArchiveOnCorruptExtract("Example", source, "huggingface", app.ErrJobCancelled); !errors.Is(got, app.ErrJobCancelled) {
				t.Fatalf("expected invalidate to preserve cancellation, got %v", got)
			}
			if _, statErr := os.Stat(corruptArchiveRedownloadMarkerPath(source)); !os.IsNotExist(statErr) {
				t.Fatalf("cancelled extraction created corrupt archive marker")
			}
		})
	}
}

func TestStageCheckpointHashAbortsOnContextCancel(t *testing.T) {
	file := filepath.Join(t.TempDir(), "output.bin")
	if err := os.WriteFile(file, make([]byte, 256*1024), 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := hashStageFileWithContext(ctx, file, nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}

func captureExtractionDiagnostics(t *testing.T) (*[]string, *[]string, *sync.Mutex) {
	t.Helper()
	var mu sync.Mutex
	var logs []string
	var telemetries []string

	prevLogf := extractionLogf
	extractionLogf = func(s *Service, format string, args ...interface{}) {
		mu.Lock()
		logs = append(logs, fmt.Sprintf(format, args...))
		mu.Unlock()
	}
	prevTel := extractionTelemetryReport
	extractionTelemetryReport = func(component, file, method, message, pageURL string, telLogs []string, terminal bool) {
		mu.Lock()
		telemetries = append(telemetries, message+" | "+strings.Join(telLogs, "; "))
		mu.Unlock()
	}
	t.Cleanup(func() {
		extractionLogf = prevLogf
		extractionTelemetryReport = prevTel
	})
	return &logs, &telemetries, &mu
}

func TestExtractionProgressMessageIncludesVolumeWhenAvailable(t *testing.T) {
	s := &Service{App: app.NewApp()}
	report := s.archiveExtractionProgressForDir("Example", `D:\godsend-temp\proc`)
	report(utils.ExtractionProgress{Bytes: 4 * 1024 * 1024, TotalBytes: -1, Files: 3})
	msg := extractionQueueStatus(t, s).Message
	if !strings.Contains(msg, "(D:)") || strings.Contains(msg, "%") || !strings.Contains(msg, "4.0 MiB") {
		t.Fatalf("unexpected volume message for RAR: %q", msg)
	}
	report(utils.ExtractionProgress{Bytes: 50, TotalBytes: 100, Files: 1})
	msgZip := extractionQueueStatus(t, s).Message
	if !strings.Contains(msgZip, "(D:)") || !strings.Contains(msgZip, "(50%)") {
		t.Fatalf("unexpected volume message for ZIP: %q", msgZip)
	}
}

func TestExtractionLogsStartHeartbeatAndVolumeFreeSpace(t *testing.T) {
	prevHB, prevStall, prevFree := extractionHeartbeatInterval, extractionStallTimeout, freeSpaceBytes
	extractionHeartbeatInterval = 10 * time.Millisecond
	extractionStallTimeout = 5 * time.Second
	freeSpaceBytes = func(string) (uint64, error) { return 64 * 1024 * 1024 * 1024, nil }
	t.Cleanup(func() {
		extractionHeartbeatInterval = prevHB
		extractionStallTimeout = prevStall
		freeSpaceBytes = prevFree
	})

	logs, telemetries, mu := captureExtractionDiagnostics(t)
	s := &Service{App: app.NewApp()}
	source := largeMultiEntryZip(t, 16)
	dest := filepath.Join(t.TempDir(), "extracted")
	if err := s.extractArchiveResilient("Example", source, dest); err != nil {
		t.Fatal(err)
	}

	mu.Lock()
	joined := strings.Join(*logs, "\n")
	telCount := len(*telemetries)
	mu.Unlock()

	if !strings.Contains(joined, "EXTRACT START [Example]") || !strings.Contains(joined, "livre=64.00 GB") {
		t.Fatalf("missing EXTRACT START with free space: %s", joined)
	}
	if !strings.Contains(joined, "EXTRACT PROGRESS [Example]") {
		t.Fatalf("missing periodic EXTRACT PROGRESS heartbeat: %s", joined)
	}
	if !strings.Contains(joined, "EXTRACT END [Example]") {
		t.Fatalf("missing EXTRACT END: %s", joined)
	}
	if telCount != 0 {
		t.Fatalf("healthy extraction emitted unexpected stall telemetry: %d", telCount)
	}
}

func TestExtractionStallDetectorReportsOpAndPreservesDownloadedArchive(t *testing.T) {
	prevHB, prevStall, prevFree := extractionHeartbeatInterval, extractionStallTimeout, freeSpaceBytes
	extractionHeartbeatInterval = 15 * time.Millisecond
	extractionStallTimeout = 40 * time.Millisecond
	freeSpaceBytes = func(string) (uint64, error) { return 32 * 1024 * 1024 * 1024, nil }
	t.Cleanup(func() {
		extractionHeartbeatInterval = prevHB
		extractionStallTimeout = prevStall
		freeSpaceBytes = prevFree
	})

	for _, op := range []string{"read", "write"} {
		t.Run(op, func(t *testing.T) {
			logs, telemetries, mu := captureExtractionDiagnostics(t)
			s := &Service{App: app.NewApp()}
			source := extractionTestArchive(t)
			origInfo, err := os.Stat(source)
			if err != nil {
				t.Fatal(err)
			}
			dest := filepath.Join(t.TempDir(), "out")

			snap := utils.ExtractionProgress{
				Bytes:            128 * 1024 * 1024,
				TotalBytes:       -1,
				Files:            3,
				CurrentFile:      "Content/0000000000000000/545408A7/00000002/part1",
				CurrentFileBytes: 16 * 1024 * 1024,
				CurrentFileSize:  512 * 1024 * 1024,
				ActiveOp:         op,
			}
			stop := s.startExtractionMonitor("GTA 5", "extract-archive", source, dest, func() utils.ExtractionProgress {
				return snap
			})

			deadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(deadline) {
				mu.Lock()
				n := len(*telemetries)
				mu.Unlock()
				if n > 0 {
					break
				}
				time.Sleep(5 * time.Millisecond)
			}
			time.Sleep(60 * time.Millisecond) // Ensure repeated ticks do not spam telemetry in one stall episode.
			stop()

			mu.Lock()
			telCopy := append([]string(nil), (*telemetries)...)
			logsJoined := strings.Join(*logs, "\n")
			mu.Unlock()

			if len(telCopy) != 1 {
				t.Fatalf("expected exactly 1 telemetry report per stall episode, got %d: %+v", len(telCopy), telCopy)
			}
			if !strings.Contains(telCopy[0], "op="+op) || !strings.Contains(logsJoined, "EXTRACT STALL [GTA 5]") || !strings.Contains(logsJoined, "op="+op) {
				t.Fatalf("missing op=%s diagnosis in stall report (%+v) or logs (%s)", op, telCopy, logsJoined)
			}
			rawStatus, ok := s.App.JobQueue.Load("GTA 5")
			if !ok {
				t.Fatalf("stall monitor did not publish queue status")
			}
			got := rawStatus.(models.GameStatus)
			if got.State != "Processing" || !strings.Contains(got.Message, "sem progresso") || !strings.Contains(got.Message, "op="+op) && !strings.Contains(got.Message, "em "+op) {
				t.Fatalf("unexpected stall queue status: %+v", got)
			}
			afterInfo, err := os.Stat(source)
			if err != nil || afterInfo.Size() != origInfo.Size() {
				t.Fatalf("stall detector modified or deleted source archive: err=%v after=%v before=%v", err, afterInfo, origInfo)
			}
			if _, markerErr := os.Stat(corruptArchiveRedownloadMarkerPath(source)); !os.IsNotExist(markerErr) {
				t.Fatalf("stall detector created corrupt redownload marker")
			}
		})
	}
}
