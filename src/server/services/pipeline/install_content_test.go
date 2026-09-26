// install_content_test.go — the playable disc of Grand Theft Auto V must not be delivered
// without the four packages its install disc writes. The catalog's "GTA 5" archive held only
// the playable disc; the job reported success and the console stopped on the loading screen.
package pipeline

import (
	"encoding/binary"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"godsend/app"
	"godsend/models"
)

const gtaVTitleID = 0x545408A7

var gtaVPackages = []string{"545408A700000000", "545408A700000001", "545408A700000002", "545408A700000003"}

func newInstallContentService(t *testing.T) *Service {
	t.Helper()
	a := app.NewApp()
	a.TempDir = t.TempDir()
	a.ToolsDir = t.TempDir()
	return &Service{App: a}
}

func localDestination(root string) *models.XboxConnection {
	return &models.XboxConnection{Mode: "local", LocalRoot: root}
}

func installContentDir(root string) string {
	return filepath.Join(root, "Content", "0000000000000000", "545408A7", "00000002")
}

// writePlayableDisc writes the folder FindXEXFolder hands to the XEX paths: a default.xex
// whose execution-info header carries titleID.
func writePlayableDisc(t *testing.T, dir string, titleID uint32) string {
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
	if err := os.WriteFile(filepath.Join(dir, "default.xex"), xex, 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// installPackageBytes builds an STFS package shaped like a retail one: the header names the
// parent title and content type, and declares the body the file has to carry.
func installPackageBytes(t *testing.T, titleID string, body int) []byte {
	t.Helper()
	raw, err := hex.DecodeString(titleID)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 0xB000+body)
	copy(buf, "LIVE")
	binary.BigEndian.PutUint32(buf[0x340:], 0xAD0E) // header size, rounds up to 0xB000
	binary.BigEndian.PutUint32(buf[0x344:], 0x00000002)
	binary.BigEndian.PutUint64(buf[0x34C:], uint64(body))
	copy(buf[0x360:], raw)
	binary.BigEndian.PutUint32(buf[0x395:], uint32(body/0x1000))
	return buf
}

func writeInstallPackage(t *testing.T, dir, name, titleID string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), installPackageBytes(t, titleID, 0x2000), 0o644); err != nil {
		t.Fatal(err)
	}
}

// writeGTAVInstallSet writes the named GTA V install packages into dir — all four by default.
func writeGTAVInstallSet(t *testing.T, dir string, names ...string) {
	t.Helper()
	if len(names) == 0 {
		names = gtaVPackages
	}
	for _, name := range names {
		writeInstallPackage(t, dir, name, "545408A7")
	}
}

func warningOf(s *Service, game string) string {
	value, _ := s.App.IncompleteRelease.Load(game)
	text, _ := value.(string)
	return text
}

func TestPlayableGTAVWithoutInstallDiscIsRejected(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	playable := writePlayableDisc(t, filepath.Join(extDir, "GTA 5 (7.61)"), gtaVTitleID)

	err := s.installCompanionDiscContent("GTA 5", extDir, playable, localDestination(t.TempDir()))

	if err == nil || !strings.Contains(err.Error(), "release incompleta") || !strings.Contains(err.Error(), "faltam 545408A700000000") {
		t.Fatalf("esperado release incompleta citando os pacotes ausentes, obtido %v", err)
	}
}

// TestInstallDiscIsNotHeldToItsOwnContent: the ISO paths run before the disc's role is known,
// and the content path passes the install disc's own package folder. Demanding the install
// content in either would make the one delivery that provides it impossible.
func TestInstallDiscIsNotHeldToItsOwnContent(t *testing.T) {
	s := newInstallContentService(t)
	game := "Grand Theft Auto V (Japan) (Disc 1) (Install)"

	isoExtDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(isoExtDir, "disc1.iso"), []byte("iso"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.installCompanionDiscContent(game, isoExtDir, "", localDestination(t.TempDir())); err != nil {
		t.Errorf("ISO do disco de instalação bloqueada antes de ser identificada: %v", err)
	}

	contentExt := t.TempDir()
	packages := filepath.Join(contentExt, "Content", "0000000000000000", "545408A7", "00000002")
	writeGTAVInstallSet(t, packages)
	if err := s.installCompanionDiscContent(game, contentExt, packages, localDestination(t.TempDir())); err != nil {
		t.Errorf("pacote de conteúdo do disco de instalação bloqueado: %v", err)
	}
}

// TestGTAVArchiveWithTheWholeReleaseIsDelivered: the replacement release carries the install
// disc under hdd1/content beside the playable folder.
func TestGTAVArchiveWithTheWholeReleaseIsDelivered(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	playable := writePlayableDisc(t, filepath.Join(extDir, "Grand.Theft.Auto.5.EUR.X360-ZTM"), gtaVTitleID)
	writeGTAVInstallSet(t, filepath.Join(extDir, "hdd1", "content", "0000000000000000", "545408A7", "00000002"))
	root := t.TempDir()
	s.App.IncompleteRelease.Store("GTA 5", "aviso anterior")

	if err := s.installCompanionDiscContent("GTA 5", extDir, playable, localDestination(root)); err != nil {
		t.Fatalf("release completa recusada: %v", err)
	}
	for _, name := range gtaVPackages {
		if _, err := os.Stat(filepath.Join(installContentDir(root), name)); err != nil {
			t.Errorf("pacote %s não gravado: %v", name, err)
		}
	}
	if w := warningOf(s, "GTA 5"); w != "" {
		t.Errorf("aviso mantido depois de gravar o Disco 1: %q", w)
	}
}

// TestIncompleteInstallSetInTheArchiveIsNotWritten: a partial set neither satisfies the
// requirement nor gets written over whatever the destination holds.
func TestIncompleteInstallSetInTheArchiveIsNotWritten(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	playable := writePlayableDisc(t, filepath.Join(extDir, "GTA5"), gtaVTitleID)
	writeGTAVInstallSet(t, filepath.Join(extDir, "hdd1", "Content", "0000000000000000", "545408A7", "00000002"), gtaVPackages[:3]...)
	root := t.TempDir()

	err := s.installCompanionDiscContent("GTA 5", extDir, playable, localDestination(root))

	if err == nil || !strings.Contains(err.Error(), "faltam 545408A700000000") {
		t.Fatalf("conjunto parcial aceito: %v", err)
	}
	if _, statErr := os.Stat(installContentDir(root)); !os.IsNotExist(statErr) {
		t.Errorf("conjunto parcial gravado no destino (stat: %v)", statErr)
	}
}

// TestForeignPayloadDoesNotStandInForTheInstallDisc: finding any payload used to be enough to
// report the release as complete.
func TestForeignPayloadDoesNotStandInForTheInstallDisc(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	playable := writePlayableDisc(t, filepath.Join(extDir, "GTA5"), gtaVTitleID)
	writeInstallPackage(t, filepath.Join(extDir, "Content", "0000000000000000", "4D5307D5", "00000002"), "4D5307D500000000", "4D5307D5")
	root := t.TempDir()
	s.App.IncompleteRelease.Store("GTA 5", "aviso anterior")

	err := s.installCompanionDiscContent("GTA 5", extDir, playable, localDestination(root))

	if err == nil || !strings.Contains(err.Error(), "release incompleta") {
		t.Fatalf("pacote de outro título aceito como Disco 1: %v", err)
	}
	if w := warningOf(s, "GTA 5"); w != "aviso anterior" {
		t.Errorf("aviso alterado por uma entrega recusada: %q", w)
	}
}

// TestDestinationMustHoldEveryValidInstallPackage: any file under the title's folder used to
// count as the install.
func TestDestinationMustHoldEveryValidInstallPackage(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(t *testing.T, dir string)
		want  string
	}{
		{"arquivo alheio", func(t *testing.T, dir string) {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "unrelated.txt"), nil, 0o644); err != nil {
				t.Fatal(err)
			}
		}, "faltam 545408A700000000, 545408A700000001, 545408A700000002, 545408A700000003"},
		{"conjunto parcial", func(t *testing.T, dir string) {
			writeGTAVInstallSet(t, dir, gtaVPackages[:3]...)
		}, "faltam 545408A700000003"},
		{"pacote de outro título", func(t *testing.T, dir string) {
			writeGTAVInstallSet(t, dir, gtaVPackages[:3]...)
			writeInstallPackage(t, dir, gtaVPackages[3], "4D5307D5")
		}, "545408A700000003 pertence ao TitleID 4D5307D5"},
		{"pacote truncado", func(t *testing.T, dir string) {
			writeGTAVInstallSet(t, dir)
			path := filepath.Join(dir, gtaVPackages[1])
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Truncate(path, info.Size()-1); err != nil {
				t.Fatal(err)
			}
		}, "545408A700000001 truncado"},
		{"conjunto completo", func(t *testing.T, dir string) {
			writeGTAVInstallSet(t, dir)
		}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := newInstallContentService(t)
			root := t.TempDir()
			tc.setup(t, installContentDir(root))

			err := s.requireInstallContent("GTA 5", gtaVTitleID, localDestination(root), nil)

			switch {
			case tc.want == "" && err != nil:
				t.Errorf("conjunto completo recusado: %v", err)
			case tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
				t.Errorf("esperado erro com %q, obtido %v", tc.want, err)
			}
		})
	}
}

// TestGTAIVIsNotHeldToGTAVInstallContent: the requirement follows the Title ID in the
// executable. The catalog name is never consulted, so neither GTA IV's own name nor a GTA IV
// rip listed as "GTA 5" inherits GTA V's install disc.
func TestGTAIVIsNotHeldToGTAVInstallContent(t *testing.T) {
	for _, game := range []string{"Grand Theft Auto IV (USA) (En,Fr,De,Es,It)", "GTA 5"} {
		s := newInstallContentService(t)
		extDir := t.TempDir()
		playable := writePlayableDisc(t, filepath.Join(extDir, "GTAIV"), 0x545407F2)

		if err := s.installCompanionDiscContent(game, extDir, playable, localDestination(t.TempDir())); err != nil {
			t.Errorf("%q: GTA IV recusado pelo requisito do GTA V: %v", game, err)
		}
	}
}

// TestPlayableDiscDefersToAQueuedInstallDisc: each disc of a Redump release is its own job and
// the jobs run in no fixed order, so the playable disc can come first.
func TestPlayableDiscDefersToAQueuedInstallDisc(t *testing.T) {
	s := newInstallContentService(t)
	play := "Grand Theft Auto V (Japan) (Disc 2) (Play)"
	install := "Grand Theft Auto V (Japan) (Disc 1) (Install)"
	root := t.TempDir()

	s.App.JobQueue.Store(install, models.GameStatus{State: "Queued"})
	if err := s.requireInstallContent(play, gtaVTitleID, localDestination(root), nil); err != nil {
		t.Fatalf("disco jogável recusado com o Disco 1 ainda na fila: %v", err)
	}
	if w := warningOf(s, play); !strings.Contains(w, install) {
		t.Errorf("aviso deve citar a tarefa do Disco 1, obtido %q", w)
	}

	s.App.JobQueue.Store(install, models.GameStatus{State: "Error"})
	if err := s.requireInstallContent(play, gtaVTitleID, localDestination(root), nil); err == nil {
		t.Error("disco jogável entregue depois que o Disco 1 falhou")
	}
}

// TestManualPackageWarnsThatTheInstallDiscIsLeftOut: without a destination the job packages
// the playable folder alone, so the warning has to stay even when the archive had the content.
func TestManualPackageWarnsThatTheInstallDiscIsLeftOut(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	playable := writePlayableDisc(t, filepath.Join(extDir, "GTA5"), gtaVTitleID)
	writeGTAVInstallSet(t, filepath.Join(extDir, "hdd1", "content", "0000000000000000", "545408A7", "00000002"))

	if err := s.installCompanionDiscContent("GTA 5", extDir, playable, nil); err != nil {
		t.Fatalf("pacote manual recusado: %v", err)
	}
	if w := warningOf(s, "GTA 5"); !strings.Contains(w, "pacote manual") {
		t.Errorf("aviso de pacote manual ausente, obtido %q", w)
	}
}

// TestUnreadableDestinationDeliversWithWarning: an unplugged drive says nothing about the
// install content; it has to reach the delivery's own device handling.
func TestUnreadableDestinationDeliversWithWarning(t *testing.T) {
	s := newInstallContentService(t)
	unplugged := localDestination(filepath.Join(t.TempDir(), "unplugged"))

	if err := s.requireInstallContent("GTA 5", gtaVTitleID, unplugged, nil); err != nil {
		t.Fatalf("destino ilegível tratado como release incompleta: %v", err)
	}
	if w := warningOf(s, "GTA 5"); !strings.Contains(w, "nao foi possivel conferir") {
		t.Errorf("aviso de conferência impossível ausente, obtido %q", w)
	}
}

// TestAnotherDriveAtTheDestinationIsNotRead: a different pendrive mounted at the same letter
// says nothing about the destination; the delivery waits for the right one on its own.
func TestAnotherDriveAtTheDestinationIsNotRead(t *testing.T) {
	s := newInstallContentService(t)
	root := t.TempDir()
	if _, err := PrepareLocalDevice(root); err != nil {
		t.Fatal(err)
	}
	conn := localDestination(root)
	conn.LocalDeviceID = "pendrive-do-usuario"

	if err := s.requireInstallContent("GTA 5", gtaVTitleID, conn, nil); err != nil {
		t.Fatalf("outro pendrive tratado como destino sem o Disco 1: %v", err)
	}
	if w := warningOf(s, "GTA 5"); !strings.Contains(w, "nao foi possivel conferir") {
		t.Errorf("aviso de conferência impossível ausente, obtido %q", w)
	}
}

// TestRepeatedInstallTreeIsWrittenOnce: a rip can carry the install tree twice — the disc's own
// and an "hdd1" copy — and each copy of GTA V's is about 8 GB.
func TestRepeatedInstallTreeIsWrittenOnce(t *testing.T) {
	s := newInstallContentService(t)
	extDir := t.TempDir()
	playable := writePlayableDisc(t, filepath.Join(extDir, "Disc1"), gtaVTitleID)
	writeGTAVInstallSet(t, filepath.Join(extDir, "Disc2", "content", "0000000000000000", "545408A7", "00000002"))
	second := filepath.Join(extDir, "hdd1", "content", "0000000000000000", "545408A7", "00000002")
	writeGTAVInstallSet(t, second)
	if err := os.WriteFile(filepath.Join(second, "copia-hdd1"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()

	if err := s.installCompanionDiscContent("GTA 5", extDir, playable, localDestination(root)); err != nil {
		t.Fatalf("release completa recusada: %v", err)
	}
	if _, err := os.Stat(filepath.Join(installContentDir(root), "copia-hdd1")); !os.IsNotExist(err) {
		t.Errorf("a segunda cópia do disco de instalação também foi gravada (stat: %v)", err)
	}
}

// TestPlayableGTAVISORequiresInstallContent: the ISO paths check once the disc is known to be
// the playable one, reading the Title ID from the disc's executable.
func TestPlayableGTAVISORequiresInstallContent(t *testing.T) {
	iso := buildAc4Disc2XexISO(t)
	image, err := os.ReadFile(iso)
	if err != nil {
		t.Fatal(err)
	}
	// buildAc4Disc2XexISO places default.xex at sector 0x22 with its execution info at +32.
	binary.BigEndian.PutUint32(image[0x22*2048+32+12:], gtaVTitleID)
	if err := os.WriteFile(iso, image, 0o644); err != nil {
		t.Fatal(err)
	}
	s := newInstallContentService(t)
	root := t.TempDir()
	game := "Grand Theft Auto V (World) (Disc 2) (Play)"

	if err := s.requireInstallContentForISO(game, iso, localDestination(root)); err == nil || !strings.Contains(err.Error(), "release incompleta") {
		t.Fatalf("ISO jogável entregue sem o Disco 1: %v", err)
	}
	writeGTAVInstallSet(t, installContentDir(root))
	if err := s.requireInstallContentForISO(game, iso, localDestination(root)); err != nil {
		t.Fatalf("ISO jogável recusada com o Disco 1 no destino: %v", err)
	}
}
