package app

import (
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	orig := os.Stdout
	os.Stdout = w
	done := make(chan string)
	go func() {
		data, _ := io.ReadAll(r)
		done <- string(data)
	}()
	fn()
	os.Stdout = orig
	w.Close()
	return <-done
}

func TestCleanupStaleScratchLogsStartAndFileCount(t *testing.T) {
	scratch := t.TempDir()
	extract := filepath.Join(scratch, "EA FC 26_extract", "faces")
	if err := os.MkdirAll(extract, 0755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a.rx3", "b.rx3", "c.rx3"} {
		if err := os.WriteFile(filepath.Join(extract, name), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(scratch, "Interrupted_hf.zip"), []byte("zip"), 0644); err != nil {
		t.Fatal(err)
	}

	a := NewApp()
	out := captureStdout(t, func() { a.cleanupStaleScratchDir(scratch, nil) })

	start := strings.Index(out, "Cleaning stale processing data in "+scratch)
	end := strings.Index(out, "Removed 0.00 GB of stale processing data from "+scratch)
	if start < 0 || end < 0 || start > end {
		t.Fatalf("expected start line before the total, got:\n%s", out)
	}
	if !regexp.MustCompile(`\(4 files in \d+(\.\d+)?m?s\)`).MatchString(out) {
		t.Fatalf("expected file count and duration in the total, got:\n%s", out)
	}
}

func TestCleanupStaleScratchSilentWhenOnlyProtectedEntries(t *testing.T) {
	scratch := t.TempDir()
	keep := filepath.Join(scratch, "Pending_GOD")
	if err := os.MkdirAll(keep, 0755); err != nil {
		t.Fatal(err)
	}
	a := NewApp()
	out := captureStdout(t, func() { a.cleanupStaleScratchDir(scratch, []string{keep}) })
	if strings.Contains(out, "Cleaning stale") || strings.Contains(out, "Removed") {
		t.Fatalf("nothing to clean must not announce a cleanup, got:\n%s", out)
	}
}
