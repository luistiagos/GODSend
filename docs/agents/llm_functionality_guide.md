# LLM Technical Functionality Guide (Standalone Developer Reference)

This document is the unified, standalone technical reference for the GODsend-360 codebase. It contains complete architectural overviews, API contracts, domain type definitions, Go/Node/Lua algorithms, safety policies, database schemas, and release workflows. Any AI agent modifying, debugging, or extending this project should consult this guide first.

---

## 1. System Architecture & Component Mapping

GODsend-360 is structured into three main layers that interact over a local area network (LAN) and physical storage media.

```
┌───────────────────────────────────────┐
│       Electron Desktop App            │
│       (TypeScript / React)            │
│  - App Settings & Local Path Config   │
│  - SQLite Parser (Aurora DB Sync)     │
│  - Transactional USB Exploit Builder  │
└──────────────────┬────────────────────┘
                   │ Child Process / IPC
                   ▼
┌───────────────────────────────────────┐          FTP Protocol          ┌───────────────────────────────────────┐
│              Go Backend               │───────────────────────────────>│             Xbox 360                  │
│            (HTTP Server)              │<───────────────────────────────│         (Aurora Dashboard)            │
│  - Native ISO -> GOD/XEX Conversion   │    (HTTP Asset / Game Pull)    │  - Lua GUI Menu (Browser & Trigger)   │
│  - Chunked Parallel Downloader       │                                │  - STFS Profile Storage (Saves)       │
│  - Core FTP Manager (IP Locks)        │                                │  - Aurora FTP Server (Port 21)        │
└───────────────────────────────────────┘                                └───────────────────────────────────────┘
```

### Component Code Registries
* **Go Backend**: Rooted in `src/server/`. Follows a DDD-like layout with constructor-based dependency injection.
* **Electron App**: Rooted in `src/electron-app/`. Runs TypeScript main process code, preload bridges, and React renderer components.
* **Aurora scripts**: Rooted in `aurora-scripts/`. Pure Lua 5.1 code operating within Aurora's execution environment.

---

## 2. Directory Layout & Package Roles

### Go Backend (`src/server/`)
```
src/server/
├── app/               # Central app.App struct, configuration defaults, path setup
├── data/              # Static game databases and title lookup caches
├── embed_titles.go    # Embeds iso2god_titles.jsonl database into binaries
├── infrastructure/    # Side-effect adapters (filesystem, download clients, FTP, aria2c)
├── interfaces/http/   # HTTP handlers, routers, and panic-recovery middleware
├── main.go            # Minimal wiring entry point (no business logic)
├── models/            # Pure domain models, enums, and repository interfaces
├── services/          # Business logic: pipelines, save games, caches
└── utils/             # Core codecs (iso2god conversion, RXEA asset encoding)
```

### Electron Desktop App (`src/electron-app/`)
```
src/electron-app/
├── app/               # Electron bootstrap lifecycle, tray config, window instantiation
├── infrastructure/    # Operating system helpers (FAT32 formatter, device enumerators, logs)
├── ipc/               # Direct IPC handlers mapping UI requests to backend HTTP or OS APIs
├── preload.ts         # Secure IPC preload bridge exposing window.godsendApi
├── renderer/          # React + Vite components (HomePage, LibraryPage, QueuePage, Settings)
├── services/          # Business/application state (Settings, SQLite library parser, Asset sync)
└── tsconfig.json      # TypeScript compiler instructions (CommonJS target, in-place compile)
```

### Aurora Lua Scripts (`aurora-scripts/`)
```
aurora-scripts/
├── main.lua           # Script metadata and main loop orchestrator
├── state.lua          # Shared mutable globals and server connectivity config
├── http_client.lua    # Defensive HTTP utilities, JSON parsers, and errors
├── services.lua       # Background-oriented triggers (triggerDownload, installGame)
└── menu.lua           # In-dashboard UI layout and navigation loops
```

---

## 3. Go Backend Domain Types

These structs, defined in [types.go](file:///e:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server/models/types.go) and [game.go](file:///e:/projects/Downloader-XBOX360-XEX-HDD-Games/src/server/models/game.go), govern the core logic of the Go server:

```go
type Platform string
const (
	PlatformXbox360 Platform = "xbox360"
	PlatformXbox    Platform = "xbox"
	PlatformXBLA    Platform = "xbla"
	PlatformDigital Platform = "digital"
	PlatformDLC     Platform = "dlc"
	PlatformXBLIG   Platform = "xblig"
	PlatformLocal   Platform = "local"
)

type JobStatus string
const (
	JobStatusIdle       JobStatus = "Idle"
	JobStatusProcessing JobStatus = "Processing"
	JobStatusReady      JobStatus = "Ready"
	JobStatusError      JobStatus = "Error"
)

type IAGameEntry struct {
	CollectionID string `json:"collection_id"`
	FileName     string `json:"filename"` 
}

type PlatformCache struct {
	Games       []string               `json:"games"`
	GameEntries map[string]IAGameEntry `json:"game_entries"` 
	BuildTime   time.Time              `json:"build_time"`
}

type MinervaEntry struct {
	FileName  string `json:"filename"`   
	PathParam string `json:"path_param"` 
}

type MinervaPlatformCache struct {
	Schema    int                     `json:"schema,omitempty"` 
	Games     []string                `json:"games"`
	Entries   map[string]MinervaEntry `json:"entries"` 
	BuildTime time.Time               `json:"build_time"`
}

type XboxConnection struct {
	IP        string `json:"ip"`
	Drive     string `json:"drive"`
	LocalRoot string `json:"local_root,omitempty"`
	GameName  string `json:"game"`
	Platform  string `json:"platform"`
	Mode      string `json:"mode"` // "ftp", "local", "http"
	Timestamp time.Time
}

type PendingFTPJob struct {
	ID          string    `json:"id"`
	GameName    string    `json:"game_name"`
	Platform    string    `json:"platform"`
	XboxIP      string    `json:"xbox_ip"`
	Drive       string    `json:"drive"`
	Mode        string    `json:"mode"`
	SourceDir   string    `json:"source_dir"`
	TitleID     string    `json:"title_id,omitempty"`
	MediaID     string    `json:"media_id,omitempty"`
	ContentType string    `json:"content_type,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}
```

---

## 4. Complete REST HTTP API Specification

The Go backend runs an HTTP server on `127.0.0.1:8080` (or `GODSEND_PORT`). 

### Game Navigation & Queue Control
* **`GET /browse?platform=<p>&source=<s?>`**: Returns game entries split by `\n` or `|`. 
  * `platform` options: `xbox360`, `xbox`, `xbla`, `digital`, `dlc`, `xblig`, `games`, `local`, `rom_<sysid>`.
  * `source` optional filters: `ia` or `minerva`.
* **`GET /status?game=<name>`**: Polls processing state of a queued item. Returns plain text: `Idle`, `Processing`, `Ready`, `Error`, or `Missing`.
* **`GET /queue`**: Returns a JSON array of all active and historical jobs in the pipeline.
* **`GET /trigger?game=<name>&platform=<p>`**: Begins downloading/converting a game. Aurora triggers this via GET.
* **`GET /register?game=<name>&ip=<xbox-ip>&drive=<d>&platform=<p>`**: Connects an active install request with console parameters for the automatic FTP loop.
* **`GET /files/<name>/...`**: HTTP file server mapping to the `Ready/` output staging folder.
* **`GET/POST /queue/remove?game=<name>`**: Deletes a game from the server queue. If `game` is omitted, the entire queue is cleared.

### Diagnostics & Storage
* **`GET /cache-status`**: Returns JSON showing per-platform cache build progress (`Loaded`/`Total`) and state.
* **`GET /cache-refresh?platform=<p>`**: Triggers asynchronous rebuild of the cache lists (`all`, an individual platform, or a `rom_<sys>` code).
* **`GET /disc-info`**: Inspects local ISOs dropped in the `Transfer/` folder. Returns Title ID and Media ID details to assist multi-disc selection.
* **`GET /data/status`**: Returns JSON containing `active_jobs`, `pending_ftp_jobs`, and `local_data_mb` (the sum of `Ready/` and `Temp/` folders).
* **`GET /data/clear`**: Deletes all compiled artifacts inside `Ready/` and `Temp/`, and wipes pending FTP files.

### DLC & Title Updates (TUs)
* **`GET /content/discover?titleId=<id>`**: Scans the console via FTP for installed DLCs and queries Minerva/IA indexes for downloadable candidates.
* **`GET /content/tu?titleId=<id>`**: Fetches Title Updates from XboxUnity, merging with already installed versions.
* **`GET /content/installed?titleId=<id>`**: Returns list of DLC/TUs currently sitting on the target Xbox.
* **`GET /content/sources?titleId=<id>`**: Lists availability of Minerva torrents vs Direct HTTP mirrors for a content package.
* **`POST /content/queue`**: Add a DLC/TU task to the downloader + FTP pipeline.
* **`POST /content/set-active`**: Swaps the current active Title Update on the Xbox over FTP. Other updates in the same Title ID path are renamed to `<name>.disabled`.

### Save Game & Profile Management
* **`GET /saves/discover?titleId=<id?>`**: Discovers profile packages (`E000...` folders) on the Xbox and matches files to gamertags.
* **`GET /saves/list?titleId=<id>&profileId=<xuid>`**: Details individual file names, sizes, and timestamps for a profile's save folder.
* **`POST /saves/download`**: Requests pulling profile STFS containers or game folders to the local backups folder.
* **`POST /saves/delete`**: Deletes profile packages or specific game saves on the console.
* **`POST /saves/copy`**: Clones save packages between profiles. Requires KeyVault processing if profiles differ.
* **`POST /saves/backup-all`**: Runs a bulk walk of `/Content/` on the Xbox, copying all profiles and game saves to the local storage path.
* **`GET /saves/keyvault-status`**: Queries if a decrypted console `KV.bin` is staged to support cross-profile signing.

### Tools & Asset Codecs
* **`POST /tools/probe-iso`**: Performs a partial byte scan of a local ISO filesystem (XDVDFS), extracting Title ID, Media ID, and Disc Number.
* **`POST /tools/iso2god`**: Converts a local ISO into GOD containers on the server disk.
* **`POST /tools/iso2xex`**: Extracts a local ISO into loose XEX files.
* **`POST /rxea/decode`**: Decodes a raw binary `.asset` cover file from Aurora into standard PNG buffers.
* **`POST /rxea/encode?slot=<n>`**: Encodes PNG/JPG files into DXT5 GPU textures packaged inside a binary `.asset` slot.
* **`POST /rxea/encode-multi`**: Encodes multiple layouts/slots into a single Aurora asset package.

### Console FTP Utilities
* **`GET /ftp/ping`**: Verifies simple socket validation to the Xbox FTP port (21).
* **`GET /ftp/test`**: Performs a diagnostic connection test (login, directory list, write permission, latency).
* **`POST /ftp/list`**: Returns directory contents on the console.
* **`POST /ftp/mkdir`**: Recursive directory creator (`MkdirAll`).
* **`POST /ftp/delete`**: Deletes files or directory trees.
* **`POST /ftp/rename`**: Standard FTP `RNFR`/`RNTO` directory/file mover.
* **`POST /ftp/size`**: Returns precise byte lengths.
* **`POST /ftp/download-file`**: Streams a file from the console to the local backend.
* **`POST /ftp/upload-file`**: Streams a file from the local backend to the console.
* **`GET /ftp/drives`**: Returns list of drives mounted on the console (filters to `/Hdd\d*`, `/Usb\d*`, `/Mu`, `/OnBoardMU`).
* **`POST /ftp/batch`**: Executes multi-command operations over one connection.
* **`POST /ftp/upload`**: Queues an upload job into the backend's async FTP system.
* **`POST /ftp/copy`**: Copies files console-to-console.
* **`POST /ftp/move-game`**: Relocates a game between console drives.
* **`POST /ftp/upload-scripts`**: Uploads modified Lua client scripts to the console's Aurora utility path.
* **`GET /ftp/jobs`**: Lists tracked async FTP uploads and moves.
* **`POST /ftp/jobs/remove`**: Deletes completed or failed jobs from the FTP queue tracker.

---

## 5. Go Core Algorithms & Logic

### 5.1 Native ISO to GOD Conversion
The backend converts Xbox ISOs to the standard Games on Demand (GOD) package format entirely in Go, removing dependencies on legacy Windows CLI tools.

```
Input ISO File (XDVDFS Filesystem)
  ├── 1. Read Sector 32 (Volume Descriptor) to locate root directory
  ├── 2. Extract Title ID, Media ID, and Disc Info from default.xex header
  ├── 3. Map input sectors directly to GOD block indexes
  ├── 4. Generate STFS Headers:
  │    ├── Apply empty_live.bin CON template
  │    └── Patch Title ID, Media ID, and License Data into header offsets
  └── 5. Write Data Parts:
       └── Split sectors into files capped at 170,000,000 bytes (e.g. data.0000)
```

* **STFS Package Layout**: Writes a `LIVE`/`CON` package container. File structural offsets match standard Microsoft layouts, setting the Content Type to `0x00007000` (Games on Demand).
* **Title Verification**: Reads the PE header of `default.xex` (or `default.xbe` for original Xbox) to parse the execution ID block. This extracts the 8-character hex Title ID and 8-character hex Media ID.

### 5.2 RXEA Cover Codec (DXT5 Compression)
Aurora dashboard covers, backgrounds, and banners are stored in binary packages called `.asset` files, encoded in the RXEA format.
* **Format Header**: The file begins with the ASCII signature `RXEA`. It contains index maps indicating slots for different assets (0: Cover, 1: Background, 2: Icon, 3: Banner, 4-9: Screenshots).
* **Texture Encoding**: Raw image formats (PNG, JPG, BMP) are parsed, decoded, and converted to DXT5 block texture compression (BC3) using standard block-quantization algorithms.
* **Texture Decoding**: The Go codec reads the DXT5 texture blocks, extracts the color and alpha lookup tables per 4x4 pixel block, and reconstructs a PNG buffer to send back to the Electron frontend.

### 5.3 FTP Connection Pool & "Offline" Resumption
* **Connection Lock Mutex**: The backend manages a pool of FTP clients. Because console FTP servers are unstable under parallel connections, all operations to an IP address are serialized using a channel-based mutex lock (`lock_wait_ms`).
* **Async Job Resumption (`pending_ftp/`)**:
  * Upload tasks are stored in `pending_ftp/` before starting execution.
  * If a transfer fails (e.g., connection timed out or closed by the host because the console launched a game), the backend transitions the job to `retrying` status.
  * The executor retries the FTP socket connection in the background using an exponential backoff loop (`30s` -> `60s` -> `120s` -> `300s` max).
  * On a successful connection, it checks the target file size, rolls back partially written blocks using the FTP `REST` command, and resumes uploading.

### 5.4 Profile Parsing & Decryption
Xbox profile packages store player identities in STFS packages. To extract a profile's gamertag, the backend decodes the binary `Account` file inside the profile's subfolder:

1. **HMAC-SHA1 Key Verification**: The first 16 bytes of the `Account` blob contain an HMAC-SHA1 signature.
2. **RC4 Decryption**: The remainder of the blob is encrypted. The decryption key is generated by computing:
   `Key = HMAC-SHA1(ConsoleKey, Signature)`
3. **Key Candidates**: The decrypter attempts decryption using the standard Retail Console Key (`E2 5A ...`) first. If the checksum verification fails, it retries using the Devkit Console Key (`4A C8 ...`).
4. **Gamertag Extraction**: The decrypted buffer contains the profile's gamertag encoded in UTF-16BE starting at offset `0x10`. The service parses this string and sanitizes it for use in local backup folders.

---

## 6. Electron Application Mechanics

The Electron shell manages the Go backend process, handles settings, and parses local databases.

### 6.1 Process Spawning & Environment
The Electron main process spawns the Go server as a child process, configuring it using environment variables:

```typescript
export function buildGodsendEnv(writableRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GODSEND_HOME: writableRoot };
  // Sets transfer, backup, and connection settings
  env.GODSEND_PORT = String(getConfiguredServerPort());
  env.GODSEND_FTP_USER = getConfiguredFtpUser();
  env.GODSEND_FTP_PASS = getConfiguredFtpPassword();
  
  // Controls Error Reporting (Telemetry)
  const errorReporting = getConfiguredErrorReporting();
  env.GODSEND_ERROR_REPORTING = errorReporting ? "1" : "0";
  const errorReportingEndpoint = getConfiguredErrorReportingEndpoint();
  if (errorReportingEndpoint) env.GODSEND_ERROR_REPORTING_ENDPOINT = errorReportingEndpoint;

  return env;
}
```

### 6.2 Preload IPC Contract (`preload.ts`)
The React UI is isolated and cannot import Node modules. It communicates with the main process via IPC channels defined in `preload.ts`:

* **`config:*`**: Handles setting and reading paths, port values, and Internet Archive credentials.
* **`xbox:*`**: Handles console pings, FTP directory queries, Aurora asset operations, and Title Update selection.
* **`tools:*`**: Handles ISO conversions, BadAvatar formatting, and raw file manipulation.
* **`saves:*`**: Handles save management triggers and backup progress reporting.
* **`telemetry:report`**: Exposes the error reporting tool to the React frontend.

---

## 7. Transactional USB Exploit Writer (BadAvatar USB)

The BadAvatar USB tool builds a bootable USB drive to launch the BadUpdate exploit. To prevent data corruption on FAT32 filesystems and protect console integrity, it implements a secure transactional write pipeline.

```
                            [Clean Image Staging]
                                      │
                                      ▼
                        [Physical USB Safety Filters]
                                      │
                         ┌────────────┴────────────┐
                         ▼                         ▼
                 [Verification OK]         [Validation Failed]
                         │                         │
                         ▼                         ▼
                [Generate Write Plan]          [ABORT WRITER]
                         │
                         ▼
             [Write Transaction Journal]
                         │
         ┌───────────────┴───────────────┐
         ▼                               ▼
 [Files Exist (Same SHA)]        [Files Differ / New]
         │                               │
         ▼                               ▼
 [Skip (No Write)]              [Create Backup copy]
                                         │
                                         ▼
                               [Stage Temporary File]
                                         │
                                         ▼
                               [Verify SHA-256 Hash]
                                         │
                                         ▼
                                [Atomically Rename]
                                         │
                                         ▼
                                [Clean staging/backup]
```

### 7.1 Safety Policies
* **Physical Target Validation**:
  * The target drive must be external (connected via USB).
  * The drive cannot be the system boot drive, partition zero, or a drive with multiple partitions.
  * The volume must be formatted as FAT32, with a partition size greater than 1GB.
* **NAND Security Lock**: The writer blocks writing system files like `KV.bin`, `OriginalMACAddress.bin`, `updflash.bin`, or custom `launch.ini` structures to the drive. It always generates a canonical `launch.ini` with safe settings.

### 7.2 Staging & Verification
* **Zip Slip Mitigation**: During ZIP extraction, the extractor verifies all target paths. It throws an error if a path attempts to traverse outside the staging directory (e.g. using `../` patterns).
* **Allocation and Capacity Assessment**:
  * Before writing, the system runs a dry-run check.
  * It calculates cluster sizes, directories, journal space, and staging requirements.
  * A minimum safety buffer is reserved on the drive (the larger of 128MB or 2% of the drive's total space). If the free space drops below this buffer, the write operation is blocked.

### 7.3 Write Plan & Resumption
The writer generates a JSON transaction journal (`.xbox-downloader/journal.json`) containing file paths, sizes, and SHA-256 hashes:

```json
{
  "transactionId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "status": "pending",
  "planHash": "a1b2c3d4...",
  "entries": [
    {
      "id": "entry-0",
      "targetPath": "BadUpdatePayload/default.xex",
      "sha256": "e3b0c442...",
      "status": "pending"
    }
  ]
}
```

* **Atomic Renaming (Promotion)**: Files are written to a temporary staging path first (e.g. `BadUpdatePayload/default.xex.uuid.tmp`). Once the written file's SHA-256 hash is verified, the writer atomically renames it to its final destination path.
* **Interrupted Write Resumption**: If the USB drive is unplugged during a write operation, the system re-reads `journal.json` upon reconnection. It checks the integrity of completed files and resumes the write plan from the last verified block.

---

## 8. Aurora Client Integration (Lua)

The Aurora client scripts run in the console's dashboard environment, providing the frontend UI for browsing libraries, monitoring downloads, and triggering installations.

### 8.1 Configuration (`GODSend.ini`)
The client script loads connection parameters from `GODSend.ini`, located in the scripts folder:

```ini
[Connection]
ServerIP = 192.168.1.50
ServerPort = 8080

[Settings]
DefaultDrive = Hdd1
SimpleMode = 1
```

### 8.2 Execution Lifecycle
1. **Network Initialization**: `state.lua` reads `GODSend.ini` and tests the server connection.
2. **Library Browsing**: The menu loop in `menu.lua` requests game lists from the Go backend (`GET /browse?platform=...`).
3. **Job Queue Synchronization**: `showQueue` in `menu.lua` polls the backend (`GET /queue`) every 3 seconds to update download progress and status in the dashboard UI.
4. **Game Trigger Flow**:
   * The user selects a game from the list.
   * The script calls `GET /register` to register the console's IP and chosen installation drive.
   * It then calls `GET /trigger` to start the download and conversion pipeline on the Go backend.
   * The backend converts the game and transfers it to the console over FTP. Once the transfer completes, the console script registers the game into Aurora's database.

---

## 9. Developer CLI & Workflows

### 9.1 Development Commands
Run these commands from the project root:
* **Install Node Dependencies**:
  ```bash
  npm install
  ```
* **Run Electron App (Dev Mode)**:
  ```bash
  npm start --prefix src/electron-app
  ```
* **Build Go Backend (macOS Apple Silicon)**:
  ```bash
  go build -C src/server -o ../../dist/godsend-mac .
  ```
* **Run Playwright Integration Tests**:
  ```bash
  npx playwright test --prefix src/electron-app
  ```

### 9.2 Release & Packaging Pipeline
The project uses `npm run build:*` scripts to package releases. 

1. **Clean Binaries**:
   * Cross-compiles the Go backend to target architectures using `CGO_ENABLED=0`.
   * Packages Electron applications (Windows installers are built using `Wine` when packaged on macOS hosts).
2. **Binary Uploads**:
   * Releases are uploaded to GoFile (using the persistent account token in `.gofile-io-token`) and mirrored to file.kiwi.
   * Each file is uploaded individually without a parent folder ID.
3. **Readme Sync**:
   * The release script updates the version numbers and download links in [README.md](file:///e:/projects/Downloader-XBOX360-XEX-HDD-Games/README.md) and [docs/headless-setup.md](file:///e:/projects/Downloader-XBOX360-XEX-HDD-Games/docs/headless-setup.md).
4. **Commits**:
   * Commits are pushed to the **github** remote branch. Do not create Git tags or GitHub releases.
