package utils

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExtractArchiveReusesCommittedFileAndRepairsPartial(t *testing.T) {
	root := t.TempDir()
	archive := filepath.Join(root, "source.zip")
	f, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(f)
	for name, contents := range map[string]string{"first.bin": "first", "second.bin": "second", "third.bin": "third"} {
		entry, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(contents)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	dest := filepath.Join(root, "dest")
	if err := os.MkdirAll(dest, 0755); err != nil {
		t.Fatal(err)
	}
	first := filepath.Join(dest, "first.bin")
	second := filepath.Join(dest, "second.bin")
	third := filepath.Join(dest, "third.bin")
	if err := os.WriteFile(first, []byte("first"), 0644); err != nil {
		t.Fatal(err)
	}
	originalTime := time.Unix(1_600_000_000, 0)
	if err := os.Chtimes(first, originalTime, originalTime); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(second+".xbox-companion-part", []byte("sec"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(third, []byte("WRONG"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := ExtractArchive(archive, dest); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(first)
	if err != nil || !st.ModTime().Equal(originalTime) {
		t.Fatalf("arquivo confirmado foi reextraido: stat=%v err=%v", st, err)
	}
	data, err := os.ReadFile(second)
	if err != nil || string(data) != "second" {
		t.Fatalf("parcial nao foi reparado: %q err=%v", data, err)
	}
	if _, err := os.Stat(second + ".xbox-companion-part"); !os.IsNotExist(err) {
		t.Fatalf("arquivo parcial permaneceu: %v", err)
	}
	data, err = os.ReadFile(third)
	if err != nil || string(data) != "third" {
		t.Fatalf("arquivo corrompido com mesmo tamanho nao foi reparado: %q err=%v", data, err)
	}
}
