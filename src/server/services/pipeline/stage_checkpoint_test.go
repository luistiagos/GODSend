package pipeline

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"godsend/app"
	"godsend/models"
)

func TestDirectoryStageResumesAndSkipsValidatedCheckpoint(t *testing.T) {
	root := t.TempDir()
	defer os.RemoveAll(root)
	source := filepath.Join(root, "source.zip")
	dest := filepath.Join(root, "extracted")
	if err := os.WriteFile(source, []byte("archive-source"), 0644); err != nil {
		t.Fatal(err)
	}
	service := &Service{App: app.NewApp()}
	calls := 0
	action := func() error {
		calls++
		if err := os.MkdirAll(dest, 0755); err != nil {
			return err
		}
		if calls == 1 {
			if err := os.WriteFile(filepath.Join(dest, "first.bin"), []byte("first"), 0644); err != nil {
				return err
			}
			return errors.New("interrupcao simulada")
		}
		if err := os.WriteFile(filepath.Join(dest, "first.bin"), []byte("first"), 0644); err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dest, "second.bin"), []byte("second"), 0644)
	}

	if err := service.runDirectoryStage("Example", "extract-test", source, dest, false, action); err == nil {
		t.Fatal("a primeira fase interrompida deveria falhar")
	}
	if _, err := os.Stat(filepath.Join(dest, "first.bin")); err != nil {
		t.Fatalf("arquivo completo da tentativa interrompida nao foi preservado: %v", err)
	}
	if err := service.runDirectoryStage("Example", "extract-test", source, dest, false, action); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("fase deveria ter executado duas vezes, executou %d", calls)
	}
	if err := service.runDirectoryStage("Example", "extract-test", source, dest, false, action); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("checkpoint valido nao foi reutilizado; chamadas=%d", calls)
	}

	if err := os.WriteFile(filepath.Join(dest, "second.bin"), []byte("damage"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := service.runDirectoryStage("Example", "extract-test", source, dest, false, action); err != nil {
		t.Fatal(err)
	}
	if calls != 3 {
		t.Fatalf("checkpoint corrompido deveria refazer a fase; chamadas=%d", calls)
	}
}

func TestDirectoryStageKeepsLocalSourceOnStorageFailure(t *testing.T) {
	root := t.TempDir()
	defer os.RemoveAll(root)
	source := filepath.Join(root, "source.zip")
	dest := filepath.Join(root, "extracted")
	if err := os.WriteFile(source, []byte("archive-source"), 0644); err != nil {
		t.Fatal(err)
	}
	service := &Service{App: app.NewApp()}
	service.App.XboxConnections.Store("Example", models.XboxConnection{Mode: "local", LocalRoot: root})
	err := service.runDirectoryStage("Example", "extract-test", source, dest, false, func() error {
		return errors.New("write output: There is not enough space on the disk.")
	})
	if !errors.Is(err, ErrLocalDelivery) {
		t.Fatalf("falha de armazenamento local deve preservar a fonte: %v", err)
	}
	if _, statErr := os.Stat(source); statErr != nil {
		t.Fatalf("fonte foi perdida depois da falha local: %v", statErr)
	}
}

func TestDirectoryStageClearsResidueWhenSourceChanges(t *testing.T) {
	root := t.TempDir()
	defer os.RemoveAll(root)
	source := filepath.Join(root, "source.zip")
	dest := filepath.Join(root, "extracted")
	if err := os.WriteFile(source, []byte("source-one"), 0644); err != nil {
		t.Fatal(err)
	}
	service := &Service{App: app.NewApp()}
	firstErr := service.runDirectoryStage("Example", "extract-test", source, dest, false, func() error {
		if err := os.WriteFile(filepath.Join(dest, "stale.bin"), []byte("stale"), 0644); err != nil {
			return err
		}
		return errors.New("interrupcao simulada")
	})
	if firstErr == nil {
		t.Fatal("a primeira fonte deveria ser interrompida")
	}
	if err := os.WriteFile(source, []byte("source-two-with-different-size"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := service.runDirectoryStage("Example", "extract-test", source, dest, false, func() error {
		if _, err := os.Stat(filepath.Join(dest, "stale.bin")); !os.IsNotExist(err) {
			return errors.New("residuo da fonte anterior nao foi removido")
		}
		return os.WriteFile(filepath.Join(dest, "fresh.bin"), []byte("fresh"), 0644)
	}); err != nil {
		t.Fatal(err)
	}
}
