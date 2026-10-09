package pipeline

import (
	"errors"
	"os"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"godsend/app"
	"godsend/models"
)

func TestFATDirentCount(t *testing.T) {
	for name, want := range map[string]int{
		"DATA0000":    1,
		"data0000":    1,
		"default.xex": 1,
		"desktop.ini": 1,
		"Data0000":    2, // base com caixa mista precisa de nome longo
		"README.Txt":  2,
		".hidden":     2,
		"a b.txt":     2,
		"a+b.txt":     2,
		"árvore.txt":  2,
		"two.dots.x":  2,
		"ninechars.x": 2,
		"face_40110_0_0_0_0_0_0_0_0_textures.rx3":                     4, // 39 caracteres
		"face_100000_0_0_0_0_0_0_0_0_textures.rx3":                    5, // 40 caracteres
		"face_40110_0_0_0_0_0_0_0_0_textures.rx3.xbox-companion-part": 6, // 59 caracteres
		"3A5F09C1.TMP": 1, // o temporario da staging
	} {
		if got := fatDirentCount(name); got != want {
			t.Errorf("fatDirentCount(%q) = %d, esperado %d", name, got, want)
		}
	}
}

func TestLocalManifestChildrenListsFilesAndSubfolders(t *testing.T) {
	dstDir := filepath.Join("E:\\", "Games", "Jogo")
	entries := []localCopyEntry{
		{relativePath: filepath.Join("data", "faces", "Face_1.rx3")},
		{relativePath: filepath.Join("data", "faces", "face_2.rx3")},
		{relativePath: "default.xex"},
	}
	children := localManifestChildren(dstDir, entries)
	if got := children[filepath.Join(dstDir, "data", "faces")]; len(got) != 2 || got["face_1.rx3"] != "Face_1.rx3" {
		t.Fatalf("pasta faces: %v", got)
	}
	if got := children[filepath.Join(dstDir, "data")]; len(got) != 1 || got["faces"] != "faces" {
		t.Fatalf("pasta data deveria conter so a subpasta faces: %v", got)
	}
	if got := children[dstDir]; len(got) != 2 || got["data"] != "data" || got["default.xex"] != "default.xex" {
		t.Fatalf("raiz do jogo: %v", got)
	}
}

// fatRecoveryFixture monta um jogo com uma pasta "faces" que ja tem arquivo de
// uma gravacao anterior e um arquivo alheio, e troca o detector de FAT e a
// copia por versoes que injetam ERROR_CANNOT_MAKE num arquivo.
func fatRecoveryFixture(t *testing.T, failures func(name string, call int) bool) (*Service, string, string, string, map[string]int) {
	t.Helper()
	if runtime.GOOS != "windows" {
		t.Skip("ERROR_CANNOT_MAKE so existe no Windows")
	}
	source := filepath.Join(t.TempDir(), "source")
	for rel, body := range map[string]string{
		filepath.Join("aaa", "first.bin"):  "first",
		filepath.Join("faces", "a.bin"):    "face-a",
		filepath.Join("faces", "b.bin"):    "face-b",
		filepath.Join("faces", "c.bin"):    "face-c",
		filepath.Join("other", "last.bin"): "last",
	} {
		path := filepath.Join(source, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0644); err != nil {
			t.Fatal(err)
		}
	}
	root := filepath.Join(t.TempDir(), "usb")
	destination := filepath.Join(root, "Games", "Jogo")
	faces := filepath.Join(destination, "faces")
	if err := os.MkdirAll(faces, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(faces, "a.bin"), []byte("face-a"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(faces, "alheio.txt"), []byte("nao e do jogo"), 0644); err != nil {
		t.Fatal(err)
	}

	calls := make(map[string]int)
	previousFAT, previousCopy := localIsFATVolume, copyLocalEntryFunc
	t.Cleanup(func() { localIsFATVolume, copyLocalEntryFunc = previousFAT, previousCopy })
	localIsFATVolume = func(string) bool { return true }
	copyLocalEntryFunc = func(entry *localCopyEntry, root, dst string, onProgress func(int64)) error {
		name := filepath.ToSlash(entry.relativePath)
		calls[name]++
		if failures(name, calls[name]) {
			return &os.LinkError{Op: "rename", Old: localStagingPath(root, dst), New: dst, Err: fatErrorCannotMake}
		}
		return copyLocalEntry(entry, root, dst, onProgress)
	}

	deviceID, err := PrepareLocalDevice(root)
	if err != nil {
		t.Fatal(err)
	}
	a := app.NewApp()
	a.XboxConnections.Store("Jogo", models.XboxConnection{Mode: "local", LocalRoot: root, LocalDeviceID: deviceID})
	return &Service{App: a}, source, destination, root, calls
}

// Pasta FAT32 que ja chegou ao teto com buracos (pendrive de quem pegou o erro
// antes da 2.12.110): o 82 faz o laco apagar os arquivos do jogo nessa pasta e
// regrava-la desde o primeiro arquivo dela, uma vez. Repetir o mesmo arquivo
// nunca resolveria.
func TestCopyTreeLocalRebuildsSaturatedFATFolderOnce(t *testing.T) {
	service, source, destination, root, calls := fatRecoveryFixture(t, func(name string, call int) bool {
		return name == "faces/c.bin" && call == 1
	})
	if err := service.copyTreeLocal(source, destination, root, "Jogo", "XEX"); err != nil {
		t.Fatalf("a pasta deveria ser reorganizada e a gravacao concluir: %v", err)
	}
	want := map[string]int{
		"aaa/first.bin":  1, // fora da pasta: so reconferido por hash
		"faces/a.bin":    1, // ja estava certo, mas foi apagado na reorganizacao
		"faces/b.bin":    2,
		"faces/c.bin":    2,
		"other/last.bin": 1,
	}
	for name, n := range want {
		if calls[name] != n {
			t.Errorf("%s copiado %d vezes, esperado %d (chamadas: %v)", name, calls[name], n, calls)
		}
	}
	for rel, body := range map[string]string{"faces/a.bin": "face-a", "faces/b.bin": "face-b", "faces/c.bin": "face-c", "other/last.bin": "last"} {
		got, err := os.ReadFile(filepath.Join(destination, filepath.FromSlash(rel)))
		if err != nil || string(got) != body {
			t.Fatalf("%s: %q, err=%v", rel, got, err)
		}
	}
	if _, err := os.Stat(filepath.Join(destination, "faces", "alheio.txt")); err != nil {
		t.Fatalf("arquivo que nao e do jogo nao pode ser apagado: %v", err)
	}
}

func TestCopyTreeLocalGivesUpWhenRebuiltFATFolderStillFull(t *testing.T) {
	service, source, destination, root, calls := fatRecoveryFixture(t, func(name string, _ int) bool {
		return name == "faces/c.bin"
	})
	err := service.copyTreeLocal(source, destination, root, "Jogo", "XEX")
	if err == nil {
		t.Fatal("82 depois da reorganizacao deveria encerrar com erro")
	}
	if !errors.Is(err, ErrLocalDelivery) || !strings.Contains(err.Error(), "depois de reorganizada") {
		t.Fatalf("erro inesperado: %v", err)
	}
	if calls["faces/c.bin"] != 2 {
		t.Fatalf("a pasta deveria ser reorganizada uma unica vez; c.bin tentado %d vezes", calls["faces/c.bin"])
	}
}

// A pasta faces do EA FC 26 cabe como nomes finais (58.494 entradas); a mesma
// forma com nomes mais longos nao cabe e e recusada antes de gravar.
func TestCheckFATDirectoryLimits(t *testing.T) {
	dstDir := filepath.Join("E:\\", "Games", "Jogo")
	faces := filepath.Join(dstDir, "data", "sceneassets", "faces")
	var entries []localCopyEntry
	for _, name := range fatFacesNamesForTest() {
		entries = append(entries, localCopyEntry{relativePath: filepath.Join("data", "sceneassets", "faces", name)})
	}
	children := localManifestChildren(dstDir, entries)
	if need := fatFolderEntriesNeeded(children[faces]); need != 58494 {
		t.Fatalf("faces deveria precisar de 58.494 entradas, contou %d", need)
	}
	if err := checkFATDirectoryLimits(dstDir, children); err != nil {
		t.Fatalf("faces cabe como nomes finais: %v", err)
	}

	for i := 0; i < 1600; i++ { // +1.600 nomes de 5 entradas = 66.494
		children[faces][fmt.Sprintf("face_9%05d_extra", i)] = fmt.Sprintf("face_9%05d_0_0_0_0_0_0_0_0_textures.rx3", i)
	}
	err := checkFATDirectoryLimits(dstDir, children)
	if !errors.Is(err, ErrFAT32DirectoryLimit) {
		t.Fatalf("esperava ErrFAT32DirectoryLimit, veio %v", err)
	}
	if !strings.Contains(err.Error(), "data/sceneassets/faces") || !strings.Contains(err.Error(), "66494") {
		t.Fatalf("a mensagem deve nomear a pasta e a contagem: %v", err)
	}
	// O limite troca de provedor (ISO/GOD) em vez de parar a cadeia como falha de hardware.
	wrapped := fmt.Errorf("Gravação local: %w", err)
	if !isFAT32LimitError(wrapped) || isLocalStorageHalt(wrapped) {
		t.Fatalf("limite de entradas deve alternar para ISO/GOD, nao interromper: %v", wrapped)
	}
}

func fatFacesNamesForTest() []string {
	names := make([]string, 0, 13146)
	for i := 10000; i < 10000+7238; i++ {
		names = append(names, fmt.Sprintf("face_%d_0_0_0_0_0_0_0_0_textures.rx3", i))
	}
	for i := 100000; i < 100000+5908; i++ {
		names = append(names, fmt.Sprintf("face_%d_0_0_0_0_0_0_0_0_textures.rx3", i))
	}
	return names
}

// copyTreeLocal recusa a pasta grande demais antes de criar qualquer coisa no destino.
func TestCopyTreeLocalRejectsOversizedFATFolderBeforeWriting(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source", "big")
	if err := os.MkdirAll(source, 0755); err != nil {
		t.Fatal(err)
	}
	long := strings.Repeat("n", 190) // 1 + ceil(194/13) = 16 entradas cada
	for i := 0; i < 4200; i++ {      // 4.200 * 16 + 2 = 67.202
		if err := os.WriteFile(filepath.Join(source, fmt.Sprintf("%s%04d", long, i)), nil, 0644); err != nil {
			t.Fatal(err)
		}
	}
	previousFAT := localIsFATVolume
	t.Cleanup(func() { localIsFATVolume = previousFAT })
	localIsFATVolume = func(string) bool { return true }

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
	destination := filepath.Join(root, "Games", "Jogo")
	err = (&Service{App: a}).copyTreeLocal(filepath.Dir(source), destination, root, "Jogo", "XEX")
	if !errors.Is(err, ErrFAT32DirectoryLimit) {
		t.Fatalf("esperava ErrFAT32DirectoryLimit, veio %v", err)
	}
	if _, statErr := os.Stat(destination); !os.IsNotExist(statErr) {
		t.Fatalf("nada deveria ser criado no destino antes da recusa; err=%v", statErr)
	}
}

func TestLocalWriteErrorTextTranslatesCannotMake(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("ERROR_CANNOT_MAKE so existe no Windows")
	}
	err := &os.LinkError{Op: "rename", Old: "a", New: "b", Err: fatErrorCannotMake}
	text := localWriteErrorText(err)
	if strings.Contains(text, "cannot be created") || !strings.Contains(text, "65.536 entradas do FAT32") {
		t.Fatalf("erro 82 deveria aparecer em portugues com a causa: %q", text)
	}
	if other := errors.New("disk exploded"); localWriteErrorText(other) != "disk exploded" {
		t.Fatal("outros erros passam como estao")
	}
}
