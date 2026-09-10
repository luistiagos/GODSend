// companion_content_test.go — the destination folder of a XEX rip has to name the game.
// Grand Theft Auto V was listed among the installed games as "Disc2" because the rip's own
// top-level folder is named after the disc, not the release.
package pipeline

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

// writeXexRipFolder creates a folder shaped like an extracted disc of a XEX rip: a synthetic
// STFS container is enough for FindTitleIDInDir to resolve the TitleID.
func writeXexRipFolder(t *testing.T, dir, titleID string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("criar %s: %v", dir, err)
	}
	raw, err := hex.DecodeString(titleID)
	if err != nil {
		t.Fatalf("TitleID inválido %q: %v", titleID, err)
	}
	buf := make([]byte, 0x400)
	copy(buf[0:4], "LIVE")
	copy(buf[0x360:0x364], raw)
	if err := os.WriteFile(filepath.Join(dir, "nxeart"), buf, 0o644); err != nil {
		t.Fatalf("gravar nxeart: %v", err)
	}
	return dir
}

func TestXexDestinationNameReplacesTheDiscPlaceholder(t *testing.T) {
	xexFolder := writeXexRipFolder(t, filepath.Join(t.TempDir(), "Disc2"), "545408A7")

	got := xexDestinationName(xexFolder, "Disc2", "Grand Theft Auto 5")

	if got != "Grand Theft Auto 5 - 545408A7" {
		t.Errorf("esperado %q, obtido %q", "Grand Theft Auto 5 - 545408A7", got)
	}
}

func TestXexDestinationNameDropsTheDiscTagFromTheReleaseTitle(t *testing.T) {
	// Redump-style catalog names carry the disc in the title too; the destination holds the
	// release, so the tag has no place in it.
	xexFolder := writeXexRipFolder(t, filepath.Join(t.TempDir(), "Disc2"), "545408A7")

	got := xexDestinationName(xexFolder, "Disc 2", "Grand Theft Auto V (USA) (Disc 2)")

	if got != "Grand Theft Auto V (USA) - 545408A7" {
		t.Errorf("esperado %q, obtido %q", "Grand Theft Auto V (USA) - 545408A7", got)
	}
}

func TestXexDestinationNameKeepsARipFolderThatNamesTheGame(t *testing.T) {
	// Single-disc scene rips ship a folder that already identifies the release; the installed
	// games list cleans it up, and replacing it would move every existing install.
	xexFolder := writeXexRipFolder(t, filepath.Join(t.TempDir(), "Gears.of.War.1.USA.X360-ZTM"), "4D5307D5")

	got := xexDestinationName(xexFolder, "Gears.of.War.1.USA.X360-ZTM", "Gears of War")

	if got != "Gears.of.War.1.USA.X360-ZTM - 4D5307D5" {
		t.Errorf("nome do rip deve ser preservado, obtido %q", got)
	}
}
