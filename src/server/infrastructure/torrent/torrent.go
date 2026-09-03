// torrent.go — aria2c probing, Minerva torrent fetching, and torrent-based downloads.
package torrent

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/anacrolix/torrent/metainfo"

	"godsend/app"
	"godsend/infrastructure/helpers"
	"godsend/models"
)

// Service provides torrent-based download capabilities via aria2c.
type Service struct {
	App *app.App

	// DarwinCandidatesFn returns extra macOS Homebrew aria2c paths to probe.
	// Injected from the build-tagged package-main function.
	DarwinCandidatesFn func() []string

	// aria2c resolved path cache (mutex-guarded, local to this service)
	aria2cResolvedMu   sync.Mutex
	aria2cResolvedPath string
	minervaTorrentMu   sync.Mutex
	minervaTorrents    map[string][]byte
}

// FetchMinervaTorrent downloads the collection .torrent file for the given platform from Minerva.
func (s *Service) FetchMinervaTorrent(platform string) ([]byte, error) {
	torrentURL, ok := app.MinervaTorrentURLs[platform]
	if !ok {
		return nil, fmt.Errorf("no torrent URL for platform %q", platform)
	}
	s.minervaTorrentMu.Lock()
	defer s.minervaTorrentMu.Unlock()
	if cached := s.minervaTorrents[torrentURL]; len(cached) > 0 {
		return cached, nil
	}
	s.App.Logf("TORRENT: Fetching collection torrent for %s...", platform)
	req, err := http.NewRequest("GET", torrentURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0")
	resp, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("download torrent: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("torrent HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if s.minervaTorrents == nil {
		s.minervaTorrents = make(map[string][]byte)
	}
	s.minervaTorrents[torrentURL] = data
	return data, nil
}

// aria2cWorks runs `<path> --version` with a short timeout and reports whether
// the binary launches cleanly.
func aria2cWorks(path string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "--version")
	out, err := cmd.CombinedOutput()
	if err != nil {
		snippet := strings.TrimSpace(string(out))
		if len(snippet) > 200 {
			snippet = snippet[:200] + "…"
		}
		if snippet == "" {
			return err
		}
		return fmt.Errorf("%w: %s", err, snippet)
	}
	return nil
}

// ProbeWorkingAria2c finds a usable aria2c (bundled next to the server binary, PATH,
// then macOS Homebrew locations). Not cached — used at startup and by Aria2cBinary.
func (s *Service) ProbeWorkingAria2c() (string, error) {
	name := "aria2c"
	if runtime.GOOS == "windows" {
		name = "aria2c.exe"
	}
	var lastErr error
	tried := map[string]bool{}

	try := func(p string, label string) (string, bool) {
		if p == "" || tried[p] {
			return "", false
		}
		tried[p] = true
		werr := aria2cWorks(p)
		if werr == nil {
			return p, true
		}
		lastErr = fmt.Errorf("%s (%s) unusable: %v", label, p, werr)
		return "", false
	}

	// Packaged builds ship aria2c next to the backend binary; the dev tree keeps
	// it in a "tools/" subdir (dist/tools/aria2c.exe). Probe both.
	bundledCandidates := []string{
		filepath.Join(s.App.GodsendExeDir, name),
		filepath.Join(s.App.GodsendExeDir, "tools", name),
	}
	for _, bundled := range bundledCandidates {
		if _, err := os.Stat(bundled); err != nil {
			continue
		}
		if p, ok := try(bundled, "bundled aria2c"); ok {
			return p, nil
		}
		if lastErr != nil {
			s.App.Logf("[WARN] %v — trying PATH / Homebrew locations", lastErr)
		}
	}

	if lp, err := exec.LookPath("aria2c"); err == nil {
		if p, ok := try(lp, "aria2c on PATH"); ok {
			return p, nil
		}
	}

	var candidates []string
	if s.DarwinCandidatesFn != nil {
		candidates = s.DarwinCandidatesFn()
	}
	for _, cand := range candidates {
		if _, err := os.Stat(cand); err != nil {
			continue
		}
		if p, ok := try(cand, "aria2c"); ok {
			return p, nil
		}
	}

	if lastErr != nil {
		return "", fmt.Errorf("aria2c not usable — %v", lastErr)
	}
	return "", fmt.Errorf("aria2c not found — bundled binary missing and not in PATH")
}

// Aria2cBinary returns the path to a working aria2c executable.
// Tries the bundled binary first (next to the server binary), validates it with
// `--version`, then PATH and macOS Homebrew paths. Result is cached.
func (s *Service) Aria2cBinary() (string, error) {
	s.aria2cResolvedMu.Lock()
	defer s.aria2cResolvedMu.Unlock()
	if s.aria2cResolvedPath != "" {
		return s.aria2cResolvedPath, nil
	}
	p, err := s.ProbeWorkingAria2c()
	if err != nil {
		if runtime.GOOS == "darwin" {
			return "", fmt.Errorf("%w. On macOS the backend normally installs Homebrew aria2 at startup; fix the error above or set GODSEND_SKIP_ARIA2_BOOTSTRAP=1 and install aria2 yourself", err)
		}
		return "", fmt.Errorf("%w. Install aria2 and restart the backend", err)
	}
	s.aria2cResolvedPath = p
	bundledName := "aria2c"
	if runtime.GOOS == "windows" {
		bundledName = "aria2c.exe"
	}
	bundled := filepath.Join(s.App.GodsendExeDir, bundledName)
	if p != bundled {
		s.App.Logf("[INFO] Using aria2c: %s", p)
	}
	return p, nil
}

// torrentBasenameMatches reports whether a path inside the .torrent matches the Minerva entry
// filename, including when one side uses HTML entities and the other uses a literal apostrophe.
func torrentBasenameMatches(torrentBase, entryFileName string) bool {
	for _, torrentKey := range minervaFilenameKeys(torrentBase) {
		for _, entryKey := range minervaFilenameKeys(entryFileName) {
			if torrentKey == entryKey {
				return true
			}
		}
	}
	return false
}

func minervaFilenameKeys(name string) []string {
	decoded := helpers.DecodeMinervaName(strings.TrimSpace(name))
	keys := []string{
		strings.ToLower(strings.TrimSpace(name)),
		strings.ToLower(decoded),
		strings.ToLower(strings.TrimSuffix(decoded, filepath.Ext(decoded))),
	}
	unique := make([]string, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		if key == "" {
			continue
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, key)
	}
	return unique
}

// ValidateMinervaEntries verifies that every catalog entry names a real file
// in the collection torrent used by DownloadViaTorrent.
func (s *Service) ValidateMinervaEntries(platform string, entries []models.MinervaEntry) ([]models.MinervaEntry, []string, error) {
	torrentData, err := s.FetchMinervaTorrent(platform)
	if err != nil {
		return nil, nil, err
	}
	mi, err := metainfo.Load(bytes.NewReader(torrentData))
	if err != nil {
		return nil, nil, fmt.Errorf("parse .torrent: %w", err)
	}
	info, err := mi.UnmarshalInfo()
	if err != nil {
		return nil, nil, fmt.Errorf("torrent info: %w", err)
	}

	torrentKeys := make(map[string]struct{})
	for _, file := range info.UpvertedFiles() {
		base := filepath.Base(filepath.Join(file.Path...))
		for _, key := range minervaFilenameKeys(base) {
			torrentKeys[key] = struct{}{}
		}
	}

	valid := make([]models.MinervaEntry, 0, len(entries))
	missing := make([]string, 0)
	for _, entry := range entries {
		matched := false
		for _, key := range minervaFilenameKeys(entry.FileName) {
			if _, ok := torrentKeys[key]; ok {
				matched = true
				break
			}
		}
		if matched {
			valid = append(valid, entry)
		} else {
			missing = append(missing, entry.FileName)
		}
	}
	return valid, missing, nil
}

// aria2cExitMessages maps aria2c's documented exit codes to human-readable
// causes so failures surface a real reason instead of a bare "exit status N".
// See the aria2 manual "EXIT STATUS" section.
var aria2cExitMessages = map[int]string{
	2:  "timed out",
	3:  "a resource was not found",
	4:  "too many resources not found",
	5:  "download was too slow and aborted",
	6:  "network problem",
	7:  "unfinished downloads remained",
	8:  "server did not support resume",
	9:  "not enough disk space available",
	11: "aria2c was already downloading the same file",
	12: "aria2c was already downloading the same torrent",
	13: "file already existed",
	16: "could not create or truncate the file",
	17: "file I/O error",
	18: "could not create the download directory",
	19: "name resolution failed",
	22: "bad or unexpected HTTP response header",
	24: "HTTP authorization failed",
	25: "could not parse the .torrent file",
	26: "the .torrent file was corrupted or incomplete",
}

// describeAria2cExit turns aria2c's process exit error into a human-readable
// string, e.g. "not enough disk space available (exit 9)". Non-exit errors
// (failed to start, killed by signal) fall through to the raw error text.
func describeAria2cExit(err error) string {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		code := ee.ExitCode()
		if msg, ok := aria2cExitMessages[code]; ok {
			return fmt.Sprintf("%s (exit %d)", msg, code)
		}
		return fmt.Sprintf("exit status %d", code)
	}
	return err.Error()
}

// stagingSpaceMargin is headroom kept free on the download staging volume, on
// top of the selected file size, for BitTorrent piece boundaries and metadata.
const stagingSpaceMargin = 512 * 1024 * 1024 // 512 MB

// freeSpaceQuery reduces a directory path to the value FreeSpaceBytes expects:
// the volume root on Windows (e.g. "F:\") so the check works even before the
// directory is created, or the path itself elsewhere.
func freeSpaceQuery(dir string) string {
	if vol := filepath.VolumeName(dir); vol != "" {
		return vol + string(filepath.Separator)
	}
	return dir
}

// aria2cSummaryNoise reports whether a line belongs to aria2c's periodic
// "*** Download Progress Summary ***" block (header, separators, FILE: lines,
// compact progress readouts). These repeat every few seconds and would flood
// the diagnostic tail, burying the actual error line, so we exclude them.
func aria2cSummaryNoise(line string) bool {
	switch {
	case strings.HasPrefix(line, "*** Download Progress Summary"):
		return true
	case strings.HasPrefix(line, "FILE:"):
		return true
	case strings.HasPrefix(line, "[#"): // compact progress readout
		return true
	case line != "" && strings.Trim(line, "=") == "": // separator rule
		return true
	case line != "" && strings.Trim(line, "-") == "": // separator rule
		return true
	}
	return false
}

// DownloadViaTorrent uses aria2c to download a single file from the Minerva collection torrent.
// It fetches the .torrent from Minerva's URL, finds the target file's 1-based index, then
// shells out to aria2c with --select-file so only that file is downloaded.
func (s *Service) DownloadViaTorrent(platform, destDir, gameName string, entry models.MinervaEntry) (string, error) {
	aria2c, err := s.Aria2cBinary()
	if err != nil {
		return "", err
	}

	targetPlatform := platform
	if entry.Platform != "" {
		if _, ok := app.MinervaTorrentURLs[entry.Platform]; ok {
			targetPlatform = entry.Platform
		}
	}

	torrentURL, ok := app.MinervaTorrentURLs[targetPlatform]
	if !ok {
		return "", fmt.Errorf("no torrent URL for platform %q", targetPlatform)
	}

	// Fetch torrent to find the 1-based file index aria2c needs.
	torrentData, err := s.FetchMinervaTorrent(targetPlatform)
	if err != nil {
		return "", fmt.Errorf("fetch torrent: %w", err)
	}
	mi, err := metainfo.Load(bytes.NewReader(torrentData))
	if err != nil {
		return "", fmt.Errorf("parse .torrent: %w", err)
	}
	info, err := mi.UnmarshalInfo()
	if err != nil {
		return "", fmt.Errorf("torrent info: %w", err)
	}

	fileIndex := -1
	var fileSize int64
	for i, f := range info.UpvertedFiles() {
		torrentBase := filepath.Base(filepath.Join(f.Path...))
		if torrentBasenameMatches(torrentBase, entry.FileName) {
			fileIndex = i + 1 // aria2c uses 1-based index
			fileSize = f.Length
			break
		}
	}
	if fileIndex < 0 {
		return "", fmt.Errorf("file %q not found in torrent", entry.FileName)
	}
	cachedFile := filepath.Join(destDir, filepath.Base(entry.FileName))
	if st, statErr := os.Stat(cachedFile); statErr == nil && st.Mode().IsRegular() && st.Size() == fileSize {
		s.App.Logf("TORRENT CACHE [%s]: reutilizando arquivo completo %s", gameName, cachedFile)
		s.App.LogStatus(gameName, "Processing", "Torrent ja concluido. Reutilizando arquivo local...")
		return cachedFile, nil
	}

	s.App.Logf("TORRENT [%s]: aria2c downloading %s (%.0f MB) file-index=%d", gameName, entry.FileName, float64(fileSize)/1048576, fileIndex)
	s.App.LogStatus(gameName, "Processing", fmt.Sprintf("Torrenting (Minerva): starting... (%.0f MB)", float64(fileSize)/1048576))

	// Write torrent to a temp file so aria2c doesn't need to re-fetch it via HTTPS.
	// (aria2c on Windows has SSL issues fetching HTTPS URLs; Go has none.)
	if err := os.MkdirAll(s.App.TorrentTempDir, 0755); err != nil {
		return "", fmt.Errorf("create torrent temp dir: %w", err)
	}

	resumeKey := fmt.Sprintf("%x", sha256.Sum256([]byte(targetPlatform+"\n"+entry.FileName)))[:20]
	aria2cDir := filepath.Join(s.App.TorrentTempDir, "resume-"+resumeKey)
	var resumableBytes uint64
	_ = filepath.Walk(aria2cDir, func(_ string, info os.FileInfo, walkErr error) error {
		if walkErr == nil && info != nil && !info.IsDir() && !strings.HasSuffix(info.Name(), ".aria2") {
			resumableBytes += uint64(info.Size())
		}
		return nil
	})

	// Fail fast when the staging volume can't hold the remaining bytes. Otherwise aria2c
	// downloads for many minutes and dies with the opaque "exit 9" (disk full)
	// on a drive the UI never shows — the destination's free space is unrelated,
	// because the download stages here, not on the destination.
	if free, ferr := helpers.FreeSpaceBytes(freeSpaceQuery(s.App.TorrentTempDir)); ferr == nil {
		if uint64(fileSize)+stagingSpaceMargin > free+resumableBytes {
			return "", fmt.Errorf(
				"espaço insuficiente no disco de download (%s): %q precisa de ~%.1f GB, mas há só %.1f GB livres. Aponte o \"torrent download temp\" (Settings → Temporary directories, ou GODSEND_TORRENT_TEMP) para um disco com espaço",
				freeSpaceQuery(s.App.TorrentTempDir), entry.FileName,
				float64(fileSize)/1073741824, float64(free)/1073741824)
		}
	} else {
		s.App.Logf("TORRENT [%s]: não foi possível medir espaço livre em %s: %v (seguindo)", gameName, s.App.TorrentTempDir, ferr)
	}

	tf, err := os.CreateTemp(s.App.TorrentTempDir, "godsend-*.torrent")
	if err != nil {
		return "", fmt.Errorf("create temp torrent: %w", err)
	}
	torrentFile := tf.Name()
	defer os.Remove(torrentFile)
	if _, err := tf.Write(torrentData); err != nil {
		tf.Close()
		return "", fmt.Errorf("write temp torrent: %w", err)
	}
	tf.Close()

	// aria2c nests output under <torrent-name>/path/… so the full path can exceed
	// Windows MAX_PATH (260 chars) when destDir + torrent subdirs + filename are combined.
	// Stage under TorrentTempDir (configurable; default GODSEND_HOME/Temp/torrent-dl), then
	// move the finished file to destDir afterwards.
	if err := os.MkdirAll(aria2cDir, 0755); err != nil {
		return "", fmt.Errorf("create aria2c temp dir: %w", err)
	}
	if resumableBytes > 0 {
		s.App.Logf("TORRENT RESUME [%s]: %.1f MB preservados em %s", gameName, float64(resumableBytes)/1048576, aria2cDir)
	}

	args := []string{
		"--dir=" + aria2cDir,
		"--select-file=" + strconv.Itoa(fileIndex),
		"--seed-time=0",                    // stop seeding immediately after download
		"--bt-remove-unselected-file=true", // don't keep unselected files
		"--bt-max-peers=100",
		"--follow-torrent=false", // torrent file is our input, don't re-fetch
		"--file-allocation=none", // skip pre-allocation — avoids spurious ENOSPC on large files
		"--continue=true",
		"--auto-file-renaming=false",
		"--allow-overwrite=true",
		"--console-log-level=warn",
		"--summary-interval=3", // print progress every 3 s
		"--human-readable=true",
		torrentFile,
	}
	if s.App.Aria2ListenPort != "" {
		args = append(args, "--listen-port="+s.App.Aria2ListenPort)
		args = append(args, "--dht-listen-port="+s.App.Aria2ListenPort)
	}
	if s.App.Aria2DhtPort != "" {
		args = append(args, "--dht-listen-port="+s.App.Aria2DhtPort)
	}
	_ = torrentURL // URL was used to fetch; aria2c gets the temp file

	cmd := exec.Command(aria2c, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", fmt.Errorf("aria2c pipe: %w", err)
	}
	cmd.Stderr = cmd.Stdout // merge stderr into the same pipe

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("aria2c start: %w", err)
	}

	// aria2c summary lines look like:
	//   [#abc123 195MiB/6504MiB(3%) CN:67 DL:9.9MiB ETA:31m]
	summaryRe := regexp.MustCompile(`\[#\S+\s+([\d.]+\S+)/([\d.]+\S+)\((\d+)%\)[^\]]*DL:([\d.]+\S+)[^\]]*ETA:(\S+)\]`)

	// Drain aria2c output in a goroutine so the pipe never fills and deadlocks cmd.Wait().
	const tailMax = 50
	var (
		tailMu     sync.Mutex
		tailBuf    []string
		abortError error
	)
	appendTail := func(line string) {
		tailMu.Lock()
		defer tailMu.Unlock()
		if len(tailBuf) >= tailMax {
			tailBuf = tailBuf[1:]
		}
		tailBuf = append(tailBuf, line)
	}

	startTime := time.Now()
	var lowSpeedStart time.Time
	doneCh := make(chan struct{})
	go func() {
		defer close(doneCh)
		sc := bufio.NewScanner(stdout)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		sc.Split(func(data []byte, atEOF bool) (advance int, token []byte, err error) {
			for i, b := range data {
				if b == '\n' || b == '\r' {
					adv := i + 1
					if b == '\r' && adv < len(data) && data[adv] == '\n' {
						adv++ // consume \r\n as one unit
					}
					return adv, data[:i], nil
				}
			}
			if atEOF && len(data) > 0 {
				return len(data), data, nil
			}
			return 0, nil, nil
		})
		for sc.Scan() {
			if s.App.IsGameJobCancelled(gameName) {
				tailMu.Lock()
				abortError = app.ErrJobCancelled
				tailMu.Unlock()
				if cmd.Process != nil {
					_ = cmd.Process.Kill()
				}
				return
			}
			line := strings.TrimRight(sc.Text(), " \t")
			if line == "" {
				continue
			}
			if m := summaryRe.FindStringSubmatch(line); m != nil {
				pct, dl, eta := m[3], m[4], m[5]
				msg := fmt.Sprintf("Torrenting (Minerva): %s%% @ %s/s ETA %s", pct, dl, eta)
				s.App.Logf("TORRENT [%s]: %s", gameName, msg)
				s.App.LogStatus(gameName, "Processing", msg)

				now := time.Now()
				speedBps := parseSpeedBytesPerSec(dl)
				var pctVal int
				fmt.Sscanf(pct, "%d", &pctVal)
				threshold := s.App.MinDownloadSpeedThreshold
				if threshold > 0 && !s.App.IsSpeedCheckBypassed(gameName) && now.Sub(startTime) > app.LowSpeedGracePeriod && pctVal < 95 {
					if speedBps < float64(threshold) {
						if lowSpeedStart.IsZero() {
							lowSpeedStart = now
						} else if now.Sub(lowSpeedStart) >= app.LowSpeedSustainedDuration {
							s.App.Logf("WARN [%s]: Minerva torrent speed sustained below threshold (%s/s < %.2f MB/s) — aborting for provider switch",
								gameName, dl, float64(threshold)/1048576)
							tailMu.Lock()
							abortError = app.ErrDownloadTooSlow
							tailMu.Unlock()
							if cmd.Process != nil {
								cmd.Process.Kill()
							}
							return
						}
					} else {
						lowSpeedStart = time.Time{}
					}
				}
				continue
			}
			// Log every line, but keep only genuine warnings/errors in the
			// tail — aria2c's periodic summary block would otherwise bury the
			// real error message that explains the failure.
			if !aria2cSummaryNoise(line) {
				appendTail(line)
			}
			s.App.Logf("TORRENT [%s]: aria2c: %s", gameName, line)
		}
	}()

	waitErr := cmd.Wait()
	<-doneCh // ensure pipe is fully drained before proceeding

	tailMu.Lock()
	aborted := abortError
	tailMu.Unlock()
	if aborted != nil {
		if errors.Is(aborted, app.ErrJobCancelled) {
			_ = os.RemoveAll(aria2cDir)
		}
		return "", aborted
	}

	if waitErr != nil {
		tailMu.Lock()
		tail := strings.Join(tailBuf, " | ")
		tailMu.Unlock()
		if tail == "" {
			tail = "(no output captured)"
		}
		return "", fmt.Errorf("aria2c: %s — last output: %s", describeAria2cExit(waitErr), tail)
	}

	// Walk the short temp dir to find the downloaded file.
	var foundPath string
	_ = filepath.Walk(aria2cDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if strings.EqualFold(filepath.Base(path), entry.FileName) {
			foundPath = path
			return filepath.SkipAll
		}
		return nil
	})
	if foundPath == "" {
		return "", fmt.Errorf("aria2c finished but %q not found under %s", entry.FileName, aria2cDir)
	}

	// Move the file to destDir (caller manages destDir lifetime).
	if err := os.MkdirAll(destDir, 0755); err != nil {
		return "", fmt.Errorf("create dest dir: %w", err)
	}
	destFile := filepath.Join(destDir, filepath.Base(foundPath))
	if err := moveDownloadedFile(foundPath, destFile); err != nil {
		return "", err
	}
	_ = os.RemoveAll(aria2cDir)

	s.App.Logf("TORRENT [%s]: Download complete (%.0f MB)", gameName, float64(fileSize)/1048576)
	return destFile, nil
}

// moveDownloadedFile moves src to dst, using copy+delete when rename fails (e.g. cross-drive on Windows).
func moveDownloadedFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return fmt.Errorf("create dest dir: %w", err)
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	} else if !isCrossDeviceRenameErr(err) {
		return fmt.Errorf("move downloaded file to dest: %w", err)
	}
	if err := helpers.CopyFileBuffered(src, dst); err != nil {
		return fmt.Errorf("move downloaded file to dest: copy: %w", err)
	}
	if err := os.Remove(src); err != nil {
		return fmt.Errorf("move downloaded file to dest: remove source after copy: %w", err)
	}
	return nil
}

func isCrossDeviceRenameErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "different disk") ||
		strings.Contains(msg, "cross-device") ||
		strings.Contains(msg, "cross device") ||
		strings.Contains(msg, "exdev")
}

func parseSpeedBytesPerSec(dlStr string) float64 {
	dlStr = strings.TrimSpace(strings.ToUpper(dlStr))
	var val float64
	var unit string
	_, err := fmt.Sscanf(dlStr, "%f%s", &val, &unit)
	if err != nil {
		return 0
	}
	switch {
	case strings.HasPrefix(unit, "GIB") || strings.HasPrefix(unit, "GB"):
		return val * 1024 * 1024 * 1024
	case strings.HasPrefix(unit, "MIB") || strings.HasPrefix(unit, "MB"):
		return val * 1024 * 1024
	case strings.HasPrefix(unit, "KIB") || strings.HasPrefix(unit, "KB"):
		return val * 1024
	default:
		return val
	}
}
