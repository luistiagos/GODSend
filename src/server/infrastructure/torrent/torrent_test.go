package torrent

import (
	"bytes"
	"context"
	"crypto/sha1"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"

	"godsend/app"
	"godsend/models"
)

func buildTestMultiFileTorrent(t *testing.T, rootName string, files []struct {
	name string
	size int64
}) []byte {
	t.Helper()
	var infoFiles []metainfo.FileInfo
	var total int64
	for _, f := range files {
		infoFiles = append(infoFiles, metainfo.FileInfo{
			Path:   []string{f.name},
			Length: f.size,
		})
		total += f.size
	}
	pieceLen := int64(262144)
	numPieces := (total + pieceLen - 1) / pieceLen
	if numPieces < 1 {
		numPieces = 1
	}
	info := metainfo.Info{
		Name:        rootName,
		PieceLength: pieceLen,
		Pieces:      bytes.Repeat(make([]byte, sha1.Size), int(numPieces)),
		Files:       infoFiles,
	}
	infoBytes, err := bencode.Marshal(info)
	if err != nil {
		t.Fatalf("marshal info: %v", err)
	}
	mi := metainfo.MetaInfo{
		Announce:  "http://127.0.0.1:1/announce",
		InfoBytes: infoBytes,
	}
	var buf bytes.Buffer
	if err := mi.Write(&buf); err != nil {
		t.Fatalf("write torrent: %v", err)
	}
	return buf.Bytes()
}

func newTestTorrentService(t *testing.T, platform, fileName string, fileSize int64, mode string) (*Service, *app.App, string) {
	t.Helper()
	tmp := t.TempDir()
	a := app.NewApp()
	a.ToolsDir = tmp
	a.TempDir = filepath.Join(tmp, "temp")
	a.TorrentTempDir = filepath.Join(a.TempDir, "torrent-dl")
	a.ReadyDir = filepath.Join(tmp, "ready")
	_ = os.MkdirAll(a.TorrentTempDir, 0755)
	_ = os.MkdirAll(a.ReadyDir, 0755)

	torrentURL, ok := app.MinervaTorrentURLs[platform]
	if !ok {
		t.Fatalf("unknown platform %q", platform)
	}
	torrentData := buildTestMultiFileTorrent(t, "MinervaTest", []struct {
		name string
		size int64
	}{
		{name: fileName, size: fileSize},
	})

	svc := &Service{
		App:                a,
		aria2cResolvedPath: "mock-aria2c",
		minervaTorrents: map[string][]byte{
			torrentURL: torrentData,
		},
		commandContextFn: func(ctx context.Context, _ string, arg ...string) *exec.Cmd {
			cmdArgs := append([]string{"-test.run=TestAria2cHelperProcess", "--"}, arg...)
			cmd := exec.CommandContext(ctx, os.Args[0], cmdArgs...)
			cmd.Env = append(os.Environ(),
				"GO_WANT_ARIA2C_HELPER=1",
				"ARIA2C_HELPER_MODE="+mode,
				"ARIA2C_HELPER_FILENAME="+fileName,
				fmt.Sprintf("ARIA2C_HELPER_FILESIZE=%d", fileSize),
			)
			return cmd
		},
	}
	return svc, a, filepath.Join(tmp, "dest")
}

// TestAria2cHelperProcess acts as a fake aria2c process controlled by ARIA2C_HELPER_MODE.
func TestAria2cHelperProcess(t *testing.T) {
	if os.Getenv("GO_WANT_ARIA2C_HELPER") != "1" {
		return
	}
	mode := os.Getenv("ARIA2C_HELPER_MODE")
	var dirArg string
	for _, a := range os.Args {
		if strings.HasPrefix(a, "--dir=") {
			dirArg = strings.TrimPrefix(a, "--dir=")
			break
		}
	}

	switch mode {
	case "zero-speed-no-eta":
		for i := 0; i < 200; i++ {
			fmt.Print("[#bef21c 0B/6.3GiB(0%) CN:50 SD:0 DL:0B]\r")
			time.Sleep(25 * time.Millisecond)
		}
	case "rounded-99-stall":
		// Rounded human-readable downloaded size ("1.0KiB") >= fileSize (1000B) while still at 99% and 0B/s.
		for i := 0; i < 200; i++ {
			fmt.Print("[#bef21c 1.0KiB/1.0KiB(99%) CN:5 SD:0 DL:0B]\r")
			time.Sleep(25 * time.Millisecond)
		}
	case "silent-hang":
		time.Sleep(10 * time.Second)
	case "slow-speed":
		for i := 0; i < 200; i++ {
			fmt.Printf("[#9857f6 %dKiB/6501MiB(0%%) CN:1 SD:1 DL:10KiB ETA:10h]\r", i+1)
			time.Sleep(25 * time.Millisecond)
		}
	case "slow-then-complete":
		for i := 0; i < 8; i++ {
			fmt.Printf("[#9857f6 %dKiB/6501MiB(%d%%) CN:1 SD:1 DL:10KiB ETA:10h]\r", i+1, i*10)
			time.Sleep(25 * time.Millisecond)
		}
		targetName := os.Getenv("ARIA2C_HELPER_FILENAME")
		var size int64
		fmt.Sscanf(os.Getenv("ARIA2C_HELPER_FILESIZE"), "%d", &size)
		outPath := filepath.Join(dirArg, "MinervaTest", targetName)
		_ = os.MkdirAll(filepath.Dir(outPath), 0755)
		_ = os.WriteFile(outPath, bytes.Repeat([]byte("A"), int(size)), 0644)
		fmt.Println("[#9857f6 1KiB/1KiB(100%) CN:1 SD:1 DL:10KiB ETA:0s]")
		os.Exit(0)
	case "complete-entity":
		targetName := os.Getenv("ARIA2C_HELPER_FILENAME")
		var size int64
		fmt.Sscanf(os.Getenv("ARIA2C_HELPER_FILESIZE"), "%d", &size)
		outPath := filepath.Join(dirArg, "MinervaTest", targetName)
		_ = os.MkdirAll(filepath.Dir(outPath), 0755)
		_ = os.WriteFile(outPath, bytes.Repeat([]byte("Z"), int(size)), 0644)
		_ = os.WriteFile(outPath+".aria2", []byte("control"), 0644)
		fmt.Println("[#9857f6 1KiB/1KiB(100%) CN:12 SD:4 DL:5.0MiB ETA:0s]")
		os.Exit(0)
	}
	os.Exit(1)
}

func TestParseAria2cSummary(t *testing.T) {
	cases := []struct {
		name    string
		line    string
		wantOK  bool
		wantPct int
		wantDL  float64
		wantETA string
		wantCN  int
		wantSD  int
	}{
		{
			name:    "with ETA",
			line:    "[#abc123 195MiB/6504MiB(3%) CN:67 DL:9.9MiB ETA:31m]",
			wantOK:  true,
			wantPct: 3,
			wantDL:  9.9 * 1024 * 1024,
			wantETA: "31m",
			wantCN:  67,
		},
		{
			name:    "zero speed without ETA",
			line:    "[#9857f6 0B/6501MiB(0%) CN:0 SD:0 DL:0B]",
			wantOK:  true,
			wantPct: 0,
			wantDL:  0,
			wantETA: "",
			wantCN:  0,
			wantSD:  0,
		},
		{
			name:    "partial without ETA",
			line:    "[#9857f6 12MiB/6501MiB(0%) CN:2 DL:0B]",
			wantOK:  true,
			wantPct: 0,
			wantDL:  0,
			wantETA: "",
			wantCN:  2,
		},
		{
			name:    "with seeders and UL and ETA",
			line:    "[#abc123 195MiB/6504MiB(3%) CN:67 SD:12 DL:9.9MiB UL:1.2MiB ETA:31m20s]",
			wantOK:  true,
			wantPct: 3,
			wantDL:  9.9 * 1024 * 1024,
			wantETA: "31m20s",
			wantCN:  67,
			wantSD:  12,
		},
		{
			name:   "unrelated error line",
			line:   "Exception: [AbstractCommand.cc:312] errorCode=1 Network problem",
			wantOK: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := parseAria2cSummary(tc.line)
			if ok != tc.wantOK {
				t.Fatalf("ok=%v, want %v (got=%+v)", ok, tc.wantOK, got)
			}
			if !ok {
				return
			}
			if got.Pct != tc.wantPct {
				t.Fatalf("Pct=%d, want %d", got.Pct, tc.wantPct)
			}
			if got.ETA != tc.wantETA {
				t.Fatalf("ETA=%q, want %q", got.ETA, tc.wantETA)
			}
			if got.Connections != tc.wantCN {
				t.Fatalf("CN=%d, want %d", got.Connections, tc.wantCN)
			}
			if got.Seeders != tc.wantSD {
				t.Fatalf("SD=%d, want %d", got.Seeders, tc.wantSD)
			}
			if int64(got.DLBytesPerSec) != int64(tc.wantDL) {
				t.Fatalf("DLBytesPerSec=%v, want %v", got.DLBytesPerSec, tc.wantDL)
			}
			status := formatAria2cStatus(got)
			if !strings.Contains(status, fmt.Sprintf("%d%%", tc.wantPct)) {
				t.Fatalf("status %q missing percentage", status)
			}
		})
	}
}

func TestDownloadViaTorrentStallsWhenAria2cOmitsETA(t *testing.T) {
	prevStall := app.DownloadStallTimeout
	app.DownloadStallTimeout = 500 * time.Millisecond
	t.Cleanup(func() { app.DownloadStallTimeout = prevStall })

	svc, a, destDir := newTestTorrentService(t, "xbox", "Tony Hawk's Pro Skater 4 (Europe).zip", 1024, "zero-speed-no-eta")
	gameName := "Tony Hawk's Pro Skater 4 (Europe)"
	entry := models.MinervaEntry{
		FileName: "Tony Hawk&#39;s Pro Skater 4 (Europe).zip",
		Platform: "xbox",
	}

	start := time.Now()
	_, err := svc.DownloadViaTorrent("xbox", destDir, gameName, entry)
	elapsed := time.Since(start)
	if !errors.Is(err, app.ErrDownloadStalled) {
		t.Fatalf("expected ErrDownloadStalled, got: %v", err)
	}
	if !strings.Contains(err.Error(), "Minerva sem fontes ativas (peers: 50, seeders: 0)") {
		t.Fatalf("expected peer/seeder diagnostic in stall error, got: %v", err)
	}
	if elapsed > 3*time.Second {
		t.Fatalf("stall took too long: %s", elapsed)
	}

	stVal, ok := a.JobQueue.Load(gameName)
	if !ok {
		t.Fatal("expected JobQueue status update")
	}
	st := stVal.(models.GameStatus)
	if strings.Contains(st.Message, "starting...") {
		t.Fatalf("status remained stuck at starting...: %q", st.Message)
	}
	if !strings.Contains(st.Message, "0% @ 0B/s") || !strings.Contains(st.Message, "peers: 50, seeders: 0") {
		t.Fatalf("expected live zero-speed status with peer counts, got: %q", st.Message)
	}
}

func TestDownloadViaTorrentRounded99PercentStillStalls(t *testing.T) {
	prevStall := app.DownloadStallTimeout
	app.DownloadStallTimeout = 500 * time.Millisecond
	t.Cleanup(func() { app.DownloadStallTimeout = prevStall })

	svc, _, destDir := newTestTorrentService(t, "xbox", "Tony Hawk's Pro Skater 4 (Europe).zip", 1000, "rounded-99-stall")
	entry := models.MinervaEntry{FileName: "Tony Hawk&#39;s Pro Skater 4 (Europe).zip", Platform: "xbox"}

	_, err := svc.DownloadViaTorrent("xbox", destDir, "Rounded99Game", entry)
	if !errors.Is(err, app.ErrDownloadStalled) {
		t.Fatalf("expected ErrDownloadStalled at 99%% with rounded size, got: %v", err)
	}
}

func TestDownloadViaTorrentStallsWhenAria2cSilent(t *testing.T) {
	prevStall := app.DownloadStallTimeout
	app.DownloadStallTimeout = 150 * time.Millisecond
	t.Cleanup(func() { app.DownloadStallTimeout = prevStall })

	svc, _, destDir := newTestTorrentService(t, "xbox", "Tony Hawk's Pro Skater 4 (Europe).zip", 1024, "silent-hang")
	entry := models.MinervaEntry{FileName: "Tony Hawk&#39;s Pro Skater 4 (Europe).zip", Platform: "xbox"}

	start := time.Now()
	_, err := svc.DownloadViaTorrent("xbox", destDir, "SilentGame", entry)
	if !errors.Is(err, app.ErrDownloadStalled) {
		t.Fatalf("expected ErrDownloadStalled, got: %v", err)
	}
	if time.Since(start) > 3*time.Second {
		t.Fatalf("silent watchdog took too long: %s", time.Since(start))
	}
}

func TestDownloadViaTorrentStallsEvenWithSpeedCheckBypass(t *testing.T) {
	prevStall := app.DownloadStallTimeout
	app.DownloadStallTimeout = 500 * time.Millisecond
	t.Cleanup(func() { app.DownloadStallTimeout = prevStall })

	svc, a, destDir := newTestTorrentService(t, "xbox", "Tony Hawk's Pro Skater 4 (Europe).zip", 1024, "zero-speed-no-eta")
	gameName := "Tony Hawk's Pro Skater 4 (Europe)"
	a.SetSpeedCheckBypass(gameName, true)
	entry := models.MinervaEntry{FileName: "Tony Hawk&#39;s Pro Skater 4 (Europe).zip", Platform: "xbox"}

	_, err := svc.DownloadViaTorrent("xbox", destDir, gameName, entry)
	if !errors.Is(err, app.ErrDownloadStalled) {
		t.Fatalf("expected ErrDownloadStalled even when speed check bypassed, got: %v", err)
	}
}

func TestDownloadViaTorrentCancelsWhileAria2cSilent(t *testing.T) {
	prevStall := app.DownloadStallTimeout
	app.DownloadStallTimeout = 5 * time.Second
	t.Cleanup(func() { app.DownloadStallTimeout = prevStall })

	svc, a, destDir := newTestTorrentService(t, "xbox", "Tony Hawk's Pro Skater 4 (Europe).zip", 1024, "silent-hang")
	gameName := "CancelSilentGame"
	tok := a.RegisterGameJob(gameName)
	if !a.AcquireGameJob(gameName, tok) {
		t.Fatal("failed to acquire game job")
	}
	defer a.ReleaseGameJob(gameName, tok)

	go func() {
		time.Sleep(80 * time.Millisecond)
		a.CancelGameJob(gameName)
	}()

	start := time.Now()
	_, err := svc.DownloadViaTorrent("xbox", destDir, gameName, models.MinervaEntry{
		FileName: "Tony Hawk&#39;s Pro Skater 4 (Europe).zip",
		Platform: "xbox",
	})
	if !errors.Is(err, app.ErrJobCancelled) {
		t.Fatalf("expected ErrJobCancelled, got: %v", err)
	}
	if time.Since(start) > 2*time.Second {
		t.Fatalf("cancel while silent took too long: %s", time.Since(start))
	}
}

func TestDownloadViaTorrentFindsDownloadedFileWithHTMLEntityAndReusesCache(t *testing.T) {
	svc, _, destDir := newTestTorrentService(t, "xbox", "Tony Hawk's Pro Skater 4 (Europe).zip", 1024, "complete-entity")
	gameName := "Tony Hawk's Pro Skater 4 (Europe)"
	entry := models.MinervaEntry{
		FileName: "Tony Hawk&#39;s Pro Skater 4 (Europe).zip",
		Platform: "xbox",
	}

	outPath, err := svc.DownloadViaTorrent("xbox", destDir, gameName, entry)
	if err != nil {
		t.Fatalf("DownloadViaTorrent failed: %v", err)
	}
	if filepath.Base(outPath) != "Tony Hawk's Pro Skater 4 (Europe).zip" {
		t.Fatalf("unexpected downloaded filename: %q", outPath)
	}
	if st, err := os.Stat(outPath); err != nil || st.Size() != 1024 {
		t.Fatalf("downloaded file stat err=%v size=%v", err, st)
	}

	// Second call should reuse cached file in destDir without launching aria2c again.
	svc.commandContextFn = func(ctx context.Context, name string, arg ...string) *exec.Cmd {
		t.Fatal("expected cached file reuse without launching aria2c")
		return nil
	}
	cachedPath, err := svc.DownloadViaTorrent("xbox", destDir, gameName, entry)
	if err != nil {
		t.Fatalf("cached DownloadViaTorrent failed: %v", err)
	}
	if cachedPath != outPath {
		t.Fatalf("cachedPath=%q, want %q", cachedPath, outPath)
	}
}

func TestDownloadViaTorrentSlowSpeedAndBypass(t *testing.T) {
	prevStall := app.DownloadStallTimeout
	app.DownloadStallTimeout = 2 * time.Second
	t.Cleanup(func() { app.DownloadStallTimeout = prevStall })

	svc, a, destDir := newTestTorrentService(t, "xbox", "Tony Hawk's Pro Skater 4 (Europe).zip", 1024, "slow-speed")
	svc.lowSpeedGracePeriod = 60 * time.Millisecond
	svc.lowSpeedSustainedDuration = 60 * time.Millisecond
	a.MinDownloadSpeedThreshold = 512 * 1024
	entry := models.MinervaEntry{FileName: "Tony Hawk&#39;s Pro Skater 4 (Europe).zip", Platform: "xbox"}

	_, err := svc.DownloadViaTorrent("xbox", destDir, "SlowGame", entry)
	if !errors.Is(err, app.ErrDownloadTooSlow) {
		t.Fatalf("expected ErrDownloadTooSlow, got: %v", err)
	}

	// With speed check bypassed, slow download is allowed to finish.
	svcBypass, aBypass, destDirBypass := newTestTorrentService(t, "xbox", "Tony Hawk's Pro Skater 4 (Europe).zip", 1024, "slow-then-complete")
	svcBypass.lowSpeedGracePeriod = 40 * time.Millisecond
	svcBypass.lowSpeedSustainedDuration = 40 * time.Millisecond
	aBypass.MinDownloadSpeedThreshold = 512 * 1024
	aBypass.SetSpeedCheckBypass("BypassGame", true)

	gotPath, err := svcBypass.DownloadViaTorrent("xbox", destDirBypass, "BypassGame", entry)
	if err != nil {
		t.Fatalf("expected bypassed slow torrent to complete, got: %v", err)
	}
	if st, statErr := os.Stat(gotPath); statErr != nil || st.Size() != 1024 {
		t.Fatalf("expected complete file, err=%v", statErr)
	}
}
