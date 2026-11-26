package download

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"godsend/app"
)

// TestDownloadEngineBenchmark compares the legacy strategy (fixed 4 MiB chunks
// + per-chunk fsync/sha256 under global lock + default transport) against the
// new MDM-style dynamic parallel engine (dedicated HTTP/1.1 + dynamic splits +
// slow-connection cut + unlocked periodic checkpoints).
//
// Gated behind GODSEND_DOWNLOAD_BENCH=1 so normal `go test ./...` stays fast.
func TestDownloadEngineBenchmark(t *testing.T) {
	if os.Getenv("GODSEND_DOWNLOAD_BENCH") != "1" {
		t.Skip("set GODSEND_DOWNLOAD_BENCH=1 to run download comparison benchmark")
	}

	// 1. Realistic lab server modeling archive.org behavior measured in retrobatnew:
	//    - 32 MiB payload
	//    - 250 ms TTFB per range request
	//    - 1 in 4 requests gets a slow connection (~250 KB/s); fast connections ~16 MB/s
	//    - 10% transient HTTP 500
	const payloadSize = 32 * 1024 * 1024
	payload := makeDeterministicPayload(payloadSize)

	runLabServer := func() (*httptest.Server, *atomic.Int32) {
		var reqSeq atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seq := reqSeq.Add(1)
			var start, end int
			if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			// Simulate archive.org TTFB.
			select {
			case <-r.Context().Done():
				return
			case <-time.After(250 * time.Millisecond):
			}
			// Probe request (bytes=0-0) always succeeds quickly.
			if start == 0 && end == 0 {
				w.Header().Set("Content-Length", "1")
				w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-0/%d", len(payload)))
				w.WriteHeader(http.StatusPartialContent)
				_, _ = w.Write(payload[:1])
				return
			}
			if seq%10 == 4 {
				w.WriteHeader(http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Length", fmt.Sprint(end-start+1))
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(payload)))
			w.WriteHeader(http.StatusPartialContent)
			fl, _ := w.(http.Flusher)

			// 1 in 4 connections is severely throttled (~256 KB/s); others run at ~16 MB/s.
			slow := seq%4 == 2
			step := 64 * 1024
			delay := 4 * time.Millisecond // ~16 MB/s
			if slow {
				step = 16 * 1024
				delay = 60 * time.Millisecond // ~266 KB/s
			}
			for pos := start; pos <= end; pos += step {
				select {
				case <-r.Context().Done():
					return
				default:
				}
				hi := pos + step
				if hi > end+1 {
					hi = end + 1
				}
				if _, err := w.Write(payload[pos:hi]); err != nil {
					return
				}
				if fl != nil {
					fl.Flush()
				}
				select {
				case <-r.Context().Done():
					return
				case <-time.After(delay):
				}
			}
		}))
		return srv, &reqSeq
	}

	// Legacy simulation: fixed 4 MiB chunks + per-chunk out.Sync() + sha256FileRange under global lock,
	// no slow-connection cutting, no dynamic splitting.
	srvOld, reqsOld := runLabServer()
	defer srvOld.Close()
	destOld := filepath.Join(t.TempDir(), "legacy.bin")
	startOld := time.Now()
	{
		out, err := os.Create(destOld)
		if err != nil {
			t.Fatal(err)
		}
		_ = out.Truncate(payloadSize)
		type seg struct{ idx int; s, e int64 }
		jobs := make(chan seg, 16)
		for off := int64(0); off < payloadSize; off += 4 * 1024 * 1024 {
			e := off + 4*1024*1024 - 1
			if e >= payloadSize {
				e = payloadSize - 1
			}
			jobs <- seg{int(off / (4 * 1024 * 1024)), off, e}
		}
		close(jobs)
		var wg sync.WaitGroup
		var mu sync.Mutex
		cli := &http.Client{}
		for w := 0; w < 8; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				buf := make([]byte, 256*1024)
				for ss := range jobs {
					for attempt := 0; attempt < 5; attempt++ {
						req, _ := http.NewRequest("GET", srvOld.URL, nil)
						req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", ss.s, ss.e))
						resp, err := cli.Do(req)
						if err != nil || resp.StatusCode != 206 {
							if resp != nil {
								resp.Body.Close()
							}
							continue
						}
						var got int64
						for {
							n, rErr := resp.Body.Read(buf)
							if n > 0 {
								_, _ = out.WriteAt(buf[:n], ss.s+got)
								got += int64(n)
							}
							if rErr == io.EOF {
								break
							}
							if rErr != nil {
								break
							}
						}
						resp.Body.Close()
						if got == ss.e-ss.s+1 {
							mu.Lock()
							_ = out.Sync()
							_, _ = sha256FileRange(out, ss.s, got)
							mu.Unlock()
							break
						}
					}
				}
			}()
		}
		wg.Wait()
		out.Close()
	}
	durOld := time.Since(startOld)

	// New MDM dynamic engine.
	origWin, origMinRem, origCool := slowEvalWindow, slowCutMinRemainingSec, slowCutCooldown
	slowEvalWindow = 500 * time.Millisecond
	slowCutMinRemainingSec = 1.0
	slowCutCooldown = 1 * time.Second
	defer func() {
		slowEvalWindow, slowCutMinRemainingSec, slowCutCooldown = origWin, origMinRem, origCool
	}()

	srvNew, reqsNew := runLabServer()
	defer srvNew.Close()
	a := app.NewApp()
	a.IAAuthorizationHeader = "bench-token"
	a.IADownloadMaxParallel = 8
	a.DownloadHTTPClient = app.NewDownloadHTTPClient(nil)
	a.IAHTTPClient = app.NewDownloadHTTPClient(nil)
	svc := &Service{App: a}
	destNew := filepath.Join(t.TempDir(), "dynamic.bin")
	startNew := time.Now()
	if err := svc.DownloadWithProgress(srvNew.URL+"/archive.org/download/bench/file.bin", destNew, "BenchDynamic", srvNew.URL); err != nil {
		t.Fatal(err)
	}
	durNew := time.Since(startNew)

	mib := float64(payloadSize) / 1048576
	t.Logf("LAB BENCHMARK (32 MiB, 250ms TTFB, 25%% slow conn, 10%% HTTP 500):")
	t.Logf("  Legacy (4 MiB fixed + per-chunk fsync/sha256): %s (%.2f MiB/s, %d HTTP reqs)", durOld.Round(time.Millisecond), mib/durOld.Seconds(), reqsOld.Load())
	t.Logf("  New MDM Dynamic HTTP/1.1 + slow-cut + splits:  %s (%.2f MiB/s, %d HTTP reqs)", durNew.Round(time.Millisecond), mib/durNew.Seconds(), reqsNew.Load())
	t.Logf("  Speedup: %.2fx", durOld.Seconds()/durNew.Seconds())
}
