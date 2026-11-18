/**
 * IPC handlers for USB Drive Maintenance: Filesystem Diagnostics, CHKDSK Auto-Repair,
 * Fake Drive / Capacity Authenticity Probing, and Safe Ejection.
 */

import { IpcMain } from "electron";
import { getWebContentsForPush } from "../app/window";
import { diagnoseDrive, repairDrive } from "../services/driveRepairService";
import { probeFakeDrive } from "../services/fakeDriveProbeService";
import { invalidateUsbDriveListCache } from "../services/badAvatarUsbService";
import { safelyEjectWindowsDrive } from "../infrastructure/windowsUsbDeviceService";
import { appendAppEvent } from "../infrastructure/serverLog";
import { reportError } from "../infrastructure/telemetry";
import { formatErrorForUser } from "../infrastructure/userFriendlyError";

let probeAbortController: AbortController | null = null;
let repairInProgress = false;

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("tools:drive-diagnose", async (_event, rootPath: string) => {
    try {
      const diagnostic = await diagnoseDrive(rootPath);
      if (diagnostic.needsRepair) {
        appendAppEvent("usb", `tools:drive-diagnose (${rootPath}): ${diagnostic.summary}`);
        return {
          ok: true,
          diagnostic: {
            ...diagnostic,
            summary:
              "Foram encontrados erros de gravação neste dispositivo (geralmente por ter sido removido sem ejetar). Use a opção “Reparar (CHKDSK)” para corrigir.",
          },
        };
      }
      return { ok: true, diagnostic };
    } catch (err: any) {
      const raw = err?.message || String(err);
      appendAppEvent("usb", `tools:drive-diagnose falhou (${rootPath}): ${raw}`);
      return { ok: false, error: formatErrorForUser(err, { area: "drive-maintenance", driveRoot: rootPath }) };
    }
  });

  ipcMain.handle("tools:drive-repair", async (_event, rootPath: string) => {
    if (repairInProgress) {
      return { ok: false, error: "Já existe um reparo de unidade em andamento. Aguarde ele terminar." };
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
      const raw = err?.message || String(err);
      appendAppEvent("usb", `tools:drive-repair falhou (${rootPath}): ${raw}`);
      reportError("electron-main", "driveMaintenanceHandlers.ts", "tools:drive-repair", raw, "", err?.stack ? [err.stack] : [], false);
      return { ok: false, error: formatErrorForUser(err, { area: "drive-maintenance", driveRoot: rootPath }) };
    } finally {
      repairInProgress = false;
      invalidateUsbDriveListCache();
    }
  });

  ipcMain.handle("tools:drive-probe-fake", async (_event, rootPath: string, fastMode = true) => {
    if (probeAbortController) {
      return { ok: false, error: "Já existe um teste de capacidade em andamento. Aguarde ou cancele o teste atual." };
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
      const raw = err?.message || String(err);
      appendAppEvent("usb", `tools:drive-probe-fake falhou (${rootPath}): ${raw}`);
      reportError("electron-main", "driveMaintenanceHandlers.ts", "tools:drive-probe-fake", raw, "", err?.stack ? [err.stack] : [], false);
      return { ok: false, error: formatErrorForUser(err, { area: "drive-maintenance", driveRoot: rootPath }) };
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
      if (!result.ok && result.error) {
        appendAppEvent("usb", `tools:drive-eject falhou (${rootPath}): ${result.error}`);
        return { ...result, error: formatErrorForUser(result.error, { area: "drive-maintenance", driveRoot: rootPath }) };
      }
      return result;
    } catch (err: any) {
      const raw = err?.message || String(err);
      appendAppEvent("usb", `tools:drive-eject exceção (${rootPath}): ${raw}`);
      return { ok: false, error: formatErrorForUser(err, { area: "drive-maintenance", driveRoot: rootPath }) };
    }
  });
}
