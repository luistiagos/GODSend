/**
 * IPC handlers for USB Drive Maintenance: Filesystem Diagnostics, CHKDSK Auto-Repair,
 * Fake Drive / Capacity Authenticity Probing, and Safe Ejection.
 */

import { IpcMain } from "electron";
import { getWebContentsForPush } from "../app/window";
import { diagnoseDrive, repairDrive } from "../services/driveRepairService";
import { probeFakeDrive } from "../services/fakeDriveProbeService";
import { safelyEjectWindowsDrive } from "../infrastructure/windowsUsbDeviceService";
import { appendAppEvent } from "../infrastructure/serverLog";

let probeAbortController: AbortController | null = null;
let repairInProgress = false;

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("tools:drive-diagnose", async (_event, rootPath: string) => {
    try {
      const diagnostic = await diagnoseDrive(rootPath);
      return { ok: true, diagnostic };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("tools:drive-repair", async (_event, rootPath: string) => {
    if (repairInProgress) {
      return { ok: false, error: "Já existe um reparo de unidade em andamento." };
    }
    repairInProgress = true;
    const wc = getWebContentsForPush();
    try {
      const result = await repairDrive(rootPath, (line) => {
        if (wc && !wc.isDestroyed()) {
          wc.send("tools:drive-repair-progress", { rootPath, line });
        }
      });
      return { ok: result.ok, result };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      repairInProgress = false;
    }
  });

  ipcMain.handle("tools:drive-probe-fake", async (_event, rootPath: string, fastMode = true) => {
    if (probeAbortController) {
      return { ok: false, error: "Já existe um teste de capacidade em andamento." };
    }
    probeAbortController = new AbortController();
    const wc = getWebContentsForPush();
    try {
      const result = await probeFakeDrive(rootPath, {
        fastMode,
        abortSignal: probeAbortController.signal,
        onProgress: (progress) => {
          if (wc && !wc.isDestroyed()) {
            wc.send("tools:drive-probe-progress", progress);
          }
        },
      });
      return { ok: result.ok, result };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      probeAbortController = null;
    }
  });

  ipcMain.handle("tools:drive-probe-fake-cancel", async () => {
    if (!probeAbortController) {
      return { ok: false, error: "Nenhum teste de capacidade em andamento." };
    }
    probeAbortController.abort();
    probeAbortController = null;
    return { ok: true };
  });

  ipcMain.handle("tools:drive-eject", async (_event, rootPath: string) => {
    try {
      const result = await safelyEjectWindowsDrive(rootPath);
      return result;
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    }
  });
}
