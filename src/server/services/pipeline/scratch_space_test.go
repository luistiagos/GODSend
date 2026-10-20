package pipeline

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godsend/app"
)

func fakeFreeSpace(t *testing.T, free uint64) {
	t.Helper()
	previous := freeSpaceBytes
	freeSpaceBytes = func(string) (uint64, error) { return free, nil }
	t.Cleanup(func() { freeSpaceBytes = previous })
}

func TestExtractionStopsBeforeWritingWhenPCVolumeIsTooSmall(t *testing.T) {
	fakeFreeSpace(t, localSpaceMargin) // margin only: no room for the 14 payload bytes
	for _, isoOnly := range []bool{false, true} {
		t.Run(map[bool]string{false: "archive", true: "iso"}[isoOnly], func(t *testing.T) {
			s := &Service{App: app.NewApp()}
			source := extractionTestArchive(t)
			root := t.TempDir()
			destDir := filepath.Join(root, "extracted")
			var err error
			if isoOnly {
				_, destDir, err = s.extractISOResilient("Example", "game", source, root)
			} else {
				err = s.extractArchiveResilient("Example", source, destDir)
			}
			var space *scratchSpaceError
			if !errors.Is(err, ErrLocalStaging) || !errors.As(err, &space) {
				t.Fatalf("want ErrLocalStaging carrying scratchSpaceError, got %v", err)
			}
			for _, name := range []string{"disc/game.iso", "readme.txt"} {
				if _, statErr := os.Stat(filepath.Join(destDir, filepath.FromSlash(name))); !os.IsNotExist(statErr) {
					t.Fatalf("%s was written before the space check: %v", name, statErr)
				}
			}
		})
	}
}

func TestExtractionRunsWhenPCVolumeFits(t *testing.T) {
	fakeFreeSpace(t, localSpaceMargin+1024)
	s := &Service{App: app.NewApp()}
	if err := s.extractArchiveResilient("Example", extractionTestArchive(t), filepath.Join(t.TempDir(), "extracted")); err != nil {
		t.Fatal(err)
	}
}

func TestLocalStagingMessageHidesRawDiskFullText(t *testing.T) {
	precheck := fmt.Errorf("Extract failed: %w", fmt.Errorf("%w: fase extract-archive: %w", ErrLocalStaging,
		&scratchSpaceError{Volume: "C:", Need: 20 << 30, Free: 5 << 30}))
	if got := localStagingMessage(precheck, `C:\godsend-data\runtime\Temp`); !strings.Contains(got, "(C:)") ||
		!strings.Contains(got, "20.00 GB") || !strings.Contains(got, "5.00 GB") || strings.Contains(got, ErrLocalStaging.Error()) {
		t.Fatalf("precheck message: %q", got)
	}

	osFull := fmt.Errorf("Extract failed: %w", fmt.Errorf("%w: fase extract-archive: %w", ErrLocalStaging,
		errors.New(`write C:\Temp\FIFA\data3.big.xbox-companion-part: There is not enough space on the disk.`)))
	if got := localStagingMessage(osFull, `C:\godsend-data\runtime\Temp`); !strings.Contains(got, "ficou sem espaço") ||
		strings.Contains(got, "not enough space") || strings.Contains(got, ErrLocalStaging.Error()) {
		t.Fatalf("disk-full message: %q", got)
	}

	denied := fmt.Errorf("%w: fase extract-archive: %w", ErrLocalStaging, errors.New("Access is denied."))
	if got := localStagingMessage(denied, `C:\Temp`); !strings.Contains(got, "Access is denied.") {
		t.Fatalf("non-space failures keep the cause on screen: %q", got)
	}
}
