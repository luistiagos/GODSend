/**
 * IPC handlers for the Browse view and download queue:
 *   browse:get-games, browse:queue-game, browse:get-disc-info, browse:fetch-cover
 *   xbox:get-queue, xbox:remove-queue-item
 */

import http from "http";
import { IpcMain } from "electron";

import { getConfiguredXboxIP, getConfiguredServerPort, getConfiguredProviderPriority } from "../services/settingsService";
import { backendGet } from "../infrastructure/backendHttp";
import { fetchHttpImage } from "../infrastructure/httpHelper";
import {
  browseCoverCache,
  baseTitleForCover,
  generateSearchCandidates,
  fetchXboxUnityCoverWithMeta,
  tryXboxCdnFromMicrosoftStoreSearch,
  fetchWikipediaCover,
} from "../services/coverArtService";

export function register(ipcMain: IpcMain): void {

  // ── Get game list from Go backend ──────────────────────────────────────────
  ipcMain.handle("browse:get-games", async (_event, { platform, source }) => {
    try {
      const priority = getConfiguredProviderPriority().join(",");
      const src  = source ? `&source=${encodeURIComponent(source)}` : "";
      const data = await backendGet(
        `/browse?platform=${encodeURIComponent(platform)}${src}&priority=${encodeURIComponent(priority)}`
      );
      if (data.startsWith("__IA_LOADING__")) {
        const m = data.match(/__IA_LOADING__:(\d+)\/(\d+)/);
        return { ok: true, loading: true, loaded: m ? m[1] : "?", total: m ? m[2] : "?", games: [] };
      }
      const games = data.split("|").map((s: string) => s.trim()).filter(Boolean);
      return { ok: true, loading: false, games };
    } catch (err: any) {
      return { ok: false, error: err.message, games: [] };
    }
  });

  // ── Queue a game (register → trigger on Go backend) ───────────────────────
  // destinationType: "local" writes directly to a mounted drive on this PC
  // (localRoot, e.g. a prepared pendrive); "ftp" (default) transfers to a console.
  ipcMain.handle("browse:queue-game", async (_event, { game, platform, source, drive, installType, destinationType, localRoot }) => {
    const isLocal = destinationType === "local";

    let xboxIp = "";
    if (isLocal) {
      if (!localRoot) return { ok: false, error: "Selecione um pendrive/HD preparado como destino." };
    } else {
      xboxIp = getConfiguredXboxIP();
      if (!xboxIp) return { ok: false, error: "No Xbox IP configured. Check Settings → Xbox connection." };
    }

    const enc  = encodeURIComponent(game);
    const drv  = encodeURIComponent(drive || "Hdd1:");
    const inst = encodeURIComponent(installType || "god");
    const plat = encodeURIComponent(platform || "xbox360");
    const src  = source ? `&source=${encodeURIComponent(source)}` : "";
    const mode = isLocal ? "local" : "ftp";
    const localParam = isLocal ? `&local_root=${encodeURIComponent(localRoot)}` : "";

    try {
      const regData = await backendGet(
        `/register?game=${enc}&ip=${encodeURIComponent(xboxIp)}&drive=${drv}&platform=${plat}&mode=${mode}&install_type=${inst}${localParam}`
      );
      let reg: any;
      try { reg = JSON.parse(regData); } catch { reg = {}; }
      if (reg.error) return { ok: false, error: `Register: ${reg.error}` };

      const priority = getConfiguredProviderPriority().join(",");
      const trigData = await backendGet(
        `/trigger?game=${enc}&platform=${plat}&install_type=${inst}${src}&priority=${encodeURIComponent(priority)}`
      );
      let trig: any;
      try { trig = JSON.parse(trigData); } catch { trig = {}; }
      if (trig.error) return { ok: false, error: `Trigger: ${trig.error}` };

      const status = trig.status || "triggered";
      return { ok: true, status };
    } catch (err: any) {
      return { ok: false, error: err.message };
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

  // ── Fetch cover art for a game name (multi-source cascade, memory-cached) ──
  ipcMain.handle("browse:fetch-cover", async (_event, gameName: string) => {
    try {
      const base = baseTitleForCover(gameName);

      if (browseCoverCache.has(base)) return browseCoverCache.get(base);

      // Generate search queries
      const candidates = generateSearchCandidates(gameName);

      let imgBuf: Buffer | null = null;

      // ── 1. XboxUnity Covers API (looping through candidates) ─────────────────
      for (const cand of candidates) {
        let meta = await fetchXboxUnityCoverWithMeta(cand);
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

      // ── 2. Microsoft Store suggestion → Title ID in product metadata → CDN (looping through candidates) ────
      if (!imgBuf) {
        for (const cand of candidates) {
          imgBuf = await tryXboxCdnFromMicrosoftStoreSearch(cand);
          if (imgBuf) break;
        }
      }

      // ── 3. Wikipedia REST API (looping through candidates) ───────────────────
      if (!imgBuf) {
        for (const cand of candidates) {
          const wikiTitles = [`${cand} (video game)`, cand];
          for (const title of wikiTitles) {
            imgBuf = await fetchWikipediaCover(title);
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
      return result;
    } catch {
      return { ok: false };
    }
  });

  // ── Download queue ──────────────────────────────────────────────────────────
  ipcMain.handle("xbox:get-queue", () => {
    return new Promise((resolve) => {
      const port = getConfiguredServerPort();
      const req  = http.get(`http://localhost:${port}/queue`, (res) => {
        let data = "";
        res.on("data",  (chunk) => { data += chunk; });
        res.on("end", () => {
          try { resolve({ ok: true, jobs: JSON.parse(data) }); }
          catch { resolve({ ok: true, jobs: [] }); }
        });
      });
      req.on("error", (err: Error) => resolve({ ok: false, jobs: [], error: err.message }));
      req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, jobs: [] }); });
    });
  });

  ipcMain.handle("xbox:remove-queue-item", (_event, game: string) => {
    return new Promise((resolve) => {
      const port = getConfiguredServerPort();
      const enc  = encodeURIComponent(game);
      const req  = http.get(`http://localhost:${port}/queue/remove?game=${enc}`, (res) => {
        let data = "";
        res.on("data",  (chunk) => { data += chunk; });
        res.on("end", () => resolve({ ok: true, data }));
      });
      req.on("error", (err: Error) => resolve({ ok: false, error: err.message }));
      req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false }); });
    });
  });
}
