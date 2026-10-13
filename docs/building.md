# Building

Requires **Go 1.21+** and **Node.js 18+**. No third-party tool binaries are needed — ISO conversion and archive extraction are handled by the Go backend natively. **Packaged desktop builds** place the Go backend next to the app executable as **`godsend-backend`** (`.exe` on Windows) and ship the Aurora Lua scripts under **`resources/`**; Electron starts the backend when the app launches.

From the repository root:

```
npm install
npm run build
```

`npm install` pulls in Electron app dependencies (`postinstall` runs `npm install` under `src/electron-app`). `npm run build` cross-compiles Go for Windows, Linux, and macOS (`dist/godsend.exe`, `dist/godsend-linux-x64`, `dist/godsend-linux-arm64`, `dist/godsend-darwin-*`, plus `dist/godsend-mac`), then builds the **Electron installer for the machine you run on**: **NSIS** on Windows, **AppImage** on Linux, and on **macOS** an AppImage plus **arm64 and x64 DMGs**. AppImage is omitted on Windows (electron-builder needs symlink privileges there). Use `npm run build:win` for Windows-only (faster). All artifacts land under the root `dist/` folder.

Backend only (all platforms): `npm run build:server:all`.
- Windows x64: `npm run build:server:win:x64`
- Windows ia32 (32-bit): `npm run build:server:win:ia32`
- Linux amd64 (`x64`): `npm run build:server:linux:amd64`
- Linux arm64: `npm run build:server:linux:arm64`

Windows backend builds (`build:server`, `build:server:all`) pass `-trimpath -buildvcs=false`: no commit stamp and no local paths in the binary, so its SHA-256 only changes when the Go code changes (antivirus reputation is per hash). Its Windows `VERSIONINFO` and icon come from `src/server/winres.json`, compiled into the committed `src/server/rsrc_windows_amd64.syso` / `rsrc_windows_386.syso` (linked by `go build` only for those GOOS/GOARCH). After editing the `.json` or the icon, regenerate in `src/server` with `go run github.com/tc-hib/go-winres@v0.3.3 make --in winres.json` and commit both `.syso`. The resource version is fixed (`1.0.0.0`) on purpose: the app version would change the hash on every release.

## Repository structure

```
package.json             Root npm scripts: `npm install`, `npm run build` (all Go targets + OS-matched Electron installer; DMGs on macOS)
dist/                    Build artifacts (per-OS binaries and installers) — created by `npm run build`

src/server/              Go backend
  main.go                  Entry point: HTTP server wiring & startup banner
  winres.json              Windows VERSIONINFO + icon source for the backend .exe
  rsrc_windows_*.syso      Resource objects generated from winres.json (committed, go-winres)
  models/                  Pure domain types and repository interfaces (Game, Platform, JobStatus…)
  services/                Application-layer service interfaces (GameService)
  infrastructure/          Infrastructure helpers (config loading, path resolution)
  interfaces/http/         HTTP router factory

src/electron-app/        Electron desktop app (Windows / macOS / Linux) — TypeScript source, compiled in-place
  main.ts                  Entry point (registers protocol scheme, calls app/bootstrap)
  preload.ts               IPC bridge exposing window.godsendApi to the renderer
  app/
    bootstrap.ts           App lifecycle, window/tray creation, IPC handler registration
    window.ts              BrowserWindow creation, minimize/close-to-tray behaviour
  services/
    settingsService.ts     Config file read/write and all setting accessors
    backendClient.ts       Backend process lifecycle, IA login, output buffer
    auroraLibraryService.ts  Aurora SQLite DB parsing, FTP drive probing, game cache
    auroraVisualService.ts   Visual asset sync (RXEA, Import, CDN), cover events
    auroraPathHelper.ts      Aurora install root discovery from FTP scripts path
    coverArtService.ts       Multi-source cover art fetching (XboxUnity, CDN, MS Store)
    autoSyncService.ts       Post-FTP automation (asset upload, library re-sync)
  ipc/
    configHandlers.ts      Startup, logs, settings, Xbox connection, cache refresh
    xboxFtpHandlers.ts     FTP ping/test/port scan, scripts upload, drives, games
    auroraLibraryHandlers.ts  Library sync, cover + visual asset sync
    auroraAssetHandlers.ts   Asset search, image fetch, RXEA decode/encode, upload
    browseHandlers.ts      Game list, queue, disc info, browse cover art
    toolsHandlers.ts       ISO probe/convert, FTP Manager ops, game drive move
  infrastructure/
    fileSystem.ts          Path resolution, directory/file helpers, runtime preparation
    electronTray.ts        System-tray icon and context menu
    backendHttp.ts         Thin HTTP helpers for the local Go backend
    httpHelper.ts          Redirect-following image fetch, MIME detection
    serverLog.ts           Session-structured log file appender
    auroraLibraryCache.ts  Local Aurora DB cache layout, meta read/write
    sqlHelper.ts           sql.js wrapper for Aurora SQLite databases
  renderer/               React/Vite renderer (App.jsx, HomePage, SettingsPage, LibraryPage, QueuePage)

aurora-scripts/          Aurora Lua script + icons installed on the Xbox
  main.lua                 Entry point: script metadata, module loading, main() loop
  state.lua                Connection settings and mutable operation globals
  http_client.lua          HTTP helpers, error catalogue, progress callback
  services.lua             Server communication, wait loop, game installation
  menu.lua                 Queue viewer and library browser UI
  menu_system.lua          Simple menu helper used by main.lua/menu.lua

```
