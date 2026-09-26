package pipeline

import (
	"fmt"
	"time"

	"godsend/utils"
)

func (s *Service) archiveExtractionProgress(gameName string) func(utils.ExtractionProgress) {
	return func(p utils.ExtractionProgress) {
		message := fmt.Sprintf("Extraindo arquivos: %.1f MiB; %d arquivos concluidos", float64(p.Bytes)/(1024*1024), p.Files)
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
		s.App.LogStatus(gameName, "Processing", message)
	}
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
