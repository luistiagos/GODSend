package pipeline

import (
	"archive/zip"
	"encoding/binary"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godsend/app"
	"godsend/models"
)

func buildSTFSPackage(t *testing.T, magic, titleID string, contentType uint32, bodySize int) []byte {
	t.Helper()
	rawTID, err := hex.DecodeString(titleID)
	if err != nil {
		t.Fatalf("TitleID inválido %q: %v", titleID, err)
	}
	buf := make([]byte, 0x400+bodySize)
	copy(buf[0:4], magic)
	binary.BigEndian.PutUint32(buf[0x344:], contentType)
	copy(buf[0x360:0x364], rawTID)
	return buf
}

func writeZipFile(t *testing.T, dest string, files map[string][]byte) string {
	t.Helper()
	f, err := os.Create(dest)
	if err != nil {
		t.Fatalf("criar zip %s: %v", dest, err)
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	for name, data := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("criar entrada %s: %v", name, err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatalf("gravar entrada %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("fechar zip %s: %v", dest, err)
	}
	return dest
}

func TestCollectDigitalContentPackagesCollectsAllContainersAndPreservesTypes(t *testing.T) {
	extDir := t.TempDir()
	// Simula pacote de DLC + TU como ocorre em Call of Duty: Black Ops II (415608C3),
	// alem de arquivos auxiliares (.txt/.nfo/.jpg) que devem ser ignorados.
	files := map[string][]byte{
		"readme.txt": []byte("info"),
		"cover.jpg":  make([]byte, 0x500),
		"Content/0000000000000000/415608C3/00000002/415608C300000001": buildSTFSPackage(t, "LIVE", "415608C3", 0x00000002, 512),
		"Content/0000000000000000/415608C3/00000002/415608C300000002": buildSTFSPackage(t, "PIRS", "415608C3", 0x00000002, 1024),
		"Content/0000000000000000/415608C3/000B0000/tu00000018_00000000": buildSTFSPackage(t, "CON ", "415608C3", 0x000B0000, 256),
	}
	for rel, data := range files {
		p := filepath.Join(extDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, data, 0o644); err != nil {
			t.Fatal(err)
		}
	}

	got := collectDigitalContentPackages(extDir)
	if len(got) != 3 {
		t.Fatalf("esperado 3 containers STFS coletados, obtido %d: %+v", len(got), got)
	}

	byName := map[string]digitalContentPackage{}
	for _, pkg := range got {
		byName[filepath.Base(pkg.path)] = pkg
	}
	if byName["415608C300000001"].typeDir != "00000002" || byName["415608C300000001"].titleID != "415608C3" {
		t.Errorf("DLC 1 classificada incorretamente: %+v", byName["415608C300000001"])
	}
	if byName["415608C300000002"].typeDir != "00000002" || byName["415608C300000002"].titleID != "415608C3" {
		t.Errorf("DLC 2 classificada incorretamente: %+v", byName["415608C300000002"])
	}
	if byName["tu00000018_00000000"].typeDir != "000B0000" || byName["tu00000018_00000000"].titleID != "415608C3" {
		t.Errorf("TU classificada incorretamente: %+v", byName["tu00000018_00000000"])
	}
}

func TestDeliverDigitalContentInstallsAllSTFSPackagesLocally(t *testing.T) {
	a := app.NewApp()
	a.TempDir = t.TempDir()
	a.ToolsDir = t.TempDir()
	s := &Service{App: a}

	gameName := "Call of Duty - Black Ops II (World) (415608C3) (Addon)"
	safeName := "Call_of_Duty_-_Black_Ops_II_World_415608C3_Addon"
	archivePath := writeZipFile(t, filepath.Join(t.TempDir(), "bo2_dlc.zip"), map[string][]byte{
		"Content/0000000000000000/415608C3/00000002/415608C300000001":    buildSTFSPackage(t, "LIVE", "415608C3", 0x00000002, 512),
		"Content/0000000000000000/415608C3/00000002/415608C300000002":    buildSTFSPackage(t, "LIVE", "415608C3", 0x00000002, 768),
		"Content/0000000000000000/415608C3/000B0000/tu00000018_00000000": buildSTFSPackage(t, "PIRS", "415608C3", 0x000B0000, 256),
	})

	extDir := filepath.Join(a.TempDir, safeName+"_ext")
	if err := s.extractArchiveResilient(gameName, archivePath, extDir); err != nil {
		t.Fatalf("extracao falhou: %v", err)
	}

	usbRoot := t.TempDir()
	gameDir := filepath.Join(a.GetReadyDir(), safeName)
	_ = os.MkdirAll(gameDir, 0o755)
	conn := &models.XboxConnection{Mode: "local", LocalRoot: usbRoot}

	if err := s.deliverDigitalContent(gameName, safeName, gameDir, extDir, conn, "Digital", "No valid Xbox content found in archive"); err != nil {
		t.Fatalf("deliverDigitalContent falhou: %v", err)
	}

	wantFiles := []string{
		filepath.Join(usbRoot, "Content", "0000000000000000", "415608C3", "00000002", "415608C300000001"),
		filepath.Join(usbRoot, "Content", "0000000000000000", "415608C3", "00000002", "415608C300000002"),
		filepath.Join(usbRoot, "Content", "0000000000000000", "415608C3", "000B0000", "tu00000018_00000000"),
	}
	for _, path := range wantFiles {
		if info, err := os.Stat(path); err != nil || info.Size() < 0x400 {
			t.Errorf("arquivo STFS esperado em %s nao foi gravado: err=%v", path, err)
		}
	}
}

func TestDeliverDigitalContentManualModePreservesSingleRawAndPacksMultiple(t *testing.T) {
	t.Run("unico container mantem type=raw", func(t *testing.T) {
		a := app.NewApp()
		a.TempDir = t.TempDir()
		a.ToolsDir = t.TempDir()
		s := &Service{App: a}

		extDir := t.TempDir()
		pkgPath := filepath.Join(extDir, "415608C300000001")
		if err := os.WriteFile(pkgPath, buildSTFSPackage(t, "LIVE", "415608C3", 0x00000002, 512), 0o644); err != nil {
			t.Fatal(err)
		}

		gameName := "BO2 DLC Single"
		safeName := "BO2_DLC_Single"
		gameDir := filepath.Join(a.GetReadyDir(), safeName)
		_ = os.MkdirAll(gameDir, 0o755)

		if err := s.deliverDigitalContent(gameName, safeName, gameDir, extDir, nil, "Digital", "No valid Xbox content found in archive"); err != nil {
			t.Fatalf("deliverDigitalContent falhou: %v", err)
		}
		iniBytes, err := os.ReadFile(filepath.Join(gameDir, "godsend.ini"))
		if err != nil {
			t.Fatalf("godsend.ini ausente: %v", err)
		}
		ini := string(iniBytes)
		if !strings.Contains(ini, "type=raw") || !strings.Contains(ini, "filename=415608C300000001") {
			t.Errorf("godsend.ini inesperado para pacote unico:\n%s", ini)
		}
	})

	t.Run("multiplos containers empacotam todos via type=content", func(t *testing.T) {
		a := app.NewApp()
		a.TempDir = t.TempDir()
		a.ToolsDir = t.TempDir()
		s := &Service{App: a}

		extDir := t.TempDir()
		if err := os.WriteFile(filepath.Join(extDir, "dlc1"), buildSTFSPackage(t, "LIVE", "415608C3", 0x00000002, 512), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(extDir, "tu18"), buildSTFSPackage(t, "PIRS", "415608C3", 0x000B0000, 256), 0o644); err != nil {
			t.Fatal(err)
		}

		gameName := "BO2 DLC Pack"
		safeName := "BO2_DLC_Pack"
		gameDir := filepath.Join(a.GetReadyDir(), safeName)
		_ = os.MkdirAll(gameDir, 0o755)

		if err := s.deliverDigitalContent(gameName, safeName, gameDir, extDir, nil, "Minerva Digital", "No valid Xbox content found in Minerva archive"); err != nil {
			t.Fatalf("deliverDigitalContent falhou: %v", err)
		}
		iniBytes, err := os.ReadFile(filepath.Join(gameDir, "godsend.ini"))
		if err != nil {
			t.Fatalf("godsend.ini ausente: %v", err)
		}
		ini := string(iniBytes)
		if !strings.Contains(ini, "type=content") || !strings.Contains(ini, "BO2_DLC_Pack_Part1.7z") {
			t.Fatalf("godsend.ini inesperado para multiplos pacotes:\n%s", ini)
		}
		zr, err := zip.OpenReader(filepath.Join(gameDir, "BO2_DLC_Pack_Part1.7z"))
		if err != nil {
			t.Fatalf("abrir pacote zipado: %v", err)
		}
		defer zr.Close()
		entries := map[string]bool{}
		for _, f := range zr.File {
			entries[filepath.ToSlash(f.Name)] = true
		}
		if !entries["415608C3/00000002/dlc1"] || !entries["415608C3/000B0000/tu18"] {
			t.Errorf("zip nao preservou todos os pacotes e typeDirs: %+v", entries)
		}
	})
}

func TestDeliverDigitalContentChecksCombinedSpaceBeforeWritingLocally(t *testing.T) {
	a := app.NewApp()
	a.TempDir = t.TempDir()
	a.ToolsDir = t.TempDir()
	s := &Service{App: a}

	extDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(extDir, "dlc1"), buildSTFSPackage(t, "LIVE", "415608C3", 0x00000002, 512), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(extDir, "dlc2"), buildSTFSPackage(t, "LIVE", "415608C3", 0x00000002, 512), 0o644); err != nil {
		t.Fatal(err)
	}

	origFree := destinationFreeSpaceBytes
	destinationFreeSpaceBytes = func(string) (uint64, error) {
		return localSpaceMargin + 1000, nil // cabe 0 pacotes completos juntos
	}
	t.Cleanup(func() { destinationFreeSpaceBytes = origFree })

	usbRoot := t.TempDir()
	gameDir := filepath.Join(a.GetReadyDir(), "BO2_Space")
	_ = os.MkdirAll(gameDir, 0o755)
	conn := &models.XboxConnection{Mode: "local", LocalRoot: usbRoot}

	err := s.deliverDigitalContent("BO2 Space", "BO2_Space", gameDir, extDir, conn, "Digital", "No valid Xbox content found in archive")
	if err == nil || !strings.Contains(err.Error(), "espaço insuficiente") {
		t.Fatalf("esperado erro de espaco insuficiente antes de gravar, obtido %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(usbRoot, "Content", "0000000000000000", "415608C3")); !os.IsNotExist(statErr) {
		t.Errorf("nenhum arquivo deveria ter sido gravado quando a soma nao cabe (stat=%v)", statErr)
	}
}
