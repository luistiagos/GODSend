# Features

Each item is a **high-level capability**, **how you use it**, and **how it works** under the hood.

## Desktop app (Electron) + backend

- **What:** Run the Go HTTP server with a full desktop UI — **Windows** (NSIS installer), **macOS** (DMG), or **Linux** (AppImage). Includes Xbox Library, FTP Manager, Aurora Asset Editor, ISO conversion tools, unified job queue, and one-click Aurora script deployment.
- **How:** Launch GODsend from the **Start menu** (Windows), **Applications** (macOS), or your **app launcher** (Linux; tray icon support depends on the desktop environment). Use the tray icon to open the window. Tools open as overlay panels on top of the current page (close with X, no back-navigation needed). Restart the backend from the home screen; optional **Launch at login** in Settings. Set **Backend server port** first (if needed), then under **Xbox connection** enter your Xbox IP and click **FTP Aurora Scripts to Xbox** — your computer’s LAN IP + selected backend port are patched into `state.lua` automatically and upload progress is shown file-by-file.
- **How it works:** Electron (TypeScript main process) spawns the Go backend (`godsend-backend` / `godsend-backend.exe`) with a writable runtime (`Transfer`, `Ready`, `Temp`, `cache`) and injects `GODSEND_*` environment variables from your settings. All FTP operations are centralised through the Go backend’s `ftp.Manager` (no npm FTP dependency). The React/Vite renderer communicates via typed IPC channels exposed through `preload.ts`.

## Minerva Archive (BitTorrent — no account needed)

- **What:** Xbox 360, OG Xbox, XBLA, DLC, XBLIG, and Game Archive libraries sourced from [minerva-archive.org](https://minerva-archive.org) — no account or login required. Works out of the box.
- **How:** When browsing any game library, select **Minerva Archive** as the source. Game lists are bundled in the installer so browsing is instant.
- **How it works:** The backend fetches the Minerva collection torrent, finds the requested file's index, and uses `aria2c` to download only that file via BitTorrent (`--select-file`). Pieces land in **torrent download temp** (by default the roomiest fixed NTFS/exFAT drive on Windows — `<drive>\godsend-temp\torrent-dl` — else `GODSEND_HOME/Temp/torrent-dl`; override via `GODSEND_TORRENT_TEMP` / Settings → **Torrent download temp**), then extract and convert to GOD in a co-located processing scratch on the same auto-selected drive (`<drive>\godsend-temp\proc`, else `GODSEND_HOME/Temp`) — so the entire multi-GB working set stays off a cramped app drive, and only the final split GOD/XEX files are written to the destination. **Windows** and **Linux** desktop builds ship a bundled `aria2c` next to the backend; the **Windows NSIS** installer can add OS firewall rules for `aria2c` so Windows does not prompt on first torrent use. **macOS** does not bundle `aria2c` — the backend prepends Homebrew to `PATH` and, if needed, tries a non-interactive Homebrew install plus `brew install aria2` at startup; if `sudo` is unavailable (typical when launched from the GUI), it sets **`SUDO_ASKPASS`** so the installer runs as your user and macOS shows the password dialog when Homebrew needs `sudo` (the installer cannot run as root). Progress is reported to the Aurora queue display every 3 seconds.

## Internet Archive account & parallel downloads (optional fallback)

- **What:** Authenticated downloads from archive.org collections — useful for titles not available on Minerva.
- **How:** Settings → **Internet Archive account** → **Log in**. Select **Internet Archive** as the source when browsing. Large files use automatic chunked parallel HTTP downloads (no connection slider).
- **How it works:** The app stores session cookies locally (not your password), passes them to the backend, which fetches items with multiple range-request workers for faster ISO/archive retrieval.

## Local Transfer folder (your own ISOs)

- **What:** Install disc games from `.iso` files you already have, without re-downloading from IA.
- **How:** Settings → set **Local Transfer folder** (or use the default runtime `Transfer` folder). Drop ISOs there. On the Xbox, open **Local Library** or trigger a title that matches a filename in that folder.
- **How it works:** For Xbox 360 / original Xbox / `local` browse, the backend prefers a matching ISO under `Transfer` over Internet Archive and runs the same conversion pipeline locally.

## Storage paths and temporary directories

- **What:** Control where GODsend stores working files — separate from Windows `%TEMP%`.
- **How:** Settings → **App data directory** (config, logs, caches), **Local storage path** (`GODSEND_HOME`: `Temp/`, `Ready/`, `Transfer/`, `cache/`), and **Temporary directories** (read-only **Processing temp** path plus configurable **Torrent download temp**).
- **How it works:** Electron writes `storagePath` / `torrentTempPath` to `config.json` and passes `GODSEND_HOME` / `GODSEND_TORRENT_TEMP` to the Go backend on spawn. Processing temp holds extraction, ISO→GOD, FTP staging, and post-torrent job folders; torrent temp is where aria2c writes active Minerva downloads (`gd-dl-*`) before they move into processing temp.

## Library metadata caches

- **What:** Faster startup after the first run; optional forced refresh when collections change.
- **How:** First launch may take a minute while lists build. In Settings, **Refresh Cache** rebuilds IA/ROM indexes in the background. On the console, **Server Queue & Status** shows aggregate cache readiness and per-platform detail.
- **How it works:** The server persists lists under `cache/` and serves `/browse` from memory; `/cache-refresh` and the Electron button trigger rebuilds without blocking the HTTP server indefinitely.

## Server queue, status, and job cleanup

- **What:** See everything the backend is processing or has finished; clear stuck or old jobs.
- **How:** Aurora → **Server Queue & Status** — refresh the list, open **Cache** for build state, **Clear ALL server jobs** or remove one job from its submenu.
- **How it works:** The script polls `/queue` and `/cache-status`. Removals call `/queue/remove` (GET/POST), which deletes entries and suppresses stray status updates for cleared games.

## Browse & install: Xbox 360 / original Xbox disc libraries

- **What:** Redump-style ISO libraries from Minerva Archive or Internet Archive, converted for Aurora. The script offers **GOD**, **DLC** (content install), or **XEX** for every title — pick the install layout that matches the disc.
- **How:** Main menu → **Xbox 360 Redump ISOs** or **Original Xbox Redump ISOs** → pick source (Minerva / Internet Archive) → letter folder → title → destination drive → install type → confirm. The backend downloads, converts, and pushes over FTP automatically. A **[Recommended]** label appears when the server can determine the correct layout from the disc.
- **How it works:** Backend downloads the ISO from Minerva (via BitTorrent) or Internet Archive (chunked parallel HTTP), or uses your local copy. Converts to GOD format natively (no external tools required), then pushes directly to the Xbox over FTP. If the Xbox is unreachable (e.g. a game was launched), the transfer is saved and retried automatically — no data is lost. Title names are resolved from XboxUnity → XboxDB → an embedded title list and used to name the GOD folder on the Xbox (e.g. `Open Season - 5454082A`) so Aurora shows the correct title.

## Multi-disc game support

- **What:** A game that ships on two or more discs arrives complete and ready to play: the playable disc lands in the games folder under the game's name, and the install disc lands in the console's content path.
- **How:** Queue the title once. In the app every disc of the release is queued together; from the Aurora dashboard or the HTTP API, `/trigger` adds the companion discs of the same release itself. Triggering a Disc 2+ title on its own still shows **GOD** or **Content** with a **[Recommended]** label in the Aurora menu; content discs land in `Content\0000000000000000\{TitleID}\00000002\` on the chosen drive.
- **How it works:** `/disc-info` uses verified disc-specific hints before download. Once the ISO exists, the server treats its XDVDFS layout as authoritative: populated `00000002`/`FFFFFFFF` installer trees select Content, while playable continuation discs remain GOD. Content discs often carry a generic placeholder Title ID (`FFED2000`) in `default.xex`; the real parent ID is read from the embedded STFS package before installation. Unknown titles therefore do not depend on a manually maintained name list.
  - Two shapes of release exist and both are handled. When the discs are **separate catalog entries**, `/trigger` enqueues every companion disc of the same release title, on every source path. When the whole release is **one archive** — the common case for XEX rips, such as the 15.4 GB `Grand.Theft.Auto.5.EUR.X360-ZTM.rar` — that archive holds the playable disc *and* the install disc, and every install path — XEX, GOD, ISO and content package alike — writes the install disc's content tree to the destination before writing the game, so nothing in the archive is discarded.
  - Such rips name their top-level folder after the disc (`Disc2`), not the game, so the destination folder uses the release title instead and the installed-games list shows *Grand Theft Auto V* rather than *Disc2*. Folders written by an earlier version keep their name; the installed-games scan resolves the real title from the Title ID, so an existing install displays correctly without reinstalling — it is still missing the disc that was dropped, and only a fresh install brings that in.
  - Which catalog rows are discs of the same release is decided in **one** place: `GET /browse/releases?platform=<p>` runs the same grouping `/trigger` uses to enqueue companion discs, and the browse view reads the answer instead of parsing the names itself. It used to have its own parser, which recognised fewer role labels — it required the literal word `Disc` inside the group and ignored bracketed tags — so releases such as Grand Theft Auto V, whose discs are named `(Disc 1) (Install)` and `(Disc 2) (Play)`, appeared as two separate one-disc versions of the game and picking either downloaded half the release.
  - When the disc set cannot be assembled — the companion disc is not listed in any available catalog under a matching release title, which is the case for roughly a third of the multi-disc rows — you are told **before** the download starts. The queue dialog names the missing disc and the download button stays disabled until you confirm you want it anyway; the version picker marks the incomplete release, which often sits beside a complete one. The same sentence is appended to the delivery message, so a release confirmed up front is not reported differently when the job finishes. Matching across region variants would install the wrong disc, so the warning is the honest outcome rather than a silent half install.
  - On a FAT32 pendrive an install package larger than 4 GB cannot be stored. The install is refused before a single byte is written and the provider chain looks for a GOD release instead, whose data is split into chunks that fit.

## Browse & install: XBLA, digital (No-Intro), DLC, Xbox Live Indie Games, 360 game archives

- **What:** Non-disc content (arcade packages, digital titles, DLC, indie games, pre-packed game archives) from Minerva Archive or Internet Archive.
- **How:** Choose the matching main-menu entry → pick source (Minerva / Internet Archive) → same browse flow. All content types show the drive picker so you can install to any drive.
- **How it works:** Backend downloads from Minerva (BitTorrent) or Internet Archive and unpacks archives natively (no external tools required), then FTPs content directly to the Xbox. Install type may be **GOD** (content tree to `[drive]\Games\`), **raw** (package to its content path), or **xex** (loose folder to `[drive]\Games\`). Both default to `Games`, the folder Aurora scans, unless a custom GOD/XEX path is configured or an existing games folder is detected on the target.

## Install layouts: GOD, XEX folder, content (DLC), raw, ROMs

- **What:** Different on-disk layouts depending on title type. The backend handles all conversion and packaging natively — no external tools required.
- **How:** After selecting a game and drive, the script asks **every** **Xbox 360 / Original / Local / Games Archive** title for **GOD / DLC / XEX**. Follow prompts until success, then **Settings → Content → Scan** in Aurora (or launch RetroArch for ROMs).
- **How it works:**
  - **GOD** — ISO is converted to Games on Demand format natively; the backend FTPs the content tree directly to `[drive]\GOD\{Name} - {TitleID}\` on the Xbox. If the Xbox goes offline mid-transfer (e.g. a game was launched), the job is saved and retried automatically — no re-download needed.
  - **DLC (Content)** — Content files are extracted from the ISO and FTP'd to `Content\0000000000000000\{TitleID}\00000002\` on the target drive. The correct Title ID is resolved from the disc's content packages automatically (see Multi-disc game support above).
  - **XEX** — The backend walks the XDVDFS filesystem for `default.xex`/`default.xbe`, extracts that game root, and writes it to `[drive]\Games\{folderName} - {TitleID}\` (the sub-path defaults to `Games`, the folder Aurora scans, unless a custom XEX path is set or an existing games folder is detected). The Title ID suffix is required, not cosmetic: rips of two-disc games ship a generic `Disc2` root folder, so without it two different titles resolve to the same destination and the second install silently overwrites the first.
  - **Raw** — Package is FTP'd directly to the appropriate content path on the target drive.
  - **ROM** — Archive is extracted and the ROM file is FTP'd to `[drive]\<ROM root>\<system folder>\` (configurable via Settings).

## Retro ROMs (EdgeEmu, many systems)

- **What:** Browse and install classic ROM sets scraped from EdgeEmu-compatible metadata (dozens of consoles/handhelds).
- **How:** **Retro ROMs** → pick system → folder → title → drive → same wait/install flow as other libraries.
- **How it works:** Backend fetches/builds per-system ROM lists (`rom_*` platforms), downloads archives when triggered, and emits a **rom**-type manifest with a drive-relative `rompath`. The script extracts under `[drive]\<ROM root>\<system folder>\`, where **ROM install path** in Settings sets the root (default `Emulators\RetroArch\roms`, passed to the backend as `GODSEND_ROM_PATH`).

## Persistent server logs

- **What:** Daily rotating log files that capture all backend activity — useful for diagnosing failed installs, FTP errors, IA download issues, or anything else that goes wrong.
- **How:** Logs are written automatically under **`logs/`** in Electron’s user-data directory (e.g. **`%APPDATA%\GODsend\logs\godsend-server-YYYY-MM-DD.log`** on Windows, **`~/Library/Application Support/GODsend/logs/`** on macOS — on Linux, use **Open logs folder** to see the exact path). On the home screen, click **Open logs folder** to open that directory in the system file manager.
- **How it works:** Each session opens with a banner that records app/Electron versions, OS, hostname, primary IPv4, `GODSEND_HOME`, backend executable path, effective Transfer folder, and all `GODSEND_*` environment variables (IA secrets redacted). Backend stdout/stderr are tagged `BACKEND_OUT`/`BACKEND_ERR`; UI events (FTP upload steps, cache refresh triggers, config saves, IA login) are tagged separately. Lines use ISO 8601 timestamps with PID so multi-process output is unambiguous.

## Xbox Library

- **What:** Live view of every game installed on your Aurora console — cover art, metadata, sorting, filtering, and drive management.
- **How:** Open **Xbox Library** from the home page. The first load downloads Aurora's content.db and settings.db via FTP and syncs cover art from RXEA assets, User/Import images, and online sources (Xbox CDN, XboxUnity). Subsequent refreshes use fingerprint-based caching (FTP SIZE checks and SHA-256 content hashes) to skip unchanged games — near-instant after the first sync. Use the **search bar** to filter by name, title ID, publisher, or developer. Sort by name, rating, last played, most played, drive, or favorites. Filter to favorites, on-drive, or multi-disc titles.
- **How it works:** `auroraLibraryService.ts` parses Aurora's SQLite databases into `AuroraGame[]` and probes FTP drives. `auroraVisualService.ts` syncs visual assets with a priority chain: User/Import files → RXEA `.asset` decode → GameAssetInfo.bin CDN URLs → GameCoverInfo.bin XboxUnity cover. Per-game fingerprints are stored in `visual-manifest.json` so unchanged assets are skipped on refresh. Covers render as CSS 3D box art (replacing the earlier WebGL approach that hit Chromium's ~16 context limit). Games with title IDs above `0x7FFFFFFF` (homebrew/unsigned) use unsigned 32-bit conversion to avoid negative hex strings. Per-game detail panels (Library Database, Asset Editor, Move to Drive, DLC & Title Updates, Save Games) are collapsible and lazy-load on first expand to keep initial page weight low.

## UI design system

- **What:** Cohesive OLED-friendly visual design across the desktop app — deep-space background, neon-green accents, monospaced body type, and consistent interaction states.
- **How it works:** The app uses a `#020617` OLED background with a `#22C55E` green accent, Orbitron headings + JetBrains Mono body via Google Fonts, smooth CSS transition tokens, and shared focus / hover states (cursor-pointer, focus-visible rings). The main nav highlights the active page with a green accent ring.

## FTP Manager

- **What:** Full file browser for your Xbox's filesystem — navigate, upload, download, cut/copy/paste, delete, rename, and create directories.
- **How:** Open **FTP Manager** from the home page (opens as an overlay panel). Browse the Xbox FTP root; right-click files or folders for Cut, Copy, Paste, Delete. Multi-select via Ctrl+Click and Shift+Click with a selection toolbar. The Clipboard dropdown shows pending items. Upload files via the upload button; transfers show streaming progress with speed and current filename.
- **How it works:** All FTP operations go through the Go backend's `ftp.Manager` (the `basic-ftp` npm dependency was fully removed in 2.8.4). 17 HTTP endpoints under `/ftp/*` handle list, upload, delete, mkdir, rename, copy, move, batch operations, and tracked async jobs. Cut uses FTP `RNFR`/`RNTO`; copy downloads to a temp file and re-uploads. The batch endpoint (`POST /ftp/batch`) executes multiple operations over a single FTP connection for efficiency.

## Aurora Asset Editor

- **What:** Search, preview, and upload cover, background, banner, icon, and screenshot artwork for any game on the console — using XboxUnity, Xbox CDN, or local image files.
- **How:** Open a game in the Xbox Library and scroll to the asset editor. Each slot (Background, Banner, Icon, Cover, Screenshots) shows the current image. Click **Search** to query XboxUnity by title name and ID, or **File** to pick a local image (JPEG/PNG/BMP/GIF). Staged uploads show a blue dot. Click **Save to Console** to push all staged images.
- **How it works:** The Go backend's `/rxea/encode` endpoint encodes images as RXEA `.asset` files (DXT5-compressed Xbox 360 Xenos GPU textures) and uploads them directly to `Aurora/Data/GameData/{dir}/` for immediate visibility without an Aurora rescan. `/rxea/decode` converts RXEA assets back to PNG for display. The backend accepts any Go-supported image format. XboxUnity search (`xbox:search-assets` IPC) queries the API by title ID and name, prepending Xbox CDN high-res covers when available.

## ISO to GOD and ISO to XEX tools

- **What:** Convert local `.iso` files to Games on Demand or XEX folder format without downloading anything — useful for ISOs you already have.
- **How:** Open **ISO to GOD** or **ISO to XEX** from the home page toolbox. Select an ISO file, choose a destination, and the backend converts and optionally transfers to the Xbox. Title names are resolved from XboxUnity → XboxDB → embedded title list → cleaned ISO filename (stripping region tags like "(USA)") as a final fallback.
- **How it works:** Uses the pure-Go ISO converter (`src/server/utils/iso2god.go`) via `/tools/iso2god`, `/tools/iso2xex`, and `/tools/probe-iso` HTTP endpoints. The probe endpoint reads disc metadata (title ID, media ID, disc number) without converting.

## DLC & Title Updates management

- **What:** Browse, install, activate, and remove DLC and Title Updates for any game on your Xbox — sourced from Minerva Archive, Internet Archive, and XboxUnity, with full awareness of what is already installed on the console.
- **How:** Open a game in the Xbox Library and expand the **DLC & Title Updates** section. Installed and candidate rows are merged into a single list per content type. Click **Install** to queue a download + FTP transfer; click the **Active / Inactive** toggle on an installed Title Update to switch versions (other TUs in the same folder are auto-disabled by renaming to `.disabled`). Use **Delete** / **Move** to remove or relocate content.
- **How it works:** The renderer issues `/content/discover` (DLC scan + Minerva / IA candidates) and `/content/tu` (XboxUnity Title Updates) independently so each list streams in as soon as its source responds. Installs go through `/content/queue` — the Minerva path downloads via `aria2c` torrent and the direct-URL path streams from XboxUnity / Internet Archive. The `.godsend.json` marker is written **before** upload so half-transferred files can still be matched back to their catalog entry on rescan. `/content/set-active` activates a single TU by renaming siblings to `.disabled`. The Aurora library background poll uses `lock_wait_ms` on `/ftp/batch` so a long upload no longer blocks the UI — when the FTP lock is busy, the renderer serves the last cached `content.db` / `settings.db` instead of spinning.

## Save game management & profile backup

- **What:** Browse, back up, restore, and delete Xbox 360 profile packages and per-game saves directly from the desktop app. One-click **Save Game Backup** pulls every profile and every save for every profile on the connected console into a local archive folder.
- **How:** Open a game in the Xbox Library and expand the **Save Games** section to list per-profile saves for that title — download a single save to the local backup folder, delete it from the console, or copy it between profiles. To back up everything at once, open **Settings → Save Game Backup** and click **Back up all profiles**. Bulk backups are organised by gamertag.
- **How it works:** The Go backend's `saves.Service` walks `/Content/<XUID>/...` over FTP, reading each profile's gamertag from the embedded `Account` blob — the file table is parsed with proper L1/L2 hash-table padding, the `Account` payload is decrypted with `RC4(HMAC-SHA1(RETAIL_KEY, file[0:0x10]))`, and the UTF-16BE gamertag is read from decrypted offset `0x10`. Both retail and devkit keys are tried (matches Velocity / py360 behaviour); the ASCII-scan heuristic is kept only as a last resort. Per-title display names are resolved through the existing XboxUnity → XboxDB → embedded list chain. Files land at `<localDir>/Saves/<gamertag> (<XUID>)/<gameName> - <titleID>/<files>` with the profile package at `<gamertag> (<XUID>)/Profile/<XUID>`; filesystem-unsafe characters in gamertags are sanitised. Endpoints: `/saves/discover`, `/saves/list`, `/saves/download`, `/saves/delete`, `/saves/copy`, `/saves/backup-all`, `/saves/keyvault-status`.

## BadAvatar USB tool (BadUpdate exploit builder)

- **What:** Build a bootable Xbox 360 USB stick that triggers the **BadUpdate** payload — a hardware-free RGH-style exploit that lets a stock console run unsigned code. Combines a FAT32 format step with the BadStick payload installer in a single Toolbox flow. Optional Proto, FreestyleDash, and Aurora (XeUnshackle build) are included by default; **Overwrite existing** and **Format USB** are also on by default.
- **How:** Plug in a USB stick, open **Toolbox → BadAvatar USB**, pick the drive, choose your payload options, and click **Build**. Progress streams file-by-file. On Windows the formatter handles large drives without the 32 GB limit; on macOS and Linux the formatter is built-in.
- **How it works:** The Electron service `badAvatarUsbService.ts` orchestrates the workflow over `tools:badavatar-*` IPC channels handled in `badAvatarHandlers.ts`. Formatting uses platform-native tools — `infrastructure/fat32Format.ts` invokes Ridgecrop `fat32format.exe` on Windows (bundled into the installer via `scripts/download-fat32format.js` → `dist/tools/`), `newfs_msdos` / `diskutil` on macOS, and `mkfs.vfat` / `mkfs.fat` on Linux. Payload files are pulled from the [BadStick](https://github.com/LxcyDr0p/BadStick) release packages.
- **2 TB ceiling per drive:** every `diskpart` path in `fat32Format.ts` partitions as **MBR**, because that is what the Xbox 360 reads. MBR and FAT32 each cap a volume at 2 TiB, so a 4 TB disk ends up at ~2 TB with the remainder unreachable — expected, not a formatting failure, and not recoverable with a second partition. Above 32 GB the main path formats the *existing* partition and only falls back to `diskpart` (which converts to MBR) when that fails, which is how a 4 TB GPT disk becomes 2 TB. The partition handed to `fat32format` is created **without a file system** on purpose: `fat32format` writes sectors straight to the volume, and Windows only allows that raw write where no file system is mounted (a mounted NTFS volume fails it with `GetLastError()=5`). Because of that, Windows may briefly pop its own *“You need to format the disk in drive X:”* dialog while the FAT32 format runs — ignore it, it disappears when the format finishes. If the format fails after we removed the file system, the partition is put back to NTFS so the drive does not stay in a RAW state. Windows Defender's **controlled folder access** (ransomware protection) blocks that same raw write and reports it as “Unauthorized changes blocked”; when it is in a blocking mode the elevated format script allowlists the bundled `fat32format.exe` for the duration of the format and removes it again afterwards, so the user never has to open Windows Security. If Defender is policy-managed and the allowlisting is refused, the error message spells out the manual path and the exact executable to allow. Selecting a disk larger than 2 TiB shows an amber notice with that disk's real numbers — how much is unreachable, and that a second partition cannot recover it. It **warns, it does not block**: 2 TB works fine, so the ceiling deliberately stays out of `assessDeviceSafety`, whose codes are all blocking. See [capacity and free space](CAPACIDADE-E-ESPACO.md#teto-de-2-tib-por-volume).
- **Crash diagnostics on the console:** the `launch.ini` written by `infrastructure/readyToPlayConfiguration.ts` sets `Dumpfile = Usb:\crashlog.txt`, so an exception caught by DashLaunch's handler lands on the prepared stick instead of going only to the UART. Two crash handlers run in this environment — DashLaunch's `exchandler` and Aurora's own, which writes `Aurora\Data\Logs\<ts>.crash.log` plus `.callstack` — so when a user reports a crash such as the *Fatal Crash Intercepted!* banner, ask for **both** `crashlog.txt` and the contents of `Aurora\Data\Logs\`. Which one exists identifies the handler. See [`docs/bugs/open/2026-09-05-fatal-crash-intercepted-pendrive-preparado.md`](bugs/open/2026-09-05-fatal-crash-intercepted-pendrive-preparado.md).
- **What is deliberately not copied:** the BadAvatar package was captured from a real console, so `fixedBadAvatarPreparationService.ts` filters out its leftover state (`isForeignConsoleStatePath`) — Aurora and FreeStyle logs, Aurora crash dumps, and the FreeStyle `content.db`/`settings.db`, which describe games on an internal HDD serial that does not exist on the user's stick. Aurora and FreeStyle rebuild these on first boot. The corrupted profile under `Content/` is kept: it is the exploit vector, not stale state.

## Move Game to Drive

- **What:** Move a game from one Xbox drive to another directly from the Library page.
- **How:** Open a game's detail view in the Xbox Library, select a target drive from "Move to Drive" (the current drive is excluded), and click Move. Progress, transfer speed, and current file are shown in real time. The job persists across page navigation.
- **How it works:** The `xbox:move-game` IPC handler queues an FTP job through the Go backend. Uses FTP rename (`RNFR`/`RNTO`) when supported (fast, same-drive moves); falls back to download-reupload-delete for cross-drive moves. FTP timeout is 120 seconds for large transfers. Double-slash path bugs (from Aurora's leading-slash DB entries) are stripped. The local Aurora library cache auto-syncs after completion.

## Unified Job Queue

- **What:** Single view of all active work — game pipeline jobs and FTP Manager jobs merged together.
- **How:** Open **Job Queue** from the home page. Each job shows its source (Store vs FTP), state, progress bar, transfer speed, and current file detail. Remove completed or stuck jobs individually.
- **How it works:** The Queue page merges jobs from `/queue` (game pipeline) and `/ftp/jobs` (FTP Manager tracked jobs) into one unified list. Progress bars and percentage hide for completed/errored jobs.

## Download queue survives closing the app

- **What:** Close the application in the middle of a download and the queue is still there when you reopen it — the transfer continues from where it stopped instead of starting over.
- **How:** Nothing to enable. Queue a game, close the app, open it again: the Job Queue lists the same jobs and downloading resumes on its own. A job that had already failed comes back as **Erro** so you decide whether to press **Tentar novamente**.
- **How it works:** `/trigger` writes a record per job under `pending_queue/` (destination, install type, provider priority) and `app.LogStatus` updates its state on every transition. At startup `Deps.ResumeQueuedJobs` reads those records, restores the destination and install type, and relaunches each unfinished job through the same path the Retry button uses. The record also names the job's partial download, which the startup scratch cleanup then preserves along with its `.xbox-companion-resume.json` marker, so `DownloadWithProgress` continues from the byte it reached. The record also stores the download URL, and `resumePriority` moves that source to the front of the provider list — otherwise a provider tried ahead of it would fail on a catalogue miss and the scratch cleanup between providers would delete the file being resumed.

## Auto Aurora sync

- **What:** After a game is downloaded and transferred to the Xbox, cover art and the local library cache update automatically — no manual refresh needed.
- **How:** Automatic; no user action required. After any successful game FTP transfer or drive move, the app fetches cover/background/banner/icon from XboxUnity and Xbox CDN, uploads them to `Aurora/User/Import/{TitleId}/`, and re-downloads content.db + settings.db.
- **How it works:** `autoSyncService.ts` listens for backend FTP completion events. `autoUploadAuroraAssets` fetches artwork from multiple CDN sources and uploads via FTP. `doAuroraLibrarySync` re-downloads Aurora databases to keep the Library page current.

## Overlay navigation

- **What:** Settings, Job Queue, Browse & Download, ISO to GOD, ISO to XEX, and FTP Manager open as overlay panels on top of the current page instead of navigating away.
- **How:** Click any of those buttons — the panel slides in over the current view. Close with the X button. No back-navigation required; the page underneath is preserved.
- **How it works:** React overlay components mount on top of the existing route, keeping Library or Home state intact while tools are used.

## In-app updates and the auto-check notice

- **What:** The app checks for new versions on its own and offers the download in a modal. If you switch that automatic check off, the home page shows a notice with a **Verificar agora** button, so a new version is still reachable in one click.
- **How:** Nothing to do by default — about 3.5 s after launch the app checks and, when a newer version exists, the update modal opens by itself. You can also check on demand in **Configurações → Verificar atualizações**. If **auto-check is disabled** in Settings, an amber bar appears at the top of the home page saying the automatic check is off; **Verificar agora** runs a forced check and opens the same modal when an update is found.
- **How it works:** `autoUpdateService.ts::checkForUpdates(force)` compares `app.getVersion()` against the remote `version.json`. With `force=false` it returns early in two cases — the `autoCheckUpdates` preference being off, and a 12-hour throttle (`TWELVE_HOURS_MS`) since the last check — and it also suppresses a version the user dismissed (`getSkippedUpdateVersion() === latestVersion`, a single stored string, so publishing any newer version makes the modal reappear). The startup check in `App.tsx` uses `force=false`; both the Settings button and the home-page notice use `force=true`, which bypasses the preference and the throttle. All three routes open the same `AppUpdateModal` through an `onOpenUpdateModal` callback owned by `App.tsx`.

## Developer / diagnostics

- **What:** Quick HTML snapshot of cache, transfer folder, ready games, and jobs.
- **How:** From a browser on the same machine as the backend, open `http://<host-ip>:<port>/debug` while the server is running.
- **How it works:** The server renders live in-memory and filesystem state for troubleshooting.
