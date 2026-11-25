/**
 * IPC handlers for the Browse view and download queue:
 *   browse:get-games, browse:queue-game, browse:get-disc-info, browse:fetch-cover,
 *   browse:fetch-installed-cover
 *   xbox:get-queue, xbox:remove-queue-item
 */

import http from "http";
import { IpcMain } from "electron";

import { getConfiguredXboxIP, getConfiguredServerPort, getConfiguredProviderPriority } from "../services/settingsService";
import { backendGet, backendGetWithStatus } from "../infrastructure/backendHttp";
import { backendFailureReason, errorMessage } from "../infrastructure/backendFailure";
import { formatErrorForUser } from "../infrastructure/userFriendlyError";
import { fetchHttpImage } from "../infrastructure/httpHelper";
import { appendAppEvent } from "../infrastructure/serverLog";
import { reportError } from "../infrastructure/telemetry";
import {
  browseCoverCache,
  baseTitleForCover,
  generateSearchCandidates,
  generateSearchCandidateEntries,
  fetchXboxUnityCoverWithMeta,
  tryXboxCdnFromMicrosoftStoreSearch,
  fetchWikipediaCover,
  fetchCustomCover,
  hasCustomCover,
  getCachedCoverFromDisk,
  getCoverStatusHints,
  saveCoverToDisk,
} from "../services/coverArtService";
import { scanUsbAndLocalGames } from "../services/localGameScannerService";

export function register(ipcMain: IpcMain): void {

  // ── Get games installed on connected USB drives and local storage ──────────
  ipcMain.handle("browse:get-installed-games", async () => {
    try {
      const games = await scanUsbAndLocalGames();
      return { ok: true, games };
    } catch (err: any) {
      const raw = errorMessage(err);
      appendAppEvent("BROWSE", `browse:get-installed-games falhou: ${raw}`);
      return { ok: false, error: formatErrorForUser(err, { area: "browse", isLocal: true }), games: [] };
    }
  });

  // ── Get game list from Go backend ──────────────────────────────────────────
  ipcMain.handle("browse:get-games", async (_event, { platform, source }) => {
    let httpStatus: number | undefined;
    try {
      const priority = getConfiguredProviderPriority().join(",");
      const src  = source ? `&source=${encodeURIComponent(source)}` : "";
      const response = await backendGetWithStatus(
        `/browse?platform=${encodeURIComponent(platform)}${src}&priority=${encodeURIComponent(priority)}`
      );
      httpStatus = response.status;
      const data = response.body;
      // /browse returns plain text, including an empty local catalog. Only
      // inspect HTTP failures and JSON error replies with the JSON helper.
      if (httpStatus < 200 || httpStatus >= 300 || data.trimStart().startsWith("{")) {
        const failure = backendFailureReason(response);
        if (failure) throw new Error(failure);
      }
      if (data.startsWith("__IA_LOADING__")) {
        const m = data.match(/__IA_LOADING__:(\d+)\/(\d+)/);
        return { ok: true, loading: true, loaded: m ? m[1] : "?", total: m ? m[2] : "?", games: [] };
      }
      const games = data.split("|").map((s: string) => s.trim()).filter(Boolean);
      return { ok: true, loading: false, games };
    } catch (err: unknown) {
      const effectivePort = (err as any)?.port ?? getConfiguredServerPort();
      const endpoint = `http://127.0.0.1:${effectivePort}/browse`;
      const message = `Falha ao carregar o catálogo em ${endpoint}` +
        (httpStatus === undefined ? "" : ` (HTTP ${httpStatus})`) +
        `: ${errorMessage(err)}`;
      const context = `platform=${platform}; source=${source || "unified"}; endpoint=${endpoint}`;
      const stack = err instanceof Error ? err.stack : undefined;
      appendAppEvent("BROWSE", `${context}; ${message}`);
      reportError(
        "electron-main",
        "browseHandlers.ts",
        "browse:get-games",
        message,
        "",
        stack ? [context, stack] : [context],
        false,
      );
      return {
        ok: false,
        error: formatErrorForUser(err, { area: "browse", isLocal: source === "local" }),
        games: [],
      };
    }
  });

  // ── Multi-disc release grouping, computed by the Go backend ────────────────
  // The browse view used to derive disc membership from the catalog names itself, with a
  // parser that had drifted from the backend's: it required the literal word "Disc" inside
  // the role group and ignored bracketed tags, so "(Disc 1) (Install)" and "(Disc 2) (Play)"
  // became two separate one-disc versions of the same game and only the clicked half was
  // downloaded. Grouping now comes from the same code /trigger uses to enqueue companions.
  ipcMain.handle("browse:get-release-groups", async (_event, { platform }) => {
    try {
      const data = await backendGet(`/browse/releases?platform=${encodeURIComponent(platform)}`);
      const parsed = JSON.parse(data);
      return { ok: true, releases: Array.isArray(parsed.releases) ? parsed.releases : [] };
    } catch (err: unknown) {
      const msg = errorMessage(err);
      const context = `platform=${platform}`;
      const stack = err instanceof Error ? err.stack : undefined;
      appendAppEvent("BROWSE", `browse:get-release-groups falhou (${context}): ${msg}`);
      // The queue dialog keeps every download button disabled until this answers, so a failure
      // here blocks the whole catalog; it has to be visible in telemetry, not only in the local log.
      reportError(
        "electron-main",
        "browseHandlers.ts",
        "browse:get-release-groups",
        msg,
        "",
        stack ? [context, stack] : [context],
        false,
      );
      return {
        ok: false,
        error: formatErrorForUser(err, { area: "browse" }),
        releases: [],
      };
    }
  });

  // ── Pick a local destination folder on the PC (standard Windows dialog) ────
  ipcMain.handle("browse:choose-folder", async () => {
    try {
      // Lazy-require Electron UI modules so unit tests loading browseHandlers without
      // an Electron window harness continue to work.
      const { dialog, BrowserWindow } = require("electron") as typeof import("electron");
      const { getMainWindow } = require("../app/window") as typeof import("../app/window");
      const win = BrowserWindow.getFocusedWindow() || getMainWindow();
      const result = await dialog.showOpenDialog(win || undefined, {
        title: "Escolha a pasta onde deseja salvar o jogo",
        buttonLabel: "Salvar nesta pasta",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths.length) {
        return { ok: false, canceled: true };
      }
      return { ok: true, folder: result.filePaths[0] };
    } catch (err: unknown) {
      const raw = errorMessage(err);
      appendAppEvent("BROWSE", `browse:choose-folder falhou: ${raw}`);
      return { ok: false, error: formatErrorForUser(err, { area: "local-files", isFolder: true }) };
    }
  });

  // ── Queue a game or disc set (register → trigger on Go backend) ───────────
  // destinationType: "local" writes directly to a mounted drive or chosen folder
  // on this PC (localRoot); "ftp" (default) transfers to a console.
  ipcMain.handle("browse:queue-game", async (_event, { game, games, platform, source, drive, installType, destinationType, localRoot, destinationKind }) => {
    try {
      const isLocal = destinationType === "local";
      const isFolder = destinationKind === "folder";

      let xboxIp = "";
      if (isLocal) {
        if (!localRoot) return { ok: false, error: "Escolha um pendrive, HD preparado ou pasta no computador onde o jogo será salvo." };
      } else {
        xboxIp = getConfiguredXboxIP();
        if (!xboxIp) return { ok: false, error: "O endereço do seu Xbox 360 ainda não foi configurado. Vá em “Configurações”, informe o IP do videogame e tente novamente." };
      }

      const itemsToQueue: string[] = (Array.isArray(games) && games.length > 0)
        ? games
        : (game ? [game] : []);

      if (itemsToQueue.length === 0) {
        return { ok: false, error: "Nenhum jogo ou disco selecionado." };
      }

      const drv  = encodeURIComponent(drive || "Hdd1:");
      const inst = encodeURIComponent(installType || "god");
      const plat = encodeURIComponent(platform || "xbox360");
      const src  = source ? `&source=${encodeURIComponent(source)}` : "";
      const mode = isLocal ? "local" : "ftp";
      const localParam = isLocal ? `&local_root=${encodeURIComponent(localRoot)}` : "";
      const priority = getConfiguredProviderPriority().join(",");

      let lastStatus = "triggered";
      for (const g of itemsToQueue) {
        const enc = encodeURIComponent(g);
        try {
          const reg = await backendGetWithStatus(
            `/register?game=${enc}&ip=${encodeURIComponent(xboxIp)}&drive=${drv}&platform=${plat}&mode=${mode}&install_type=${inst}${localParam}`
          );
          const regFailure = backendFailureReason(reg);
          if (regFailure) {
            appendAppEvent("BROWSE", `browse:queue-game register falhou (${g}): ${regFailure}`);
            return { ok: false, error: formatErrorForUser(regFailure, { area: "queue", gameName: g, driveRoot: localRoot, isLocal, isFolder }) };
          }

          const trig = await backendGetWithStatus(
            `/trigger?game=${enc}&platform=${plat}&install_type=${inst}${src}&priority=${encodeURIComponent(priority)}`
          );
          const trigFailure = backendFailureReason(trig);
          if (trigFailure) {
            appendAppEvent("BROWSE", `browse:queue-game trigger falhou (${g}): ${trigFailure}`);
            return { ok: false, error: formatErrorForUser(trigFailure, { area: "queue", gameName: g, driveRoot: localRoot, isLocal, isFolder }) };
          }

          try { lastStatus = JSON.parse(trig.body).status || "triggered"; } catch { lastStatus = "triggered"; }
        } catch (err: unknown) {
          const raw = errorMessage(err);
          appendAppEvent("BROWSE", `browse:queue-game erro (${g}): ${raw}`);
          return { ok: false, error: formatErrorForUser(err, { area: "queue", gameName: g, driveRoot: localRoot, isLocal, isFolder }) };
        }
      }

      return { ok: true, status: lastStatus, queuedCount: itemsToQueue.length };
    } catch (err: unknown) {
      // Never let this handler reject: an IPC rejection reaches the renderer
      // with no result object at all, which is what left users staring at an
      // error box with nothing in it.
      const raw = errorMessage(err);
      appendAppEvent("BROWSE", `browse:queue-game falha inesperada: ${raw}`);
      reportError("electron-main", "browseHandlers.ts", "browse:queue-game", raw, "", err instanceof Error && err.stack ? [err.stack] : [], false);
      return { ok: false, error: formatErrorForUser(err, { area: "queue" }) };
    }
  });

  // ── Disc-info recommendation (install type hint) ───────────────────────────
  ipcMain.handle("browse:get-disc-info", async (_event, game) => {
    try {
      const data = await backendGet(`/disc-info?game=${encodeURIComponent(game)}`);
      return { ok: true, ...JSON.parse(data) };
    } catch {
      return { ok: false };
    }
  });

  // ── Fetch cover art for a game name (multi-source cascade, memory + disk cached) ──
  const fetchCover = async (gameName: string): Promise<{ ok: boolean; dataUrl?: string }> => {
    try {
      const base = baseTitleForCover(gameName);

      // 1. In-memory cache check
      if (browseCoverCache.has(base)) return browseCoverCache.get(base);

      // 2. Persistent disk cache check
      const diskDataUrl = getCachedCoverFromDisk(base);
      if (diskDataUrl) {
        const result = { ok: true, dataUrl: diskDataUrl };
        browseCoverCache.set(base, result);
        return result;
      }

      // ── 0. Custom cover URL check (for mods/homebrew with dedicated covers) ──
      let imgBuf: Buffer | null = await fetchCustomCover(base);
      if (!imgBuf && base !== gameName) {
        imgBuf = await fetchCustomCover(gameName);
      }

      // Generate search queries
      const candidates = generateSearchCandidateEntries(gameName);

      // ── 1. XboxUnity Covers API (looping through candidates) ─────────────────
      if (!imgBuf) {
        for (const cand of candidates) {
          let meta = await fetchXboxUnityCoverWithMeta(cand.term, cand.requiredBrand);
          if (meta) {
            imgBuf = meta.buf;
            if (meta.titleId) {
              const xboxUrl = `http://catalog.xboxlive.com/Catalog/Product/CoverArt/${meta.titleId}/en-US/1`;
              const xboxBuf = await fetchHttpImage(xboxUrl);
              if (xboxBuf && xboxBuf.length >= 100) imgBuf = xboxBuf;
            }
            break;
          }
        }
      }

      // ── 2. Microsoft Store suggestion → Title ID in product metadata → CDN (looping through candidates) ────
      if (!imgBuf) {
        for (const cand of candidates) {
          imgBuf = await tryXboxCdnFromMicrosoftStoreSearch(cand.term, cand.requiredBrand);
          if (imgBuf) break;
        }
      }

      // ── 3. Wikipedia REST API (looping through candidates) ───────────────────
      if (!imgBuf) {
        for (const cand of candidates) {
          const wikiTitles = [`${cand.term} (video game)`, cand.term];
          for (const title of wikiTitles) {
            imgBuf = await fetchWikipediaCover(title, cand.requiredBrand);
            if (imgBuf) break;
          }
          if (imgBuf) break;
        }
      }

      if (!imgBuf) {
        const result = { ok: false };
        browseCoverCache.set(base, result);
        return result;
      }

      const mime =
        (imgBuf[0] === 0xFF && imgBuf[1] === 0xD8) ? "image/jpeg" :
        (imgBuf[0] === 0x89 && imgBuf[1] === 0x50) ? "image/png"  : "image/jpeg";
      const result = { ok: true, dataUrl: `data:${mime};base64,${imgBuf.toString("base64")}` };
      browseCoverCache.set(base, result);
      saveCoverToDisk(base, imgBuf, mime);
      return result;
    } catch {
      return { ok: false };
    }
  };

  ipcMain.handle("browse:fetch-cover", (_event, gameName: string) => fetchCover(gameName));

  ipcMain.handle("browse:get-cover-hints", (_event, names: unknown) => {
    try {
      const list = Array.isArray(names) ? names.map((n) => String(n || "")).filter(Boolean) : [];
      return { ok: true, ...getCoverStatusHints(list) };
    } catch {
      return { ok: false, hasCover: [], noCover: [], withHint: [] };
    }
  });

  // ── Cover for an installed game: the folder carries both a name and a TitleID ──
  // A mod or translation runs with the base game's TitleID, so looking it up by TitleID shows
  // the base game's cover (EA FC 26 Legacy Edition -> FIFA 17) while the catalog, which looks
  // up by name, shows the mod's own cover. A name with a dedicated cover wins; otherwise the
  // TitleID is the exact key and the name is the fallback.
  ipcMain.handle("browse:fetch-installed-cover", async (_event, game: { name?: string; titleId?: string }) => {
    const name = String(game?.name || "").trim();
    const titleId = String(game?.titleId || "").trim();
    if (name && hasCustomCover(name)) {
      const custom = await fetchCover(name);
      if (custom.ok && custom.dataUrl) return custom;
    }
    if (titleId) {
      const byId = await fetchCover(titleId);
      if (byId.ok && byId.dataUrl) return byId;
    }
    return name ? fetchCover(name) : { ok: false };
  });

  // ── Download queue ──────────────────────────────────────────────────────────
  ipcMain.handle("xbox:get-queue", () => {
    return new Promise((resolve) => {
      const port = getConfiguredServerPort();
      const req  = http.get(`http://127.0.0.1:${port}/queue`, (res) => {
        let data = "";
        res.on("data",  (chunk) => { data += chunk; });
        res.on("end", () => {
          try { resolve({ ok: true, jobs: JSON.parse(data) }); }
          catch { resolve({ ok: true, jobs: [] }); }
        });
      });
      req.on("error", (err: Error) => {
        appendAppEvent("QUEUE", `xbox:get-queue error: ${err.message}`);
        resolve({ ok: false, jobs: [], error: formatErrorForUser(err, { area: "queue" }) });
      });
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ ok: false, jobs: [], error: formatErrorForUser("timeout", { area: "queue" }) });
      });
    });
  });

  ipcMain.handle("xbox:remove-queue-item", (_event, game: string) => {
    return new Promise((resolve) => {
      const port = getConfiguredServerPort();
      const enc  = encodeURIComponent(game);
      const req  = http.get(`http://127.0.0.1:${port}/queue/remove?game=${enc}`, (res) => {
        let data = "";
        res.on("data",  (chunk) => { data += chunk; });
        res.on("end", () => resolve({ ok: true, data }));
      });
      req.on("error", (err: Error) => {
        appendAppEvent("QUEUE", `xbox:remove-queue-item (${game}) error: ${err.message}`);
        resolve({ ok: false, error: formatErrorForUser(err, { area: "queue" }) });
      });
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ ok: false, error: formatErrorForUser("timeout", { area: "queue" }) });
      });
    });
  });

  ipcMain.handle("xbox:retry-queue-item", (_event, game: string) => {
    return new Promise((resolve) => {
      const port = getConfiguredServerPort();
      const enc  = encodeURIComponent(game);
      const req  = http.get(`http://127.0.0.1:${port}/queue/retry?game=${enc}`, (res) => {
        let data = "";
        res.on("data",  (chunk) => { data += chunk; });
        res.on("end", () => {
          try { resolve({ ok: true, ...JSON.parse(data) }); }
          catch { resolve({ ok: true, data }); }
        });
      });
      req.on("error", (err: Error) => {
        appendAppEvent("QUEUE", `xbox:retry-queue-item (${game}) error: ${err.message}`);
        resolve({ ok: false, error: formatErrorForUser(err, { area: "queue" }) });
      });
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ ok: false, error: formatErrorForUser("timeout", { area: "queue" }) });
      });
    });
  });
}
