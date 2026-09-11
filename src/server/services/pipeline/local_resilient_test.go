package pipeline

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"syscall"
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

func TestOptimizedStreamingLocalCopyAndManifest(t *testing.T) {
	srcDir := filepath.Join(t.TempDir(), "src_game")
	if err := os.MkdirAll(filepath.Join(srcDir, "sub"), 0755); err != nil {
		t.Fatal(err)
	}
	f1 := filepath.Join(srcDir, "Data0000")
	f2 := filepath.Join(srcDir, "sub", "default.xex")
	if err := os.WriteFile(f1, []byte("large-test-data-block-123456789"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f2, []byte("xex-header-bytes-987654321"), 0644); err != nil {
		t.Fatal(err)
	}

	entries, totalSize, err := buildLocalCopyManifest(srcDir)
	if err != nil {
		t.Fatalf("buildLocalCopyManifest falhou: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("esperava 2 entradas, obteve %d", len(entries))
	}
	if totalSize != int64(len("large-test-data-block-123456789")+len("xex-header-bytes-987654321")) {
		t.Fatalf("totalSize incorreto: %d", totalSize)
	}
	for _, entry := range entries {
		if entry.sha256 != "" {
			t.Fatalf("manifesto deveria conter sha256 lazy (vazio) para evitar pre-leitura: %q", entry.sha256)
		}
	}

	destRoot := t.TempDir()
	deviceID, err := PrepareLocalDevice(destRoot)
	if err != nil {
		t.Fatal(err)
	}
	a := app.NewApp()
	a.XboxConnections.Store("StreamTest", models.XboxConnection{
		Mode: "local", LocalRoot: destRoot, LocalDeviceID: deviceID,
	})
	svc := &Service{App: a}
	targetDir := filepath.Join(destRoot, "Games", "StreamTest")
	if err := svc.copyTreeLocal(srcDir, targetDir, destRoot, "StreamTest", "GOD"); err != nil {
		t.Fatalf("copyTreeLocal falhou: %v", err)
	}

	out1, err := os.ReadFile(filepath.Join(targetDir, "Data0000"))
	if err != nil || string(out1) != "large-test-data-block-123456789" {
		t.Fatalf("arquivo Data0000 gravado incorretamente: %s, err: %v", out1, err)
	}
	out2, err := os.ReadFile(filepath.Join(targetDir, "sub", "default.xex"))
	if err != nil || string(out2) != "xex-header-bytes-987654321" {
		t.Fatalf("arquivo default.xex gravado incorretamente: %s, err: %v", out2, err)
	}

	// Test copyFileLocal
	singleSrc := filepath.Join(srcDir, "single.bin")
	if err := os.WriteFile(singleSrc, []byte("single-file-content"), 0644); err != nil {
		t.Fatal(err)
	}
	singleDst := filepath.Join(destRoot, "Content", "0000000000000000", "12345678", "00000002", "single.bin")
	if err := svc.copyFileLocal(singleSrc, singleDst, destRoot, "StreamTest", "Gravando..."); err != nil {
		t.Fatalf("copyFileLocal falhou: %v", err)
	}
	singleOut, err := os.ReadFile(singleDst)
	if err != nil || string(singleOut) != "single-file-content" {
		t.Fatalf("single.bin gravado incorretamente: %s, err: %v", singleOut, err)
	}
}

// Um socket abortado no Windows produz "The specified network name is no longer
// available.", que casa a lista de fragmentos de armazenamento. Antes disso ser
// filtrado, uma queda de conexao com o provedor virava ErrLocalDelivery e
// abortava a cadeia inteira de fallback em vez de cair no proximo provedor.
// Guarda do proprio discriminador. Testar a interface net.Error em vez destes
// tipos concretos passaria despercebido aqui e desligaria a classificacao de
// armazenamento inteira: no Windows syscall.Errno declara Timeout/Temporary,
// entao um *os.PathError de disco cheio TAMBEM satisfaz net.Error.
func TestIsNetworkErrorSeparatesDiskFromSocket(t *testing.T) {
	diskFull := fmt.Errorf("write at +1024: %w",
		&os.PathError{Op: "write", Path: "X", Err: syscall.Errno(112)})
	if isNetworkError(diskFull) {
		t.Fatalf("erro de disco foi tratado como erro de rede: %v", diskFull)
	}

	socket := fmt.Errorf("read after 512 bytes: %w",
		&net.OpError{Op: "read", Net: "tcp", Err: os.NewSyscallError("wsarecv", syscall.Errno(64))})
	if !isNetworkError(socket) {
		t.Fatalf("erro de socket nao foi reconhecido como rede: %v", socket)
	}
}

// O disco cheio real chega como *os.PathError vindo de out.WriteAt
// (`ia.go`: "write at +%d: %w"), nao como um errors.New de texto solto. Se o
// filtro de rede for largo demais, este erro deixa de interromper o job e a
// cadeia baixa mais gigabytes no mesmo disco cheio, sem telemetria.
func TestClassifyLocalStorageFailureStillHaltsOnRealDiskError(t *testing.T) {
	connection := &models.XboxConnection{Mode: "local"}
	diskFull := fmt.Errorf("write at +1024: %w", &os.PathError{
		Op:   "write",
		Path: "X",
		Err:  errors.New("There is not enough space on the disk."),
	})

	got := classifyLocalStorageFailure(connection, "download-http", diskFull)
	if !isLocalStorageHalt(got) {
		t.Fatalf("disco cheio real deixou de interromper o job: %v", got)
	}
	if !errors.Is(got, ErrLocalStaging) {
		t.Fatalf("disco cheio na fase de download deve apontar o disco do PC: %v", got)
	}
	// %v achatava o erro original em texto e deixava errors.Is cego para
	// qualquer sentinela abaixo — um cancelamento que carregasse uma palavra de
	// disco seria engolido como falha de armazenamento.
	var pathErr *os.PathError
	if !errors.As(got, &pathErr) {
		t.Fatalf("o erro original foi achatado em texto e deixou de ser inspecionavel: %v", got)
	}
}

func TestClassifyLocalStorageFailureIgnoresNetworkErrors(t *testing.T) {
	connection := &models.XboxConnection{Mode: "local"}
	netErr := &net.OpError{
		Op:  "read",
		Net: "tcp",
		Err: os.NewSyscallError("wsarecv", errors.New("The specified network name is no longer available.")),
	}
	wrapped := fmt.Errorf("read after 1024 bytes: %w", netErr)

	if !isLikelyLocalStorageError(wrapped) {
		t.Fatal("premissa do teste mudou: o texto deixou de casar a lista de fragmentos")
	}
	got := classifyLocalStorageFailure(connection, "download-http", wrapped)
	if errors.Is(got, ErrLocalDelivery) {
		t.Fatalf("erro de rede foi classificado como falha de dispositivo local: %v", got)
	}
	if got != wrapped {
		t.Fatalf("erro de rede deve passar intacto para o proximo provedor, veio: %v", got)
	}
}

// Nenhuma das fases de download/extracao/conversao grava no destino: todas
// rodam no TempDir do PC (outputRoot devolve s.App.TempDir para todas elas, e a
// conversao GOD e a que mais consome disco). A cadeia continua parando — outro
// provedor tambem nao cabe no mesmo disco — mas a mensagem tem de apontar o
// disco certo, em vez de mandar conferir o pendrive.
func TestClassifyLocalStorageFailureSeparatesStagingFromDevice(t *testing.T) {
	connection := &models.XboxConnection{Mode: "local"}
	full := errors.New("espaco insuficiente no armazenamento temporario C:\\")

	for _, phase := range []string{"download-http", "extract-archive", "extract-iso", "convert-god"} {
		staging := classifyLocalStorageFailure(connection, phase, full)
		if !isLocalStorageHalt(staging) {
			t.Fatalf("fase %s: falha de armazenamento ainda deve interromper o job", phase)
		}
		if !errors.Is(staging, ErrLocalStaging) {
			t.Fatalf("fase %s roda no disco do PC e deve ser marcada como staging: %v", phase, staging)
		}
		if errors.Is(staging, ErrLocalDelivery) {
			t.Fatalf("fase %s nao tocou o dispositivo do usuario: %v", phase, staging)
		}
	}

	delivery := classifyLocalStorageFailure(connection, "install-local", full)
	if !errors.Is(delivery, ErrLocalDelivery) {
		t.Fatal("falha de gravacao no destino deve continuar sendo ErrLocalDelivery")
	}
	if errors.Is(delivery, ErrLocalStaging) {
		t.Fatalf("falha no destino nao deve ser marcada como staging do PC: %v", delivery)
	}
}

// classifyLocalStorageFailure re-embrulhava com %v, achatando o erro original
// em texto e deixando errors.Is cego para qualquer sentinela abaixo dele. Hoje
// ErrJobCancelled nao casa nenhum fragmento de armazenamento, mas basta uma
// mensagem carregar "acesso negado" para o cancelamento do usuario ser relatado
// como disco cheio — e fallback.go decide pelo errors.Is, nao pelo texto.
func TestClassifyLocalStorageFailureKeepsSentinelsDetectable(t *testing.T) {
	connection := &models.XboxConnection{Mode: "local"}
	cancelled := fmt.Errorf("acesso negado ao encerrar a tarefa: %w", app.ErrJobCancelled)

	got := classifyLocalStorageFailure(connection, "download-http", cancelled)
	if !errors.Is(got, app.ErrJobCancelled) {
		t.Fatalf("sentinela abaixo da classificacao foi achatada em texto: %v", got)
	}
}

// O disco de trabalho e o mesmo nos dois modos. Em modo FTP o disco cheio caia
// no recordError e a cadeia seguia para ia e minerva, enchendo o mesmo disco
// mais duas vezes antes de falhar igual; so o modo local parava. Nenhum dos dois
// comportamentos foi decidido de proposito.
func TestClassifyLocalStorageFailureHaltsInEveryMode(t *testing.T) {
	full := errors.New("there is not enough space on the disk")

	for _, connection := range []*models.XboxConnection{
		{Mode: "ftp"},
		{Mode: "local"},
		nil,
	} {
		mode := "nil"
		if connection != nil {
			mode = connection.Mode
		}
		got := classifyLocalStorageFailure(connection, "download-http", full)
		if !isLocalStorageHalt(got) {
			t.Fatalf("modo %s: disco cheio do PC deve interromper a cadeia, veio: %v", mode, got)
		}
		// Em modo FTP nao existe dispositivo local para culpar.
		if errors.Is(got, ErrLocalDelivery) {
			t.Fatalf("modo %s: falha no disco do PC nao pode virar falha de dispositivo: %v", mode, got)
		}
	}
}
