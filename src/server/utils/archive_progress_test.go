package utils

import (
	"archive/zip"
	"bytes"
	"errors"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func progressZip(t *testing.T, files map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "source.zip")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(f)
	for name, content := range files {
		entry, err := w.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(entry, content); err != nil {
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

func TestArchiveProgressFormatsAndReuse(t *testing.T) {
	files := map[string]string{"game.iso": "iso payload\n", "readme.txt": "archive progress fixture\n"}
	archives := []string{
		progressZip(t, files),
		filepath.Join("testdata", "extraction-progress.7z"),
		filepath.Join("testdata", "extraction-progress.rar"),
	}
	for _, archive := range archives {
		t.Run(filepath.Ext(archive), func(t *testing.T) {
			dest := t.TempDir()
			for attempt := 0; attempt < 2; attempt++ {
				var events []ExtractionProgress
				err := ExtractArchiveWithProgress(archive, dest, func(p ExtractionProgress) {
					events = append(events, p)
				})
				if err != nil {
					t.Fatal(err)
				}
				if len(events) < 2 || events[0].Bytes != 0 || events[0].Done {
					t.Fatalf("missing initial update: %+v", events)
				}
				last := events[len(events)-1]
				if !last.Done || last.Bytes != 37 || last.Files != 2 {
					t.Fatalf("incorrect final progress on attempt %d: %+v", attempt, last)
				}
				if filepath.Ext(archive) == ".rar" {
					if last.TotalBytes != -1 {
						t.Fatalf("RAR must not invent a total: %+v", last)
					}
				} else if last.TotalBytes != 37 {
					t.Fatalf("wrong uncompressed total: %+v", last)
				}
				for name, content := range files {
					data, err := os.ReadFile(filepath.Join(dest, name))
					if err != nil || string(data) != content {
						t.Fatalf("%s: %q, %v", name, data, err)
					}
				}
			}
		})
	}
}

func TestISOProgressCountsOnlyMatchingEntries(t *testing.T) {
	for _, archive := range []string{
		progressZip(t, map[string]string{"GAME.ISO": "iso payload\n", "other.bin": "ignored"}),
		filepath.Join("testdata", "extraction-progress.7z"),
		filepath.Join("testdata", "extraction-progress.rar"),
	} {
		t.Run(filepath.Ext(archive), func(t *testing.T) {
			var events []ExtractionProgress
			iso, err := ExtractISOWithProgress(archive, "game", t.TempDir(), func(p ExtractionProgress) {
				events = append(events, p)
			})
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(iso)
			if err != nil || string(data) != "iso payload\n" {
				t.Fatalf("%q: %v", data, err)
			}
			last := events[len(events)-1]
			if !last.Done || last.Bytes != 12 || last.Files != 1 {
				t.Fatalf("wrong filtered progress: %+v", last)
			}
			if filepath.Ext(archive) != ".rar" && last.TotalBytes != 12 {
				t.Fatalf("non-ISO entry counted: %+v", last)
			}
		})
	}
}

func TestArchiveCorruptionNeverReportsDone(t *testing.T) {
	archive := progressZip(t, map[string]string{"game.iso": "payload"})
	r, err := zip.OpenReader(archive)
	if err != nil {
		t.Fatal(err)
	}
	offset, err := r.File[0].DataOffset()
	if err != nil {
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	f, err := os.OpenFile(archive, os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt([]byte("X"), offset); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	var events []ExtractionProgress
	dest := t.TempDir()
	err = ExtractArchiveWithProgress(archive, dest, func(p ExtractionProgress) { events = append(events, p) })
	if err == nil {
		t.Fatal("expected CRC failure")
	}
	for _, p := range events {
		if p.Done {
			t.Fatalf("corrupt archive reported completion: %+v", p)
		}
	}
	if _, err := os.Stat(filepath.Join(dest, "game.iso")); !os.IsNotExist(err) {
		t.Fatalf("corrupt file committed: %v", err)
	}
}

func TestMissingISONeverReportsDone(t *testing.T) {
	archive := progressZip(t, map[string]string{"readme.txt": "no ISO"})
	_, err := ExtractISOWithProgress(archive, "game", t.TempDir(), func(p ExtractionProgress) {
		if p.Done {
			t.Fatal("missing ISO reported completion")
		}
	})
	if err == nil {
		t.Fatal("expected missing ISO error")
	}
}

// Advance the reporting interval at each read without slowing down tests.
// Restrict reads to chunks to exercise updates inside one unfinished file.
type progressChunkReader struct {
	reader   io.Reader
	progress *archiveProgress
}

func (r progressChunkReader) Read(b []byte) (int, error) {
	r.progress.last = time.Time{}
	if len(b) > 64*1024 {
		b = b[:64*1024]
	}
	return r.reader.Read(b)
}

func TestExtractionReportsWithinSingleFileAndKeepsAtomicValidation(t *testing.T) {
	payload := bytes.Repeat([]byte("x"), 3*1024*1024)
	for _, corrupt := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "crc-failure"}[corrupt], func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "large.iso")
			var events []ExtractionProgress
			progress := newArchiveProgress(func(p ExtractionProgress) {
				events = append(events, p)
				if p.Files == 0 {
					if p.Done {
						t.Fatalf("file not yet committed: %+v", p)
					}
					if _, err := os.Stat(path); !os.IsNotExist(err) {
						t.Fatalf("partial final file exposed: %v", err)
					}
				}
			})
			progress.TotalBytes = int64(len(payload))
			crc := crc32.ChecksumIEEE(payload)
			if corrupt {
				crc++
			}
			err := extractFileAtomically(path, int64(len(payload)), crc, true, true,
				progressChunkReader{bytes.NewReader(payload), progress}, progress)
			if (err != nil) != corrupt {
				t.Fatalf("corrupt=%v, error=%v", corrupt, err)
			}
			if len(events) < 3 || events[0].Bytes <= 0 || events[0].Bytes >= int64(len(payload)) {
				t.Fatalf("no intermediate byte progress: %+v", events)
			}
			if !corrupt && progress.Files != 1 {
				t.Fatal("committed file not counted")
			}
			if corrupt && progress.Files != 0 {
				t.Fatal("failed file counted")
			}
		})
	}
}

type failedProgressWriter struct{}

func (failedProgressWriter) Write(b []byte) (int, error) { return 2, io.ErrShortWrite }

func TestArchiveProgressThrottleAndFailedWrites(t *testing.T) {
	var events []ExtractionProgress
	p := newArchiveProgress(func(p ExtractionProgress) { events = append(events, p) })
	p.report(true)
	for i := 0; i < 100; i++ {
		p.addBytes(1)
	}
	if len(events) != 1 {
		t.Fatalf("unbounded updates: %d", len(events))
	}
	p.last = time.Now().Add(-2 * time.Second)
	w := extractionProgressWriter{failedProgressWriter{}, p}
	n, err := w.Write([]byte("abcd"))
	if n != 2 || !errors.Is(err, io.ErrShortWrite) {
		t.Fatalf("%d, %v", n, err)
	}
	if len(events) != 2 || events[1].Bytes != 102 {
		t.Fatalf("failed bytes counted: %+v", events)
	}
}
