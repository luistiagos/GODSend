import { IpcMain } from "electron";
import { backendGet, backendPost } from "../infrastructure/backendHttp";
import { getConfiguredXboxIP } from "../services/settingsService";
import { appendAppEvent } from "../infrastructure/serverLog";
import { formatErrorForUser } from "../infrastructure/userFriendlyError";

function xboxIP(): string | null {
  const ip = getConfiguredXboxIP();
  if (!ip) return null;
  return ip;
}

const MISSING_IP_MSG =
  "O endereço do seu Xbox 360 ainda não foi configurado. Vá em “Configurações”, informe o IP do videogame e tente novamente.";

export function register(ipcMain: IpcMain): void {
  function normalizeSavesReply(rawOrObj: any, op: string): any {
    let parsed = rawOrObj;
    if (typeof rawOrObj === "string") {
      try {
        parsed = JSON.parse(rawOrObj);
      } catch {
        appendAppEvent("SAVES", `${op} resposta inválida: ${rawOrObj.substring(0, 200)}`);
        return { ok: false, error: formatErrorForUser("backend returned invalid", { area: "saves" }) };
      }
    }
    if (parsed && parsed.ok === false) {
      const rawErr = parsed.error || parsed.message || "saves error";
      appendAppEvent("SAVES", `${op} falhou: ${rawErr}`);
      return { ...parsed, error: formatErrorForUser(rawErr, { area: "saves" }) };
    }
    if (parsed && parsed.state === "Error" && parsed.message) {
      appendAppEvent("SAVES", `${op} falhou: ${parsed.message}`);
      return { ...parsed, ok: false, error: formatErrorForUser(parsed.message, { area: "saves" }) };
    }
    return parsed;
  }

  ipcMain.handle("saves:discover", async (_event, payload?: { drive?: string; titleId?: string }) => {
    const ip = xboxIP();
    if (!ip) return { ok: false, error: MISSING_IP_MSG };
    const drive = payload?.drive || "";
    const tid = payload?.titleId ? `&title_id=${encodeURIComponent(payload.titleId)}` : "";
    try {
      const r = await backendGet(
        `/saves/discover?ip=${encodeURIComponent(ip)}&drive=${encodeURIComponent(drive)}${tid}`
      );
      return normalizeSavesReply(r, "saves:discover");
    } catch (err: any) {
      appendAppEvent("SAVES", `saves:discover erro: ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "saves" }) };
    }
  });

  ipcMain.handle("saves:list", async (_event, payload: { drive?: string; titleId: string; profileId: string }) => {
    const ip = xboxIP();
    if (!ip) return { ok: false, error: MISSING_IP_MSG };
    const drive = payload.drive || "";
    try {
      const r = await backendGet(
        `/saves/list?ip=${encodeURIComponent(ip)}&drive=${encodeURIComponent(drive)}&title_id=${encodeURIComponent(payload.titleId)}&profile_id=${encodeURIComponent(payload.profileId)}`
      );
      return normalizeSavesReply(r, "saves:list");
    } catch (err: any) {
      appendAppEvent("SAVES", `saves:list erro: ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "saves" }) };
    }
  });

  ipcMain.handle("saves:download", async (_event, payload: { drive?: string; titleId: string; profileId: string; gameName?: string }) => {
    const ip = xboxIP();
    if (!ip) return { ok: false, error: MISSING_IP_MSG };
    const drive = payload.drive || "";
    try {
      const r = await backendPost("/saves/download", {
        ip,
        drive,
        title_id: payload.titleId,
        profile_id: payload.profileId,
        game_name: payload.gameName || "",
      });
      return normalizeSavesReply(r, "saves:download");
    } catch (err: any) {
      appendAppEvent("SAVES", `saves:download erro: ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "saves" }) };
    }
  });

  ipcMain.handle("saves:delete", async (_event, payload: { drive?: string; titleId: string; profileId: string }) => {
    const ip = xboxIP();
    if (!ip) return { ok: false, error: MISSING_IP_MSG };
    const drive = payload.drive || "";
    try {
      const r = await backendPost("/saves/delete", {
        ip,
        drive,
        title_id: payload.titleId,
        profile_id: payload.profileId,
      });
      return normalizeSavesReply(r, "saves:delete");
    } catch (err: any) {
      appendAppEvent("SAVES", `saves:delete erro: ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "saves" }) };
    }
  });

  ipcMain.handle("saves:copy", async (_event, payload: {
    drive?: string; titleId: string; srcProfile: string; dstProfile: string; useKeyvault?: boolean;
  }) => {
    const ip = xboxIP();
    if (!ip) return { ok: false, error: MISSING_IP_MSG };
    try {
      const r = await backendPost("/saves/copy", {
        ip,
        drive: payload.drive || "",
        title_id: payload.titleId,
        src_profile: payload.srcProfile,
        dst_profile: payload.dstProfile,
        use_keyvault: payload.useKeyvault !== false,
      });
      return normalizeSavesReply(r, "saves:copy");
    } catch (err: any) {
      appendAppEvent("SAVES", `saves:copy erro: ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "saves" }) };
    }
  });

  ipcMain.handle("saves:backup-all", async (_event, payload?: { drive?: string }) => {
    const ip = xboxIP();
    if (!ip) return { ok: false, error: MISSING_IP_MSG };
    try {
      const r = await backendPost("/saves/backup-all", {
        ip,
        drive: payload?.drive || "",
      });
      return normalizeSavesReply(r, "saves:backup-all");
    } catch (err: any) {
      appendAppEvent("SAVES", `saves:backup-all erro: ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "saves" }) };
    }
  });

  ipcMain.handle("saves:keyvault-status", async () => {
    const ip = xboxIP();
    if (!ip) return { ok: false, error: MISSING_IP_MSG };
    try {
      const r = await backendGet(`/saves/keyvault-status?ip=${encodeURIComponent(ip)}`);
      return normalizeSavesReply(r, "saves:keyvault-status");
    } catch (err: any) {
      appendAppEvent("SAVES", `saves:keyvault-status erro: ${err?.message || err}`);
      return { ok: false, error: formatErrorForUser(err, { area: "saves" }) };
    }
  });
}
