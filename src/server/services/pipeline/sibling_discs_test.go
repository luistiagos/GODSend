// sibling_discs_test.go — "Mass Effect 2 + PT-BR + DLC" ships both playable discs side by side
// in one archive. Only "DISCO 1" was written, and the console asked for a disc 2 the user did
// not have.
package pipeline

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godsend/infrastructure/helpers"
)

const massEffect2TitleID = 0x454108CE

func writeMassEffect2Release(t *testing.T, extDir string) (disc1, disc2 string) {
	t.Helper()
	release := filepath.Join(extDir, "Mass Effect 2 + PT-BR + DLC", "MASS EFFECT 2")
	disc1 = filepath.Join(release, "DISCO 1")
	disc2 = filepath.Join(release, "DISCO 2")
	writeXEXDisc(t, disc1, massEffect2TitleID, 1)
	writeXEXDisc(t, disc2, massEffect2TitleID, 2)
	return disc1, disc2
}

func TestInstallSiblingDiscsWritesTheSecondPlayableDiscToItsOwnFolder(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	disc1, _ := writeMassEffect2Release(t, extDir)
	root := t.TempDir()

	if xexFolder := helpers.FindXEXFolder(extDir); xexFolder != disc1 {
		t.Fatalf("o disco principal é o DISCO 1; veio %s", xexFolder)
	}
	if err := s.installSiblingDiscs("Mass Effect 2 + PT-BR + DLC", extDir, disc1, "Mass Effect 2 + PT-BR + DLC - 454108CE", localDestination(root)); err != nil {
		t.Fatalf("Disco 2 não gravado: %v", err)
	}

	games, err := os.ReadDir(filepath.Join(root, "Games"))
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 {
		t.Fatalf("só o Disco 2 é gravado aqui (o Disco 1 segue pelo caminho de sempre); veio %d pastas", len(games))
	}
	name := games[0].Name()
	if !strings.HasSuffix(name, " - Disco 2 - 454108CE") || len([]rune(name)) > 42 {
		t.Errorf("pasta do Disco 2 = %q; quer \"<release> - Disco 2 - 454108CE\" em até 42 caracteres", name)
	}
	if name == xexDestinationName(disc1, ripFolderName(disc1, extDir), "Mass Effect 2 + PT-BR + DLC") {
		t.Errorf("o Disco 2 iria para a mesma pasta do Disco 1: %q", name)
	}
	if _, err := os.Stat(filepath.Join(root, "Games", name, "default.xex")); err != nil {
		t.Errorf("default.xex do Disco 2 não está no destino: %v", err)
	}
	if _, warned := s.App.IncompleteRelease.Load("Mass Effect 2 + PT-BR + DLC"); warned {
		t.Error("com destino os dois discos vão; não há o que avisar")
	}
}

func TestInstallSiblingDiscsWarnsWhenTheManualPackageCannotCarryTheSecondDisc(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	disc1, _ := writeMassEffect2Release(t, extDir)

	if err := s.installSiblingDiscs("Mass Effect 2 + PT-BR + DLC", extDir, disc1, "Mass Effect 2 + PT-BR + DLC - 454108CE", nil); err != nil {
		t.Fatalf("sem destino não há o que falhar: %v", err)
	}
	warning, ok := s.App.IncompleteRelease.Load("Mass Effect 2 + PT-BR + DLC")
	if !ok || !strings.Contains(warning.(string), "Disco 2") {
		t.Errorf("o pacote manual leva só o Disco 1 e tem de dizer isso; aviso = %v", warning)
	}
}

func TestInstallSiblingDiscsDoesNothingForASingleDiscRip(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	game := filepath.Join(extDir, "Halo 3")
	writeXEXDisc(t, game, 0x4D5307E6, 1)
	root := t.TempDir()

	if err := s.installSiblingDiscs("Halo 3", extDir, game, "Halo 3 - 4D5307E6", localDestination(root)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "Games")); !os.IsNotExist(err) {
		t.Errorf("rip de um disco não grava nada a mais: %v", err)
	}
}

func writeFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// fakeDestinationFree makes the destination report free bytes beyond the safety margin.
func fakeDestinationFree(t *testing.T, free uint64) {
	t.Helper()
	previous := destinationFreeSpaceBytes
	destinationFreeSpaceBytes = func(string) (uint64, error) { return localSpaceMargin + free, nil }
	t.Cleanup(func() { destinationFreeSpaceBytes = previous })
}

// Each synthetic default.xex has 64 bytes: 100 free holds one disc, not both.
func TestInstallSiblingDiscsRefusesBeforeWritingWhenOnlyOneDiscFits(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	disc1, _ := writeMassEffect2Release(t, extDir)
	root := t.TempDir()
	fakeDestinationFree(t, 100)

	err := s.installSiblingDiscs("Mass Effect 2 + PT-BR + DLC", extDir, disc1, "Mass Effect 2 + PT-BR + DLC - 454108CE", localDestination(root))
	if !errors.Is(err, ErrLocalDelivery) {
		t.Fatalf("os dois discos não cabem; quer ErrLocalDelivery, veio %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "Games")); !os.IsNotExist(statErr) {
		t.Errorf("o Disco 2 foi gravado antes de faltar espaço para o Disco 1: %v", statErr)
	}
}

func TestInstallSiblingDiscsCountsTheMainDiscAlreadyOnTheDevice(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	disc1, _ := writeMassEffect2Release(t, extDir)
	root := t.TempDir()
	mainFolder := "Mass Effect 2 + PT-BR + DLC - 454108CE"
	xex, err := os.ReadFile(filepath.Join(disc1, "default.xex"))
	if err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(root, "Games", mainFolder, "default.xex"), xex)
	fakeDestinationFree(t, 100)

	if err := s.installSiblingDiscs("Mass Effect 2 + PT-BR + DLC", extDir, disc1, mainFolder, localDestination(root)); err != nil {
		t.Fatalf("o Disco 1 já está no destino (retomada) e só o Disco 2 falta gravar: %v", err)
	}
}

func TestInstallSiblingDiscsStopsBeforeTheSecondDiscWhenTheMainOneExceedsFAT32(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	disc1, _ := writeMassEffect2Release(t, extDir)
	writeFile(t, filepath.Join(disc1, "big.bin"), make([]byte, 2000))
	root := t.TempDir()
	previousFAT, previousLimit := localIsFATVolume, fat32FileSizeLimit
	localIsFATVolume = func(string) bool { return true }
	fat32FileSizeLimit = 1000
	t.Cleanup(func() { localIsFATVolume, fat32FileSizeLimit = previousFAT, previousLimit })

	err := s.installSiblingDiscs("Mass Effect 2 + PT-BR + DLC", extDir, disc1, "Mass Effect 2 + PT-BR + DLC - 454108CE", localDestination(root))
	if !errors.Is(err, ErrFAT32FileSizeLimit) {
		t.Fatalf("o Disco 1 não cabe no FAT32; quer ErrFAT32FileSizeLimit (troca de provedor), veio %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(root, "Games")); !os.IsNotExist(statErr) {
		t.Errorf("o Disco 2 ficou no pendrive de uma entrega que vai para outro provedor: %v", statErr)
	}
}
