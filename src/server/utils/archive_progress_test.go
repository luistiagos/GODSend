package utils

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"runtime"
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

func TestExtractFileAtomicallyCancelsMidCopyAndRemovesPartial(t *testing.T) {
	payload := bytes.Repeat([]byte("z"), 4*1024*1024)
	path := filepath.Join(t.TempDir(), "large.iso")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var events []ExtractionProgress
	progress := newArchiveProgressWithContext(ctx, func(p ExtractionProgress) {
		events = append(events, p)
		if p.Bytes > 0 {
			cancel()
		}
	})
	progress.TotalBytes = int64(len(payload))
	err := extractFileAtomically(path, int64(len(payload)), crc32.ChecksumIEEE(payload), true, true,
		progressChunkReader{bytes.NewReader(payload), progress}, progress)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if len(events) == 0 || events[len(events)-1].Bytes >= int64(len(payload)) {
		t.Fatalf("expected copy to abort early, got progress=%+v", events)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("cancelled final file exists: %v", statErr)
	}
	if _, statErr := os.Stat(path + ".xbox-companion-part"); !os.IsNotExist(statErr) {
		t.Fatalf("cancelled partial file remained: %v", statErr)
	}
}

func TestExtractArchiveAndISOWithContextCancelAcrossFormats(t *testing.T) {
	files := map[string]string{
		"game.iso":   "iso payload\n",
		"readme.txt": "archive progress fixture\n",
	}
	archives := []string{
		progressZip(t, files),
		filepath.Join("testdata", "extraction-progress.7z"),
		filepath.Join("testdata", "extraction-progress.rar"),
	}
	for _, archive := range archives {
		ext := filepath.Ext(archive)
		t.Run("archive/"+ext, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			dest := t.TempDir()
			err := ExtractArchiveWithContext(ctx, archive, dest, func(p ExtractionProgress) {
				if p.Done {
					t.Fatalf("cancelled archive reported done: %+v", p)
				}
				cancel()
			})
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("expected context.Canceled, got %v", err)
			}
			if _, statErr := os.Stat(filepath.Join(dest, "game.iso.xbox-companion-part")); !os.IsNotExist(statErr) {
				t.Fatalf("partial left behind: %v", statErr)
			}
		})
		t.Run("iso/"+ext, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			root := t.TempDir()
			_, err := ExtractISOWithContext(ctx, archive, "game", root, func(p ExtractionProgress) {
				if p.Done {
					t.Fatalf("cancelled iso reported done: %+v", p)
				}
				cancel()
			})
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("expected context.Canceled, got %v", err)
			}
		})
	}
}

func TestXDVDFSExtractFileCancelsMidCopyAndRemovesPartial(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "source.iso")
	const payloadSize = uint32(128 * 1024 * 1024)
	srcFile, err := os.Create(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := srcFile.Truncate(int64(payloadSize)); err != nil {
		srcFile.Close()
		t.Fatal(err)
	}
	defer srcFile.Close()

	destPath := filepath.Join(dir, "default.xex")
	partialPath := destPath + ".xbox-companion-part"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			if st, statErr := os.Stat(partialPath); statErr == nil && st.Size() > 0 {
				cancel()
				return
			}
			runtime.Gosched()
		}
		cancel()
	}()

	err = xdvdfsExtractFile(ctx, srcFile, 0, 0, payloadSize, destPath)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
	if _, statErr := os.Stat(destPath); !os.IsNotExist(statErr) {
		t.Fatalf("cancelled final file exists: %v", statErr)
	}
	if _, statErr := os.Stat(partialPath); !os.IsNotExist(statErr) {
		t.Fatalf("cancelled partial file remained: %v", statErr)
	}
}

func TestISOHelpersWithCancelledContextReturnImmediately(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	isoPath := filepath.Join(t.TempDir(), "missing.iso")
	outDir := filepath.Join(t.TempDir(), "out")

	if err := RunIso2GodNativeWithContext(ctx, isoPath, outDir, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("RunIso2GodNativeWithContext: expected context.Canceled, got %v", err)
	}
	if err := ExtractXEXFolderFromISOWithContext(ctx, isoPath, outDir); !errors.Is(err, context.Canceled) {
		t.Fatalf("ExtractXEXFolderFromISOWithContext: expected context.Canceled, got %v", err)
	}
	if err := ExtractXDVDFSContentToDirWithContext(ctx, isoPath, outDir, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("ExtractXDVDFSContentToDirWithContext: expected context.Canceled, got %v", err)
	}
}

func TestExtractionTrackerReportsCurrentFileAndActiveOp(t *testing.T) {
	files := map[string]string{
		"folder/game.iso": "iso payload\n",
		"readme.txt":      "docs",
	}
	archive := progressZip(t, files)
	ctx, tracker := ContextWithExtractionTracker(context.Background())

	var last CallbackCapture
	err := ExtractArchiveWithContext(ctx, archive, t.TempDir(), func(p ExtractionProgress) {
		last.seen++
		last.final = p
	})
	if err != nil {
		t.Fatal(err)
	}
	snap := tracker.Snapshot()
	if !snap.Done || snap.Files != 2 || snap.Bytes != 16 || snap.ActiveOp != "" || last.seen < 2 || !last.final.Done {
		t.Fatalf("unexpected final tracker/callback state: snap=%+v callback=%+v", snap, last)
	}
}

type CallbackCapture struct {
	seen  int
	final ExtractionProgress
}

type gateReader struct {
	chunk   []byte
	sent    bool
	entered chan struct{}
	release chan struct{}
}

func (g *gateReader) Read(p []byte) (int, error) {
	if !g.sent {
		g.sent = true
		n := copy(p, g.chunk)
		return n, nil
	}
	close(g.entered)
	<-g.release
	return 0, io.EOF
}

type gateWriter struct {
	entered chan struct{}
	release chan struct{}
	written int64
}

func (g *gateWriter) Write(p []byte) (int, error) {
	close(g.entered)
	<-g.release
	g.written += int64(len(p))
	return len(p), nil
}

func TestExtractionTrackerReflectsBlockedReadAndWriteOps(t *testing.T) {
	t.Run("blocked-read", func(t *testing.T) {
		ctx, tracker := ContextWithExtractionTracker(context.Background())
		progress := newArchiveProgressWithContext(ctx, nil)
		progress.startEntry("disc1/game.iso", 1024)

		entered := make(chan struct{})
		release := make(chan struct{})
		rdr := &gateReader{chunk: []byte("hello"), entered: entered, release: release}

		done := make(chan error, 1)
		dest := filepath.Join(t.TempDir(), "game.iso")
		go func() {
			done <- extractFileAtomically(dest, 5, 0, false, false, rdr, progress)
		}()

		<-entered
		snap := tracker.Snapshot()
		if snap.ActiveOp != "read" || snap.CurrentFile != "disc1/game.iso" || snap.Bytes != 5 {
			close(release)
			t.Fatalf("unexpected snapshot during blocked read: %+v", snap)
		}
		close(release)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	})

	t.Run("blocked-write", func(t *testing.T) {
		ctx, tracker := ContextWithExtractionTracker(context.Background())
		progress := newArchiveProgressWithContext(ctx, nil)
		progress.startEntry("disc2/game.iso", 5)

		entered := make(chan struct{})
		release := make(chan struct{})
		gw := &gateWriter{entered: entered, release: release}
		w := extractionProgressWriter{Writer: gw, progress: progress}

		done := make(chan error, 1)
		go func() {
			_, err := w.Write([]byte("hello"))
			done <- err
		}()

		<-entered
		snap := tracker.Snapshot()
		if snap.ActiveOp != "write" || snap.CurrentFile != "disc2/game.iso" || snap.Bytes != 0 {
			close(release)
			t.Fatalf("unexpected snapshot during blocked write: %+v", snap)
		}
		close(release)
		if err := <-done; err != nil {
			t.Fatal(err)
		}
		if snap = tracker.Snapshot(); snap.Bytes != 5 {
			t.Fatalf("expected 5 bytes after write unblocked, got %+v", snap)
		}
	})
}
