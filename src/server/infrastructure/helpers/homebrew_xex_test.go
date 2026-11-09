package helpers

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindXEXFolderFallsBackToSingleHomebrewXEX(t *testing.T) {
	tmp := t.TempDir()
	xexContent := []byte("XEX2_SNES360_BINARY")
	if err := os.WriteFile(filepath.Join(tmp, "Snes360.xex"), xexContent, 0644); err != nil {
		t.Fatalf("failed to write Snes360.xex: %v", err)
	}

	got := FindXEXFolder(tmp)
	if got != tmp {
		t.Fatalf("expected FindXEXFolder to return %q, got %q", tmp, got)
	}

	// Verify default.xex was created with identical content
	defPath := filepath.Join(tmp, "default.xex")
	data, err := os.ReadFile(defPath)
	if err != nil {
		t.Fatalf("expected default.xex to be created in %q: %v", tmp, err)
	}
	if string(data) != string(xexContent) {
		t.Fatalf("default.xex content mismatch, got %q, want %q", string(data), string(xexContent))
	}
}

func TestFindXEXFolderPrefersShallowestHomebrewXEX(t *testing.T) {
	tmp := t.TempDir()
	rootXex := []byte("ROOT_MAME_XEX")
	if err := os.WriteFile(filepath.Join(tmp, "mame_0.72.xex"), rootXex, 0644); err != nil {
		t.Fatalf("failed to write mame_0.72.xex: %v", err)
	}

	deepDir := filepath.Join(tmp, "mame_src_fix", "sub")
	if err := os.MkdirAll(deepDir, 0755); err != nil {
		t.Fatalf("failed to mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(deepDir, "deep.xex"), []byte("DEEP_XEX"), 0644); err != nil {
		t.Fatalf("failed to write deep.xex: %v", err)
	}

	got := FindXEXFolder(tmp)
	if got != tmp {
		t.Fatalf("expected shallowest folder %q, got %q", tmp, got)
	}

	defPath := filepath.Join(tmp, "default.xex")
	data, err := os.ReadFile(defPath)
	if err != nil {
		t.Fatalf("expected default.xex in root: %v", err)
	}
	if string(data) != string(rootXex) {
		t.Fatalf("default.xex should match rootXex, got %q", string(data))
	}
}

func TestFindXEXFolderPrefersNamedHomebrewOverCores(t *testing.T) {
	tmp := t.TempDir()
	retroDir := filepath.Join(tmp, "Retroarch-360")
	if err := os.MkdirAll(retroDir, 0755); err != nil {
		t.Fatalf("failed to mkdir: %v", err)
	}

	coreXex := []byte("NINTENDO_CORE")
	mainXex := []byte("RETROARCH_MAIN")
	if err := os.WriteFile(filepath.Join(retroDir, "Nintendo.xex"), coreXex, 0644); err != nil {
		t.Fatalf("failed to write core: %v", err)
	}
	if err := os.WriteFile(filepath.Join(retroDir, "Retroarch.xex"), mainXex, 0644); err != nil {
		t.Fatalf("failed to write main: %v", err)
	}

	got := FindXEXFolder(tmp)
	if got != retroDir {
		t.Fatalf("expected %q, got %q", retroDir, got)
	}

	defPath := filepath.Join(retroDir, "default.xex")
	data, err := os.ReadFile(defPath)
	if err != nil {
		t.Fatalf("expected default.xex in retroDir: %v", err)
	}
	if string(data) != string(mainXex) {
		t.Fatalf("expected default.xex to match Retroarch.xex, got %q", string(data))
	}
}

func TestFindXEXFolderIgnoresPluginsWhenStandaloneExists(t *testing.T) {
	tmp := t.TempDir()
	pluginsDir := filepath.Join(tmp, "Plugins")
	if err := os.MkdirAll(pluginsDir, 0755); err != nil {
		t.Fatalf("failed to mkdir: %v", err)
	}

	if err := os.WriteFile(filepath.Join(pluginsDir, "FtpDll.xex"), []byte("FTP_DLL"), 0644); err != nil {
		t.Fatalf("failed to write plugin: %v", err)
	}
	fbaXex := []byte("FBA_NEXT_BINARY")
	if err := os.WriteFile(filepath.Join(tmp, "FBANext.xex"), fbaXex, 0644); err != nil {
		t.Fatalf("failed to write FBANext.xex: %v", err)
	}

	got := FindXEXFolder(tmp)
	if got != tmp {
		t.Fatalf("expected %q, got %q", tmp, got)
	}

	defPath := filepath.Join(tmp, "default.xex")
	data, err := os.ReadFile(defPath)
	if err != nil {
		t.Fatalf("expected default.xex in root: %v", err)
	}
	if string(data) != string(fbaXex) {
		t.Fatalf("expected default.xex to match FBANext.xex, got %q", string(data))
	}
}

func TestFindXEXFolderReturnsEmptyWhenNoXEX(t *testing.T) {
	tmp := t.TempDir()
	if err := os.WriteFile(filepath.Join(tmp, "xenon.elf"), []byte("XELL_ELF"), 0644); err != nil {
		t.Fatalf("failed to write elf: %v", err)
	}

	got := FindXEXFolder(tmp)
	if got != "" {
		t.Fatalf("expected empty result for elf only, got %q", got)
	}
	if _, err := os.Stat(filepath.Join(tmp, "default.xex")); !os.IsNotExist(err) {
		t.Fatalf("default.xex should not have been created")
	}
}

func TestFindXEXFolderDoesNotTouchExistingDefaultXEX(t *testing.T) {
	tmp := t.TempDir()
	origDef := []byte("ORIGINAL_DEFAULT_XEX")
	if err := os.WriteFile(filepath.Join(tmp, "default.xex"), origDef, 0644); err != nil {
		t.Fatalf("failed to write default.xex: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "other.xex"), []byte("OTHER_XEX"), 0644); err != nil {
		t.Fatalf("failed to write other.xex: %v", err)
	}

	got := FindXEXFolder(tmp)
	if got != tmp {
		t.Fatalf("expected %q, got %q", tmp, got)
	}

	data, err := os.ReadFile(filepath.Join(tmp, "default.xex"))
	if err != nil {
		t.Fatalf("failed to read default.xex: %v", err)
	}
	if string(data) != string(origDef) {
		t.Fatalf("existing default.xex modified!")
	}
}

