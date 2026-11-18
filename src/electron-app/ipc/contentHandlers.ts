/**
 * IPC handlers for DLC / Title Update management:
 *   content:discover, content:installed, content:queue, content:sources
 */

import http from "http";
import { IpcMain } from "electron";

import { getConfiguredXboxIP, getConfiguredServerPort, getConfiguredDefaultXboxDrive } from "../services/settingsService";
import { backendGet } from "../infrastructure/backendHttp";
import { appendAppEvent } from "../infrastructure/serverLog";
import { formatErrorForUser } from "../infrastructure/userFriendlyError";

const MISSING_IP_MSG =
  "O endereço do seu Xbox 360 ainda não foi configurado. Vá em “Configurações”, informe o IP do videogame e tente novamente.";

export function register(ipcMain: IpcMain): void {

  // ── Discover DLC for a TitleID (Minerva + IA only, fast) ───────────────────
  ipcMain.handle("content:discover", async (_event, { titleId, gameName, drive: reqDrive }) => {
    try {
      const xboxIp = getConfiguredXboxIP();
      const drive = reqDrive || getConfiguredDefaultXboxDrive() || "Hdd1:";
      const ipParam = xboxIp ? `&xbox_ip=${encodeURIComponent(xboxIp)}` : "";
      const drvParam = `&drive=${encodeURIComponent(drive)}`;
      const data = await backendGet(
        `/content/discover?title_id=${encodeURIComponent(titleId)}&game_name=${encodeURIComponent(gameName || "")}${ipParam}${drvParam}`
      );
      const parsed = JSON.parse(data);
      if (parsed?.state === "Error" || parsed?.error) {
        const raw = parsed.message || parsed.error;
        appendAppEvent("CONTENT", `content:discover falhou (${titleId}): ${raw}`);
        return { ok: false, error: formatErrorForUser(raw, { area: "content" }) };
      }
      return { ok: true, ...parsed };
    } catch (err: any) {
      appendAppEvent("CONTENT", `content:discover erro (${titleId}): ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "content" }) };
    }
  });

  // ── Discover Title Updates for a TitleID (XboxUnity, separate endpoint) ───
  ipcMain.handle("content:title-updates", async (_event, { titleId }) => {
    try {
      const data = await backendGet(`/content/tu?title_id=${encodeURIComponent(titleId)}`);
      const parsed = JSON.parse(data);
      if (parsed?.state === "Error" || parsed?.error) {
        const raw = parsed.message || parsed.error;
        appendAppEvent("CONTENT", `content:title-updates falhou (${titleId}): ${raw}`);
        return { ok: false, error: formatErrorForUser(raw, { area: "content" }) };
      }
      return { ok: true, ...parsed };
    } catch (err: any) {
      appendAppEvent("CONTENT", `content:title-updates erro (${titleId}): ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "content" }) };
    }
  });

  // ── Scan Xbox Content directory for installed items ───────────────────
  ipcMain.handle("content:installed", async (_event, { titleId, drive: reqDrive }) => {
    try {
      const xboxIp = getConfiguredXboxIP();
      if (!xboxIp) return { ok: false, error: MISSING_IP_MSG };
      const drive = reqDrive || getConfiguredDefaultXboxDrive() || "Hdd1:";
      const data = await backendGet(
        `/content/installed?title_id=${encodeURIComponent(titleId)}&xbox_ip=${encodeURIComponent(xboxIp)}&drive=${encodeURIComponent(drive)}`
      );
      const parsed = JSON.parse(data);
      if (parsed?.state === "Error" || parsed?.error) {
        const raw = parsed.message || parsed.error;
        appendAppEvent("CONTENT", `content:installed falhou (${titleId}): ${raw}`);
        return { ok: false, error: formatErrorForUser(raw, { area: "content" }) };
      }
      return { ok: true, ...parsed };
    } catch (err: any) {
      appendAppEvent("CONTENT", `content:installed erro (${titleId}): ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "content" }) };
    }
  });

  // ── Queue a specific DLC or TU for download + FTP ───────────────────────
  ipcMain.handle("content:queue", async (_event, payload) => {
    try {
      const port = getConfiguredServerPort();
      const enriched = {
        xbox_ip: getConfiguredXboxIP(),
        drive: getConfiguredDefaultXboxDrive() || "Hdd1:",
        ...payload,
      };
      const body = JSON.stringify(enriched);
      return new Promise((resolve) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/content/queue",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
              const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
              try {
                const parsed = JSON.parse(data);
                const rawError = ok ? undefined : (parsed?.message || parsed?.error || `HTTP ${res.statusCode}`);
                if (rawError) {
                  appendAppEvent("CONTENT", `content:queue falhou: ${rawError}`);
                }
                resolve({ ok, ...parsed, ...(rawError ? { error: formatErrorForUser(rawError, { area: "content" }) } : {}) });
              } catch {
                if (!ok) appendAppEvent("CONTENT", `content:queue falhou HTTP ${res.statusCode}: ${data.slice(0, 200)}`);
                resolve({ ok, data, ...(ok ? {} : { error: formatErrorForUser(`HTTP ${res.statusCode}`, { area: "content" }) }) });
              }
            });
          }
        );
        req.on("error", (err: Error) => {
          appendAppEvent("CONTENT", `content:queue erro de rede: ${err.message}`);
          resolve({ ok: false, error: formatErrorForUser(err, { area: "content" }) });
        });
        req.write(body);
        req.end();
      });
    } catch (err: any) {
      appendAppEvent("CONTENT", `content:queue exceção: ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "content" }) };
    }
  });

  // ── Activate / deactivate a Title Update file on the Xbox ────────────
  ipcMain.handle("content:set-active", async (_event, { titleId, contentType, fileName, drive, setActive }) => {
    try {
      const xboxIp = getConfiguredXboxIP();
      if (!xboxIp) return { ok: false, error: MISSING_IP_MSG };
      const resolvedDrive = drive || getConfiguredDefaultXboxDrive() || "Hdd1:";
      const body = JSON.stringify({
        title_id: titleId,
        content_type: contentType,
        file_name: fileName,
        drive: resolvedDrive,
        xbox_ip: xboxIp,
        set_active: !!setActive,
      });
      const port = getConfiguredServerPort();
      return await new Promise((resolve) => {
        const req = http.request(
          { hostname: "127.0.0.1", port, path: "/content/set-active", method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
          (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
              const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
              try {
                const parsed = JSON.parse(data);
                const rawError = ok ? undefined : (parsed?.message || parsed?.error || `HTTP ${res.statusCode}`);
                if (rawError) appendAppEvent("CONTENT", `content:set-active falhou: ${rawError}`);
                resolve({ ok, ...parsed, ...(rawError ? { error: formatErrorForUser(rawError, { area: "content" }) } : {}) });
              } catch {
                if (!ok) appendAppEvent("CONTENT", `content:set-active HTTP ${res.statusCode}`);
                resolve({ ok, ...(ok ? {} : { error: formatErrorForUser(`HTTP ${res.statusCode}`, { area: "content" }) }) });
              }
            });
          }
        );
        req.on("error", (err: Error) => {
          appendAppEvent("CONTENT", `content:set-active erro: ${err.message}`);
          resolve({ ok: false, error: formatErrorForUser(err, { area: "content" }) });
        });
        req.write(body);
        req.end();
      });
    } catch (err: any) {
      appendAppEvent("CONTENT", `content:set-active exceção: ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "content" }) };
    }
  });

  // ── Get available download sources for a content item ───────────────────
  ipcMain.handle("content:sources", async (_event, { titleId, gameName }) => {
    try {
      const data = await backendGet(
        `/content/sources?title_id=${encodeURIComponent(titleId)}&game_name=${encodeURIComponent(gameName || "")}`
      );
      const parsed = JSON.parse(data);
      if (parsed?.state === "Error" || parsed?.error) {
        const raw = parsed.message || parsed.error;
        appendAppEvent("CONTENT", `content:sources falhou (${titleId}): ${raw}`);
        return { ok: false, error: formatErrorForUser(raw, { area: "content" }) };
      }
      return { ok: true, ...parsed };
    } catch (err: any) {
      appendAppEvent("CONTENT", `content:sources erro (${titleId}): ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "content" }) };
    }
  });
}
