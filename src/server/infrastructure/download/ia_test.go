package download

import (
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"godsend/app"
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
