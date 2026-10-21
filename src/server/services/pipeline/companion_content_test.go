// companion_content_test.go — the destination folder of a XEX rip has to name the game.
// Grand Theft Auto V was listed among the installed games as "Disc2" because the rip's own
// top-level folder is named after the disc, not the release.
package pipeline

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"godsend/infrastructure/helpers"
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

// writeRootXexArchive extracts a rip that ships default.xex at the root of the archive into
// the provider's scratch dir, the way the HF homebrew bundles (RetroArch emulators) do.
func writeRootXexArchive(t *testing.T, extDir string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(extDir, "roms"), 0o755); err != nil {
		t.Fatalf("criar %s: %v", extDir, err)
	}
	if err := os.WriteFile(filepath.Join(extDir, "default.xex"), []byte("XEX2"), 0o644); err != nil {
		t.Fatalf("gravar default.xex: %v", err)
	}
	return extDir
}

func TestXexDestinationNameNamesARootRipAfterTheReleaseNotTheScratchDir(t *testing.T) {
	// [[pipeline-xex-com-default-xex-na-raiz-do-arquivo-grava-pasta-com-sufixo-hf-ext_2026-10-12T14-56]]
	// [[pipeline-nome-de-pasta-xex-sem-titleid-com-mais-de-42-caracteres-nao-e-cortado-para-o-hd-fatx_2026-10-12T19-15]]
	const game = "EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 360 RGH )"
	extDir := writeRootXexArchive(t, filepath.Join(t.TempDir(), game+"_hf_ext"))
	xexFolder := helpers.FindXEXFolder(extDir)

	got := xexDestinationName(xexFolder, ripFolderName(xexFolder, extDir), game)

	expected := "EMULADOR MASTER SYSTEM + 376 ROMS ( XBOX 3"
	if got != expected {
		t.Errorf("esperado %q, obtido %q", expected, got)
	}
}

func TestXexDestinationNameAddsTheTitleIDToARootRip(t *testing.T) {
	extDir := writeXexRipFolder(t, writeRootXexArchive(t, filepath.Join(t.TempDir(), "Halo 3_ext")), "4D5307E6")
	xexFolder := helpers.FindXEXFolder(extDir)

	got := xexDestinationName(xexFolder, ripFolderName(xexFolder, extDir), "Halo 3")

	if got != "Halo 3 - 4D5307E6" {
		t.Errorf("esperado %q, obtido %q", "Halo 3 - 4D5307E6", got)
	}
}

func TestXexDestinationNameDropsTheDiscTagFromARootRip(t *testing.T) {
	extDir := writeRootXexArchive(t, filepath.Join(t.TempDir(), "Grand Theft Auto V (USA) (Disc 2)_mgext"))
	xexFolder := helpers.FindXEXFolder(extDir)

	got := xexDestinationName(xexFolder, ripFolderName(xexFolder, extDir), "Grand Theft Auto V (USA) (Disc 2)")

	if got != "Grand Theft Auto V (USA)" {
		t.Errorf("esperado %q, obtido %q", "Grand Theft Auto V (USA)", got)
	}
}

func TestRipFolderNameKeepsTheRipsOwnFolder(t *testing.T) {
	extDir := filepath.Join(t.TempDir(), "Gears of War_hf_ext")
	writeRootXexArchive(t, filepath.Join(extDir, "Gears.of.War.1.USA.X360-ZTM"))
	xexFolder := helpers.FindXEXFolder(extDir)

	if got := ripFolderName(xexFolder, extDir); got != "Gears.of.War.1.USA.X360-ZTM" {
		t.Errorf("esperado o nome da pasta do rip, obtido %q", got)
	}
}
