package utils

import (
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/nwaples/rardecode/v2"
)

// TestRARLocalArchives validates retained RAR archives without downloading or writing extracted games.
func TestRARLocalArchives(t *testing.T) {
	paths := filepath.SplitList(os.Getenv("GODSEND_TEST_RAR_ARCHIVES"))
	if len(paths) == 0 {
		t.Skip("set GODSEND_TEST_RAR_ARCHIVES to local RAR paths")
	}
	for _, path := range paths {
		t.Run(filepath.Base(filepath.Dir(path)), func(t *testing.T) {
			r, err := rardecode.OpenReader(path)
			if err != nil {
				t.Fatal(err)
			}
			defer r.Close()
			files := 0
			var total int64
			for {
				h, err := r.Next()
				if err == io.EOF {
					break
				}
				if err != nil {
					t.Fatal(err)
				}
				if h.IsDir {
					continue
				}
				crc := crc32.NewIEEE()
				n, err := io.Copy(crc, r)
				if err != nil {
					t.Fatalf("entry %q after %d bytes: err=%v, computed_crc=%08X", h.Name, n, err, crc.Sum32())
				}
				if !h.UnKnownSize && n != h.UnPackedSize {
					t.Fatalf("entry %q: got %d bytes, want %d", h.Name, n, h.UnPackedSize)
				}
				files++
				total += n
			}
			if files == 0 {
				t.Fatal("archive has no files")
			}
			t.Logf("validated %d files, %d bytes", files, total)
		})
	}
}
