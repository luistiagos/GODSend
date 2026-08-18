// config.go — configuration constants, collection maps, ROM systems, and setup/init helpers.
package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"godsend/models"
)

// ── Constants ─────────────────────────────────────────────────────────

const (
	Port            = "8080"
	MaxPartSize     = 1800000000
	MaxDLCSizeBytes = 349 * 1024 * 1024
	CopyBufferSize  = 4 * 1024 * 1024
	ServeBufferSize = 128 * 1024
	FTPPort         = 21
	FTPTimeout      = 30 * time.Second
	FTPBufferSize   = 1 * 1024 * 1024
	FTPMaxRetries   = 3
	FTPRetryDelay   = 2 * time.Second
	TCPSendBuffer   = 512 * 1024
	TCPKeepAlive    = 30 * time.Second

	IADownloadBase = "https://archive.org/download/"

	// Minerva Archive browse base
	MinervaBrowseBase = "https://minerva-archive.org/browse/"

	// Internet Archive / HTTP range downloads
	IAChunkRetries       = 5
	IAChunkRetryBase     = 6 * time.Second
	IAParallelThreshold  = 32 * 1024 * 1024 // below this size, use a single HTTP stream
	IASegmentSize        = 4 * 1024 * 1024  // bytes per queued range job
	IAParallelMaxDefault = 16               // default concurrent range GETs
	IAParallelMaxCap     = 32               // upper bound for env-tuned parallelism

	// Download speed monitoring & fallback thresholds
	MinDownloadSpeedThreshold = 1024 * 1024      // 1.0 MB/s (1048576 B/s)
	LowSpeedGracePeriod       = 15 * time.Second // Grace period before enforcing speed limit
	LowSpeedSustainedDuration = 10 * time.Second // Duration speed must remain under threshold
)

// ErrDownloadTooSlow is returned when download speed stays under MinDownloadSpeedThreshold.
var ErrDownloadTooSlow = fmt.Errorf("download muito lento (abaixo de 1.0 MB/s), alternando para o próximo provedor")

// ErrJobCancelled is returned when the user removes a running queue item.
var ErrJobCancelled = fmt.Errorf("tarefa cancelada pelo usuario")

// ClampIAParallel clamps an IA parallel download count to valid range.
func ClampIAParallel(c int) int {
	if c < 1 {
		return 1
	}
	if c > IAParallelMaxCap {
		return IAParallelMaxCap
	}
	return c
}

// ── Internet Archive Collection Map ───────────────────────────────────

// IACollections maps platform key → list of IA collection identifiers.
var IACollections = map[string][]string{
	"xbox360": {
		"microsoft_xbox360_numberssymbols",
		"microsoft_xbox360_a_part1", "microsoft_xbox360_a_part2",
		"microsoft_xbox360_b_part1", "microsoft_xbox360_b_part2",
		"microsoft_xbox360_c_part1", "microsoft_xbox360_c_part2",
		"microsoft_xbox360_d_part1", "microsoft_xbox360_d_part2", "microsoft_xbox360_d_part3",
		"microsoft_xbox360_e",
		"microsoft_xbox360_f_part1", "microsoft_xbox360_f_part2",
		"microsoft_xbox360_g",
		"microsoft_xbox360_h",
		"microsoft_xbox360_i",
		"microsoft_xbox360_j",
		"microsoft_xbox360_k",
		"microsoft_xbox360_l",
		"microsoft_xbox360_m_part1", "microsoft_xbox360_m_part2",
		"microsoft_xbox360_n_part1", "microsoft_xbox360_n_part2",
		"microsoft_xbox360_o",
		"microsoft_xbox360_p",
		"microsoft_xbox360_q",
		"microsoft_xbox360_r",
		"microsoft_xbox360_s_part1", "microsoft_xbox360_s_part2",
		"microsoft_xbox360_t_part1", "microsoft_xbox360_t_part2",
		"microsoft_xbox360_u",
		"microsoft_xbox360_v",
		"microsoft_xbox360_w",
		"microsoft_xbox360_x_part1", "microsoft_xbox360_x_part2",
		"microsoft_xbox360_y",
		"microsoft_xbox360_z",
	},
	"xbox": {
		"microsoft_xbox_numberssymbols",
		"microsoft_xbox_a", "microsoft_xbox_b", "microsoft_xbox_c",
		"microsoft_xbox_d", "microsoft_xbox_e", "microsoft_xbox_f",
		"microsoft_xbox_g", "microsoft_xbox_h", "microsoft_xbox_i",
		"microsoft_xbox_j", "microsoft_xbox_k", "microsoft_xbox_l",
		"microsoft_xbox_m", "microsoft_xbox_n", "microsoft_xbox_o",
		"microsoft_xbox_p", "microsoft_xbox_q", "microsoft_xbox_r",
		"microsoft_xbox_s", "microsoft_xbox_t", "microsoft_xbox_u",
		"microsoft_xbox_v", "microsoft_xbox_w", "microsoft_xbox_x",
		"microsoft_xbox_y", "microsoft_xbox_z",
	},
	"digital": {
		"microsoft_xbox360_digital_part1",
		"microsoft_xbox360_digital_part2",
		"microsoft_xbox360_digital_part3",
		"microsoft_xbox360_digital_part4",
		"microsoft_xbox360_digital_part5",
		"microsoft_xbox360_digital_part6",
		"microsoft_xbox360_digital_part7",
	},
	"xbla": {
		"XBOX_360_XBLA",
	},
	"dlc": {
		"XBOX_360_DLC_1", "XBOX_360_DLC_2", "XBOX_360_DLC_3",
		"XBOX_360_DLC_4", "XBOX_360_DLC_5", "XBOX_360_DLC_6",
		"XBOX_360_XBLA_DLC",
	},
	"xblig": {
		"XBOX_360_XBLIG_1", "XBOX_360_XBLIG_2",
		"XBOX_360_XBLIG_3", "XBOX_360_XBLIG_4",
	},
	"games": {
		"XBOX_360_1", "XBOX_360_1_OTHER",
		"XBOX_360_2", "XBOX_360_3", "XBOX_360_4",
		"XBOX_360_5", "XBOX_360_6",
	},
}

// ── Minerva Archive Collection Map ────────────────────────────────────

// MinervaPageURLs maps platform key → single browse-page URL to scrape.
var MinervaPageURLs = map[string]string{
	"xbox360": MinervaBrowseBase + "Redump/Microsoft%20-%20Xbox%20360/",
	"xbox":    MinervaBrowseBase + "Redump/Microsoft%20-%20Xbox/",
	"digital": MinervaBrowseBase + "No-Intro/Microsoft%20-%20Xbox%20360%20(Digital)/",
	"xbla":    MinervaBrowseBase + "No-Intro/Microsoft%20-%20Xbox%20360%20(Digital)/",
	"dlc":     MinervaBrowseBase + "No-Intro/Microsoft%20-%20Xbox%20360%20(Digital)/",
	"xblig":   MinervaBrowseBase + "No-Intro/Microsoft%20-%20Xbox%20360%20(Digital)/",
	"games":   MinervaBrowseBase + "No-Intro/Non-Redump%20-%20Microsoft%20-%20Xbox%20360/",
}

// MinervaTagFilters: if non-empty, only filenames containing one of these
// substrings are kept. No-Intro mixes Xbox 360 (Digital) titles together in
// one collection; we partition them by filename tag.
//
// `dlc` accepts both `(Addon)` (the bulk No-Intro tag) and `(DLC)` (the
// newer alternative) so DLCs published under the `(DLC)` convention — about
// 4,690 entries as of the v0.3 dataset — show up in the Store's DLC tab.
// `(Addon for XBLA)` is a rare variant for XBLA-bound add-ons.
var MinervaTagFilters = map[string][]string{
	"xbla":  {"(XBLA)"},
	"dlc":   {"(Addon)", "(DLC)", "(Addon for XBLA)"},
	"xblig": {"(XBLIG)"},
}

// MinervaCacheSchema is the cache-file schema version. Bump this whenever the
// shape of MinervaPlatformCache changes or the filtering rules change in a
// way that invalidates older caches — on-disk caches with a different schema
// are rejected at load time and a rebuild is triggered.
const MinervaCacheSchema = 3

// MinervaTorrentURLs: the collection-level .torrent file for each platform.
var MinervaTorrentURLs = map[string]string{
	"xbox360": "https://minerva-archive.org/assets/Minerva_Myrient_v0.3/Minerva_Myrient%20-%20Redump%20-%20Microsoft%20-%20Xbox%20360.torrent",
	"xbox":    "https://minerva-archive.org/assets/Minerva_Myrient_v0.3/Minerva_Myrient%20-%20Redump%20-%20Microsoft%20-%20Xbox.torrent",
	"digital": "https://minerva-archive.org/assets/Minerva_Myrient_v0.3/Minerva_Myrient%20-%20No-Intro%20-%20Microsoft%20-%20Xbox%20360%20(Digital).torrent",
	"xbla":    "https://minerva-archive.org/assets/Minerva_Myrient_v0.3/Minerva_Myrient%20-%20No-Intro%20-%20Microsoft%20-%20Xbox%20360%20(Digital).torrent",
	"dlc":     "https://minerva-archive.org/assets/Minerva_Myrient_v0.3/Minerva_Myrient%20-%20No-Intro%20-%20Microsoft%20-%20Xbox%20360%20(Digital).torrent",
	"xblig":   "https://minerva-archive.org/assets/Minerva_Myrient_v0.3/Minerva_Myrient%20-%20No-Intro%20-%20Microsoft%20-%20Xbox%20360%20(Digital).torrent",
	"games":   "https://minerva-archive.org/assets/Minerva_Myrient_v0.3/Minerva_Myrient%20-%20No-Intro%20-%20Non-Redump%20-%20Microsoft%20-%20Xbox%20360.torrent",
}

// MinervaROMAnchorRe accepts both the legacy name-based links and the current
// id-based links while capturing the filename rendered by the browse page.
var MinervaROMAnchorRe = regexp.MustCompile(`(?is)<a[^>]+href="(/rom\?(?:name|id)=[^"]+)"[^>]*>([^<]+)</a>`)

// ── ROM Systems (EdgeEmu) ─────────────────────────────────────────────

// ROMSystems maps sysid → ROMSystem metadata.
var ROMSystems = map[string]models.ROMSystem{
	// Atari
	"a2600":    {Name: "Atari - 2600", BrowseURL: "https://edgeemu.net/browse/atari-2600", Folder: "A2600"},
	"a5200":    {Name: "Atari - 5200", BrowseURL: "https://edgeemu.net/browse/atari-5200", Folder: "A5200"},
	"a7800":    {Name: "Atari - 7800", BrowseURL: "https://edgeemu.net/browse/atari-7800", Folder: "A7800"},
	"jaguar":   {Name: "Atari - Jaguar", BrowseURL: "https://edgeemu.net/browse/atari-jaguar", Folder: "JAG"},
	"jaguarcd": {Name: "Atari - Jaguar CD", BrowseURL: "https://edgeemu.net/browse/atari-jaguar-cd", Folder: "JAGCD"},
	"lynx":     {Name: "Atari - Lynx", BrowseURL: "https://edgeemu.net/browse/atari-lynx", Folder: "LYNX"},
	"st":       {Name: "Atari - ST", BrowseURL: "https://edgeemu.net/browse/atari-st", Folder: "ST"},
	// Bandai
	"ws": {Name: "Bandai - WonderSwan", BrowseURL: "https://edgeemu.net/browse/bandai-wonderswan", Folder: "WS"},
	// Coleco
	"coleco": {Name: "Coleco - ColecoVision", BrowseURL: "https://edgeemu.net/browse/colecovision", Folder: "COLECO"},
	// Commodore
	"c64":       {Name: "Commodore - 64", BrowseURL: "https://edgeemu.net/browse/commodore-64", Folder: "C64"},
	"amiga":     {Name: "Commodore - Amiga", BrowseURL: "https://edgeemu.net/browse/commodore-amiga", Folder: "AMIGA"},
	"amigacd":   {Name: "Commodore - Amiga CD", BrowseURL: "https://edgeemu.net/browse/commodore-amiga-cd", Folder: "AMIGACD"},
	"amigacd32": {Name: "Commodore - Amiga CD32", BrowseURL: "https://edgeemu.net/browse/commodore-amiga-cd32", Folder: "AMIGACD32"},
	"plus4":     {Name: "Commodore - Plus/4", BrowseURL: "https://edgeemu.net/browse/commodore-plus-4", Folder: "PLUS4"},
	"vic20":     {Name: "Commodore - VIC-20", BrowseURL: "https://edgeemu.net/browse/commodore-vic-20", Folder: "VIC20"},
	// Fairchild
	"channelf": {Name: "Fairchild - Channel F", BrowseURL: "https://edgeemu.net/browse/fairchild-channel-f", Folder: "CHANNELF"},
	// GCE
	"vectrex": {Name: "GCE - Vectrex", BrowseURL: "https://edgeemu.net/browse/gce-vectrex", Folder: "VECTREX"},
	// Microsoft
	"msx": {Name: "Microsoft - MSX / MSX2", BrowseURL: "https://edgeemu.net/browse/microsoft-msx", Folder: "MSX"},
	// NEC
	"pcecd": {Name: "NEC - PC Engine CD / TurboGrafx CD", BrowseURL: "https://edgeemu.net/browse/nec-pc-engine-cd-turbografx-cd", Folder: "PCECD"},
	"sgx":   {Name: "NEC - PC Engine SuperGrafx", BrowseURL: "https://edgeemu.net/browse/nec-pc-engine-supergrafx", Folder: "SGX"},
	"pce":   {Name: "NEC - PC Engine / TurboGrafx 16", BrowseURL: "https://edgeemu.net/browse/nec-pc-engine-turbografx-16", Folder: "PCE"},
	// Nintendo
	"nds":  {Name: "Nintendo - DS", BrowseURL: "https://edgeemu.net/browse/nintendo-ds", Folder: "NDS"},
	"fds":  {Name: "Nintendo - Famicom Disk System", BrowseURL: "https://edgeemu.net/browse/nintendo-fds", Folder: "FDS"},
	"gb":   {Name: "Nintendo - Game Boy", BrowseURL: "https://edgeemu.net/browse/nintendo-gameboy", Folder: "GB"},
	"gba":  {Name: "Nintendo - Game Boy Advance", BrowseURL: "https://edgeemu.net/browse/nintendo-gameboy-advance", Folder: "GBA"},
	"gbc":  {Name: "Nintendo - Game Boy Color", BrowseURL: "https://edgeemu.net/browse/nintendo-gameboy-color", Folder: "GBC"},
	"gc":   {Name: "Nintendo - GameCube", BrowseURL: "https://edgeemu.net/browse/nintendo-gamecube", Folder: "GC"},
	"n64":  {Name: "Nintendo - 64", BrowseURL: "https://edgeemu.net/browse/nintendo-64", Folder: "N64"},
	"nes":  {Name: "Nintendo - NES", BrowseURL: "https://edgeemu.net/browse/nintendo-nes", Folder: "NES"},
	"sat":  {Name: "Nintendo - Satellaview", BrowseURL: "https://edgeemu.net/browse/nintendo-satellaview", Folder: "SAT"},
	"vb":   {Name: "Nintendo - Virtual Boy", BrowseURL: "https://edgeemu.net/browse/nintendo-virtualboy", Folder: "VB"},
	"snes": {Name: "Nintendo - SNES", BrowseURL: "https://edgeemu.net/browse/nintendo-snes", Folder: "SNES"},
	// Panasonic
	"3do": {Name: "Panasonic - 3DO", BrowseURL: "https://edgeemu.net/browse/panasonic-3do", Folder: "3DO"},
	// Philips
	"cdi": {Name: "Philips - CDi", BrowseURL: "https://edgeemu.net/browse/philips-cdi", Folder: "CDI"},
	// RCA
	"studioii": {Name: "RCA - Studio II", BrowseURL: "https://edgeemu.net/browse/rca-studioii", Folder: "STUDIOII"},
	// Sega
	"32x":     {Name: "Sega - 32X", BrowseURL: "https://edgeemu.net/browse/sega-32x", Folder: "32X"},
	"dc":      {Name: "Sega - Dreamcast", BrowseURL: "https://edgeemu.net/browse/sega-dreamcast", Folder: "DC"},
	"gg":      {Name: "Sega - Game Gear", BrowseURL: "https://edgeemu.net/browse/sega-gamegear", Folder: "GG"},
	"sms":     {Name: "Sega - Master System / Mark III", BrowseURL: "https://edgeemu.net/browse/sega-sms", Folder: "SMS"},
	"scd":     {Name: "Sega - Mega-CD / Sega CD", BrowseURL: "https://edgeemu.net/browse/sega-cd", Folder: "SCD"},
	"genesis": {Name: "Sega - Mega Drive / Genesis", BrowseURL: "https://edgeemu.net/browse/sega-genesis", Folder: "MD"},
	"pico":    {Name: "Sega - PICO", BrowseURL: "https://edgeemu.net/browse/sega-pico", Folder: "PICO"},
	"saturn":  {Name: "Sega - Saturn", BrowseURL: "https://edgeemu.net/browse/sega-saturn", Folder: "SATURN"},
	"sg1000":  {Name: "Sega - SG-1000", BrowseURL: "https://edgeemu.net/browse/sega-sg1000", Folder: "SG1000"},
	// Sinclair
	"zx": {Name: "Sinclair - ZX Spectrum +3", BrowseURL: "https://edgeemu.net/browse/sinclair-zx-spectrum-3", Folder: "ZX"},
	// SNK
	"ngcd": {Name: "SNK - Neo Geo CD", BrowseURL: "https://edgeemu.net/browse/snk-neo-geo-cd", Folder: "NGCD"},
	"ngpc": {Name: "SNK - Neo Geo Pocket Color", BrowseURL: "https://edgeemu.net/browse/snk-ngpc", Folder: "NGPC"},
	// Watara
	"supervision": {Name: "Watara - Supervision", BrowseURL: "https://edgeemu.net/browse/watara-supervision", Folder: "SUPERVISION"},
}

// ── Setup helpers (methods on App) ────────────────────────────────────

const scratchOwnerFile = ".godsend-owner.pid"

func scratchDirSize(dir string) int64 {
	var total int64
	_ = filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	return total
}

// cleanupStaleScratchDir removes processing data left by a backend that is no
// longer running. A live owner marker protects another local backend instance.
func protectedScratchPaths(toolsDir string) []string {
	type pendingJob struct {
		SourceDir string `json:"source_dir"`
	}
	entries, err := os.ReadDir(filepath.Join(toolsDir, "pending_ftp"))
	if err != nil {
		return nil
	}
	var protected []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".json") {
			continue
		}
		data, readErr := os.ReadFile(filepath.Join(toolsDir, "pending_ftp", entry.Name()))
		if readErr != nil {
			continue
		}
		var job pendingJob
		if json.Unmarshal(data, &job) == nil && job.SourceDir != "" {
			if abs, absErr := filepath.Abs(job.SourceDir); absErr == nil {
				protected = append(protected, filepath.Clean(abs))
			}
		}
	}
	return protected
}

func containsProtectedScratch(candidate string, protected []string) bool {
	candidateAbs, err := filepath.Abs(candidate)
	if err != nil {
		return false
	}
	candidateAbs = filepath.Clean(candidateAbs)
	for _, path := range protected {
		if strings.EqualFold(candidateAbs, path) {
			return true
		}
		rel, relErr := filepath.Rel(candidateAbs, path)
		if relErr == nil && rel != "." && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func (a *App) cleanupStaleScratchDir(dir string, protected []string) {
	ownerPath := filepath.Join(dir, scratchOwnerFile)
	if data, err := os.ReadFile(ownerPath); err == nil {
		if pid, parseErr := strconv.Atoi(strings.TrimSpace(string(data))); parseErr == nil && processIsRunning(pid) {
			a.Logf("[INFO] Scratch directory is owned by active process %d; preserving %s", pid, dir)
			return
		}
	}
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return
	}
	var reclaimed int64
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		path := filepath.Join(dir, entry.Name())
		if containsProtectedScratch(path, protected) {
			a.Logf("[INFO] Preserving scratch required by pending FTP: %s", path)
			continue
		}
		reclaimed += scratchDirSize(path)
		if removeErr := os.RemoveAll(path); removeErr != nil {
			a.Logf("[WARN] Could not clean stale scratch entry %s: %v", path, removeErr)
		}
	}
	if reclaimed > 0 {
		a.Logf("[INFO] Removed %.2f GB of stale processing data from %s", float64(reclaimed)/1073741824, dir)
	}
}

func markScratchOwner(dir string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, scratchOwnerFile), []byte(strconv.Itoa(os.Getpid())), 0644)
}

// SetupPaths resolves filesystem paths and environment config into App fields.
func (a *App) SetupPaths() error {
	ex, err := os.Executable()
	if err != nil {
		return fmt.Errorf("executable path: %w", err)
	}
	exDir := filepath.Dir(ex)
	a.GodsendExeDir = exDir
	if v := strings.TrimSpace(os.Getenv("GODSEND_HOME")); v != "" {
		abs, err := filepath.Abs(v)
		if err != nil {
			return fmt.Errorf("GODSEND_HOME: %w", err)
		}
		a.ToolsDir = abs
		a.Logf("[INFO] Data directory (GODSEND_HOME): %s", a.ToolsDir)
		a.Logf("[INFO] Executable: %s", ex)
	} else {
		a.ToolsDir = exDir
	}
	for _, dir := range []string{"Ready", "Temp", "cache"} {
		if err := os.MkdirAll(filepath.Join(a.ToolsDir, dir), 0755); err != nil {
			return err
		}
	}
	// Per-game processing scratch (download → extract → GOD) and the aria2c
	// download staging default to ToolsDir/Temp.
	// Clear scratch left by an interrupted run before comparing free space.
	// Otherwise a preallocated partial archive can make the roomiest drive look
	// full and send the next run to a smaller system partition.
	protectedScratch := protectedScratchPaths(a.ToolsDir)
	a.cleanupStaleScratchDir(filepath.Join(a.ToolsDir, "Temp"), protectedScratch)
	for _, volume := range fixedLargeFileVolumes() {
		a.cleanupStaleScratchDir(filepath.Join(volume.root, "godsend-temp", "proc"), protectedScratch)
		a.cleanupStaleScratchDir(filepath.Join(volume.root, "godsend-temp", "torrent-dl"), protectedScratch)
	}

	a.TempDir = filepath.Join(a.ToolsDir, "Temp")
	a.TorrentTempDir = filepath.Join(a.TempDir, "torrent-dl")

	// When a *different* fixed NTFS/exFAT drive has more free space than the app
	// drive, move the whole per-game working set there so multi-GB downloads and
	// extraction/GOD conversion don't fill a cramped app/system partition.
	// Removable and FAT32 volumes are skipped (see bestFixedVolume).
	if best := bestFixedVolume(); best != "" &&
		!strings.EqualFold(filepath.VolumeName(best), filepath.VolumeName(a.ToolsDir)) {
		base := filepath.Join(best, "godsend-temp")
		a.TempDir = filepath.Join(base, "proc")
		a.TorrentTempDir = filepath.Join(base, "torrent-dl")
		a.Logf("[INFO] Processing/torrent temp auto-selected roomiest drive: %s", base)
	}

	// An explicit GODSEND_TORRENT_TEMP still wins for the download staging.
	if v := strings.TrimSpace(os.Getenv("GODSEND_TORRENT_TEMP")); v != "" {
		abs, err := filepath.Abs(v)
		if err != nil {
			return fmt.Errorf("GODSEND_TORRENT_TEMP: %w", err)
		}
		a.TorrentTempDir = abs
		a.cleanupStaleScratchDir(a.TorrentTempDir, protectedScratch)
		a.Logf("[INFO] Torrent download temp (GODSEND_TORRENT_TEMP): %s", a.TorrentTempDir)
	}

	if err := markScratchOwner(a.TempDir); err != nil {
		return fmt.Errorf("processing temp dir: %w", err)
	}
	if err := markScratchOwner(a.TorrentTempDir); err != nil {
		return fmt.Errorf("torrent temp dir: %w", err)
	}
	// ROM install path (drive-relative, no drive letter, no trailing slash)
	a.ROMRootPath = "Emulators\\RetroArch\\roms"
	if v := strings.TrimSpace(os.Getenv("GODSEND_ROM_PATH")); v != "" {
		v = strings.ReplaceAll(v, "/", "\\")
		a.ROMRootPath = strings.TrimRight(v, "\\")
	}

	a.TransferDir = filepath.Join(a.ToolsDir, "Transfer")
	if v := strings.TrimSpace(os.Getenv("GODSEND_TRANSFER")); v != "" {
		abs, err := filepath.Abs(v)
		if err != nil {
			return fmt.Errorf("GODSEND_TRANSFER: %w", err)
		}
		a.TransferDir = abs
		a.Logf("[INFO] Local Transfer folder (GODSEND_TRANSFER): %s", a.TransferDir)
	}
	if err := os.MkdirAll(a.TransferDir, 0755); err != nil {
		return err
	}

	a.SaveBackupDir = a.TransferDir // default: same as transfer folder
	if v := strings.TrimSpace(os.Getenv("GODSEND_SAVE_BACKUP")); v != "" {
		abs, err := filepath.Abs(v)
		if err != nil {
			return fmt.Errorf("GODSEND_SAVE_BACKUP: %w", err)
		}
		a.SaveBackupDir = abs
		a.Logf("[INFO] Save backup folder (GODSEND_SAVE_BACKUP): %s", a.SaveBackupDir)
	}
	a.ServerPort = Port
	if v := strings.TrimSpace(os.Getenv("GODSEND_PORT")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 65535 {
			return fmt.Errorf("GODSEND_PORT must be an integer between 1 and 65535")
		}
		a.ServerPort = strconv.Itoa(n)
		a.Logf("[INFO] Server port (GODSEND_PORT): %s", a.ServerPort)
	}
	a.FTPUsername = "xboxftp"
	a.FTPPassword = "xboxftp"
	if v := strings.TrimSpace(os.Getenv("GODSEND_FTP_USER")); v != "" {
		a.FTPUsername = v
	}
	if v := os.Getenv("GODSEND_FTP_PASS"); v != "" {
		a.FTPPassword = v
	}
	a.PendingFTPDir = filepath.Join(a.ToolsDir, "pending_ftp")
	os.MkdirAll(a.PendingFTPDir, 0755)

	a.DefaultXboxDrive = strings.TrimSpace(os.Getenv("GODSEND_DEFAULT_DRIVE"))
	a.CustomGodPath = strings.TrimSpace(os.Getenv("GODSEND_CUSTOM_GOD_PATH"))
	a.CustomXexPath = strings.TrimSpace(os.Getenv("GODSEND_CUSTOM_XEX_PATH"))
	a.Aria2ListenPort = strings.TrimSpace(os.Getenv("GODSEND_ARIA2_LISTEN_PORT"))
	a.Aria2DhtPort = strings.TrimSpace(os.Getenv("GODSEND_ARIA2_DHT_PORT"))

	a.TelemetryEnabled = true
	if v := strings.TrimSpace(os.Getenv("GODSEND_ERROR_REPORTING")); v != "" {
		a.TelemetryEnabled = v == "1" || strings.ToLower(v) == "true" || strings.ToLower(v) == "yes"
	}
	a.TelemetryEndpoint = "https://digitalstoregames.pythonanywhere.com/logErr"
	if v := strings.TrimSpace(os.Getenv("GODSEND_ERROR_REPORTING_ENDPOINT")); v != "" {
		a.TelemetryEndpoint = v
	}

	a.CleanupEmptyReadyDirs()
	return nil
}

// LoadIAAuthFromEnv reads optional Internet Archive credentials and download settings.
func (a *App) LoadIAAuthFromEnv() {
	v := strings.TrimSpace(os.Getenv("GODSEND_IA_COOKIE"))
	if len(v) > 7 && strings.EqualFold(v[:7], "cookie:") {
		v = strings.TrimSpace(v[7:])
	}
	v = strings.ReplaceAll(strings.ReplaceAll(v, "\r", ""), "\n", "")
	a.IACookieHeader = strings.TrimSpace(v)

	aa := strings.TrimSpace(os.Getenv("GODSEND_IA_AUTHORIZATION"))
	if len(aa) > 14 && strings.EqualFold(aa[:14], "authorization:") {
		aa = strings.TrimSpace(aa[14:])
	}
	a.IAAuthorizationHeader = strings.TrimSpace(aa)

	a.IADownloadMaxParallel = IAParallelMaxDefault
	if v := strings.TrimSpace(os.Getenv("GODSEND_IA_MAX_CONNECTIONS")); v != "" {
		if c, err := strconv.Atoi(v); err == nil {
			a.IADownloadMaxParallel = ClampIAParallel(c)
		}
	} else if v := strings.TrimSpace(os.Getenv("GODSEND_IA_CONCURRENCY")); v != "" {
		if c, err := strconv.Atoi(v); err == nil {
			a.IADownloadMaxParallel = ClampIAParallel(c)
		}
	}

	// Shared IA HTTP client: forwards auth headers across redirects.
	jar := newIACookieJar()
	a.IAHTTPClient = &http.Client{
		Jar:     jar,
		Timeout: 0,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("too many redirects")
			}
			if len(via) > 0 {
				for key, vals := range via[0].Header {
					if _, set := req.Header[key]; !set {
						req.Header[key] = vals
					}
				}
			}
			return nil
		},
	}
	a.seedIACookieJar(a.IACookieHeader)

	if a.IACookieHeader != "" {
		a.Logf("[INFO] Internet Archive: Cookie header set (%d chars)", len(a.IACookieHeader))
	} else if a.IAAuthorizationHeader == "" {
		a.Logf("[INFO] Internet Archive: no stored session found; automatic shared-account login is enabled")
	}
	if a.IAAuthorizationHeader != "" {
		a.Logf("[INFO] Internet Archive: Authorization header set (%d chars)", len(a.IAAuthorizationHeader))
	}
	a.Logf("[INFO] Internet Archive: chunked HTTP downloads (max %d parallel range requests)", a.IADownloadMaxParallel)
}

// ApplyArchiveOrgHeaders adds session/auth headers for archive.org HTTP requests.
func (a *App) ApplyArchiveOrgHeaders(req *http.Request) {
	if req == nil {
		return
	}
	_ = a.EnsureIAAuthSession()
	if a.IAAuthorizationHeader != "" {
		req.Header.Set("Authorization", a.IAAuthorizationHeader)
	}
	if req.Header.Get("Accept") == "" {
		req.Header.Set("Accept", archiveAcceptHeader)
	}
	if req.Header.Get("Accept-Language") == "" {
		req.Header.Set("Accept-Language", archiveAcceptLanguage)
	}
	if req.Header.Get("Cache-Control") == "" {
		req.Header.Set("Cache-Control", "no-cache")
	}
	if req.Header.Get("Pragma") == "" {
		req.Header.Set("Pragma", "no-cache")
	}
	req.Header.Set("User-Agent", archiveUserAgent)
}

// CleanupEmptyReadyDirs removes any subdirectory under Ready/ that contains no files.
func (a *App) CleanupEmptyReadyDirs() {
	readyDir := filepath.Join(a.ToolsDir, "Ready")
	entries, err := os.ReadDir(readyDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		subDir := filepath.Join(readyDir, e.Name())
		hasFiles := false
		filepath.Walk(subDir, func(_ string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				hasFiles = true
				return filepath.SkipAll
			}
			return nil
		})
		if !hasFiles {
			a.Logf("Cleanup: removing empty Ready dir: %s", e.Name())
			os.RemoveAll(subDir)
		}
	}
}
