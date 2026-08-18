package pipeline

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"godsend/app"
	"godsend/models"
)

func TestLikelyLocalDeviceErrorRecognizesWindowsDisconnect(t *testing.T) {
	err := errors.New("write F:\\Games\\Data0021: A device which does not exist was specified.")
	if !isLikelyLocalDeviceError(err) {
		t.Fatalf("erro real de desconexao nao foi reconhecido: %v", err)
	}
	if isLikelyLocalDeviceError(errors.New("ISO header is invalid")) {
		t.Fatal("erro de conversao nao deve ser tratado como desconexao")
	}
}

func TestLikelyLocalStorageError(t *testing.T) {
	for _, message := range []string{
		"write file: There is not enough space on the disk.",
		"open output: access is denied",
		"sync output: data error (cyclic redundancy check)",
	} {
		if !isLikelyLocalStorageError(errors.New(message)) {
			t.Fatalf("erro de armazenamento nao reconhecido: %q", message)
		}
	}
	if isLikelyLocalStorageError(errors.New("invalid ISO header")) {
		t.Fatal("erro de conteudo nao deve ser classificado como armazenamento")
	}
}

func TestCopyTreeLocalReusesGoodFilesAndRepairsInterruptedFile(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source")
	rootParent := t.TempDir()
	defer os.RemoveAll(rootParent)
	root := filepath.Join(rootParent, "usb")
	destination := filepath.Join(root, "Games", "Example")
	if err := os.MkdirAll(source, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "Data0000"), []byte("already-complete"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "Data0001"), []byte("must-be-repaired"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(destination, 0755); err != nil {
		t.Fatal(err)
	}
	good := filepath.Join(destination, "Data0000")
	bad := filepath.Join(destination, "Data0001")
	if err := os.WriteFile(good, []byte("already-complete"), 0644); err != nil {
		t.Fatal(err)
	}
	originalTime := time.Unix(1_600_000_000, 0)
	if err := os.Chtimes(good, originalTime, originalTime); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bad, []byte("truncated"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bad+".xbox-companion-part", []byte("partial"), 0644); err != nil {
		t.Fatal(err)
	}

	deviceID, err := PrepareLocalDevice(root)
	if err != nil {
		t.Fatal(err)
	}
	a := app.NewApp()
	a.XboxConnections.Store("Example", models.XboxConnection{
		Mode: "local", LocalRoot: root, LocalDeviceID: deviceID,
	})
	service := &Service{App: a}
	if err := service.copyTreeLocal(source, destination, root, "Example", "GOD"); err != nil {
		t.Fatal(err)
	}

	goodStat, err := os.Stat(good)
	if err != nil {
		t.Fatal(err)
	}
	if !goodStat.ModTime().Equal(originalTime) {
		t.Fatalf("arquivo integro foi regravado: modtime=%s", goodStat.ModTime())
	}
	contents, err := os.ReadFile(bad)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "must-be-repaired" {
		t.Fatalf("arquivo interrompido nao foi reparado: %q", contents)
	}
	if _, err := os.Stat(bad + ".xbox-companion-part"); !os.IsNotExist(err) {
		t.Fatalf("arquivo parcial deveria ser removido; err=%v", err)
	}
}

func TestLocalDeviceIdentityRejectsReplacementAtSamePath(t *testing.T) {
	root := t.TempDir()
	id, err := PrepareLocalDevice(root)
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(root, filepath.FromSlash(localDeviceIdentityFile))
	if err := os.WriteFile(marker, []byte("different-device\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureLocalDeviceIdentity(root, id); err == nil {
		t.Fatal("esperava rejeicao do dispositivo substituto")
	}
	if err := os.RemoveAll(filepath.Join(root, ".xbox-downloader")); err != nil {
		t.Fatal(err)
	}
}

func TestWaitForLocalDeviceIgnoresWrongReplacementAndResumesSameDevice(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "usb")
	parked := filepath.Join(parent, "original-usb")
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	id, err := PrepareLocalDevice(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(root, parked); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareLocalDevice(root); err != nil {
		t.Fatal(err)
	}

	previousInterval := localDevicePollInterval
	localDevicePollInterval = 10 * time.Millisecond
	defer func() { localDevicePollInterval = previousInterval }()
	go func() {
		time.Sleep(40 * time.Millisecond)
		_ = os.RemoveAll(root)
		_ = os.Rename(parked, root)
	}()

	service := &Service{App: app.NewApp()}
	if err := service.waitForLocalDevice(root, id, "Example"); err != nil {
		t.Fatal(err)
	}
	if !localDeviceMatches(root, id) {
		t.Fatal("a retomada ocorreu antes do dispositivo original voltar")
	}
}

func TestLocalTorrentScratchIsPreservedUntilInstallReady(t *testing.T) {
	a := app.NewApp()
	a.TempDir = t.TempDir()
	gameName := "Example"
	torrentDir := filepath.Join(a.TempDir, "Example_torrent")
	if err := os.MkdirAll(torrentDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(torrentDir, "source.zip"), []byte("complete"), 0644); err != nil {
		t.Fatal(err)
	}
	connection := models.XboxConnection{Mode: "local", LocalRoot: t.TempDir()}
	a.XboxConnections.Store(gameName, connection)
	service := &Service{App: a}

	service.cleanupGameScratch(gameName)
	if _, err := os.Stat(torrentDir); err != nil {
		t.Fatalf("torrent local deveria ser preservado para retomada: %v", err)
	}
	service.cleanupTorrentScratchAfterRun(gameName, torrentDir, &connection)
	if _, err := os.Stat(torrentDir); err != nil {
		t.Fatalf("torrent nao deveria ser removido antes de Ready: %v", err)
	}

	a.JobQueue.Store(gameName, models.GameStatus{State: "Ready"})
	service.cleanupTorrentScratchAfterRun(gameName, torrentDir, &connection)
	if _, err := os.Stat(torrentDir); !os.IsNotExist(err) {
		t.Fatalf("torrent deveria ser removido apos sucesso; err=%v", err)
	}
}

func TestLocalStageScratchIsPreservedUntilInstallReady(t *testing.T) {
	a := app.NewApp()
	service := &Service{App: a}
	gameName := "Stage Example"
	root := t.TempDir()
	stage := filepath.Join(root, "Stage Example_ext")
	if err := os.MkdirAll(stage, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stage, "file.bin"), []byte("data"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stageCheckpointPath(stage), []byte("checkpoint"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stageSourceMarkerPath(stage), []byte("source"), 0644); err != nil {
		t.Fatal(err)
	}
	connection := &models.XboxConnection{Mode: "local", LocalRoot: root}
	a.JobQueue.Store(gameName, models.GameStatus{State: "Error"})
	service.cleanupStageAfterRun(gameName, stage, connection)
	if _, err := os.Stat(stage); err != nil {
		t.Fatalf("stage nao deveria ser removido antes de Ready: %v", err)
	}
	a.JobQueue.Store(gameName, models.GameStatus{State: "Ready"})
	service.cleanupStageAfterRun(gameName, stage, connection)
	for _, path := range []string{stage, stageCheckpointPath(stage), stageSourceMarkerPath(stage)} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("artefato deveria ser removido depois de Ready: %s (%v)", path, err)
		}
	}
}
