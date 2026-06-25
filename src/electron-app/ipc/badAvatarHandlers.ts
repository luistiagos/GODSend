/**
 * IPC handlers for the BadAvatar USB toolbox tool.
 */

import { app, IpcMain } from "electron";
import { resolveFat32FormatExe } from "../infrastructure/fat32Format";
import {
  formatRequiresElevation,
  isBadAvatarPreparationEnabled,
  isRunningAsAdmin,
  listFat32UsbDrives,
} from "../services/badAvatarUsbService";
import { getWebContentsForPush } from "../app/window";
import { inspectTrustedManifestReadiness } from "../services/preparationReadinessService";
import {
  runTrustedPreparationPreview,
  type PreparationPreviewRequest,
} from "../services/preparationPreviewService";
import {
  inspectFixedPayloadReadiness,
  prepareFixedBadAvatarDevice,
  type FixedPreparationRequest,
} from "../services/fixedBadAvatarPreparationService";

let previewInProgress = false;
let previewAbortController: AbortController | null = null;
let preparationInProgress = false;

export function register(ipcMain: IpcMain): void {
  ipcMain.handle("tools:badavatar-list-drives", async () => {
    try {
      const drives = await listFat32UsbDrives();
      return { ok: true, drives };
    } catch (err: any) {
      return { ok: false, drives: [], error: err.message || String(err) };
    }
  });

  ipcMain.handle("tools:badavatar-is-admin", async () => {
    const manifest = inspectTrustedManifestReadiness();
    const writerEnabled = isBadAvatarPreparationEnabled();
    const fixedPayload = inspectFixedPayloadReadiness();
    const previewBlockers = [
      ...(process.platform === "win32"
        ? []
        : ["A prévia segura está disponível somente no Windows nesta fase."]),
      ...(manifest.blocker ? [manifest.blocker] : []),
    ];
    const preparationBlockers = [
      ...(process.platform === "win32" ? [] : ["A preparação está disponível somente no Windows."]),
      ...(fixedPayload.ready ? [] : [fixedPayload.blocker || "O pacote BadAvatar ativo não está disponível."]),
    ];
    return {
      ok: true,
      isAdmin: await isRunningAsAdmin(),
      platform: process.platform,
      formatRequiresElevation: formatRequiresElevation(),
      hasFat32FormatExe: process.platform === "win32" && resolveFat32FormatExe() != null,
      previewEnabled: process.platform === "win32" && manifest.ready && previewBlockers.length === 0,
      previewBlockers,
      preparationEnabled:
        process.platform === "win32" && fixedPayload.ready && preparationBlockers.length === 0,
      preparationBlockers,
      trustedManifest: manifest,
      fixedPayload,
      legacyWriterEnabled: writerEnabled,
    };
  });

  ipcMain.handle("tools:badavatar-prepare", async (_event, request: FixedPreparationRequest) => {
    if (preparationInProgress) {
      return { ok: false, error: "Já existe uma preparação em andamento." };
    }
    preparationInProgress = true;
    const wc = getWebContentsForPush();
    try {
      const result = await prepareFixedBadAvatarDevice(request, (progress) => {
        if (wc && !wc.isDestroyed()) wc.send("tools:badavatar-prepare-progress", progress);
      });
      return { ok: true, result };
    } catch (err: any) {
      return { ok: false, error: err?.message || String(err) };
    } finally {
      preparationInProgress = false;
    }
  });

  ipcMain.handle("tools:badavatar-preview", async (_event, request: PreparationPreviewRequest) => {
    if (previewInProgress) {
      return { ok: false, error: "Já existe uma prévia em andamento." };
    }
    previewInProgress = true;
    previewAbortController = new AbortController();
    const wc = getWebContentsForPush();
    try {
      const report = await runTrustedPreparationPreview(
        request,
        app.getPath("userData"),
        (progress) => {
          if (wc && !wc.isDestroyed()) wc.send("tools:badavatar-preview-progress", progress);
        },
        previewAbortController.signal,
      );
      return { ok: true, report };
    } catch (err: any) {
      if (previewAbortController?.signal.aborted || err?.name === "AbortError") {
        return {
          ok: false,
          cancelled: true,
          error: "Prévia cancelada; nenhum arquivo foi gravado no dispositivo.",
        };
      }
      return { ok: false, error: err?.message || String(err) };
    } finally {
      previewInProgress = false;
      previewAbortController = null;
    }
  });

  ipcMain.handle("tools:badavatar-preview-cancel", async () => {
    if (!previewInProgress || !previewAbortController) {
      return { ok: false, error: "Não existe prévia em andamento." };
    }
    previewAbortController.abort();
    return { ok: true };
  });

}
