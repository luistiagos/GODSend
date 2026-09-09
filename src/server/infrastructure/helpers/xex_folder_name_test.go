// xex_folder_name_test.go — XEXFolderName keeps two titles that ship the same generic
// archive folder ("Disc2") from resolving to the same install destination.
package helpers

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeStfsPackage creates a synthetic STFS container (magic + TitleID at 0x360),
// the layout ParseXboxHeader reads.
func writeStfsPackage(t *testing.T, path, titleID string) {
	t.Helper()
	raw, err := hex.DecodeString(titleID)
	if err != nil {
		t.Fatalf("TitleID inválido %q: %v", titleID, err)
	}
	buf := make([]byte, 0x400)
	copy(buf[0:4], "PIRS")
	copy(buf[0x360:0x364], raw)
	if err := os.WriteFile(path, buf, 0o644); err != nil {
		t.Fatalf("gravar %s: %v", path, err)
	}
}

func TestXEXFolderNameSeparatesMultiDiscRips(t *testing.T) {
	// Both Forza Motorsport 3 and GTA 5 ship their second disc as a top-level "Disc2"
	// folder, so the archive folder name alone points both installs at one destination.
	fm3 := filepath.Join(t.TempDir(), "Disc2")
	gta5 := filepath.Join(t.TempDir(), "Disc2")
	for _, dir := range []string{fm3, gta5} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatalf("criar %s: %v", dir, err)
		}
	}
	writeStfsPackage(t, filepath.Join(fm3, "nxeart"), "4D53084D")
	writeStfsPackage(t, filepath.Join(gta5, "nxeart"), "545408A7")

	fm3Name := XEXFolderName(fm3, "Disc2")
	gta5Name := XEXFolderName(gta5, "Disc2")

	if fm3Name != "Disc2 - 4D53084D" {
		t.Errorf("Forza Motorsport 3: esperado %q, obtido %q", "Disc2 - 4D53084D", fm3Name)
	}
	if gta5Name != "Disc2 - 545408A7" {
		t.Errorf("GTA 5: esperado %q, obtido %q", "Disc2 - 545408A7", gta5Name)
	}
	if fm3Name == gta5Name {
		t.Fatalf("dois jogos diferentes resolveram para o mesmo destino: %q", fm3Name)
	}
}

func TestXEXFolderNameDoesNotDuplicateExistingTitleID(t *testing.T) {
	dir := t.TempDir()
	writeStfsPackage(t, filepath.Join(dir, "nxeart"), "4D5307E6")

	if got := XEXFolderName(dir, "Halo 3 - 4D5307E6"); got != "Halo 3 - 4D5307E6" {
		t.Errorf("esperado nome inalterado, obtido %q", got)
	}
}

func TestXEXFolderNameKeepsNameWhenTitleIDUnknown(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "leiame.txt"), []byte("sem cabeçalho Xbox"), 0o644); err != nil {
		t.Fatalf("gravar arquivo: %v", err)
	}

	if got := XEXFolderName(dir, "Jogo Sem TitleID"); got != "Jogo Sem TitleID" {
		t.Errorf("esperado nome inalterado, obtido %q", got)
	}
}

func TestXEXFolderNameIgnoresSystemTitleID(t *testing.T) {
	// Kinect and speech packages bundled inside a game are signed under the system title, and
	// FindTitleIDInDir walks lexically — "Database.xmplr" sorts ahead of "default.xex". Using
	// that ID would name the folder something the installed-games scan discards.
	dir := t.TempDir()
	writeStfsPackage(t, filepath.Join(dir, "Database.xmplr"), SystemTitleID)

	if got := XEXFolderName(dir, "Jogo Com Kinect"); got != "Jogo Com Kinect" {
		t.Errorf("esperado nome sem sufixo de sistema, obtido %q", got)
	}
}

func TestXEXFolderNameFitsFATXNameLimit(t *testing.T) {
	dir := t.TempDir()
	writeStfsPackage(t, filepath.Join(dir, "nxeart"), "4D53084D")

	long := "Forza.Horizon.2.Presents.Fast.&.Furious.USA.X360-ZTM"
	got := XEXFolderName(dir, long)

	if len([]rune(got)) > fatxMaxNameLen {
		t.Errorf("nome com %d caracteres excede o limite FATX de %d: %q", len([]rune(got)), fatxMaxNameLen, got)
	}
	if !strings.HasSuffix(got, " - 4D53084D") {
		t.Errorf("o TitleID tem de sobreviver ao corte, obtido %q", got)
	}
	// O corte não pode deixar espaço ou ponto antes do sufixo: o Windows os descarta em
	// nomes de pasta, e o destino deixaria de bater com o nome registrado.
	base := strings.TrimSuffix(got, " - 4D53084D")
	if base != strings.TrimRight(base, " .") {
		t.Errorf("nome cortado terminou em espaço ou ponto: %q", got)
	}
}

func TestXEXFolderNameKeepsShortNamesIntact(t *testing.T) {
	dir := t.TempDir()
	writeStfsPackage(t, filepath.Join(dir, "nxeart"), "545408A7")

	if got := XEXFolderName(dir, "Disc2"); got != "Disc2 - 545408A7" {
		t.Errorf("nome curto não deve ser cortado, obtido %q", got)
	}
}
