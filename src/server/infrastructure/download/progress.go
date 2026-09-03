// progress.go — ProgressWriter for tracking download progress.
package download

import (
	"fmt"
	"time"

	"godsend/app"
)

// ProgressWriter is an io.Writer that tracks download progress and logs it.
type ProgressWriter struct {
	Total         int64
	Written       int64
	ResumeOffset  int64
	GameName      string
	LastLog       time.Time // logStatus cadence (500 ms — feeds Lua progress)
	LastConsole   time.Time // logf cadence (15 s — feeds Electron terminal)
	StartTime     time.Time
	FirstByteTime time.Time
	LowSpeedStart time.Time
	App           *app.App
}

func (pw *ProgressWriter) Write(p []byte) (int, error) {
	if pw.App.IsGameJobCancelled(pw.GameName) {
		return 0, app.ErrJobCancelled
	}
	n := len(p)
	pw.Written += int64(n)
	now := time.Now()
	if n > 0 && pw.FirstByteTime.IsZero() {
		pw.FirstByteTime = now
	}

	// Speed monitoring: check if download speed is below threshold
	threshold := pw.App.MinDownloadSpeedThreshold
	if threshold > 0 && !pw.App.IsSpeedCheckBypassed(pw.GameName) && !pw.FirstByteTime.IsZero() && now.Sub(pw.FirstByteTime) > app.LowSpeedGracePeriod && pw.Total > 0 {
		pct := float64(pw.Written) / float64(pw.Total) * 100
		if pct < 95 {
			activeElapsed := now.Sub(pw.FirstByteTime).Seconds()
			if activeElapsed >= 1.0 {
				speedBytesPerSec := float64(pw.Written-pw.ResumeOffset) / activeElapsed
				if speedBytesPerSec < float64(threshold) {
					if pw.LowSpeedStart.IsZero() {
						pw.LowSpeedStart = now
					} else if now.Sub(pw.LowSpeedStart) >= app.LowSpeedSustainedDuration {
						pw.App.Logf("WARN [%s]: Download speed sustained below threshold (%.2f MB/s < %.2f MB/s) — aborting for provider switch",
							pw.GameName, speedBytesPerSec/1048576, float64(threshold)/1048576)
						return 0, app.ErrDownloadTooSlow
					}
				} else {
					pw.LowSpeedStart = time.Time{}
				}
			}
		}
	}

	if now.Sub(pw.LastLog) > 500*time.Millisecond || pw.Written == pw.Total {
		percent := float64(pw.Written) / float64(pw.Total) * 100
		elapsed := now.Sub(pw.StartTime).Seconds()
		if elapsed < 0.001 {
			elapsed = 0.001
		}
		speedMBs := float64(pw.Written-pw.ResumeOffset) / elapsed / 1048576
		writtenMB := float64(pw.Written) / 1048576
		totalMB := float64(pw.Total) / 1048576
		elapsedStr := app.FmtDuration(elapsed)
		var etaStr string
		if speedMBs > 0 && percent < 100 {
			etaSecs := float64(pw.Total-pw.Written) / (speedMBs * 1048576)
			etaStr = "~" + app.FmtDuration(etaSecs) + " left"
		} else {
			etaStr = "done"
		}
		pw.App.LogStatus(pw.GameName, "Processing",
			fmt.Sprintf("Downloading: %.0f%% (%.0f/%.0f MB) @ %.1f MB/s | %s | %s",
				percent, writtenMB, totalMB, speedMBs, elapsedStr, etaStr))
		if now.Sub(pw.LastConsole) > 15*time.Second || pw.Written == pw.Total {
			pw.App.Logf("Download [%s]: %.1f%% (%.1f/%.1f MB) @ %.1f MB/s | %s",
				pw.GameName, percent, writtenMB, totalMB, speedMBs, elapsedStr)
			pw.LastConsole = now
		}
		pw.LastLog = now
	}
	return n, nil
}
