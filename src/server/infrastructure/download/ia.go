// ia.go — Internet Archive HTTP downloads (single-stream and parallel range).
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

var iaSegmentSize int64 = app.IASegmentSize

type completedDownloadMarker struct {
	URL    string `json:"url"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

func completedMarkerPath(dest string) string {
	return dest + ".xbox-companion-complete.json"
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

// iaHTTPError turns an archive.org HTTP status into an actionable message.
// 401/403 almost always mean the item is restricted to logged-in accounts.
func iaHTTPError(status int, urlStr string) error {
	if status == 401 || status == 403 {
		return fmt.Errorf("HTTP %d — este item do Internet Archive exige conta logada. Em Configurações → Conta do Internet Archive, entre com seu login do archive.org e tente novamente", status)
	}
	return fmt.Errorf("HTTP %d from %s", status, urlStr)
}

// DownloadWithProgress downloads urlStr to dest. For Internet Archive URLs it uses a
// Gopeed-style segment queue (fixed-size ranges, worker pool) when Range is supported.
func (s *Service) DownloadWithProgress(urlStr, dest, name, ref string) error {
	if reusableCompletedDownload(dest, urlStr) {
		removeDownloadResume(dest)
		s.App.Logf("DOWNLOAD CACHE [%s]: reutilizando arquivo completo %s", name, dest)
		s.App.LogStatus(name, "Processing", "Download ja concluido. Reutilizando arquivo local...")
		return nil
	}
	// A process can stop after the final fsync but before publishing the
	// completion marker. Promote that durable full-length single-stream file
	// instead of issuing another multi-gigabyte request.
	if finishedSingleResume(dest, urlStr) {
		if err := markDownloadCompleted(dest, urlStr); err == nil {
			removeDownloadResume(dest)
			s.App.Logf("DOWNLOAD RESUME [%s]: promovendo arquivo integral sincronizado", name)
			s.App.LogStatus(name, "Processing", "Download ja concluido. Verificando e retomando do arquivo local...")
			return nil
		}
	}
	_ = os.Remove(completedMarkerPath(dest))

	var downloadErr error
	isIA := strings.Contains(strings.ToLower(urlStr), "archive.org")
	if isIA && s.App.IADownloadMaxParallel > 1 {
		size, rangeOK, err := s.IAProbeDownload(urlStr, ref)
		if err != nil {
			s.App.Logf("WARN [%s]: probe failed (%v), using single stream", name, err)
		} else if rangeOK && size >= app.IAParallelThreshold {
			nSeg := (size + iaSegmentSize - 1) / iaSegmentSize
			s.App.Logf("[%s] Chunked download: %.0f MB, %d segments (~%d MiB each), up to %d parallel HTTP",
				name, float64(size)/1048576, nSeg, iaSegmentSize/(1024*1024), s.App.IADownloadMaxParallel)
			downloadErr = s.IADownloadChunkedParallel(urlStr, dest, name, ref, size)
			if downloadErr == nil {
				if err := markDownloadCompleted(dest, urlStr); err != nil {
					return fmt.Errorf("persistir conclusao do download: %w", err)
				}
			}
			return downloadErr
		}
	}
	downloadErr = s.IADownloadSingle(urlStr, dest, name, ref)
	if downloadErr != nil {
		return downloadErr
	}
	if err := markDownloadCompleted(dest, urlStr); err != nil {
		return fmt.Errorf("persistir conclusao do download: %w", err)
	}
	return nil
}

// IAProbeDownload sends a GET request with Range: bytes=0-0 and returns (Content-Length, Accept-Ranges, error).
// Using GET Range: bytes=0-0 is significantly more reliable than HEAD on Internet Archive edge servers and CDNs.
func (s *Service) IAProbeDownload(urlStr, ref string) (size int64, rangeOK bool, err error) {
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return 0, false, err
	}
	req.Header.Set("Range", "bytes=0-0")
	req.Header.Set("Referer", ref)
	s.App.ApplyArchiveOrgHeaders(req)
	resp, err := s.App.IAHTTPClient.Do(req)
	if err != nil {
		return 0, false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusPartialContent { // 206 Partial Content
		start, end, total, parseErr := parseHTTPContentRange(resp.Header.Get("Content-Range"))
		if parseErr == nil && start == 0 && end == 0 {
			return total, true, nil
		}
		if resp.ContentLength > 0 {
			return resp.ContentLength, true, nil
		}
	} else if resp.StatusCode == http.StatusOK { // 200 OK (range not supported, full body returned)
		return resp.ContentLength, false, nil
	}

	return 0, false, fmt.Errorf("probe HTTP %d", resp.StatusCode)
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

// IADownloadChunkedParallel downloads the file into a single pre-sized destination using a
// queue of fixed-size byte ranges and a bounded worker pool.
func (s *Service) IADownloadChunkedParallel(urlStr, dest, name, ref string, totalSize int64) error {
	if err := ensureDownloadSpace(dest, totalSize); err != nil {
		return err
	}
	type seg struct {
		index      int
		start, end int64
	}
	var segments []seg
	for off := int64(0); off < totalSize; off += iaSegmentSize {
		end := off + iaSegmentSize - 1
		if end >= totalSize {
			end = totalSize - 1
		}
		segments = append(segments, seg{index: len(segments), start: off, end: end})
	}

	marker, resumed := loadResumeMarker(dest, urlStr, "chunked", totalSize, iaSegmentSize)
	if !resumed || len(marker.Completed) != len(segments) || len(marker.SegmentHashes) != len(segments) {
		marker = &downloadResumeMarker{
			Mode: "chunked", URL: urlStr, TotalSize: totalSize,
			SegmentSize: iaSegmentSize, Completed: make([]bool, len(segments)), SegmentHashes: make([]string, len(segments)),
		}
		out, err := os.Create(dest)
		if err != nil {
			return fmt.Errorf("create dest: %w", err)
		}
		if err := out.Truncate(totalSize); err != nil {
			out.Close()
			return fmt.Errorf("truncate: %w", err)
		}
		if err := out.Close(); err != nil {
			return err
		}
		if err := writeResumeMarker(dest, marker); err != nil {
			return fmt.Errorf("persistir mapa de segmentos: %w", err)
		}
	}
	out, err := os.OpenFile(dest, os.O_RDWR, 0644)
	if err != nil {
		return fmt.Errorf("open dest: %w", err)
	}
	if resumed {
		changed := false
		for _, ss := range segments {
			if !marker.Completed[ss.index] {
				continue
			}
			hash, hashErr := sha256FileRange(out, ss.start, ss.end-ss.start+1)
			if hashErr != nil || hash != marker.SegmentHashes[ss.index] {
				marker.Completed[ss.index] = false
				marker.SegmentHashes[ss.index] = ""
				changed = true
			}
		}
		if changed {
			if err := writeResumeMarker(dest, marker); err != nil {
				out.Close()
				return fmt.Errorf("reparar mapa de segmentos: %w", err)
			}
		}
	}

	jobs := make(chan seg, len(segments))
	for _, ss := range segments {
		if !marker.Completed[ss.index] {
			jobs <- ss
		}
	}
	close(jobs)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var written int64
	for _, ss := range segments {
		if marker.Completed[ss.index] {
			written += ss.end - ss.start + 1
		}
	}
	if written > 0 {
		s.App.Logf("DOWNLOAD RESUME [%s]: %.1f MB ja confirmados em %d segmentos", name, float64(written)/1048576, len(segments)-len(jobs))
	}
	initialWritten := written
	var lowSpeedErr error
	var lowSpeedErrMu sync.Mutex
	var resumeMu sync.Mutex
	startTime := time.Now()
	progressDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		lastConsole := time.Time{}
		var lowSpeedStart time.Time
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
					s.App.Logf("Download [%s]: %.1f%% (%.1f/%.1f MB) @ %.1f MB/s (chunked HTTP)",
						name, pct, wMB, tMB, speedMBs)
					lastConsole = now
				}

				// Speed monitoring: check if download speed is sustained below 1.0 MB/s
				if now.Sub(startTime) > app.LowSpeedGracePeriod && pct < 95 {
					currentSpeedBytesPerSec := float64(sessionWritten) / elapsed
					if currentSpeedBytesPerSec < float64(app.MinDownloadSpeedThreshold) {
						if lowSpeedStart.IsZero() {
							lowSpeedStart = now
						} else if now.Sub(lowSpeedStart) >= app.LowSpeedSustainedDuration {
							s.App.Logf("WARN [%s]: Download speed sustained below 1.0 MB/s (%.2f MB/s) — aborting for provider switch",
								name, speedMBs)
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
	}()

	workers := s.App.IADownloadMaxParallel
	if workers < 1 {
		workers = 1
	}
	var wg sync.WaitGroup
	var firstErr error
	var errMu sync.Mutex
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for ss := range jobs {
				if ctx.Err() != nil {
					return
				}
				if err := s.iaDownloadRange(ctx, urlStr, ref, out, ss.start, ss.end, totalSize, &written); err != nil {
					errMu.Lock()
					if firstErr == nil {
						firstErr = err
						cancel()
					}
					errMu.Unlock()
					return
				}
				resumeMu.Lock()
				checkpointErr := out.Sync()
				if checkpointErr == nil {
					marker.SegmentHashes[ss.index], checkpointErr = sha256FileRange(out, ss.start, ss.end-ss.start+1)
				}
				if checkpointErr == nil {
					marker.Completed[ss.index] = true
					checkpointErr = writeResumeMarker(dest, marker)
				}
				if checkpointErr != nil {
					errMu.Lock()
					if firstErr == nil {
						firstErr = fmt.Errorf("checkpoint do segmento %d: %w", ss.index, checkpointErr)
						cancel()
					}
					errMu.Unlock()
					resumeMu.Unlock()
					return
				}
				resumeMu.Unlock()
			}
		}()
	}
	wg.Wait()
	close(progressDone)
	out.Close()

	lowSpeedErrMu.Lock()
	if lowSpeedErr != nil {
		firstErr = lowSpeedErr
	}
	lowSpeedErrMu.Unlock()

	if firstErr != nil {
		if errors.Is(firstErr, app.ErrJobCancelled) {
			os.Remove(dest)
			removeDownloadResume(dest)
		}
		return firstErr
	}
	removeDownloadResume(dest)
	return nil
}

// iaDownloadRange downloads the inclusive byte range [start,end] into out at the same file offsets.
func (s *Service) iaDownloadRange(ctx context.Context, urlStr, ref string, out *os.File, start, end, totalSize int64, writtenAtomic *int64) error {
	expect := end - start + 1
	var lastErr error
	for attempt := 0; attempt <= app.IAChunkRetries; attempt++ {
		if attempt > 0 {
			wait := time.Duration(attempt) * app.IAChunkRetryBase
			s.App.Logf("RETRY chunk bytes=%d-%d (attempt %d/%d): %v — waiting %s",
				start, end, attempt, app.IAChunkRetries, lastErr, wait)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
		}

		req, err := http.NewRequestWithContext(ctx, "GET", urlStr, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
		req.Header.Set("Referer", ref)
		s.App.ApplyArchiveOrgHeaders(req)

		resp, err := s.App.IAHTTPClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request: %w", err)
			continue
		}
		if resp.StatusCode != 206 {
			resp.Body.Close()
			lastErr = fmt.Errorf("HTTP %d (expected 206 Partial Content)", resp.StatusCode)
			continue
		}
		responseStart, responseEnd, responseTotal, rangeErr := parseHTTPContentRange(resp.Header.Get("Content-Range"))
		if rangeErr != nil || responseStart != start || responseEnd != end || responseTotal != totalSize {
			resp.Body.Close()
			lastErr = fmt.Errorf("resposta de faixa divergente: pedido %d-%d/%d, recebido %q", start, end, totalSize, resp.Header.Get("Content-Range"))
			continue
		}

		var chunkWritten int64
		buf := make([]byte, 256*1024)
		var readErr error
		for {
			select {
			case <-ctx.Done():
				resp.Body.Close()
				atomic.AddInt64(writtenAtomic, -chunkWritten)
				return ctx.Err()
			default:
			}
			remaining := expect - chunkWritten
			if remaining == 0 {
				break
			}
			readBuf := buf
			if int64(len(readBuf)) > remaining {
				readBuf = readBuf[:remaining]
			}
			var n int
			n, readErr = resp.Body.Read(readBuf)
			if n > 0 {
				off := start + chunkWritten
				if _, wErr := out.WriteAt(buf[:n], off); wErr != nil {
					resp.Body.Close()
					atomic.AddInt64(writtenAtomic, -chunkWritten)
					lastErr = fmt.Errorf("write at +%d: %w", chunkWritten, wErr)
					chunkWritten = 0
					goto nextAttempt
				}
				atomic.AddInt64(writtenAtomic, int64(n))
				chunkWritten += int64(n)
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				break
			}
		}
		resp.Body.Close()
		if readErr != nil && readErr != io.EOF {
			atomic.AddInt64(writtenAtomic, -chunkWritten)
			lastErr = fmt.Errorf("read after %d bytes: %w", chunkWritten, readErr)
			continue
		}
		if chunkWritten != expect {
			atomic.AddInt64(writtenAtomic, -chunkWritten)
			lastErr = fmt.Errorf("range incomplete: got %d want %d bytes", chunkWritten, expect)
			continue
		}
		return nil
	nextAttempt:
	}
	return lastErr
}

// IADownloadSingle is a single-stream download with up to IAChunkRetries retries.
func (s *Service) IADownloadSingle(urlStr, dest, name, ref string) error {
	isIA := strings.Contains(strings.ToLower(urlStr), "archive.org")
	var lastErr error
	for attempt := 0; attempt <= app.IAChunkRetries; attempt++ {
		if attempt > 0 {
			wait := time.Duration(attempt) * app.IAChunkRetryBase
			s.App.Logf("RETRY download [%s] (attempt %d/%d): %v — waiting %s",
				name, attempt, app.IAChunkRetries, lastErr, wait)
			time.Sleep(wait)
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
	}
	return lastErr
}

func (s *Service) iaDownloadSingleAttempt(urlStr, dest, name, ref string, isIA bool) error {
	client := s.App.IAHTTPClient
	if !isIA {
		client = &http.Client{Timeout: 0}
	}
	req, err := http.NewRequest("GET", urlStr, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Referer", ref)
	resumeMarker, resumeOffset, resumeOK := loadSingleResume(dest, urlStr)
	if resumeOK {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", resumeOffset))
		if resumeMarker.Validator != "" {
			req.Header.Set("If-Range", resumeMarker.Validator)
		}
		s.App.Logf("DOWNLOAD RESUME [%s]: retomando a partir de %.1f MB", name, float64(resumeOffset)/1048576)
	}
	if isIA {
		s.App.ApplyArchiveOrgHeaders(req)
	} else {
		req.Header.Set("User-Agent", "Mozilla/5.0")
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
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
	written, err := io.Copy(bw, io.TeeReader(resp.Body, pw))
	flushErr := bw.Flush()
	syncErr := out.Sync()
	closeErr := out.Close()
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
	removeDownloadResume(dest)
	return nil
}
