/**
 * IPC handlers for the in-app update system.
 */

import { IpcMain } from "electron";
import {
  checkForUpdates,
  downloadUpdate,
  cancelUpdateDownload,
  applyUpdateAndRestart,
  dismissVersion,
} from "../services/autoUpdateService";
import {
  getConfiguredAutoCheckUpdates,
  writeConfig,
} from "../services/settingsService";
import { getWebContentsForPush } from "../app/window";
import { appendAppEvent } from "../infrastructure/serverLog";

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("update:check", async (_event, payload?: { force?: boolean }) => {
    try {
      const force = payload?.force === true;
      const result = await checkForUpdates(force);
      return result;
    } catch (err: any) {
      appendAppEvent("UPDATE", `update:check error: ${err.message || err}`);
      return {
        ok: false,
        updateAvailable: false,
        currentVersion: "",
        latestVersion: "",
        error: err.message || String(err),
      };
    }
  });

  ipcMain.handle(
    "update:download",
    async (_event, payload: { downloadUrl: string; sha256?: string; size?: number }) => {
      const wc = getWebContentsForPush();
      try {
        const filePath = await downloadUpdate(
          payload.downloadUrl,
          payload.sha256,
          payload.size,
          (progress) => {
            if (wc && !wc.isDestroyed()) {
              wc.send("update:download-progress", progress);
            }
          }
        );
        return { ok: true, filePath };
      } catch (err: any) {
        appendAppEvent("UPDATE", `update:download error: ${err.message || err}`);
        return { ok: false, error: err.message || String(err) };
      }
    }
  );

  ipcMain.handle("update:cancel-download", async () => {
    try {
      cancelUpdateDownload();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("update:apply", async (_event, payload?: { filePath?: string }) => {
    try {
      const success = applyUpdateAndRestart(payload?.filePath);
      return { ok: success };
    } catch (err: any) {
      appendAppEvent("UPDATE", `update:apply error: ${err.message || err}`);
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("update:dismiss-version", async (_event, payload: { version: string }) => {
    try {
      if (payload?.version) {
        dismissVersion(payload.version);
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle("update:get-auto-check", async () => {
    return { ok: true, enabled: getConfiguredAutoCheckUpdates() };
  });

  ipcMain.handle("update:set-auto-check", async (_event, payload: { enabled: boolean }) => {
    try {
      writeConfig({ autoCheckUpdates: payload.enabled === true });
      return { ok: true, enabled: payload.enabled === true };
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}
