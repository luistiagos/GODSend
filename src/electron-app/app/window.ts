import { app, BrowserWindow } from "electron";
import path from "path";

import { getFirstValidIconPath } from "../infrastructure/fileSystem";
import { isAllowedApplicationNavigation } from "../infrastructure/navigationPolicy";
import { appendAppEvent } from "../infrastructure/serverLog";
import { reportError } from "../infrastructure/telemetry";
import { setMainWindowRef } from "../services/backendClient";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

/**
 * Get the webContents to use for pushing events to the renderer.
 * Prefers the main window; falls back to any non-destroyed BrowserWindow.
 */
export function getWebContentsForPush(): Electron.WebContents | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow.webContents;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents) return w.webContents;
  }
  return null;
}

/** Return the main BrowserWindow reference (may be null during startup/teardown). */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

/** Testing hook to set the main window reference. */
export function setMainWindowForTesting(win: any): void {
  mainWindow = win;
}

/**
 * Focus and restore the main window if it is hidden (e.g. minimized to tray),
 * minimized, or obscured by other applications.
 */
export function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
}


/** Return whether the app is in the process of quitting. */
export function getIsQuitting(): boolean {
  return isQuitting;
}

/** Mark the app as quitting so close events allow the window to close. */
export function setIsQuitting(value: boolean): void {
  isQuitting = Boolean(value);
}

export interface RendererHealthDeps {
  log: (category: string, message: string) => void;
  report: (component: string, file: string, method: string, message: string) => void;
  now: () => number;
  isQuitting: () => boolean;
}

const RENDERER_RELOAD_COOLDOWN_MS = 60_000;
const MAX_CONSOLE_ERROR_LINES = 50;
const MAX_CONSOLE_ERROR_CHARS = 500;

/**
 * Log renderer crash/hang/load failure/console errors to the app log (and the
 * crash/hang to telemetry), and reload the page once after a renderer crash so
 * the window restored from the tray is not left blank. Without this a white
 * window left no trace at all in the log ([[electron-main-janela-branca-ao-reabrir-com-o-app-ja-aberto-sem-telemetria-do-renderer_2026-10-07T21-48]]).
 * Reloading does not restart the backend: bootstrap starts it on a `once`.
 */
export function watchRendererHealth(win: BrowserWindow, deps: Partial<RendererHealthDeps> = {}): void {
  const {
    log = appendAppEvent,
    report = reportError,
    now = Date.now,
    isQuitting: quitting = getIsQuitting,
  } = deps;
  const wc = win.webContents;
  let lastReloadAt = -Infinity;
  let unresponsiveSince: number | null = null;
  let consoleErrorLines = 0;

  wc.on("render-process-gone", (_event, details) => {
    const what = `reason=${details.reason} exitCode=${details.exitCode}`;
    log("RENDERER", `render-process-gone ${what}`);
    if (details.reason === "clean-exit" || quitting()) return;
    report("electron-main", "window.ts", "render-process-gone", `renderer gone: ${what}`);
    if (win.isDestroyed()) return;
    const t = now();
    if (t - lastReloadAt < RENDERER_RELOAD_COOLDOWN_MS) {
      log("RENDERER", "not reloading: crash loop");
      return;
    }
    lastReloadAt = t;
    log("RENDERER", "reloading after render-process-gone");
    try {
      wc.reload();
    } catch (err: any) {
      log("RENDERER", `reload failed: ${err?.message || err}`);
    }
  });

  wc.on("unresponsive", () => {
    unresponsiveSince = now();
    log("RENDERER", "unresponsive");
    report("electron-main", "window.ts", "unresponsive", "renderer unresponsive");
  });

  wc.on("responsive", () => {
    const since = unresponsiveSince;
    unresponsiveSince = null;
    log("RENDERER", since === null ? "responsive" : `responsive after ${now() - since} ms`);
  });

  wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = ERR_ABORTED (navigation replaced)
    log("RENDERER", `did-fail-load code=${errorCode} desc=${errorDescription} url=${validatedURL}`);
  });

  wc.on("console-message", (details) => {
    if (details.level !== "error" || consoleErrorLines >= MAX_CONSOLE_ERROR_LINES) return;
    consoleErrorLines++;
    const line = `${details.sourceId}:${details.lineNumber} ${details.message}`;
    log("RENDERER", `console error ${line.slice(0, MAX_CONSOLE_ERROR_CHARS)}`);
  });
}

/**
 * Create the main BrowserWindow and hook up minimize-to-tray / close-to-tray
 * behaviour.
 */
export function createMainWindow(): void {
  const windowIconPath = getFirstValidIconPath();
  mainWindow = new BrowserWindow({
    width:           900,
    height:          600,
    show:            false,
    autoHideMenuBar: true,
    icon:            windowIconPath || undefined,
    webPreferences: {
      preload:          path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true,
      webSecurity:      true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      safeDialogs:      true,
      devTools:         process.env.NODE_ENV === "development",
    },
  });
  watchRendererHealth(mainWindow);

  mainWindow.maximize();
  mainWindow.show();

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedApplicationNavigation(
      targetUrl,
      mainWindow?.webContents.getURL() || "",
      process.env.VITE_DEV_SERVER_URL,
    )) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "renderer-dist", "index.html"), {
      query: { nocache: String(Date.now()) },
    });
  }

  // Force clear renderer cache on every startup so vite-dist changes
  // are always picked up (Electron keeps compiled JS in renderer caches).
  mainWindow.webContents.on("did-finish-load", () => {
    if (!mainWindow) return;
    mainWindow.webContents.session.clearCache().catch(() => {});
  });

  mainWindow.on("minimize", () => {
    mainWindow!.hide();
  });

  mainWindow.on("close", (event: Electron.Event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow!.hide();
    }
  });

  setMainWindowRef(mainWindow);
}
