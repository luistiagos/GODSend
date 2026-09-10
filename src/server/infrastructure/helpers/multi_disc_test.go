// multi_disc_test.go — a two-disc rip must deliver both discs. Grand Theft Auto V reached the
// console as a game called "Disc2" with its install disc missing, because the XEX paths keep
// the folder holding default.xex and drop the rest of the archive.
package helpers

import (
	"encoding/binary"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

// writeStfsContentPackage creates a synthetic STFS container carrying both fields
// describePayload reads: the parent TitleID at 0x360 and the content type at 0x344.
func writeStfsContentPackage(t *testing.T, path, titleID string, contentType uint32) {
	t.Helper()
	raw, err := hex.DecodeString(titleID)
	if err != nil {
		t.Fatalf("TitleID inválido %q: %v", titleID, err)
	}
	buf := make([]byte, 0x400)
	copy(buf[0:4], "LIVE")
	binary.BigEndian.PutUint32(buf[0x344:0x348], contentType)
	copy(buf[0x360:0x364], raw)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("criar %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, buf, 0o644); err != nil {
		t.Fatalf("gravar %s: %v", path, err)
	}
}

// writeGtaVStyleRip lays out the shape a scene rip of a two-disc release has: the install
// disc as a console-addressed Content tree, the playable disc as a loose XEX folder.
func writeGtaVStyleRip(t *testing.T, root, installTitleIDFolder, packageTitleID string) string {
	t.Helper()
	writeStfsContentPackage(t,
		filepath.Join(root, "Disc1", "Content", "0000000000000000", installTitleIDFolder, "00000002", "GTA5INSTALL"),
		packageTitleID, 0x00000002)
	gameFolder := filepath.Join(root, "Disc2")
	if err := os.MkdirAll(gameFolder, 0o755); err != nil {
		t.Fatalf("criar %s: %v", gameFolder, err)
	}
	if err := os.WriteFile(filepath.Join(gameFolder, "default.xex"), []byte("XEX2"), 0o644); err != nil {
		t.Fatalf("gravar default.xex: %v", err)
	}
	return gameFolder
}

func TestFindCompanionContentPayloadsFindsTheInstallDisc(t *testing.T) {
	root := t.TempDir()
	gameFolder := writeGtaVStyleRip(t, root, "545408A7", "545408A7")

	payloads := FindCompanionContentPayloads(root, gameFolder)

	if len(payloads) != 1 {
		t.Fatalf("esperado 1 payload de disco de instalação, obtido %d: %+v", len(payloads), payloads)
	}
	if payloads[0].TitleID != "545408A7" {
		t.Errorf("TitleID: esperado %q, obtido %q", "545408A7", payloads[0].TitleID)
	}
	if payloads[0].TypeDir != "00000002" {
		t.Errorf("TypeDir: esperado %q, obtido %q", "00000002", payloads[0].TypeDir)
	}
	if payloads[0].Dir != filepath.Join(root, "Disc1", "Content", "0000000000000000", "545408A7", "00000002") {
		t.Errorf("Dir inesperado: %q", payloads[0].Dir)
	}
}

func TestFindCompanionContentPayloadsResolvesInstallerPlaceholder(t *testing.T) {
	// A retail installer addresses its own tree under FFED2000; the console looks the content
	// up by the game's real Title ID, which only the package header carries.
	root := t.TempDir()
	gameFolder := writeGtaVStyleRip(t, root, ContentPlaceholderTitleID, "545408A7")

	payloads := FindCompanionContentPayloads(root, gameFolder)

	if len(payloads) != 1 {
		t.Fatalf("esperado 1 payload, obtido %d: %+v", len(payloads), payloads)
	}
	if payloads[0].TitleID != "545408A7" {
		t.Errorf("o TitleID do cabeçalho tem de vencer o da pasta: obtido %q", payloads[0].TitleID)
	}
}

func TestFindCompanionContentPayloadsSkipsTheGameFolder(t *testing.T) {
	// Whatever the playable folder carries is installed with the game; copying it a second
	// time into Content would duplicate gigabytes on the destination.
	root := t.TempDir()
	gameFolder := filepath.Join(root, "Disc2")
	writeStfsContentPackage(t,
		filepath.Join(gameFolder, "Content", "0000000000000000", "545408A7", "00000002", "PKG"),
		"545408A7", 0x00000002)

	if payloads := FindCompanionContentPayloads(root, gameFolder); len(payloads) != 0 {
		t.Fatalf("nada dentro da pasta do jogo deve ser reinstalado como conteúdo: %+v", payloads)
	}
}

func TestFindCompanionContentPayloadsIgnoresSystemPackages(t *testing.T) {
	// Kinect, speech and dashboard packages are signed under the system title. Writing one to
	// Content/0000000000000000/FFFE07DF would put dashboard data where a game is expected.
	root := t.TempDir()
	gameFolder := writeGtaVStyleRip(t, root, SystemTitleID, SystemTitleID)

	if payloads := FindCompanionContentPayloads(root, gameFolder); len(payloads) != 0 {
		t.Fatalf("pacote de sistema não é disco de instalação: %+v", payloads)
	}
}

func TestFindCompanionContentPayloadsAcceptsMissingContentTypeFolder(t *testing.T) {
	// Some rips drop the content-type folder and leave the package directly under the Title
	// ID; the header still says which folder the console expects.
	root := t.TempDir()
	writeStfsContentPackage(t,
		filepath.Join(root, "Disc1", "Content", "0000000000000000", "4D53084D", "FORZA3INSTALL"),
		"4D53084D", 0x00000002)
	gameFolder := filepath.Join(root, "Disc2")
	if err := os.MkdirAll(gameFolder, 0o755); err != nil {
		t.Fatalf("criar %s: %v", gameFolder, err)
	}

	payloads := FindCompanionContentPayloads(root, gameFolder)

	if len(payloads) != 1 {
		t.Fatalf("esperado 1 payload, obtido %d: %+v", len(payloads), payloads)
	}
	if payloads[0].TypeDir != "00000002" {
		t.Errorf("TypeDir: esperado %q do cabeçalho, obtido %q", "00000002", payloads[0].TypeDir)
	}
}

func TestFindCompanionContentPayloadsIgnoresLooseFiles(t *testing.T) {
	// Only a console-addressed Content tree is a payload: a stray package in the archive root
	// has no Title ID folder saying where it belongs.
	root := t.TempDir()
	writeStfsContentPackage(t, filepath.Join(root, "extras", "bonus.bin"), "545408A7", 0x00000002)

	if payloads := FindCompanionContentPayloads(root, ""); len(payloads) != 0 {
		t.Fatalf("arquivo solto não é payload endereçado: %+v", payloads)
	}
}

func TestIsGenericDiscFolderName(t *testing.T) {
	generic := []string{"Disc2", "Disc 2", "disc1", "DVD1", "DVD 2", "CD3", "Disk 1", "Game Disc", "Install Disc 2", "Disc"}
	for _, name := range generic {
		if !IsGenericDiscFolderName(name) {
			t.Errorf("%q é um marcador de disco do rip, não um jogo", name)
		}
	}
	titles := []string{"Grand Theft Auto 5", "Gears.of.War.1.USA.X360-ZTM", "Disc Golf", "Discworld Noir", "Forza Motorsport 3", "CD Projekt Game"}
	for _, name := range titles {
		if IsGenericDiscFolderName(name) {
			t.Errorf("%q é o nome de um jogo e tem de ser preservado", name)
		}
	}
}

func TestFindCompanionContentPayloadsLooksPastASystemPackage(t *testing.T) {
	// os.ReadDir is ordered by name and rips ship Kinect/speech packages beside the install
	// package; "Database.xmplr" sorts ahead of "GTA5INSTALL". The first package read must not
	// decide where the payload belongs.
	root := t.TempDir()
	payloadDir := filepath.Join(root, "Disc1", "Content", "0000000000000000", ContentPlaceholderTitleID, "00000002")
	writeStfsContentPackage(t, filepath.Join(payloadDir, "Database.xmplr"), SystemTitleID, 0x00000002)
	writeStfsContentPackage(t, filepath.Join(payloadDir, "GTA5INSTALL"), "545408A7", 0x00000002)

	payloads := FindCompanionContentPayloads(root, filepath.Join(root, "Disc2"))

	if len(payloads) != 1 {
		t.Fatalf("esperado 1 payload, obtido %d: %+v", len(payloads), payloads)
	}
	if payloads[0].TitleID != "545408A7" {
		t.Errorf("TitleID: esperado %q, obtido %q", "545408A7", payloads[0].TitleID)
	}
}
