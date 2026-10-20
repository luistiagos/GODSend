package utils

import (
	"path/filepath"
	"testing"
)

func TestArchiveSpaceNeeded(t *testing.T) {
	sources := []string{
		progressZip(t, map[string]string{"game.iso": "iso payload\n", "readme.txt": "archive progress fixture\n"}),
		filepath.Join("testdata", "extraction-progress.7z"),
		filepath.Join("testdata", "extraction-progress.rar"),
	}
	for _, source := range sources {
		t.Run(filepath.Ext(source), func(t *testing.T) {
			dest := t.TempDir()
			for _, c := range []struct {
				wantExt string
				want    int64
			}{{"", 37}, {".iso", 12}, {".ISO", 12}} {
				got, err := ArchiveSpaceNeeded(source, dest, c.wantExt)
				if err != nil || got != c.want {
					t.Fatalf("before extraction, filter %q: got %d, %v; want %d", c.wantExt, got, err, c.want)
				}
			}
			if err := ExtractArchive(source, dest); err != nil {
				t.Fatal(err)
			}
			// zip/7z skip committed files; RAR rewrites each one beside the old copy.
			want := int64(0)
			if filepath.Ext(source) == ".rar" {
				want = 25
			}
			got, err := ArchiveSpaceNeeded(source, dest, "")
			if err != nil || got != want {
				t.Fatalf("after extraction: got %d, %v; want %d", got, err, want)
			}
		})
	}
	if _, err := ArchiveSpaceNeeded("game.tar", t.TempDir(), ""); err == nil {
		t.Fatal("unknown format must report that the size is unknown")
	}
}
