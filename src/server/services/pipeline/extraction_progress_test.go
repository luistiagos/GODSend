package pipeline

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

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
