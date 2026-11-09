package pipeline

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"godsend/app"
	"godsend/infrastructure/download"
	"godsend/models"
)

// createMinimalXEX2 builds a minimal 64-byte buffer with a valid XEX2 signature and execution info.
func createMinimalXEX2(titleID uint32) []byte {
	xex := make([]byte, 64)
	copy(xex, "XEX2")
	binary.BigEndian.PutUint32(xex[20:], 1)          // 1 optional header
	binary.BigEndian.PutUint32(xex[24:], 0x00040006) // execution info header ID
	binary.BigEndian.PutUint32(xex[28:], 32)         // header offset
	binary.BigEndian.PutUint32(xex[32+12:], titleID) // Title ID
	return xex
}

// buildZipArchive creates an in-memory zip file from a map of relative path -> content.
func buildZipArchive(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("failed to create zip entry %s: %v", name, err)
		}
		if _, err := w.Write(content); err != nil {
			t.Fatalf("failed to write zip content %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("failed to close zip writer: %v", err)
	}
	return buf.Bytes()
}

// TestHuggingFaceE2E_HomebrewEmulatorInstallation verifies the entire end-to-end pipeline:
// downloading an emulator zip containing a custom .xex (Snes360.xex), extracting it,
// applying the fallback that creates default.xex, and atomically installing to the local USB drive.
func TestHuggingFaceE2E_HomebrewEmulatorInstallation(t *testing.T) {
	snesZipData := buildZipArchive(t, map[string][]byte{
		"Snes360.xex":               createMinimalXEX2(0x00000000),
		"Roms/SuperMarioWorld.smc":  []byte("SNES_ROM_BINARY_DATA"),
		"skin/background.png":       []byte("PNG_HEADER_DATA"),
	})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		http.ServeContent(w, r, "snes.zip", time.Time{}, bytes.NewReader(snesZipData))
	}))
	defer ts.Close()

	a := app.NewApp()
	a.TempDir = t.TempDir()
	a.ToolsDir = t.TempDir()
	dlSvc := &download.Service{App: a}
	svc := &Service{
		App:      a,
		Download: dlSvc,
	}

	usbRoot := t.TempDir()
	gameName := "Emulador Super Nintendo + 3247 ROMS ( XBOX 360 RGH )"
	a.XboxConnections.Store(gameName, models.XboxConnection{
		Mode:      "local",
		LocalRoot: usbRoot,
	})

	downloadURL := ts.URL + "/Emulador_Super_Nintendo.zip"
	err := svc.ProcessHuggingFaceGameWithErr(gameName, downloadURL)
	if err != nil {
		t.Fatalf("expected successful end-to-end installation, got error: %v", err)
	}

	gamesDir := filepath.Join(usbRoot, "Games")
	entries, err := os.ReadDir(gamesDir)
	if err != nil {
		t.Fatalf("Games directory not found in usbRoot: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("expected at least one installed game folder in %s", gamesDir)
	}

	installedFolder := filepath.Join(gamesDir, entries[0].Name())

	// 1. Verify default.xex was created by the homebrew fallback
	defaultXEX := filepath.Join(installedFolder, "default.xex")
	if info, err := os.Stat(defaultXEX); err != nil || info.Size() == 0 {
		t.Fatalf("default.xex was not created in %s: %v", installedFolder, err)
	}

	// 2. Verify original custom .xex exists
	snesXEX := filepath.Join(installedFolder, "Snes360.xex")
	if info, err := os.Stat(snesXEX); err != nil || info.Size() == 0 {
		t.Fatalf("Snes360.xex was not preserved in %s: %v", installedFolder, err)
	}

	// 3. Verify ROMs are in place
	romPath := filepath.Join(installedFolder, "Roms", "SuperMarioWorld.smc")
	if data, err := os.ReadFile(romPath); err != nil || string(data) != "SNES_ROM_BINARY_DATA" {
		t.Fatalf("ROM data not preserved in %s: %v", romPath, err)
	}

	// 4. Verify installation marker was cleaned up
	marker := filepath.Join(installedFolder, ".xbox-companion-installing")
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("temporary installation marker .xbox-companion-installing was not removed: %v", err)
	}
}

// TestHuggingFaceE2E_BlockedKnownBadURL verifies that known corrupted/incompatible
// releases are rejected immediately without performing any download.
func TestHuggingFaceE2E_BlockedKnownBadURL(t *testing.T) {
	a := app.NewApp()
	a.TempDir = t.TempDir()
	dlSvc := &download.Service{App: a}
	svc := &Service{
		App:      a,
		Download: dlSvc,
	}

	gameName := "BOMBA PATCH 2023 PARA O PES 17 - ATT.AGOSTO ( XBOX 360 RGH )"
	badURL := "https://huggingface.co/datasets/luisluis123/xboxrghgames/resolve/main/BOMBA%20PATCH%202023%20PARA%20O%20PES%2017%20-%20ATT.AGOSTO%20%28%20XBOX%20360%20RGH%20%29.zip"

	err := svc.ProcessHuggingFaceGameWithErr(gameName, badURL)
	if err == nil {
		t.Fatalf("expected error for known bad HuggingFace release, got nil")
	}
	if !strings.Contains(err.Error(), "pacote HuggingFace corrompido ou incompativel") {
		t.Fatalf("expected corrupted package error, got: %v", err)
	}
}

// TestHuggingFaceE2E_IncompatibleXeLLELFPackage verifies that an archive containing
// only XeLL ELF executables (.elf) is rejected with an explicit diagnostic message.
func TestHuggingFaceE2E_IncompatibleXeLLELFPackage(t *testing.T) {
	elfZipData := buildZipArchive(t, map[string][]byte{
		"xenon.elf":          []byte("ELF_BINARY_DATA"),
		"ROMS/sm64.z64":      []byte("N64_ROM_DATA"),
		"mupen64-360/cfg":   []byte("CFG_DATA"),
	})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		http.ServeContent(w, r, "n64.zip", time.Time{}, bytes.NewReader(elfZipData))
	}))
	defer ts.Close()

	a := app.NewApp()
	a.TempDir = t.TempDir()
	a.ToolsDir = t.TempDir()
	dlSvc := &download.Service{App: a}
	svc := &Service{
		App:      a,
		Download: dlSvc,
	}

	usbRoot := t.TempDir()
	gameName := "Emulador Nintendo N64 MUPEN Test"
	a.XboxConnections.Store(gameName, models.XboxConnection{
		Mode:      "local",
		LocalRoot: usbRoot,
	})

	err := svc.ProcessHuggingFaceGameWithErr(gameName, ts.URL+"/n64.zip")
	if err == nil {
		t.Fatalf("expected error for XeLL ELF release, got nil")
	}
	if !strings.Contains(err.Error(), "XeLL ELF (xenon.elf)") {
		t.Fatalf("expected error message to mention XeLL ELF, got: %v", err)
	}
}

// TestHuggingFaceE2E_CorruptedNestedArchivePackage verifies that an archive containing
// an unextracted inner .rar file is rejected with an explicit diagnostic message.
func TestHuggingFaceE2E_CorruptedNestedArchivePackage(t *testing.T) {
	rarZipData := buildZipArchive(t, map[string][]byte{
		"inner_archive.rar": []byte("Rar!\x1a\x07\x01\x00FAKE_RAR_DATA"),
		"leia-me.txt":       []byte("Instrucoes"),
	})

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/zip")
		http.ServeContent(w, r, "fake.zip", time.Time{}, bytes.NewReader(rarZipData))
	}))
	defer ts.Close()

	a := app.NewApp()
	a.TempDir = t.TempDir()
	a.ToolsDir = t.TempDir()
	dlSvc := &download.Service{App: a}
	svc := &Service{
		App:      a,
		Download: dlSvc,
	}

	usbRoot := t.TempDir()
	gameName := "Fake Nested Archive Test"
	a.XboxConnections.Store(gameName, models.XboxConnection{
		Mode:      "local",
		LocalRoot: usbRoot,
	})

	err := svc.ProcessHuggingFaceGameWithErr(gameName, ts.URL+"/fake.zip")
	if err == nil {
		t.Fatalf("expected error for nested archive release, got nil")
	}
	if !strings.Contains(err.Error(), "arquivo compactado aninhado (inner_archive.rar)") {
		t.Fatalf("expected error message to mention nested archive, got: %v", err)
	}
}
