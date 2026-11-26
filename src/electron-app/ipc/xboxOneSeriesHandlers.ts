/**
 * IPC handlers exclusivos do fluxo Xbox One / Xbox Series X|S (Modo Desenvolvedor / Xenia):
 *   tools:xenia-list-drives, tools:xenia-prepare, tools:xenia-repair-permissions
 */

import { IpcMain } from "electron";
import { getWebContentsForPush } from "../app/window";
import { appendAppEvent } from "../infrastructure/serverLog";
import { reportError } from "../infrastructure/telemetry";
import { formatErrorForUser } from "../infrastructure/userFriendlyError";
import { setUsbPreparationActive } from "../services/badAvatarUsbService";
import {
  listXboxOneSeriesDevices,
  prepareXboxOneSeriesDevice,
  type XboxOneSeriesPrepareProgress,
  type XboxOneSeriesPrepareRequest,
} from "../services/xboxOneSeriesUsbService";

let xeniaPreparationInProgress = false;

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("tools:xenia-list-drives", async (_event, options?: { fresh?: boolean }) => {
    try {
      const { drives, unassignedDisks } = await listXboxOneSeriesDevices(options?.fresh === true);
      appendAppEvent(
        "xenia-usb",
        `lista enviada à interface: ${drives.length} volume(s) montado(s), ${unassignedDisks.length} disco(s) USB sem letra`,
      );
      return { ok: true, drives, unassignedDisks };
    } catch (err: any) {
      const message = err?.message || String(err);
      appendAppEvent("xenia-usb", `falha ao listar dispositivos: ${message}`);
      reportError(
        "electron-main",
        "xboxOneSeriesHandlers.ts",
        "tools:xenia-list-drives",
        message,
        "",
        err?.stack ? [err.stack] : [],
        false,
      );
      return {
        ok: false,
        drives: [],
        unassignedDisks: [],
        error: formatErrorForUser(err, { area: "drive-maintenance" }),
      };
    }
  });

  ipcMain.handle("tools:xenia-prepare", async (_event, request: XboxOneSeriesPrepareRequest) => {
    if (xeniaPreparationInProgress) {
      return { ok: false, error: "Já existe uma preparação para Xbox One / Series em andamento." };
    }
    xeniaPreparationInProgress = true;
    setUsbPreparationActive(true);
    const wc = getWebContentsForPush();
    let lastProgress: XboxOneSeriesPrepareProgress | null = null;

    try {
      const result = await prepareXboxOneSeriesDevice(request, (progress) => {
        lastProgress = progress;
        if (wc && !wc.isDestroyed()) {
          wc.send("tools:xenia-prepare-progress", progress);
        }
      });
      return { ok: true, result };
    } catch (err: any) {
      const message = err?.message || String(err);
      const phase = lastProgress as XboxOneSeriesPrepareProgress | null;
      const context =
        `console=xbox-one-series; alvo=${request?.targetKind || "volume"}; formatar=${request?.formatDrive === true}; ` +
        `unidade=${request?.driveRoot || `disk#${request?.diskNumber ?? "?"}`}; fase=` +
        (phase ? `${phase.status} (${phase.percent}%)` : "antes do primeiro progresso");
      appendAppEvent("xenia-usb", `falha no preparo: ${context}; ${message}`);
      reportError(
        "electron-main",
        "xboxOneSeriesHandlers.ts",
        "tools:xenia-prepare",
        message,
        "",
        err?.stack ? [context, err.stack] : [context],
        false,
      );
      return {
        ok: false,
        error: formatErrorForUser(err, { area: "drive-maintenance", driveRoot: request?.driveRoot }),
      };
    } finally {
      xeniaPreparationInProgress = false;
      setUsbPreparationActive(false);
    }
  });

  ipcMain.handle(
    "tools:xenia-repair-permissions",
    async (_event, request: { driveRoot: string; expectedDeviceFingerprint: string }) => {
      if (xeniaPreparationInProgress) {
        return { ok: false, error: "Já existe uma operação em andamento no dispositivo USB." };
      }
      xeniaPreparationInProgress = true;
      setUsbPreparationActive(true);
      const wc = getWebContentsForPush();
      try {
        const result = await prepareXboxOneSeriesDevice(
          {
            targetKind: "volume",
            driveRoot: request?.driveRoot,
            expectedDeviceFingerprint: request?.expectedDeviceFingerprint,
            formatDrive: false,
          },
          (progress) => {
            if (wc && !wc.isDestroyed()) {
              wc.send("tools:xenia-prepare-progress", progress);
            }
          },
        );
        return { ok: true, result };
      } catch (err: any) {
        const message = err?.message || String(err);
        appendAppEvent("xenia-usb", `falha ao corrigir permissoes em ${request?.driveRoot}: ${message}`);
        reportError(
          "electron-main",
          "xboxOneSeriesHandlers.ts",
          "tools:xenia-repair-permissions",
          message,
          "",
          err?.stack ? [err.stack] : [],
          false,
        );
        return {
          ok: false,
          error: formatErrorForUser(err, { area: "drive-maintenance", driveRoot: request?.driveRoot }),
        };
      } finally {
        xeniaPreparationInProgress = false;
        setUsbPreparationActive(false);
      }
    },
  );
}
