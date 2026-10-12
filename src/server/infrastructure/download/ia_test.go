package download

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"godsend/app"
	"godsend/models"
)

func TestEnsureDownloadSpaceReturnsActionableError(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "large.rar")
	err := ensureDownloadSpace(dest, math.MaxInt64)
	if err == nil {
		t.Fatal("expected insufficient temporary storage error")
	}
	if !strings.Contains(err.Error(), "armazenamento temporario") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSingleDownloadResumesFromPersistedOffset(t *testing.T) {
	payload := []byte("0123456789ABCDEFGHIJ")
	var requests atomic.Int32
	var resumed atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		request := requests.Add(1)
		if request == 1 {
			w.Header().Set("Content-Length", fmt.Sprint(len(payload)))
			_, _ = w.Write(payload[:8])
			return
		}
		if r.Header.Get("Range") != "bytes=8-" {
			t.Errorf("Range inesperado: %q", r.Header.Get("Range"))
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		resumed.Store(true)
		w.Header().Set("Content-Length", fmt.Sprint(len(payload)-8))
		w.Header().Set("Content-Range", fmt.Sprintf("bytes 8-%d/%d", len(payload)-1, len(payload)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(payload[8:])
	}))
	defer server.Close()

	a := app.NewApp()
	a.IAAuthorizationHeader = "test-auth-token"
	a.IAHTTPClient = server.Client()
	service := &Service{App: a}
	dest := filepath.Join(t.TempDir(), "resume.zip")
	if err := service.iaDownloadSingleAttempt(server.URL, dest, "Resume", server.URL, false); err == nil {
		t.Fatal("a primeira resposta truncada deveria falhar")
	}
	if st, err := os.Stat(dest); err != nil || st.Size() != 8 {
		t.Fatalf("parcial nao foi preservado: stat=%v err=%v", st, err)
	}
	if err := service.iaDownloadSingleAttempt(server.URL, dest, "Resume", server.URL, false); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(dest)
	if err != nil || string(data) != string(payload) {
		t.Fatalf("download retomado incorreto: %q err=%v", data, err)
	}
	if !resumed.Load() {
		t.Fatal("o segundo request nao retomou pelo offset")
	}
}

func TestChunkedDownloadReusesCheckpointedSegments(t *testing.T) {
	payload := []byte("01234567ABCDEFGHijklmnop")
	var requestedFirst atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var start, end int
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil {
			t.Errorf("Range invalido: %q", r.Header.Get("Range"))
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if start == 0 {
			requestedFirst.Store(true)
		}
		w.Header().Set("Content-Length", fmt.Sprint(end-start+1))
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(payload)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(payload[start : end+1])
	}))
	defer server.Close()

	previousSegmentSize := iaSegmentSize
	iaSegmentSize = 8
	defer func() { iaSegmentSize = previousSegmentSize }()
	a := app.NewApp()
	a.IAAuthorizationHeader = "test-auth-token"
	a.IAHTTPClient = server.Client()
	a.IADownloadMaxParallel = 2
	service := &Service{App: a}
	testDir := t.TempDir()
	dest := filepath.Join(testDir, "chunked.zip")
	defer func() { _ = os.RemoveAll(testDir) }()
	if err := os.WriteFile(dest, append(append([]byte{}, payload[:8]...), make([]byte, len(payload)-8)...), 0644); err != nil {
		t.Fatal(err)
	}
	marker := &downloadResumeMarker{
		Mode: "chunked", URL: server.URL, TotalSize: int64(len(payload)), SegmentSize: 8,
		Completed: []bool{true, false, false}, SegmentHashes: []string{"", "", ""},
	}
	checkpointFile, err := os.Open(dest)
	if err != nil {
		t.Fatal(err)
	}
	marker.SegmentHashes[0], err = sha256FileRange(checkpointFile, 0, 8)
	_ = checkpointFile.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := writeResumeMarker(dest, marker); err != nil {
		t.Fatal(err)
	}
	if err := service.IADownloadChunkedParallel(server.URL, dest, "Chunked", server.URL, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(dest)
	if err != nil || string(data) != string(payload) {
		t.Fatalf("arquivo segmentado incorreto: %q err=%v", data, err)
	}
	if requestedFirst.Load() {
		t.Fatal("segmento confirmado foi baixado novamente")
	}

	checkpointFile, err = os.Open(dest)
	if err != nil {
		t.Fatal(err)
	}
	marker.Completed = []bool{true, true, true}
	for index := range marker.SegmentHashes {
		marker.SegmentHashes[index], err = sha256FileRange(checkpointFile, int64(index*8), 8)
		if err != nil {
			_ = checkpointFile.Close()
			t.Fatal(err)
		}
	}
	_ = checkpointFile.Close()
	if err := writeResumeMarker(dest, marker); err != nil {
		t.Fatal(err)
	}
	corrupt, err := os.OpenFile(dest, os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = corrupt.WriteAt([]byte("X"), 0)
	_ = corrupt.Close()
	requestedFirst.Store(false)
	if err := service.IADownloadChunkedParallel(server.URL, dest, "Chunked", server.URL, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	if !requestedFirst.Load() {
		t.Fatal("segmento corrompido nao foi baixado novamente")
	}
	data, err = os.ReadFile(dest)
	if err != nil || string(data) != string(payload) {
		t.Fatalf("segmento corrompido nao foi reparado: %q err=%v", data, err)
	}
}

func TestDownloadWithProgressReusesOnlyVerifiedCompletedFile(t *testing.T) {
	payload := []byte("arquivo de jogo concluido")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.Header().Set("Content-Length", "25")
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	a := app.NewApp()
	a.IAAuthorizationHeader = "test-auth-token"
	a.IAHTTPClient = server.Client()
	service := &Service{App: a}
	testDir := t.TempDir()
	defer os.RemoveAll(testDir)
	dest := filepath.Join(testDir, "source.zip")
	if err := service.DownloadWithProgress(server.URL, dest, "Teste", server.URL); err != nil {
		t.Fatal(err)
	}
	if err := service.DownloadWithProgress(server.URL, dest, "Teste", server.URL); err != nil {
		t.Fatal(err)
	}
	if got := requests.Load(); got != 1 {
		t.Fatalf("download completo deveria ser reutilizado; requisicoes=%d", got)
	}

	f, err := os.OpenFile(dest, os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.WriteString(f, "X")
	_ = f.Close()
	if err := service.DownloadWithProgress(server.URL, dest, "Teste", server.URL); err != nil {
		t.Fatal(err)
	}
	if got := requests.Load(); got != 2 {
		t.Fatalf("cache corrompido deveria baixar novamente; requisicoes=%d", got)
	}
}

func TestDownloadPromotesDurableFullSingleResumeWithoutRequest(t *testing.T) {
	payload := []byte("download integral sincronizado")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	a := app.NewApp()
	a.IAAuthorizationHeader = "test-auth-token"
	a.IAHTTPClient = server.Client()
	service := &Service{App: a}
	testDir := t.TempDir()
	defer os.RemoveAll(testDir)
	dest := filepath.Join(testDir, "source.zip")
	if err := os.WriteFile(dest, payload, 0644); err != nil {
		t.Fatal(err)
	}
	if err := writeResumeMarker(dest, &downloadResumeMarker{
		Mode: "single", URL: server.URL, TotalSize: int64(len(payload)),
	}); err != nil {
		t.Fatal(err)
	}
	if err := service.DownloadWithProgress(server.URL, dest, "Promote", server.URL); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 0 {
		t.Fatalf("arquivo integral provocou %d requests", requests.Load())
	}
	if !reusableCompletedDownload(dest, server.URL) {
		t.Fatal("arquivo integral nao recebeu marcador de conclusao verificavel")
	}
}

func TestSingleDownloadStallTimeoutAbortsAttempt(t *testing.T) {
	prevTimeout := app.DownloadStallTimeout
	app.DownloadStallTimeout = 150 * time.Millisecond
	defer func() { app.DownloadStallTimeout = prevTimeout }()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "1000")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("12345"))
		if flusher, ok := w.(http.Flusher); ok {
			flusher.Flush()
		}
		// Stall indefinitely without closing connection
		time.Sleep(2 * time.Second)
	}))
	defer server.Close()

	a := app.NewApp()
	a.IAHTTPClient = server.Client()
	service := &Service{App: a}
	dest := filepath.Join(t.TempDir(), "stall.zip")

	err := service.iaDownloadSingleAttempt(server.URL, dest, "StallTest", server.URL, false)
	if err == nil {
		t.Fatal("expected download to abort on stall")
	}
	if !errors.Is(err, app.ErrDownloadStalled) && !strings.Contains(err.Error(), "estagnado") {
		t.Fatalf("expected ErrDownloadStalled, got: %v", err)
	}
}

// rangeTestServer serves payload honouring "Range: bytes=a-b" (the probe asks for
// bytes=0-0) and records every Range header it received; a request without a
// closed range gets the whole payload with 200.
func rangeTestServer(t *testing.T, payload []byte) (*httptest.Server, func() []string) {
	t.Helper()
	var mu sync.Mutex
	var ranges []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		ranges = append(ranges, r.Header.Get("Range"))
		mu.Unlock()
		var start, end int
		if _, err := fmt.Sscanf(r.Header.Get("Range"), "bytes=%d-%d", &start, &end); err != nil {
			w.Header().Set("Content-Length", fmt.Sprint(len(payload)))
			_, _ = w.Write(payload)
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(end-start+1))
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(payload)))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(payload[start : end+1])
	}))
	t.Cleanup(server.Close)
	return server, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), ranges...)
	}
}

func newResumeTestService(server *httptest.Server) *Service {
	a := app.NewApp()
	a.IAAuthorizationHeader = "test-auth-token"
	a.IAHTTPClient = server.Client()
	a.IADownloadMaxParallel = 2
	return &Service{App: a}
}

func readResumeMap(t *testing.T, dest string) *downloadResumeMarker {
	t.Helper()
	data, err := os.ReadFile(resumeMarkerPath(dest))
	if err != nil {
		t.Fatalf("mapa de retomada ausente depois do download: %v", err)
	}
	var marker downloadResumeMarker
	if err := json.Unmarshal(data, &marker); err != nil {
		t.Fatal(err)
	}
	return &marker
}

func writeChunkedResume(t *testing.T, dest, urlStr string, payload []byte, segmentSize int64, completed []bool) {
	t.Helper()
	if err := os.WriteFile(dest, payload, 0644); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(dest)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	marker := &downloadResumeMarker{
		Mode: "chunked", URL: urlStr, TotalSize: int64(len(payload)), SegmentSize: segmentSize,
		Completed: completed, SegmentHashes: make([]string, len(completed)),
	}
	for index, done := range completed {
		if !done {
			continue
		}
		start := int64(index) * segmentSize
		size := segmentSize
		if start+size > int64(len(payload)) {
			size = int64(len(payload)) - start
		}
		if marker.SegmentHashes[index], err = sha256FileRange(f, start, size); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeResumeMarker(dest, marker); err != nil {
		t.Fatal(err)
	}
}

// The segment map is the only durable proof of a finished chunked download
// until the completion marker exists, so the download itself must not drop it.
func TestChunkedDownloadKeepsResumeMapUntilCompletionMarker(t *testing.T) {
	payload := []byte("01234567ABCDEFGHijklmnop")
	server, _ := rangeTestServer(t, payload)
	previousSegmentSize := iaSegmentSize
	iaSegmentSize = 8
	defer func() { iaSegmentSize = previousSegmentSize }()
	service := newResumeTestService(server)
	dest := filepath.Join(t.TempDir(), "chunked.zip")

	if err := service.IADownloadChunkedParallel(server.URL, dest, "Chunked", server.URL, int64(len(payload))); err != nil {
		t.Fatal(err)
	}
	marker := readResumeMap(t, dest)
	if marker.Mode != "chunked" || len(marker.Completed) != 3 {
		t.Fatalf("mapa inesperado: %+v", marker)
	}
	for index, done := range marker.Completed {
		if !done || marker.SegmentHashes[index] == "" {
			t.Fatalf("segmento %d nao ficou confirmado no mapa: %+v", index, marker)
		}
	}
}

func TestSingleDownloadKeepsResumeMapUntilCompletionMarker(t *testing.T) {
	payload := []byte("download single integral")
	server, _ := rangeTestServer(t, payload)
	service := newResumeTestService(server)
	dest := filepath.Join(t.TempDir(), "single.zip")

	if err := service.IADownloadSingle(server.URL, dest, "Single", server.URL); err != nil {
		t.Fatal(err)
	}
	marker := readResumeMap(t, dest)
	if marker.Mode != "single" || marker.TotalSize != int64(len(payload)) {
		t.Fatalf("mapa inesperado: %+v", marker)
	}
}

func TestDownloadWithProgressClearsResumeMapAfterCompletionMarker(t *testing.T) {
	payload := []byte("download concluido e conferido")
	server, _ := rangeTestServer(t, payload)
	service := newResumeTestService(server)
	dest := filepath.Join(t.TempDir(), "source.zip")

	if err := service.DownloadWithProgress(server.URL, dest, "Clear", server.URL); err != nil {
		t.Fatal(err)
	}
	if !reusableCompletedDownload(dest, server.URL) {
		t.Fatal("download concluido sem marcador de conclusao verificavel")
	}
	if _, err := os.Stat(resumeMarkerPath(dest)); !os.IsNotExist(err) {
		t.Fatalf("mapa de retomada sobrou depois do marcador de conclusao: err=%v", err)
	}
}

// A stop during the final full-file hash leaves a full file plus a segment map
// with every segment confirmed and no completion marker. The next run must
// promote it instead of truncating the file and downloading it again.
func TestDownloadPromotesFullChunkedResumeWithoutRequest(t *testing.T) {
	payload := []byte("01234567ABCDEFGHijklmnop")
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	service := newResumeTestService(server)
	urlStr := server.URL + "/archive.org/download/item/source.zip"
	dest := filepath.Join(t.TempDir(), "source.zip")
	writeChunkedResume(t, dest, urlStr, payload, 8, []bool{true, true, true})

	if err := service.DownloadWithProgress(urlStr, dest, "Promote", urlStr); err != nil {
		t.Fatal(err)
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("arquivo chunked integral provocou %d requests", got)
	}
	if data, err := os.ReadFile(dest); err != nil || !bytes.Equal(data, payload) {
		t.Fatalf("arquivo integral foi alterado: %q err=%v", data, err)
	}
	if !reusableCompletedDownload(dest, urlStr) {
		t.Fatal("arquivo integral nao recebeu marcador de conclusao verificavel")
	}
	if _, err := os.Stat(resumeMarkerPath(dest)); !os.IsNotExist(err) {
		t.Fatalf("mapa de retomada sobrou depois da promocao: err=%v", err)
	}
}

func TestDownloadDoesNotPromotePartialChunkedResume(t *testing.T) {
	// DownloadWithProgress only takes the chunked path at app.IAParallelThreshold.
	const segment = 16 * 1024 * 1024
	payload := make([]byte, 2*segment)
	for index := range payload {
		payload[index] = byte(index % 251)
	}
	server, ranges := rangeTestServer(t, payload)
	previousSegmentSize := iaSegmentSize
	iaSegmentSize = segment
	defer func() { iaSegmentSize = previousSegmentSize }()
	service := newResumeTestService(server)
	urlStr := server.URL + "/archive.org/download/item/source.zip"
	dest := filepath.Join(t.TempDir(), "source.zip")
	partial := append(append([]byte{}, payload[:segment]...), make([]byte, segment)...)
	writeChunkedResume(t, dest, urlStr, partial, segment, []bool{true, false})

	if err := service.DownloadWithProgress(urlStr, dest, "Partial", urlStr); err != nil {
		t.Fatal(err)
	}
	want := []string{"bytes=0-0", fmt.Sprintf("bytes=%d-%d", segment, 2*segment-1)}
	if got := ranges(); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("faixas pedidas = %v, esperado %v (so o probe e o segmento que faltava)", got, want)
	}
	if data, err := os.ReadFile(dest); err != nil || !bytes.Equal(data, payload) {
		t.Fatalf("arquivo retomado incorreto (err=%v)", err)
	}
	if !reusableCompletedDownload(dest, urlStr) {
		t.Fatal("download retomado sem marcador de conclusao verificavel")
	}
	if _, err := os.Stat(resumeMarkerPath(dest)); !os.IsNotExist(err) {
		t.Fatalf("mapa de retomada sobrou depois do marcador de conclusao: err=%v", err)
	}
}

func TestDownloadWithProgressReportsFinalVerification(t *testing.T) {
	payload := []byte("arquivo para conferir no fim")
	server, _ := rangeTestServer(t, payload)
	service := newResumeTestService(server)
	dest := filepath.Join(t.TempDir(), "source.zip")

	if err := service.DownloadWithProgress(server.URL, dest, "Verify", server.URL); err != nil {
		t.Fatal(err)
	}
	value, ok := service.App.JobQueue.Load("Verify")
	if !ok {
		t.Fatal("nenhum status publicado para o job")
	}
	if status := value.(models.GameStatus); !strings.Contains(status.Message, "Conferindo") {
		t.Fatalf("ultimo status nao mostra a conferencia final: %+v", status)
	}
}
