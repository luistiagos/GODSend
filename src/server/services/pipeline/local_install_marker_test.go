package pipeline

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"godsend/app"
	"godsend/models"
)

// docs/bugs/open/pipeline-jogo-com-gravacao-interrompida-aparece-como-instalado-e-baixado_2026-10-09T19-30.md
func newMarkerTestCopy(t *testing.T, files map[string]string) (*Service, string, string, string) {
	t.Helper()
	source := filepath.Join(t.TempDir(), "source")
	for rel, body := range files {
		path := filepath.Join(source, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	root := filepath.Join(t.TempDir(), "usb")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	deviceID, err := PrepareLocalDevice(root)
	if err != nil {
		t.Fatal(err)
	}
	a := app.NewApp()
	a.XboxConnections.Store("Jogo", models.XboxConnection{Mode: "local", LocalRoot: root, LocalDeviceID: deviceID})
	destination := filepath.Join(root, "Games", "Jogo - 454109F4")
	return &Service{App: a}, source, root, destination
}

func TestCopyTreeLocalMarksFolderUntilLastFileAndWritesEntryPointsLast(t *testing.T) {
	service, source, root, destination := newMarkerTestCopy(t, map[string]string{
		"data/faces/face_1.rx3":         "face",
		"default.xex":                   "xex",
		"zzz.ini":                       "ini",
		"00007000/ABCDEF":               "header",
		"00007000/ABCDEF.data/Data0000": "data0",
		"00007000/ABCDEF.data/Data0001": "data1",
	})
	marker := filepath.Join(destination, installInProgressMarker)
	var order []string
	original := copyLocalEntryFunc
	defer func() { copyLocalEntryFunc = original }()
	copyLocalEntryFunc = func(entry *localCopyEntry, root, dst string, onProgress func(int64)) error {
		if _, err := os.Stat(marker); err != nil {
			t.Errorf("gravando %s sem a marca de instalacao em andamento: %v", entry.relativePath, err)
		}
		order = append(order, filepath.ToSlash(entry.relativePath))
		return original(entry, root, dst, onProgress)
	}

	if err := service.copyTreeLocal(source, destination, root, "Jogo", "XEX"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("marca deveria sumir quando a gravacao termina; err=%v", err)
	}
	if len(order) != 6 {
		t.Fatalf("esperava 6 arquivos gravados, veio %v", order)
	}
	last := map[string]bool{order[4]: true, order[5]: true}
	if !last["default.xex"] || !last["00007000/ABCDEF"] {
		t.Fatalf("default.xex e o cabecalho GOD tem de ser os ultimos; ordem=%v", order)
	}
}

func TestCopyTreeLocalKeepsMarkerWhenCopyFails(t *testing.T) {
	service, source, root, destination := newMarkerTestCopy(t, map[string]string{
		"data/a.bin":  "a",
		"data/b.bin":  "b",
		"default.xex": "xex",
	})
	original := copyLocalEntryFunc
	defer func() { copyLocalEntryFunc = original }()
	copyLocalEntryFunc = func(entry *localCopyEntry, root, dst string, onProgress func(int64)) error {
		if filepath.Base(entry.relativePath) == "b.bin" {
			return fmt.Errorf("%w: simulado", ErrFAT32FileSizeLimit)
		}
		return original(entry, root, dst, onProgress)
	}

	if err := service.copyTreeLocal(source, destination, root, "Jogo", "XEX"); err == nil {
		t.Fatal("a gravacao simulada deveria falhar")
	}
	if _, err := os.Stat(filepath.Join(destination, installInProgressMarker)); err != nil {
		t.Fatalf("copia interrompida tem de manter a marca: %v", err)
	}
	if _, err := os.Stat(filepath.Join(destination, "default.xex")); !os.IsNotExist(err) {
		t.Fatalf("default.xex nao pode ter sido gravado antes do resto do jogo; err=%v", err)
	}

	// Nova tentativa que completa: a marca some.
	copyLocalEntryFunc = original
	if err := service.copyTreeLocal(source, destination, root, "Jogo", "XEX"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(destination, installInProgressMarker)); !os.IsNotExist(err) {
		t.Fatalf("marca deveria sumir na tentativa que completa; err=%v", err)
	}
}
