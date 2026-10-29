// nested_disc_test.go — the ZTM release of Grand Theft Auto V keeps its install disc (1 of 2)
// in a folder named "Disc2" inside the playable disc (2 of 2). Lexical order put the installer
// first, so it was taken for the game and its four install packages were never found.
package helpers

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"

	"godsend/utils"
)

// writeDiscXEX writes a default.xex whose execution-info header names titleID and disc.
func writeDiscXEX(t *testing.T, dir string, titleID uint32, disc byte) {
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

// writeZTMStyleGTAV lays the release out the way the archive really ships it.
func writeZTMStyleGTAV(t *testing.T, extDir string) (game, installDisc string) {
	t.Helper()
	game = filepath.Join(extDir, "Grand.Theft.Auto.5.EUR.X360-ZTM")
	writeDiscXEX(t, game, 0x545408A7, 2)
	installDisc = filepath.Join(game, "Disc2")
	writeDiscXEX(t, installDisc, 0x545408A7, 1)
	writeStfsContentPackage(t,
		filepath.Join(installDisc, "content", "0000000000000000", "545408A7", "00000002", "545408A700000000"),
		"545408A7", 0x00000002)
	return game, installDisc
}

func TestFindXEXFolderPrefersThePlayableDiscOverANestedInstallDisc(t *testing.T) {
	extDir := t.TempDir()
	game, _ := writeZTMStyleGTAV(t, extDir)

	if got := FindXEXFolder(extDir); got != game {
		t.Fatalf("o jogo é o disco 2 na raiz da release; veio %s", got)
	}
}

func TestFindXEXFolderPrefersThePlayableDiscOverASiblingInstallDisc(t *testing.T) {
	extDir := t.TempDir()
	writeDiscXEX(t, filepath.Join(extDir, "Disc1"), 0x545408A7, 1)
	game := filepath.Join(extDir, "Disc2")
	writeDiscXEX(t, game, 0x545408A7, 2)

	if got := FindXEXFolder(extDir); got != game {
		t.Fatalf("o disco de instalação vem antes em ordem alfabética, mas não é o jogo; veio %s", got)
	}
}

func TestFindXEXFolderKeepsTheFirstFolderWhenNothingIsAnInstallDisc(t *testing.T) {
	extDir := t.TempDir()
	first := filepath.Join(extDir, "A")
	writeDiscXEX(t, first, 0x4D5307E6, 1)
	writeDiscXEX(t, filepath.Join(extDir, "B"), 0x4D5307E6, 2)

	if got := FindXEXFolder(extDir); got != first {
		t.Fatalf("sem disco de instalação conhecido, a escolha continua sendo a primeira; veio %s", got)
	}
}

// TestSiblingDiscFoldersFindsTheOtherPlayableDisc mirrors "Mass Effect 2 + PT-BR + DLC": both
// playable discs side by side in one archive, and only the first was ever installed.
func TestSiblingDiscFoldersFindsTheOtherPlayableDisc(t *testing.T) {
	extDir := t.TempDir()
	release := filepath.Join(extDir, "Mass Effect 2 + PT-BR + DLC", "MASS EFFECT 2")
	writeDiscXEX(t, filepath.Join(release, "DISCO 1"), 0x454108CE, 1)
	disc2 := filepath.Join(release, "DISCO 2")
	writeDiscXEX(t, disc2, 0x454108CE, 2)

	game := FindXEXFolder(extDir)
	if game != filepath.Join(release, "DISCO 1") {
		t.Fatalf("o jogo escolhido continua sendo o DISCO 1; veio %s", game)
	}
	if got := SiblingDiscFolders(extDir, game); len(got) != 1 || got[0] != disc2 {
		t.Fatalf("esperava só %s, veio %v", disc2, got)
	}
}

// TestSiblingDiscFoldersIgnoresWhatIsNotAnotherDisc: another title, a second copy of the game's
// own disc, and a second folder for a disc already found are not discs to install.
func TestSiblingDiscFoldersIgnoresWhatIsNotAnotherDisc(t *testing.T) {
	extDir := t.TempDir()
	game := filepath.Join(extDir, "A", "Disc 1")
	writeDiscXEX(t, game, 0x454108CE, 1)
	writeDiscXEX(t, filepath.Join(extDir, "A", "Bonus"), 0x4D530919, 2)    // another title
	writeDiscXEX(t, filepath.Join(extDir, "A", "Launcher"), 0x454108CE, 1) // same disc
	disc2 := filepath.Join(extDir, "B", "Disc 2")
	writeDiscXEX(t, disc2, 0x454108CE, 2)
	writeDiscXEX(t, filepath.Join(extDir, "C", "Disc 2"), 0x454108CE, 2) // disc 2 again

	if got := SiblingDiscFolders(extDir, game); len(got) != 1 || got[0] != disc2 {
		t.Fatalf("esperava só %s, veio %v", disc2, got)
	}
	if got := SiblingDiscFolders(extDir, filepath.Join(extDir, "sem-xex")); len(got) != 0 {
		t.Fatalf("pasta sem default.xex: %v", got)
	}
}

// TestSiblingDiscFoldersLeavesTheNestedInstallDiscToContent: the ZTM install disc of GTA V is
// not a game folder of its own, and stays out of the copy of the game as before.
func TestSiblingDiscFoldersLeavesTheNestedInstallDiscToContent(t *testing.T) {
	extDir := t.TempDir()
	game, installDisc := writeZTMStyleGTAV(t, extDir)

	if got := SiblingDiscFolders(extDir, game); len(got) != 0 {
		t.Fatalf("o disco de instalação vira Content, não pasta de jogo: %v", got)
	}
	if got := utils.CompanionDiscFolders(game); len(got) != 1 || got[0] != installDisc {
		t.Fatalf("o disco aninhado deveria continuar fora da cópia do jogo: %v", got)
	}
}

func TestFindCompanionContentPayloadsLooksInsideANestedInstallDisc(t *testing.T) {
	extDir := t.TempDir()
	game, installDisc := writeZTMStyleGTAV(t, extDir)

	payloads := FindCompanionContentPayloads(extDir, game)
	if len(payloads) != 1 {
		t.Fatalf("esperava o pacote do disco 1 aninhado, veio %+v", payloads)
	}
	want := filepath.Join(installDisc, "content", "0000000000000000", "545408A7", "00000002")
	if payloads[0].Dir != want || payloads[0].TitleID != "545408A7" || payloads[0].TypeDir != "00000002" {
		t.Fatalf("payload errado: %+v", payloads[0])
	}
}
