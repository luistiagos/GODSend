package utils

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
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

// TestCompanionDiscFoldersFindsTheInstallDiscNestedInTheGame mirrors the ZTM release of GTA V:
// the playable disc (2 of 2) at the top, the install disc (1 of 2) in a folder called "Disc2".
func TestCompanionDiscFoldersFindsTheInstallDiscNestedInTheGame(t *testing.T) {
	game := filepath.Join(t.TempDir(), "Grand.Theft.Auto.5.EUR.X360-ZTM")
	writeDiscXEX(t, game, 0x545408A7, 2)
	installDisc := filepath.Join(game, "Disc2")
	writeDiscXEX(t, installDisc, 0x545408A7, 1)

	got := CompanionDiscFolders(game)
	if len(got) != 1 || got[0] != installDisc {
		t.Fatalf("esperava só %s, veio %v", installDisc, got)
	}
	if !WithinAnyDir(filepath.Join(installDisc, "content", "0000000000000000"), got) {
		t.Error("o conteúdo do disco aninhado deveria estar dentro dele")
	}
	if WithinAnyDir(filepath.Join(game, "sfx"), got) {
		t.Error("uma pasta do próprio jogo não é outro disco")
	}
}

// TestCompanionDiscFoldersIgnoresWhatIsNotAnotherDisc: a nested executable of another title or
// of the same disc stays part of the folder, as it always was.
func TestCompanionDiscFoldersIgnoresWhatIsNotAnotherDisc(t *testing.T) {
	game := filepath.Join(t.TempDir(), "Game")
	writeDiscXEX(t, game, 0x4D5307E6, 1)
	writeDiscXEX(t, filepath.Join(game, "Bonus"), 0x4D530919, 2)  // another title
	writeDiscXEX(t, filepath.Join(game, "Launcher"), 0x4D5307E6, 1) // same disc

	if got := CompanionDiscFolders(game); len(got) != 0 {
		t.Fatalf("nada deveria ser tratado como outro disco: %v", got)
	}
	if got := CompanionDiscFolders(filepath.Join(t.TempDir(), "sem-xex")); len(got) != 0 {
		t.Fatalf("pasta sem default.xex: %v", got)
	}
}
