// ztm_release_test.go — the "GTA 5" of the catalog is the ZTM release on Archive.org, and it
// nests the install disc (1 of 2) in a folder named "Disc2" inside the playable disc (2 of 2).
// Measured on the real 14.7 GB archive with v2.12.103: the installer was taken for the game,
// its four packages were never found, and the job ended in "release incompleta".
package pipeline

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godsend/infrastructure/helpers"
)

// writeXEXDisc writes a default.xex whose execution-info header names titleID and disc.
func writeXEXDisc(t *testing.T, dir string, titleID uint32, disc byte) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	xex := make([]byte, 64)
	copy(xex, "XEX2")
	binary.BigEndian.PutUint32(xex[20:], 1)          // one optional header
	binary.BigEndian.PutUint32(xex[24:], 0x00040006) // execution info
	binary.BigEndian.PutUint32(xex[28:], 32)
	binary.BigEndian.PutUint32(xex[32+12:], titleID)
	xex[32+18] = disc
	xex[32+19] = 2
	if err := os.WriteFile(filepath.Join(dir, "default.xex"), xex, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestZTMReleaseDeliversTheGameAndItsNestedInstallDisc(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	game := filepath.Join(extDir, "Grand.Theft.Auto.5.EUR.X360-ZTM")
	writeXEXDisc(t, game, gtaVTitleID, 2)
	if err := os.WriteFile(filepath.Join(game, "xbox360a.rpf"), []byte("game data"), 0o644); err != nil {
		t.Fatal(err)
	}
	installDisc := filepath.Join(game, "Disc2")
	writeXEXDisc(t, installDisc, gtaVTitleID, 1)
	writeGTAVInstallSet(t, filepath.Join(installDisc, "content", "0000000000000000", "545408A7", "00000002"))
	root := t.TempDir()

	xexFolder := helpers.FindXEXFolder(extDir)
	if xexFolder != game {
		t.Fatalf("o jogo é o disco 2 na raiz da release, não o instalador; veio %s", xexFolder)
	}
	if err := s.installCompanionDiscContent("GTA 5", extDir, xexFolder, localDestination(root)); err != nil {
		t.Fatalf("release completa recusada: %v", err)
	}
	for _, name := range gtaVPackages {
		if _, err := os.Stat(filepath.Join(installContentDir(root), name)); err != nil {
			t.Errorf("pacote %s não gravado: %v", name, err)
		}
	}

	entries, _, err := buildLocalCopyManifest(xexFolder)
	if err != nil {
		t.Fatal(err)
	}
	copied := map[string]bool{}
	for _, entry := range entries {
		if strings.HasPrefix(filepath.ToSlash(entry.relativePath), "Disc2/") {
			t.Errorf("o disco de instalação iria junto com o jogo para Games: %s", entry.relativePath)
		}
		copied[filepath.ToSlash(entry.relativePath)] = true
	}
	if !copied["default.xex"] || !copied["xbox360a.rpf"] {
		t.Errorf("o jogo em si tem de ser copiado inteiro: %v", copied)
	}
	if large, _ := findFileExceedingFAT32Limit(xexFolder); large != "" {
		t.Errorf("nenhum arquivo do jogo passa de 4 GB aqui: %s", large)
	}
}
