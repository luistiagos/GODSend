// ia.go — HTTP downloads (single-stream and MDM-style dynamic parallel range).
package download

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"godsend/app"
	"godsend/infrastructure/helpers"
)

// Service provides download functionality.
type Service struct {
	App *app.App
}

const downloadSpaceMargin = 64 * 1024 * 1024

var (
	iaSegmentSize          int64 = app.IASegmentSize
	checkpointInterval           = 15 * time.Second
	checkpointBytes        int64 = 64 * 1024 * 1024
	downloadResumeWait           = 10 * time.Second
	probeTimeout                 = 30 * time.Second
)

type completedDownloadMarker struct {
	URL    string `json:"url"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type downloadProbeInfo struct {
	size        int64
	rangeOK     bool
	resolvedURL string
	validator   string
	ttfb        time.Duration
}

func isIAURL(rawURL string) bool {
	return strings.Contains(strings.ToLower(rawURL), "archive.org")
}

func isEdgeEmuURL(rawURL string) bool {
	return strings.Contains(strings.ToLower(rawURL), "edgeemu.net")
}

func (s *Service) httpClientForURL(rawURL string) *http.Client {
	if isIAURL(rawURL) && s.App.IAHTTPClient != nil {
		return s.App.IAHTTPClient
	}
	if isEdgeEmuURL(rawURL) && s.App.EdgeEmuHTTPClient != nil {
		return s.App.EdgeEmuHTTPClient
	}
	// Support TLS httptest servers in unit tests that configure only App.IAHTTPClient.
	host := normalizedHostKey(rawURL)
	if (host == "127.0.0.1" || host == "localhost" || host == "::1") && s.App.IAHTTPClient != nil {
		return s.App.IAHTTPClient
	}
	if s.App.DownloadHTTPClient != nil {
		return s.App.DownloadHTTPClient
	}
	if s.App.IAHTTPClient != nil {
		return s.App.IAHTTPClient
	}
	return http.DefaultClient
}

func (s *Service) applyDownloadHeaders(req *http.Request, rawURL, ref string) {
	if ref != "" {
		req.Header.Set("Referer", ref)
	}
	req.Header.Set("Accept-Encoding", "identity")
	if isIAURL(rawURL) {
		s.App.ApplyArchiveOrgHeaders(req)
	} else {
		req.Header.Set("User-Agent", "Mozilla/5.0")
	}
}

func completedMarkerPath(dest string) string {
	return dest + app.DownloadCompleteSuffix
}

func reusableCompletedDownload(dest, urlStr string) bool {
	data, err := os.ReadFile(completedMarkerPath(dest))
	if err != nil {
		return false
	}
	var marker completedDownloadMarker
	if json.Unmarshal(data, &marker) != nil || marker.URL != urlStr || marker.Size <= 0 {
		return false
	}
	st, err := os.Stat(dest)
	if err != nil || !st.Mode().IsRegular() || st.Size() != marker.Size {
		return false
	}
	hash, err := sha256File(dest)
	return err == nil && hash == marker.SHA256
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

func sha256FileRange(file *os.File, start, size int64) (string, error) {
	h := sha256.New()
	if _, err := io.Copy(h, io.NewSectionReader(file, start, size)); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

func markDownloadCompleted(dest, urlStr string) error {
	st, err := os.Stat(dest)
	if err != nil {
		return err
	}
	hash, err := sha256File(dest)
	if err != nil {
		return err
	}
	data, err := json.Marshal(completedDownloadMarker{URL: urlStr, Size: st.Size(), SHA256: hash})
	if err != nil {
		return err
	}
	marker := completedMarkerPath(dest)
	tmp := marker + ".new"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return err
	}
	if _, err := f.Write(append(data, '\n')); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	_ = os.Remove(marker)
	if err := os.Rename(tmp, marker); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// InvalidateCompletedDownload removes every local artifact that could make a
// later DownloadWithProgress reuse a source archive that failed validation in a
// downstream processing step.
func (s *Service) InvalidateCompletedDownload(dest, name, reason string) {
	_ = os.Remove(completedMarkerPath(dest))
	removeDownloadResume(dest)
	if err := os.Remove(dest); err != nil && !os.IsNotExist(err) {
		s.App.Logf("WARN [%s]: nao foi possivel remover download invalido %s: %v", name, dest, err)
		return
	}
	s.App.Logf("DOWNLOAD CACHE [%s]: arquivo local invalidado (%s): %s", name, reason, dest)
}

func ensureDownloadSpace(dest string, totalSize int64) error {
	if totalSize <= 0 {
		return nil
	}
	query := filepath.Dir(dest)
	if volume := filepath.VolumeName(dest); volume != "" {
		query = volume + string(filepath.Separator)
	}
	free, err := helpers.FreeSpaceBytes(query)
	if err != nil {
		return nil
	}
	if current, statErr := os.Stat(dest); statErr == nil {
		free += uint64(current.Size())
	}
	need := uint64(totalSize) + downloadSpaceMargin
	if need > free {
		return fmt.Errorf("espaco insuficiente no armazenamento temporario %s: o arquivo precisa de %.1f GB, mas ha apenas %.1f GB livres apos a margem de seguranca",
			query, float64(totalSize)/1073741824, float64(free)/1073741824)
	}
	return nil
}

// iaHTTPError turns an HTTP status into an actionable message.
// 401/403 on archive.org almost always mean the item is restricted to logged-in accounts.
func iaHTTPError(status int, urlStr string) error {
	if (status == 401 || status == 403) && isIAURL(urlStr) {
		return fmt.Errorf("HTTP %d — este item do Internet Archive exige conta logada. Em Configurações → Conta do Internet Archive, entre com seu login do archive.org e tente novamente", status)
	}
	return fmt.Errorf("HTTP %d from %s", status, urlStr)
}

func parseRetryAfter(value string, now time.Time) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if secs, err := strconv.Atoi(value); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	if t, err := http.ParseTime(value); err == nil {
		if d := t.Sub(now); d > 0 {
			return d
		}
	}
	return 0
}

// downloadMaxAttemptsWithoutProgress bounds the resumes that add no durable byte.
const downloadMaxAttemptsWithoutProgress = 3

// DownloadWithProgress downloads urlStr to dest. When the server supports HTTP
// byte ranges and the file exceeds IAParallelThreshold, it uses an MDM-style
// dynamic parallel range engine (dedicated HTTP/1.1 connections, dynamic
// work-stealing splits, slow-connection cutting, adaptive checkpoints, and
// sparse/bounded-window disk allocation).
//
// A transient interruption (stall, stream reset, dropped connection) resumes
// the partial file in place for as long as each attempt adds durable bytes.
func (s *Service) DownloadWithProgress(urlStr, dest, name, ref string) error {
	return s.resumeWhileProgressing(dest, urlStr, name, func() error {
		return s.downloadWithProgressOnce(urlStr, dest, name, ref)
	})
}

// resumeWhileProgressing runs attempt again after a resumable interruption,
// keeping the partial file, until it succeeds, fails for another reason, or
// downloadMaxAttemptsWithoutProgress attempts in a row add no durable byte.
func (s *Service) resumeWhileProgressing(dest, urlStr, name string, attempt func() error) error {
	withoutProgress := 0
	for resume := 1; ; resume++ {
		before := durableDownloadBytes(dest, urlStr)
		err := attempt()
		if !isResumableDownloadInterruption(err) || s.App.IsGameJobCancelled(name) {
			return err
		}
		after := durableDownloadBytes(dest, urlStr)
		if after > before {
			withoutProgress = 0
		} else {
			withoutProgress++
		}
		if withoutProgress >= downloadMaxAttemptsWithoutProgress {
			s.App.Logf("WARN [%s]: download interrompido %d vezes seguidas sem progresso — desistindo: %v", name, withoutProgress, err)
			return err
		}
		s.App.Logf("DOWNLOAD RESUME [%s]: interrompido (%v) com %.1f MB duraveis — retomando no lugar (retomada %d) em %s",
			name, err, float64(after)/1048576, resume, downloadResumeWait)
		s.App.LogStatus(name, "Processing", fmt.Sprintf("Conexao interrompida; retomando o download de %.0f MB...", float64(after)/1048576))
		for waited := time.Duration(0); waited < downloadResumeWait; waited += 250 * time.Millisecond {
			if s.App.IsGameJobCancelled(name) {
				return app.ErrJobCancelled
			}
			time.Sleep(250 * time.Millisecond)
		}
	}
}

// isResumableDownloadInterruption reports a network interruption that a new
// attempt resumes from the partial file. Too slow, cancellation and every
// deterministic answer (4xx, size, local storage) stay out: those must reach the
// fallback chain unchanged.
func isResumableDownloadInterruption(err error) bool {
	if err == nil || errors.Is(err, app.ErrDownloadTooSlow) || errors.Is(err, app.ErrJobCancelled) {
		return false
	}
	if errors.Is(err, app.ErrDownloadStalled) {
		return true
	}
	msg := strings.ToLower(err.Error())
	for _, marker := range []string{
		"stream error", "read after", "interrupted after", "request failed", "request:",
		"connection reset", "forcibly closed", "unexpected eof", "http 5", "http 429",
	} {
		if strings.Contains(msg, marker) {
			return true
		}
	}
	return false
}

// durableDownloadBytes is how much of dest is already safe to resume from: the
// file size of a single-stream download, the confirmed segments of a legacy
// chunked download, or the written bytes across ranges of a dynamic download.
func durableDownloadBytes(dest, urlStr string) int64 {
	data, err := os.ReadFile(resumeMarkerPath(dest))
	if err != nil {
		return 0
	}
	var marker downloadResumeMarker
	if json.Unmarshal(data, &marker) != nil || marker.URL != urlStr {
		return 0
	}
	switch marker.Mode {
	case "single":
		if st, err := os.Stat(dest); err == nil {
			return st.Size()
		}
	case "chunked":
		var total int64
		for index, done := range marker.Completed {
			if !done {
				continue
			}
			size := marker.SegmentSize
			if start := int64(index) * marker.SegmentSize; start+size > marker.TotalSize {
				size = marker.TotalSize - start
			}
			total += size
		}
		return total
	case "dynamic":
		var total int64
		for _, r := range marker.Ranges {
			if r.Cursor > r.Start && r.Cursor <= r.End {
				total += r.Cursor - r.Start
			}
		}
		return total
	}
	return 0
}

func (s *Service) downloadWithProgressOnce(urlStr, dest, name, ref string) error {
	// Tell the durable queue which partial file this job owns, so a restart
	// keeps it out of the scratch cleanup and resumes instead of restarting.
	s.App.SetQueueJobDownload(name, urlStr, dest)
	if reusableCompletedDownload(dest, urlStr) {
		removeDownloadResume(dest)
		s.App.Logf("DOWNLOAD CACHE [%s]: reutilizando arquivo completo %s", name, dest)
		s.App.LogStatus(name, "Processing", "Download ja concluido. Reutilizando arquivo local...")
		return nil
	}
	// A process can stop after the last byte is durable but before publishing
	// the completion marker, whose full-file hash takes minutes on a
	// multi-gigabyte file. Promote that full single-stream, chunked, or dynamic
	// file instead of truncating it and issuing the whole download again.
	if finishedResume(dest, urlStr) {
		s.App.Logf("DOWNLOAD RESUME [%s]: promovendo arquivo integral sincronizado", name)
		err := s.finalizeDownload(dest, urlStr, name)
		if err == nil {
			s.App.LogStatus(name, "Processing", "Download ja concluido. Verificando e retomando do arquivo local...")
			return nil
		}
		s.App.Logf("WARN [%s]: promocao do arquivo integral falhou (%v), seguindo para o download", name, err)
	}
	_ = os.Remove(completedMarkerPath(dest))

	var downloadErr error
	if s.App.IADownloadMaxParallel > 1 {
		probe, err := s.probeDownload(urlStr, ref)
		if err != nil {
			s.App.Logf("WARN [%s]: probe failed (%v), using single stream", name, err)
		} else if probe.rangeOK && probe.size >= app.IAParallelThreshold {
			baseWorkers := defaultHostCeiling(urlStr, s.App.IADownloadMaxParallel)
			workers := globalHostLimits.effectiveLimit(probe.resolvedURL, baseWorkers, time.Now())
			if workers > 1 {
				nodeHost := normalizedHostKey(probe.resolvedURL)
				if nodeHost == "" {
					nodeHost = normalizedHostKey(urlStr)
				}
				s.App.Logf("[%s] Dynamic parallel HTTP: %.0f MB, up to %d HTTP/1.1 connections (host=%s, probe TTFB=%s)",
					name, float64(probe.size)/1048576, workers, nodeHost, probe.ttfb.Round(time.Millisecond))
				downloadErr = s.downloadDynamicParallel(urlStr, probe, dest, name, ref, workers)
				if downloadErr == nil {
					if err := s.finalizeDownload(dest, urlStr, name); err != nil {
						return fmt.Errorf("persistir conclusao do download: %w", err)
					}
				}
				return downloadErr
			}
		}
	}
	downloadErr = s.IADownloadSingle(urlStr, dest, name, ref)
	if downloadErr != nil {
		return downloadErr
	}
	if err := s.finalizeDownload(dest, urlStr, name); err != nil {
		return fmt.Errorf("persistir conclusao do download: %w", err)
	}
	return nil
}

// finalizeDownload publishes the completion marker of a full download and only
// then drops its resume map.
func (s *Service) finalizeDownload(dest, urlStr, name string) error {
	var size int64
	if st, err := os.Stat(dest); err == nil {
		size = st.Size()
	}
	s.App.LogStatus(name, "Processing", "Conferindo o arquivo baixado...")
	s.App.Logf("DOWNLOAD VERIFY [%s]: conferindo %.1f MB antes de liberar", name, float64(size)/1048576)
	started := time.Now()
	if err := markDownloadCompleted(dest, urlStr); err != nil {
		return err
	}
	removeDownloadResume(dest)
	s.App.Logf("DOWNLOAD VERIFY [%s]: concluido em %s", name, time.Since(started).Round(time.Millisecond))
	return nil
}

// IAProbeDownload sends a GET request with Range: bytes=0-0 and returns (Content-Length, Accept-Ranges, error).
// Using GET Range: bytes=0-0 is significantly more reliable than HEAD on Internet Archive edge servers and CDNs.
func (s *Service) IAProbeDownload(urlStr, ref string) (size int64, rangeOK bool, err error) {
	info, err := s.probeDownload(urlStr, ref)
	if err != nil {
		return 0, false, err
	}
	return info.size, info.rangeOK, nil
}

func (s *Service) probeDownload(urlStr, ref string) (downloadProbeInfo, error) {
	client := s.httpClientForURL(urlStr)
	for attempt := 0; attempt < 2; attempt++ {
		started := time.Now()
		ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
		req, err := http.NewRequestWithContext(ctx, "GET", urlStr, nil)
		if err != nil {
			cancel()
			return downloadProbeInfo{}, err
		}
		req.Header.Set("Range", "bytes=0-0")
		s.applyDownloadHeaders(req, urlStr, ref)

		resp, err := client.Do(req)
		if err != nil {
			cancel()
			return downloadProbeInfo{}, err
		}
		ttfb := time.Since(started)
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		cancel()

		if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && isIAURL(urlStr) && attempt == 0 {
			if refreshErr := s.App.RefreshIAAuthSession(); refreshErr == nil {
				continue
			}
		}

		resolved := urlStr
		if resp.Request != nil && resp.Request.URL != nil && resp.Request.URL.String() != "" {
			resolved = resp.Request.URL.String()
		}
		// Prefer Last-Modified as cross-node validator (MDM rule #8: per-node ETags
		// on CDNs like archive.org can vary between edge nodes for the same file).
		validator := resp.Header.Get("Last-Modified")
		if validator == "" {
			validator = resp.Header.Get("ETag")
		}

		if resp.StatusCode == http.StatusPartialContent {
			start, end, total, parseErr := parseHTTPContentRange(resp.Header.Get("Content-Range"))
			if parseErr == nil && start == 0 && end == 0 {
				return downloadProbeInfo{
					size:        total,
					rangeOK:     true,
					resolvedURL: resolved,
					validator:   validator,
					ttfb:        ttfb,
				}, nil
			}
			if resp.ContentLength > 0 {
				return downloadProbeInfo{
					size:        resp.ContentLength,
					rangeOK:     true,
					resolvedURL: resolved,
					validator:   validator,
					ttfb:        ttfb,
				}, nil
			}
		} else if resp.StatusCode == http.StatusOK {
			return downloadProbeInfo{
				size:        resp.ContentLength,
				rangeOK:     false,
				resolvedURL: resolved,
				validator:   validator,
				ttfb:        ttfb,
			}, nil
		}

		return downloadProbeInfo{}, fmt.Errorf("probe HTTP %d", resp.StatusCode)
	}
	return downloadProbeInfo{}, fmt.Errorf("probe failed")
}

func parseHTTPContentRange(value string) (start, end, total int64, err error) {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(strings.ToLower(value), "bytes ") {
		return 0, 0, 0, fmt.Errorf("Content-Range invalido: %q", value)
	}
	parts := strings.Split(strings.TrimSpace(value[len("bytes "):]), "/")
	if len(parts) != 2 || parts[1] == "*" {
		return 0, 0, 0, fmt.Errorf("Content-Range invalido: %q", value)
	}
	limits := strings.Split(parts[0], "-")
	if len(limits) != 2 {
		return 0, 0, 0, fmt.Errorf("Content-Range invalido: %q", value)
	}
	start, err = strconv.ParseInt(strings.TrimSpace(limits[0]), 10, 64)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("Content-Range invalido: %q", value)
	}
	end, err = strconv.ParseInt(strings.TrimSpace(limits[1]), 10, 64)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("Content-Range invalido: %q", value)
	}
	total, err = strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil || start < 0 || end < start || total <= end {
		return 0, 0, 0, fmt.Errorf("Content-Range invalido: %q", value)
	}
	return start, end, total, nil
}

// IADownloadChunkedParallel downloads urlStr into dest using the MDM-style
// dynamic parallel range engine (with full backward compatibility for resuming
// legacy v1 chunked segment markers and custom test segment sizes).
func (s *Service) IADownloadChunkedParallel(urlStr, dest, name, ref string, totalSize int64) error {
	workers := s.App.IADownloadMaxParallel
	if workers < 1 {
		workers = 1
	}
	probe := downloadProbeInfo{
		size:        totalSize,
		rangeOK:     true,
		resolvedURL: urlStr,
	}
	return s.downloadDynamicParallel(urlStr, probe, dest, name, ref, workers)
}

func (s *Service) downloadDynamicParallel(urlStr string, probe downloadProbeInfo, dest, name, ref string, workers int) error {
	totalSize := probe.size
	if err := ensureDownloadSpace(dest, totalSize); err != nil {
		return err
	}
	if workers < 1 {
		workers = 1
	}

	resumedRanges, resumedValidator, resumed := loadDynamicResume(dest, urlStr, totalSize)
	if resumed && probe.validator != "" && resumedValidator != "" && probe.validator != resumedValidator {
		s.App.Logf("DOWNLOAD RESUME [%s]: arquivo remoto alterado (%q -> %q); reiniciando do zero", name, resumedValidator, probe.validator)
		resumed = false
		resumedRanges = nil
	}

	var out *os.File
	var err error
	var isSparse, boundedWindow bool
	if resumed {
		out, err = os.OpenFile(dest, os.O_RDWR, 0644)
		if err != nil {
			return fmt.Errorf("open dest: %w", err)
		}
		isSparse, boundedWindow = prepareSparseDestFile(out)
		if isSparse {
			if st, statErr := out.Stat(); statErr == nil && st.Size() < totalSize {
				if truncErr := out.Truncate(totalSize); truncErr != nil {
					out.Close()
					return fmt.Errorf("truncate: %w", truncErr)
				}
			}
		}
	} else {
		if mkErr := os.MkdirAll(filepath.Dir(dest), 0755); mkErr != nil {
			return fmt.Errorf("mkdir dest: %w", mkErr)
		}
		out, err = os.OpenFile(dest, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0644)
		if err != nil {
			return fmt.Errorf("create dest: %w", err)
		}
		isSparse, boundedWindow = prepareSparseDestFile(out)
		// Only pre-size when sparse holes are supported (NTFS / Linux / macOS /
		// Android). On exFAT, Truncate + far-ahead WriteAt triggers synchronous
		// zero-fill, so we grow the file inside a bounded window instead.
		if isSparse {
			if truncErr := out.Truncate(totalSize); truncErr != nil {
				out.Close()
				return fmt.Errorf("truncate: %w", truncErr)
			}
		}
	}

	// Build planner config. When a test shrinks iaSegmentSize below the default
	// 4 MiB, honor its exact segment boundaries; otherwise use full MDM dynamic
	// splitting (or bounded-window splitting on exFAT).
	cfg := plannerConfig{
		totalSize:        totalSize,
		workers:          workers,
		minSplit:         app.IASegmentSize,
		splitAlign:       defaultSplitAlignBytes,
		boundedWindow:    boundedWindow,
		boundedChunkSize: defaultBoundedChunk,
	}
	if iaSegmentSize > 0 && iaSegmentSize != app.IASegmentSize {
		cfg.fixedChunkSize = iaSegmentSize
		cfg.minSplit = 0
		cfg.boundedWindow = false
	} else if totalSize < 2*cfg.minSplit {
		minDynamic := totalSize / int64(workers*2)
		if minDynamic < 1 {
			minDynamic = 1
		}
		cfg.minSplit = minDynamic
		cfg.splitAlign = 0
	}
	if app.DownloadStallTimeout >= 2*time.Second {
		stealAfter := 5 * time.Second
		if probe.ttfb > 0 && 2*probe.ttfb > stealAfter {
			stealAfter = 2 * probe.ttfb
		}
		if stealAfter > 15*time.Second {
			stealAfter = 15 * time.Second
		}
		cfg.stealPendingAfter = stealAfter
	}

	planner := newSegmentPlanner(cfg, resumedRanges)
	initialWritten := planner.initialWritten()
	if initialWritten > 0 {
		s.App.Logf("DOWNLOAD RESUME [%s]: %.1f MB ja confirmados", name, float64(initialWritten)/1048576)
	}

	validator := probe.validator
	if validator == "" {
		validator = resumedValidator
	}

	// Persist initial dynamic map immediately so a restart knows this file owns
	// a valid dynamic resume layout.
	if err := writeResumeMarker(dest, &downloadResumeMarker{
		Mode:      "dynamic",
		URL:       urlStr,
		Validator: validator,
		TotalSize: totalSize,
		Ranges:    planner.snapshotRanges(),
	}); err != nil {
		out.Close()
		return fmt.Errorf("persistir mapa de segmentos: %w", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var written int64 = initialWritten
	var lastChunkActivity int64
	atomic.StoreInt64(&lastChunkActivity, time.Now().UnixNano())
	var receiving atomic.Int32
	var authRefreshed atomic.Bool

	var activeURLMu sync.RWMutex
	activeURL := probe.resolvedURL
	if activeURL == "" {
		activeURL = urlStr
	}
	getActiveURL := func() string {
		activeURLMu.RLock()
		u := activeURL
		activeURLMu.RUnlock()
		return u
	}
	resetActiveURL := func() {
		activeURLMu.Lock()
		activeURL = urlStr
		activeURLMu.Unlock()
	}

	// Adaptive unlocked checkpointing (MDM rule #7): never holds planner.mu
	// during out.Sync() or JSON writes, so network reads and WriteAt keep running.
	var checkpointMu sync.Mutex
	lastCheckpointTime := time.Now()
	lastCheckpointWritten := initialWritten
	flushCheckpoint := func(force bool) error {
		checkpointMu.Lock()
		defer checkpointMu.Unlock()
		curWritten := atomic.LoadInt64(&written)
		if !force && curWritten-lastCheckpointWritten < checkpointBytes && time.Since(lastCheckpointTime) < checkpointInterval {
			return nil
		}
		if !force && curWritten == lastCheckpointWritten {
			return nil
		}
		ranges := planner.snapshotRanges()
		if syncErr := out.Sync(); syncErr != nil {
			return syncErr
		}
		if writeErr := writeResumeMarker(dest, &downloadResumeMarker{
			Mode:      "dynamic",
			URL:       urlStr,
			Validator: validator,
			TotalSize: totalSize,
			Ranges:    ranges,
		}); writeErr != nil {
			return writeErr
		}
		lastCheckpointWritten = curWritten
		lastCheckpointTime = time.Now()
		return nil
	}

	var firstErr error
	var errMu sync.Mutex
	setFatalErr := func(e error) {
		if e == nil {
			return
		}
		errMu.Lock()
		if firstErr == nil {
			firstErr = e
			cancel()
		}
		errMu.Unlock()
	}

	var lowSpeedErr error
	var lowSpeedErrMu sync.Mutex
	startTime := time.Now()
	slowTracker := newSlowConnectionTracker(startTime, initialWritten)

	progressDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		lastConsole := time.Time{}
		var lowSpeedStart time.Time
		var firstDataTime time.Time
		for {
			select {
			case <-progressDone:
				return
			case now := <-ticker.C:
				if s.App.IsGameJobCancelled(name) {
					lowSpeedErrMu.Lock()
					lowSpeedErr = app.ErrJobCancelled
					lowSpeedErrMu.Unlock()
					cancel()
					return
				}
				w := atomic.LoadInt64(&written)
				pct := float64(w) / float64(totalSize) * 100
				elapsed := now.Sub(startTime).Seconds()
				if elapsed < 0.001 {
					elapsed = 0.001
				}
				sessionWritten := w - initialWritten
				if sessionWritten > 0 && firstDataTime.IsZero() {
					firstDataTime = now
				}
				speedMBs := float64(sessionWritten) / elapsed / 1048576
				wMB := float64(w) / 1048576
				tMB := float64(totalSize) / 1048576
				etaStr := "..."
				if speedMBs > 0 && pct < 100 {
					etaSecs := float64(totalSize-w) / (speedMBs * 1048576)
					etaStr = "~" + app.FmtDuration(etaSecs) + " left"
				}
				s.App.LogStatus(name, "Processing",
					fmt.Sprintf("Downloading: %.0f%% (%.0f/%.0f MB) @ %.1f MB/s | %s",
						pct, wMB, tMB, speedMBs, etaStr))
				if now.Sub(lastConsole) > 15*time.Second {
					s.App.Logf("Download [%s]: %.1f%% (%.1f/%.1f MB) @ %.1f MB/s (dynamic HTTP, %d active)",
						name, pct, wMB, tMB, speedMBs, receiving.Load())
					lastConsole = now
				}

				// Global stall monitoring: no byte received by any worker within DownloadStallTimeout.
				lastProgNano := atomic.LoadInt64(&lastChunkActivity)
				if lastProgNano > 0 {
					lastProg := time.Unix(0, lastProgNano)
					if now.Sub(lastProg) > app.DownloadStallTimeout {
						s.App.Logf("WARN [%s]: Download estagnado (nenhum dado recebido por %s) — abortando",
							name, app.DownloadStallTimeout)
						lowSpeedErrMu.Lock()
						lowSpeedErr = app.ErrDownloadStalled
						lowSpeedErrMu.Unlock()
						cancel()
						return
					}
				}

				// Speed monitoring: check if aggregate download speed is sustained below threshold.
				threshold := s.App.MinDownloadSpeedThreshold
				if threshold > 0 && !s.App.IsSpeedCheckBypassed(name) && !firstDataTime.IsZero() && now.Sub(firstDataTime) > app.LowSpeedGracePeriod && pct < 95 {
					activeElapsed := now.Sub(firstDataTime).Seconds()
					if activeElapsed >= 1.0 {
						currentSpeedBytesPerSec := float64(sessionWritten) / activeElapsed
						if currentSpeedBytesPerSec < float64(threshold) {
							if lowSpeedStart.IsZero() {
								lowSpeedStart = now
							} else if now.Sub(lowSpeedStart) >= app.LowSpeedSustainedDuration {
								s.App.Logf("WARN [%s]: Download speed sustained below threshold (%.2f MB/s < %.2f MB/s) — aborting for provider switch",
									name, currentSpeedBytesPerSec/1048576, float64(threshold)/1048576)
								lowSpeedErrMu.Lock()
								lowSpeedErr = app.ErrDownloadTooSlow
								lowSpeedErrMu.Unlock()
								cancel()
								return
							}
						} else {
							lowSpeedStart = time.Time{}
						}
					}
				}
			}
		}
	}()

	checkpointDone := make(chan struct{})
	go func() {
		defer close(checkpointDone)
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-progressDone:
				return
			case <-ticker.C:
				if cpErr := flushCheckpoint(false); cpErr != nil {
					setFatalErr(fmt.Errorf("checkpoint do download: %w", cpErr))
					return
				}
			}
		}
	}()

	// Per-worker read stall timeout: recovers an individually wedged TCP socket
	// without waiting for the global 45s stall timeout. Only active when the
	// global stall timeout is at least 10s (so short unit tests see deterministic
	// global ErrDownloadStalled).
	var workerReadStall time.Duration
	if app.DownloadStallTimeout >= 10*time.Second {
		workerReadStall = app.DownloadStallTimeout / 2
		if workerReadStall > 20*time.Second {
			workerReadStall = 20 * time.Second
		}
	}

	client := s.httpClientForURL(urlStr)
	isIA := isIAURL(urlStr)

	var wg sync.WaitGroup
	for workerID := 0; workerID < workers; workerID++ {
		wg.Add(1)
		go func(wid int) {
			defer wg.Done()
			buf := make([]byte, 256*1024)
			for {
				if ctx.Err() != nil {
					return
				}
				// Respect learned per-host connection caps (MDM rule #5).
				if wid > 0 {
					capNow := globalHostLimits.effectiveLimit(getActiveURL(), workers, time.Now())
					if wid >= capNow {
						if planner.isComplete() {
							return
						}
						select {
						case <-ctx.Done():
							return
						case <-time.After(500 * time.Millisecond):
							continue
						}
					}
				}

				seg, more := planner.assign(wid, time.Now())
				if !more {
					return
				}
				if seg == nil {
					select {
					case <-ctx.Done():
						return
					case <-planner.waitCh():
					case <-time.After(250 * time.Millisecond):
					}
					continue
				}

				fetchErr, waitAfter, fatal := s.fetchDynamicSegment(
					ctx, client, wid, seg, planner, slowTracker,
					urlStr, getActiveURL, resetActiveURL, ref, isIA, totalSize,
					out, buf, workers, workerReadStall,
					&written, &lastChunkActivity, &receiving, &authRefreshed, name,
				)
				if fatal != nil {
					setFatalErr(fatal)
					return
				}
				if fetchErr != nil && ctx.Err() == nil {
					if waitAfter > 0 {
						select {
						case <-ctx.Done():
							return
						case <-time.After(waitAfter):
						}
					}
				}
			}
		}(workerID)
	}

	wg.Wait()
	close(progressDone)
	<-checkpointDone

	lowSpeedErrMu.Lock()
	if lowSpeedErr != nil {
		firstErr = lowSpeedErr
	}
	lowSpeedErrMu.Unlock()

	if firstErr == nil && !planner.isComplete() {
		firstErr = fmt.Errorf("download paralelo encerrou antes de concluir todos os segmentos")
	}

	if firstErr != nil {
		if errors.Is(firstErr, app.ErrJobCancelled) {
			out.Close()
			_ = os.Remove(dest)
			removeDownloadResume(dest)
			return firstErr
		}
		// Flush every byte written so far so resumeWhileProgressing can resume
		// from the exact cursors without losing progress.
		_ = flushCheckpoint(true)
		out.Close()
		return firstErr
	}

	if isSparse {
		clearSparseDestFile(out)
	}
	if cpErr := flushCheckpoint(true); cpErr != nil {
		out.Close()
		return fmt.Errorf("checkpoint final do download: %w", cpErr)
	}
	if st, statErr := out.Stat(); statErr == nil && st.Size() != totalSize {
		out.Close()
		return fmt.Errorf("download paralelo com tamanho final divergente: esperado %d, obtido %d bytes", totalSize, st.Size())
	}
	if closeErr := out.Close(); closeErr != nil {
		return fmt.Errorf("close dest: %w", closeErr)
	}

	elapsed := time.Since(startTime)
	if elapsed < time.Millisecond {
		elapsed = time.Millisecond
	}
	stats := planner.stats()
	sessionMB := float64(atomic.LoadInt64(&written)-initialWritten) / 1048576
	speedMiBs := sessionMB / elapsed.Seconds()
	nodeHost := normalizedHostKey(getActiveURL())
	if nodeHost == "" {
		nodeHost = normalizedHostKey(urlStr)
	}
	s.App.Logf("[%s] Dynamic HTTP done: %.1f MB in %s (%.1f MiB/s) | host=%s workers=%d splits=%d steals=%d retries=%d slow_cuts=%d",
		name, sessionMB, elapsed.Round(time.Millisecond), speedMiBs, nodeHost, workers,
		stats.splits, stats.steals, stats.retries, slowTracker.totalCuts())
	return nil
}

// fetchDynamicSegment executes one HTTP range attempt for seg, writing directly
// at seg.cursor via out.WriteAt.
// Returns (retryableErr, waitDuration, fatalErr).
func (s *Service) fetchDynamicSegment(
	ctx context.Context,
	client *http.Client,
	workerID int,
	seg *segment,
	planner *segmentPlanner,
	slowTracker *slowConnectionTracker,
	originalURL string,
	getActiveURL func() string,
	resetActiveURL func(),
	ref string,
	isIA bool,
	totalSize int64,
	out *os.File,
	buf []byte,
	workers int,
	workerReadStall time.Duration,
	writtenAtomic *int64,
	lastActivity *int64,
	receiving *atomic.Int32,
	authRefreshed *atomic.Bool,
	name string,
) (retryErr error, waitAfter time.Duration, fatalErr error) {
	// Guarantee segment ownership is always released when this attempt exits.
	defer planner.release(seg, workerID, false)

	start, end, ok := planner.segmentBounds(seg, workerID)
	if !ok {
		return nil, 0, nil
	}

	reqCtx, reqCancel := context.WithCancel(ctx)
	defer reqCancel()
	if !planner.setRequestCancel(seg, workerID, reqCancel) {
		return nil, 0, nil
	}

	targetURL := getActiveURL()
	req, err := http.NewRequestWithContext(reqCtx, "GET", targetURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end-1))
	s.applyDownloadHeaders(req, originalURL, ref)

	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil || reqCtx.Err() != nil {
			return nil, 0, nil
		}
		if strings.Contains(strings.ToLower(err.Error()), "connection refused") {
			if capVal, learned := globalHostLimits.recordRefusal(targetURL, int(receiving.Load()), time.Now()); learned {
				s.App.Logf("[%s] Host limit learned for %s: capping to %d connections", name, normalizedHostKey(targetURL), capVal)
			}
		}
		failures, _, pending := planner.release(seg, workerID, true)
		if !pending {
			return nil, 0, nil
		}
		wrapped := fmt.Errorf("request: %w", err)
		if failures > app.IAChunkRetries {
			return nil, 0, wrapped
		}
		wait := retryBackoff(failures, 0)
		s.App.Logf("RETRY range bytes=%d-%d (attempt %d/%d): %v — waiting %s", start, end-1, failures, app.IAChunkRetries, wrapped, wait)
		return wrapped, wait, nil
	}

	if resp.StatusCode != http.StatusPartialContent {
		status := resp.StatusCode
		retryAfter := parseRetryAfter(resp.Header.Get("Retry-After"), time.Now())
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()

		// Deterministic 4xx handling: don't waste 90 s retrying permanent rejections.
		if status == http.StatusUnauthorized || status == http.StatusForbidden {
			if isIA && authRefreshed.CompareAndSwap(false, true) {
				if refreshErr := s.App.RefreshIAAuthSession(); refreshErr == nil {
					resetActiveURL()
					planner.release(seg, workerID, false)
					return fmt.Errorf("HTTP %d after session refresh", status), 500 * time.Millisecond, nil
				}
			}
			if targetURL != originalURL {
				// Resolved/signed CDN URL may have expired (MDM rule #9): re-resolve via original URL once.
				resetActiveURL()
				failures, _, pending := planner.release(seg, workerID, true)
				if pending && failures <= 2 {
					return fmt.Errorf("HTTP %d on resolved node; refreshing URL", status), 500 * time.Millisecond, nil
				}
			}
			return nil, 0, iaHTTPError(status, originalURL)
		}
		if status == http.StatusNotFound || status == http.StatusGone {
			if targetURL != originalURL {
				resetActiveURL()
				failures, _, pending := planner.release(seg, workerID, true)
				if pending && failures <= 1 {
					return fmt.Errorf("HTTP %d on resolved node; falling back to original URL", status), 0, nil
				}
			}
			return nil, 0, iaHTTPError(status, originalURL)
		}

		// Rate limit / overload (429 / 503): learn host connection cap + honor Retry-After.
		if status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable {
			if capVal, learned := globalHostLimits.recordRefusal(targetURL, int(receiving.Load()), time.Now()); learned {
				s.App.Logf("[%s] Host limit learned for %s (HTTP %d): capping to %d connections", name, normalizedHostKey(targetURL), status, capVal)
			}
		}

		failures, _, pending := planner.release(seg, workerID, true)
		if !pending {
			return nil, 0, nil
		}
		wrapped := fmt.Errorf("HTTP %d (expected 206 Partial Content)", status)
		if failures > app.IAChunkRetries {
			return nil, 0, wrapped
		}
		wait := retryBackoff(failures, retryAfter)
		s.App.Logf("RETRY range bytes=%d-%d (attempt %d/%d): %v — waiting %s", start, end-1, failures, app.IAChunkRetries, wrapped, wait)
		return wrapped, wait, nil
	}

	respStart, respEnd, respTotal, rangeErr := parseHTTPContentRange(resp.Header.Get("Content-Range"))
	if rangeErr != nil || respStart != start || respEnd != end-1 || respTotal != totalSize {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		failures, _, pending := planner.release(seg, workerID, true)
		wrapped := fmt.Errorf("resposta de faixa divergente: pedido %d-%d/%d, recebido %q", start, end-1, totalSize, resp.Header.Get("Content-Range"))
		if !pending || failures > app.IAChunkRetries {
			return nil, 0, wrapped
		}
		return wrapped, retryBackoff(failures, 0), nil
	}

	// Stream body directly into out via WriteAt.
	receiving.Add(1)
	defer receiving.Add(-1)

	var stallTimer *time.Timer
	var workerStalled atomic.Bool
	if workerReadStall > 0 {
		stallTimer = time.AfterFunc(workerReadStall, func() {
			workerStalled.Store(true)
			reqCancel()
		})
		defer stallTimer.Stop()
	}

	var (
		responseBytes int64
		firstByteAt   time.Time
		windowStart   time.Time
		windowBytes   int64
		abandoned     bool
		slowCut       bool
		readErr       error
	)

	for {
		n, rErr := resp.Body.Read(buf)
		if n > 0 {
			if stallTimer != nil {
				stallTimer.Reset(workerReadStall)
			}
			now := time.Now()
			off, keep, okWrite := planner.beginWrite(seg, workerID, int64(n))
			if !okWrite {
				// Segment reached its shortened end (split) or was stolen.
				abandoned = true
				reqCancel()
				break
			}
			if _, wErr := out.WriteAt(buf[:keep], off); wErr != nil {
				planner.abortWrite(seg, workerID)
				reqCancel()
				resp.Body.Close()
				planner.release(seg, workerID, false)
				return nil, 0, fmt.Errorf("write at +%d: %w", off, wErr)
			}
			done, rem, totalW := planner.commitWrite(seg, workerID, keep, now)
			atomic.StoreInt64(writtenAtomic, totalW)
			if lastActivity != nil {
				atomic.StoreInt64(lastActivity, now.UnixNano())
			}

			if firstByteAt.IsZero() {
				firstByteAt = now
				windowStart = now
			} else {
				responseBytes += keep
				windowBytes += keep
			}

			if done {
				slowTracker.recordFastCompletion(responseBytes, now.Sub(firstByteAt))
				// If a dynamic split shortened seg.end, abort the leftover response
				// stream immediately rather than draining gigabytes.
				if off+keep < end {
					abandoned = true
					reqCancel()
				}
				break
			}

			// MDM rule #4: evaluate slow-connection cut every slowEvalWindow (2 s).
			if workers > 1 && !windowStart.IsZero() && now.Sub(windowStart) >= slowEvalWindow &&
				globalHostLimits.effectiveLimit(targetURL, workers, now) > 1 {
				rate := float64(windowBytes) / now.Sub(windowStart).Seconds()
				windowStart = now
				windowBytes = 0
				if slowTracker.shouldCut(rate, rem, int(receiving.Load()), planner.lastSlowCut(seg), totalW, now) {
					planner.markSlowCut(seg, workerID, now)
					slowCut = true
					abandoned = true
					// Cancel request context so Go closes the slow TCP socket
					// instead of putting it back into the keep-alive idle pool.
					reqCancel()
					break
				}
			}
		}

		if rErr != nil {
			readErr = rErr
			break
		}
	}

	resp.Body.Close()

	if slowCut {
		if isIA && slowTracker.totalCuts()%4 == 0 {
			// Periodically re-resolve archive.org/download/ after repeated slow
			// cuts so a sluggish edge node can rotate to a faster node.
			resetActiveURL()
		}
		return nil, 0, nil
	}
	if abandoned || ctx.Err() != nil {
		return nil, 0, nil
	}

	// Check if we completed the segment cleanly.
	_, _, stillOpen := planner.segmentBounds(seg, workerID)
	if !stillOpen {
		return nil, 0, nil
	}

	// Incomplete read (network drop, EOF early, or per-worker stall): preserve
	// all bytes already written up to seg.cursor and retry from there!
	var reason error
	if workerStalled.Load() {
		reason = fmt.Errorf("read after %d bytes: per-worker stall (%s)", responseBytes, workerReadStall)
	} else if readErr != nil && readErr != io.EOF {
		reason = fmt.Errorf("read after %d bytes: %w", responseBytes, readErr)
	} else {
		reason = fmt.Errorf("range incomplete after %d bytes (eof before end)", responseBytes)
	}

	// Because commitWrite reset seg.failures to 0 whenever bytes arrived, a
	// connection that delivered data before dropping gets fresh retries from its
	// new cursor instead of burning the retry budget.
	failures, cursor, pending := planner.release(seg, workerID, true)
	if !pending {
		return nil, 0, nil
	}
	if failures > app.IAChunkRetries {
		return nil, 0, reason
	}
	wait := retryBackoff(failures, 0)
	s.App.Logf("RETRY range at offset %d (attempt %d/%d): %v — waiting %s", cursor, failures, app.IAChunkRetries, reason, wait)
	return reason, wait, nil
}

func isDeterministicHTTPFailure(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	for _, code := range []string{"HTTP 401", "HTTP 403", "HTTP 404", "HTTP 410"} {
		if strings.Contains(msg, code) {
			return true
		}
	}
	return false
}

// IADownloadSingle is a single-stream download with up to IAChunkRetries retries.
func (s *Service) IADownloadSingle(urlStr, dest, name, ref string) error {
	isIA := isIAURL(urlStr)
	var lastErr error
	for attempt := 0; attempt <= app.IAChunkRetries; attempt++ {
		if attempt > 0 {
			wait := time.Duration(attempt) * app.IAChunkRetryBase
			s.App.Logf("RETRY download [%s] (attempt %d/%d): %v — waiting %s",
				name, attempt, app.IAChunkRetries, lastErr, wait)
			for slept := time.Duration(0); slept < wait; slept += 250 * time.Millisecond {
				if s.App.IsGameJobCancelled(name) {
					os.Remove(dest)
					removeDownloadResume(dest)
					return app.ErrJobCancelled
				}
				time.Sleep(250 * time.Millisecond)
			}
		}
		lastErr = s.iaDownloadSingleAttempt(urlStr, dest, name, ref, isIA)
		if lastErr == nil {
			return nil
		}
		if errors.Is(lastErr, app.ErrDownloadTooSlow) {
			return lastErr
		}
		if errors.Is(lastErr, app.ErrJobCancelled) {
			os.Remove(dest)
			removeDownloadResume(dest)
			return lastErr
		}
		// Do not waste 90 s retrying deterministic 404/410 or permanent 401/403
		// (allow 1 retry on IA 401/403 in case RefreshIAAuthSession renewed cookies).
		if isDeterministicHTTPFailure(lastErr) {
			if isIA && (strings.Contains(lastErr.Error(), "HTTP 401") || strings.Contains(lastErr.Error(), "HTTP 403")) && attempt == 0 {
				continue
			}
			return lastErr
		}
		if errors.Is(lastErr, app.ErrDownloadStalled) && attempt >= 1 {
			return lastErr
		}
	}
	return lastErr
}

func (s *Service) iaDownloadSingleAttempt(urlStr, dest, name, ref string, isIA bool) error {
	client := s.httpClientForURL(urlStr)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", urlStr, nil)
	if err != nil {
		return err
	}
	resumeMarker, resumeOffset, resumeOK := loadSingleResume(dest, urlStr)
	if resumeOK {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", resumeOffset))
		if resumeMarker.Validator != "" {
			req.Header.Set("If-Range", resumeMarker.Validator)
		}
		s.App.Logf("DOWNLOAD RESUME [%s]: retomando a partir de %.1f MB", name, float64(resumeOffset)/1048576)
	}
	s.applyDownloadHeaders(req, urlStr, ref)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && isIA {
		_ = s.App.RefreshIAAuthSession()
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		return iaHTTPError(resp.StatusCode, urlStr)
	}
	appendMode := resumeOK && resp.StatusCode == http.StatusPartialContent
	responseValidator := resp.Header.Get("ETag")
	if responseValidator == "" {
		responseValidator = resp.Header.Get("Last-Modified")
	}
	totalSize := resp.ContentLength
	if resp.StatusCode == http.StatusPartialContent {
		responseStart, responseEnd, responseTotal, rangeErr := parseHTTPContentRange(resp.Header.Get("Content-Range"))
		if rangeErr != nil || responseStart != resumeOffset || responseEnd != responseTotal-1 {
			return fmt.Errorf("resposta de retomada divergente para offset %d: %q", resumeOffset, resp.Header.Get("Content-Range"))
		}
		totalSize = responseTotal
		if resp.ContentLength >= 0 && resp.ContentLength != responseEnd-responseStart+1 {
			return fmt.Errorf("tamanho da faixa divergente: cabecalho=%d, faixa=%d", resp.ContentLength, responseEnd-responseStart+1)
		}
	}
	if appendMode {
		if resumeMarker.TotalSize != totalSize {
			return fmt.Errorf("servidor alterou o tamanho durante a retomada: antes %d, agora %d", resumeMarker.TotalSize, totalSize)
		}
		if resumeMarker.Validator != "" && responseValidator != "" && resumeMarker.Validator != responseValidator {
			_ = os.Remove(dest)
			removeDownloadResume(dest)
			return fmt.Errorf("servidor alterou o arquivo durante a retomada; reiniciando download")
		}
	} else {
		resumeOffset = 0
		resumeMarker = &downloadResumeMarker{Mode: "single", URL: urlStr, TotalSize: totalSize, Validator: responseValidator}
	}
	if totalSize <= 0 {
		return fmt.Errorf("servidor nao informou o tamanho do download")
	}
	if err := ensureDownloadSpace(dest, totalSize); err != nil {
		return err
	}
	if err := writeResumeMarker(dest, resumeMarker); err != nil {
		return fmt.Errorf("persistir checkpoint do download: %w", err)
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	if appendMode {
		flags = os.O_CREATE | os.O_WRONLY | os.O_APPEND
	}
	out, err := os.OpenFile(dest, flags, 0644)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	bw := bufio.NewWriterSize(out, app.CopyBufferSize)
	pw := &ProgressWriter{
		Total: totalSize, Written: resumeOffset, ResumeOffset: resumeOffset,
		GameName: name, LastLog: time.Now(), StartTime: time.Now(), App: s.App,
	}

	var stallErr error
	var stallErrMu sync.Mutex
	doneCh := make(chan struct{})
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-doneCh:
				return
			case now := <-ticker.C:
				if s.App.IsGameJobCancelled(name) {
					stallErrMu.Lock()
					stallErr = app.ErrJobCancelled
					stallErrMu.Unlock()
					cancel()
					return
				}
				lastActivity := pw.LastActivityTime()
				if !lastActivity.IsZero() && now.Sub(lastActivity) > app.DownloadStallTimeout {
					s.App.Logf("WARN [%s]: Download estagnado (nenhum dado recebido por %s) — abortando tentativa para retentativa/retomada",
						name, app.DownloadStallTimeout)
					stallErrMu.Lock()
					stallErr = app.ErrDownloadStalled
					stallErrMu.Unlock()
					cancel()
					return
				}
			}
		}
	}()

	written, err := io.Copy(bw, io.TeeReader(resp.Body, pw))
	close(doneCh)

	flushErr := bw.Flush()
	syncErr := out.Sync()
	closeErr := out.Close()

	stallErrMu.Lock()
	if stallErr != nil {
		err = stallErr
	}
	stallErrMu.Unlock()

	if err != nil {
		return fmt.Errorf("interrupted after %.2f MB nesta tentativa: %w", float64(written)/1048576, err)
	}
	if flushErr != nil {
		return fmt.Errorf("flush download: %w", flushErr)
	}
	if syncErr != nil {
		return fmt.Errorf("sync download: %w", syncErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close download: %w", closeErr)
	}
	if resumeOffset+written != totalSize {
		return fmt.Errorf("download incompleto: esperado %d, recebido %d bytes", totalSize, resumeOffset+written)
	}
	// The resume marker stays until DownloadWithProgress publishes the
	// completion marker (finalizeDownload).
	return nil
}
