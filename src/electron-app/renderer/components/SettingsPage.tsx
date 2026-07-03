import { useState, useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "../lib/utils";

// ── Shared layout helpers ──────────────────────────────────────────────────────

function Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="py-4 border-b border-[#1e242e] last:border-0">
      {title && (
        <span className="block text-[13px] font-semibold text-[#cad3dc] mb-2.5">
          {title}
        </span>
      )}
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-[11px] text-muted-foreground leading-[1.4]">{children}</p>
  );
}

function PathExplain({ title, path, children }: { title: string; path: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded border border-[#1e242e] bg-[#0d1117] px-3 py-2.5">
      <p className="text-[12px] font-medium text-[#cad3dc]">{title}</p>
      <p className="mt-1 font-mono text-[10px] text-[#8b9aab] break-all">{path || "—"}</p>
      <p className="mt-1.5 text-[11px] text-muted-foreground leading-[1.45]">{children}</p>
    </div>
  );
}

function Status({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-[12px] text-[#a8b4c0]", className)} aria-live="polite">
      {children || null}
    </p>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface SettingsPageProps {
  onAppendLine: (line: string) => void;
}

export default function SettingsPage({ onAppendLine }: SettingsPageProps) {
  // Form state
  const [startup, setStartup]                   = useState(false);
  const [storagePath, setStoragePath]           = useState("");
  const [defaultStoragePath, setDefaultStoragePath] = useState("");
  const [backendTempPath, setBackendTempPath]   = useState("");
  const [torrentTempPath, setTorrentTempPath]   = useState("");
  const [defaultTorrentTempPath, setDefaultTorrentTempPath] = useState("");
  const [appDataDir, setAppDataDir]             = useState("");
  const [defaultAppDataDir, setDefaultAppDataDir] = useState("");
  const [appDataPortable, setAppDataPortable]   = useState(false);
  const [appDataStatus, setAppDataStatus]       = useState("");
  const [appDataSaving, setAppDataSaving]       = useState(false);
  const [serverPort, setServerPort]             = useState("8080");
  const [xboxIp, setXboxIp]                     = useState("");
  const [ftpUser, setFtpUser]                   = useState("");
  const [ftpPassword, setFtpPassword]           = useState("");
  const [ftpScriptsPath, setFtpScriptsPath]     = useState("");
  const [transferPath, setTransferPath]         = useState("");
  const [saveBackupPath, setSaveBackupPath]     = useState("");
  const [backupAllBusy, setBackupAllBusy]       = useState(false);
  const [backupAllStatus, setBackupAllStatus]   = useState("");
  const [iaEmail, setIaEmail]                   = useState("");
  const [iaPassword, setIaPassword]             = useState("");
  const [romPath, setRomPath]                   = useState("");
  const [ftpScanSubnet, setFtpScanSubnet]       = useState("");

  // Aria2 port settings
  const [aria2ListenPort, setAria2ListenPort]   = useState("");
  const [aria2DhtPort, setAria2DhtPort]         = useState("");
  const [aria2Status, setAria2Status]           = useState("");

  // Default Xbox drive
  const [defaultDrive, setDefaultDrive]         = useState("");
  const [driveList, setDriveList]               = useState<string[]>([]);
  const [driveStatus, setDriveStatus]           = useState("");
  const [driveLoading, setDriveLoading]         = useState(false);

  // Local app data
  const [dataStatus, setDataStatus]             = useState<any>(null);
  const [dataCheckLoading, setDataCheckLoading] = useState(false);
  const [dataClearLoading, setDataClearLoading] = useState(false);
  const [dataStatusMsg, setDataStatusMsg]       = useState("");

  // Status messages
  const [iaSessionStatus, setIaSessionStatus]           = useState("Não conectado.");
  const [cacheStatus, setCacheStatus]                   = useState("");
  const [xboxConnectionStatus, setXboxConnectionStatus] = useState("");
  const [ftpScriptsStatus, setFtpScriptsStatus]         = useState("");
  const [ftpDebugStatus, setFtpDebugStatus]             = useState("");
  const [ftpDebugLog, setFtpDebugLog]                   = useState("");

  // Loading flags
  const [iaLoginLoading, setIaLoginLoading]     = useState(false);
  const [xboxSaveLoading, setXboxSaveLoading]   = useState(false);
  const [ftpUploadLoading, setFtpUploadLoading] = useState(false);
  const [ftpTestLoading, setFtpTestLoading]     = useState(false);
  const [ftpScanLoading, setFtpScanLoading]     = useState(false);
  const [cacheLoading, setCacheLoading]         = useState(false);
  const [exportDbLoading, setExportDbLoading]   = useState(false);
  const [exportDbStatus, setExportDbStatus]     = useState("");

  // Collapsible state
  const [ftpDebugOpen, setFtpDebugOpen] = useState(false);

  // Custom GOD / XEX install paths
  const [customGodPath, setCustomGodPathState] = useState("");
  const [customXexPath, setCustomXexPathState] = useState("");
  const [customPathStatus, setCustomPathStatus] = useState("");

  // FTP inline directory picker state
  const [ftpPickerOpen, setFtpPickerOpen] = useState(false);
  const [ftpPickerTarget, setFtpPickerTarget] = useState<"god" | "xex" | null>(null);
  const [ftpPickerPath, setFtpPickerPath] = useState("/");
  const [ftpPickerEntries, setFtpPickerEntries] = useState<any[]>([]);
  const [ftpPickerLoading, setFtpPickerLoading] = useState(false);
  const [ftpPickerStatus, setFtpPickerStatus] = useState("");

  const ftpDebugLogRef = useRef<HTMLPreElement>(null);

  // ── Load saved values on mount ─────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setStartup(await window.godsendApi.getStartupEnabled());
      setStoragePath((await window.godsendApi.getEffectiveStoragePath()) || "");
      setDefaultStoragePath((await window.godsendApi.getDefaultStoragePath()) || "");
      setBackendTempPath((await window.godsendApi.getEffectiveBackendTempPath()) || "");
      setTorrentTempPath((await window.godsendApi.getEffectiveTorrentTempPath()) || "");
      setDefaultTorrentTempPath((await window.godsendApi.getDefaultTorrentTempPath()) || "");
      setAppDataDir((await window.godsendApi.getAppDataDir()) || "");
      setDefaultAppDataDir((await window.godsendApi.getDefaultAppDataDir()) || "");
      setAppDataPortable(Boolean(await window.godsendApi.isPortable()));
      setTransferPath((await window.godsendApi.getEffectiveTransferFolder()) || "");
      setSaveBackupPath((await window.godsendApi.getEffectiveSaveBackupFolder()) || "");
      setServerPort(String(await window.godsendApi.getServerPort()));

      const auth = await window.godsendApi.getArchiveAuth();
      setIaEmail(auth.iaEmail || "");
      applyIAStatus(auth);

      setRomPath(await window.godsendApi.getROMPath());

      const conn = await window.godsendApi.getXboxConnection();
      setXboxIp(conn.xboxIp || "");
      setFtpUser(conn.ftpUser || "");
      setFtpPassword(conn.ftpPassword || "");
      setFtpScriptsPath(conn.ftpScriptsPath || "");
      if (conn.xboxIp) {
        const parts = conn.xboxIp.split(".");
        if (parts.length === 4) setFtpScanSubnet(parts.slice(0, 3).join("."));
      }

      setAria2ListenPort(await window.godsendApi.getAria2ListenPort());
      setAria2DhtPort(await window.godsendApi.getAria2DhtPort());
      setDefaultDrive(await window.godsendApi.getDefaultXboxDrive());
      setCustomGodPathState(await window.godsendApi.getCustomGodPath());
      setCustomXexPathState(await window.godsendApi.getCustomXexPath());
    }
    load();

    const cleanupProgress  = window.godsendApi.onFtpProgress((msg: string) => setFtpScriptsStatus(msg));
    const cleanupDebugLog  = window.godsendApi.onFtpDebugLog((line: string) =>
      setFtpDebugLog((prev) => prev + line + "\n")
    );

    return () => {
      cleanupProgress();
      cleanupDebugLog();
    };
  }, []);

  // Auto-scroll FTP debug log
  useEffect(() => {
    if (ftpDebugLogRef.current) {
      ftpDebugLogRef.current.scrollTop = ftpDebugLogRef.current.scrollHeight;
    }
  }, [ftpDebugLog]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function applyIAStatus(auth: any) {
    setIaSessionStatus(
      auth?.hasSession && auth.iaScreenname
        ? `Conectado como ${auth.iaScreenname}.`
        : auth?.hasSession
        ? `Conectado (${auth.iaEmail || "sessão ativa"}).`
        : "Não conectado."
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleStartupChange(checked: boolean | "indeterminate") {
    const result = await window.godsendApi.setStartupEnabled(checked);
    setStartup(result);
  }

  async function handleStorageBrowse() {
    const picked = await window.godsendApi.chooseStoragePath();
    if (!picked) return;
    await window.godsendApi.setStoragePath(picked);
    setStoragePath((await window.godsendApi.getEffectiveStoragePath()) || "");
    setBackendTempPath((await window.godsendApi.getEffectiveBackendTempPath()) || "");
    setTorrentTempPath((await window.godsendApi.getEffectiveTorrentTempPath()) || "");
    setDefaultTorrentTempPath((await window.godsendApi.getDefaultTorrentTempPath()) || "");
    onAppendLine(`[INFO] Storage path changed to ${picked}; backend restarted.`);
  }

  async function handleStorageReset() {
    await window.godsendApi.setStoragePath("");
    setStoragePath((await window.godsendApi.getEffectiveStoragePath()) || "");
    setBackendTempPath((await window.godsendApi.getEffectiveBackendTempPath()) || "");
    setTorrentTempPath((await window.godsendApi.getEffectiveTorrentTempPath()) || "");
    setDefaultTorrentTempPath((await window.godsendApi.getDefaultTorrentTempPath()) || "");
    onAppendLine("[INFO] Storage path reset to default; backend restarted.");
  }

  async function handleTorrentTempBrowse() {
    const picked = await window.godsendApi.chooseTorrentTempPath();
    if (!picked) return;
    await window.godsendApi.setTorrentTempPath(picked);
    setTorrentTempPath((await window.godsendApi.getEffectiveTorrentTempPath()) || "");
    onAppendLine(`[INFO] Torrent download temp changed to ${picked}; backend restarted.`);
  }

  async function handleTorrentTempReset() {
    await window.godsendApi.setTorrentTempPath("");
    setTorrentTempPath((await window.godsendApi.getEffectiveTorrentTempPath()) || "");
    onAppendLine("[INFO] Torrent download temp reset to default; backend restarted.");
  }

  async function applyAppDataDir(target: string) {
    setAppDataSaving(true);
    setAppDataStatus("Movendo os dados do aplicativo…");
    try {
      const r: any = await window.godsendApi.setAppDataDir(target);
      if (!r?.ok) {
        setAppDataStatus(`Falha: ${r?.error || "Erro desconhecido"}`);
        setAppDataSaving(false);
        return;
      }
      if (r.restarted) {
        setAppDataStatus("Dados movidos — reiniciando…");
      } else {
        setAppDataStatus("O caminho dos dados não mudou.");
        setAppDataSaving(false);
      }
    } catch (err: any) {
      setAppDataStatus(`Falha: ${err.message || String(err)}`);
      setAppDataSaving(false);
    }
  }

  async function handleAppDataBrowse() {
    const picked = await window.godsendApi.chooseAppDataDir();
    if (!picked) return;
    await applyAppDataDir(picked);
  }

  async function handleAppDataReset() {
    await applyAppDataDir("");
  }

  async function handlePortSave() {
    const saved = await window.godsendApi.setServerPort(serverPort);
    setServerPort(String(saved));
    onAppendLine(`[INFO] Backend port set to ${saved}; backend restarted if running.`);
  }

  async function handlePortReset() {
    const saved = await window.godsendApi.setServerPort(8080);
    setServerPort(String(saved));
    onAppendLine("[INFO] Backend port reset to 8080; backend restarted if running.");
  }

  async function handleTransferBrowse() {
    const picked = await window.godsendApi.chooseTransferFolder();
    if (!picked) return;
    await window.godsendApi.setTransferFolder(picked);
    setTransferPath((await window.godsendApi.getEffectiveTransferFolder()) || "");
  }

  async function handleTransferReset() {
    await window.godsendApi.setTransferFolder("");
    setTransferPath((await window.godsendApi.getEffectiveTransferFolder()) || "");
  }

  async function handleSaveBackupBrowse() {
    const picked = await window.godsendApi.chooseSaveBackupFolder();
    if (!picked) return;
    await window.godsendApi.setSaveBackupFolder(picked);
    setSaveBackupPath((await window.godsendApi.getEffectiveSaveBackupFolder()) || "");
  }

  async function handleSaveBackupReset() {
    await window.godsendApi.setSaveBackupFolder("");
    setSaveBackupPath((await window.godsendApi.getEffectiveSaveBackupFolder()) || "");
  }

  async function handleBackupAllSaves() {
    setBackupAllBusy(true);
    setBackupAllStatus("Fazendo backup de todos os perfis e saves… isso pode demorar.");
    try {
      const r: any = await window.godsendApi.savesBackupAll();
      if (r?.ok && r?.result) {
        const x = r.result;
        const errs = Array.isArray(x.errors) && x.errors.length > 0
          ? ` (${x.errors.length} ignorados — veja o log do backend)` : "";
        setBackupAllStatus(
          `Concluído: ${x.profiles_backed_up}/${x.profiles_processed} pacotes de perfil, ` +
          `${x.saves_backed_up} saves de jogos, ${x.files_backed_up} arquivos no total${errs}.`
        );
        onAppendLine(`[INFO] Save backup-all: ${x.files_backed_up} files across ${x.profiles_processed} profiles.`);
      } else {
        setBackupAllStatus(`Falha: ${r?.error || r?.message || "erro desconhecido"}`);
      }
    } catch (err: any) {
      setBackupAllStatus(`Falha: ${err?.message || String(err)}`);
    } finally {
      setBackupAllBusy(false);
    }
  }

  async function handleIALogin() {
    setIaLoginLoading(true);
    try {
      const r = await window.godsendApi.loginInternetArchive({
        email: iaEmail,
        password: iaPassword,
      });
      setIaPassword("");
      if (r.ok) {
        onAppendLine("[INFO] Internet Archive: signed in; backend restarted.");
        applyIAStatus(await window.godsendApi.getArchiveAuth());
      } else {
        onAppendLine(`[ERROR] Internet Archive login: ${r.error || "Unknown error"}`);
      }
    } finally {
      setIaLoginLoading(false);
    }
  }

  async function handleIALogout() {
    await window.godsendApi.logoutInternetArchive();
    applyIAStatus(await window.godsendApi.getArchiveAuth());
    onAppendLine("[INFO] Internet Archive: signed out; backend restarted.");
  }

  async function handleRomPathSave() {
    await window.godsendApi.setROMPath(romPath);
  }

  async function handleRomPathReset() {
    await window.godsendApi.setROMPath("");
    setRomPath(await window.godsendApi.getROMPath());
  }

  async function handleCacheRefresh() {
    setCacheLoading(true);
    setCacheStatus("Solicitando atualização...");
    const r = await window.godsendApi.refreshCache("all");
    setCacheStatus(
      r.ok
        ? "Atualização iniciada — rodando em segundo plano. Veja o log do servidor para acompanhar."
        : `Falha: ${r.error || "erro desconhecido"}`
    );
    setCacheLoading(false);
  }

  async function handleXboxSave() {
    setXboxSaveLoading(true);
    setXboxConnectionStatus("Salvando\u2026");
    try {
      await window.godsendApi.setXboxConnection({
        xboxIp:         xboxIp.trim(),
        ftpUser:        ftpUser.trim(),
        ftpPassword,
        ftpScriptsPath: ftpScriptsPath.trim(),
      });
      setXboxConnectionStatus(
        "Salvo. Backend reiniciado \u2014 as pr\u00f3ximas instala\u00e7\u00f5es via FTP usar\u00e3o estas credenciais."
      );
      onAppendLine("[INFO] Xbox connection saved; backend restarted if running.");
    } catch (err: any) {
      setXboxConnectionStatus(`Falha ao salvar: ${err.message || "erro desconhecido"}`);
    } finally {
      setXboxSaveLoading(false);
    }
  }

  async function handleFtpUpload() {
    if (!xboxIp.trim()) {
      setFtpScriptsStatus("Informe o IP do Xbox primeiro.");
      return;
    }
    setFtpUploadLoading(true);
    setFtpScriptsStatus("Enviando\u2026");
    try {
      await window.godsendApi.setXboxConnection({
        xboxIp:         xboxIp.trim(),
        ftpUser:        ftpUser.trim(),
        ftpPassword,
        ftpScriptsPath: ftpScriptsPath.trim(),
        skipRestart:    true,
      });
      const r = await window.godsendApi.ftpAuroraScripts({
        xboxIp:         xboxIp.trim(),
        ftpUser:        ftpUser.trim(),
        ftpPassword,
        ftpScriptsPath: ftpScriptsPath.trim(),
      });
      setFtpScriptsStatus(
        r.ok
          ? `Scripts enviados com sucesso para ${r.remotePath || "(caminho desconhecido)"}.`
          : `Falha: ${r.error || "erro desconhecido"}`
      );
    } catch (err: any) {
      setFtpScriptsStatus(`Falha: ${err.message || "erro desconhecido"}`);
    } finally {
      setFtpUploadLoading(false);
    }
  }

  async function handleFtpTest() {
    setFtpTestLoading(true);
    setFtpDebugStatus("Testando conexão...");
    setFtpDebugLog("");
    try {
      const r = await window.godsendApi.ftpTestConnection({
        xboxIp:      xboxIp.trim(),
        ftpUser:     ftpUser.trim(),
        ftpPassword,
      });
      setFtpDebugStatus(
        r.ok ? "Conexão bem-sucedida." : `Falha no teste: ${r.error}`
      );
    } catch (err: any) {
      setFtpDebugStatus(`Falha no teste: ${err.message || "erro desconhecido"}`);
    } finally {
      setFtpTestLoading(false);
    }
  }

  async function handleFtpScan() {
    if (!ftpScanSubnet.trim()) {
      setFtpDebugStatus("Informe a sub-rede primeiro (ex: 192.168.1).");
      return;
    }
    setFtpScanLoading(true);
    setFtpDebugStatus("Varrendo rede...");
    setFtpDebugLog("");
    try {
      const r = await window.godsendApi.ftpScanPorts(ftpScanSubnet.trim());
      if (r.ok) {
        setFtpDebugStatus(
          r.hosts.length
            ? `Encontrado(s) ${r.hosts.length} host(s) FTP: ${r.hosts.join(", ")}`
            : "Nenhum servidor FTP encontrado nesta sub-rede."
        );
      } else {
        setFtpDebugStatus(`Falha na varredura: ${r.error}`);
      }
    } catch (err: any) {
      setFtpDebugStatus(`Falha na varredura: ${err.message || "erro desconhecido"}`);
    } finally {
      setFtpScanLoading(false);
    }
  }

  async function handleFtpScriptsPathReset() {
    setFtpScriptsPath(await window.godsendApi.getFtpScriptsPathDefault());
  }

  async function handleAria2Save() {
    await window.godsendApi.setAria2ListenPort(aria2ListenPort);
    await window.godsendApi.setAria2DhtPort(aria2DhtPort);
    setAria2Status("Salvo. Backend reiniciado.");
  }

  async function handleFetchDrives() {
    setDriveLoading(true);
    setDriveStatus("Conectando ao Xbox via FTP...");
    try {
      const r = await window.godsendApi.listXboxDrives();
      if (r.ok) {
        setDriveList(r.drives);
        setDriveStatus(`Encontrado(s) ${r.drives.length} drive(s).`);
      } else {
        setDriveStatus(`Falha: ${r.error || "erro desconhecido"}`);
      }
    } catch (err: any) {
      setDriveStatus(`Falha: ${err.message || "erro desconhecido"}`);
    } finally {
      setDriveLoading(false);
    }
  }

  async function handleDriveSave() {
    const saved = await window.godsendApi.setDefaultXboxDrive(defaultDrive);
    setDefaultDrive(saved);
    setDriveStatus(saved ? `Drive padrão definido como ${saved}. Backend reiniciado.` : "Drive padrão removido.");
  }

  async function handleDriveClear() {
    const saved = await window.godsendApi.setDefaultXboxDrive("");
    setDefaultDrive(saved);
    setDriveStatus("Drive padrão removido — o Aurora vai solicitar o drive a cada download.");
  }

  async function handleCustomGodPathSave() {
    const saved = await window.godsendApi.setCustomGodPath(customGodPath);
    setCustomGodPathState(saved);
    setCustomPathStatus(`Caminho GOD personalizado ${saved ? `definido como ${saved}` : "removido"}. Backend reiniciado.`);
  }

  async function handleCustomGodPathClear() {
    const saved = await window.godsendApi.setCustomGodPath("");
    setCustomGodPathState(saved);
    setCustomPathStatus("Caminho GOD personalizado removido. Backend reiniciado.");
  }

  async function handleCustomXexPathSave() {
    const saved = await window.godsendApi.setCustomXexPath(customXexPath);
    setCustomXexPathState(saved);
    setCustomPathStatus(`Caminho XEX personalizado ${saved ? `definido como ${saved}` : "removido"}. Backend reiniciado.`);
  }

  async function handleCustomXexPathClear() {
    const saved = await window.godsendApi.setCustomXexPath("");
    setCustomXexPathState(saved);
    setCustomPathStatus("Caminho XEX personalizado removido. Backend reiniciado.");
  }

  // FTP inline directory picker helpers
  async function openFtpPicker(target: "god" | "xex") {
    if (!xboxIp.trim()) {
      setCustomPathStatus("Informe o IP do Xbox primeiro.");
      return;
    }
    setFtpPickerTarget(target);
    setFtpPickerOpen(true);
    setFtpPickerPath("/");
    setFtpPickerEntries([]);
    await ftpPickerLoad("/");
  }

  async function ftpPickerLoad(remotePath: string) {
    setFtpPickerLoading(true);
    setFtpPickerStatus("Carregando...");
    try {
      const r = await window.godsendApi.toolsFtpList(remotePath);
      if (r.ok && r.entries) {
        // Normalize paths: keep relative to drive root, remove leading /Hdd1 etc if present
        setFtpPickerPath(r.cwd || remotePath);
        // Only show directories
        const dirs = r.entries.filter((e: any) => e.type === "directory" || !e.size);
        // Add a ".." entry when not at root
        const parent = { name: "..", type: "directory", size: 0 };
        const isRoot = r.cwd === "/" || !r.cwd || r.cwd.match(/^\/?[A-Za-z0-9]+:?$/);
        setFtpPickerEntries(isRoot ? dirs : [parent, ...dirs]);
        setFtpPickerStatus(`${dirs.length} pasta(s)`);
      } else {
        setFtpPickerStatus(`Erro: ${r.error || "desconhecido"}`);
      }
    } catch (err: any) {
      setFtpPickerStatus(`Erro: ${err.message || "desconhecido"}`);
    } finally {
      setFtpPickerLoading(false);
    }
  }

  function ftpPickerNavigate(entry: any) {
    if (entry.name === "..") {
      const parts = ftpPickerPath.replace(/\/+$/, "").split("/").filter(Boolean);
      parts.pop();
      const parentPath = "/" + parts.join("/");
      ftpPickerLoad(parentPath || "/");
      return;
    }
    const next = (ftpPickerPath.replace(/\/+$/, "") + "/" + entry.name).replace(/\/+/g, "/");
    ftpPickerLoad(next);
  }

  function ftpPickerSelect() {
    if (!ftpPickerTarget) return;
    const raw = ftpPickerPath.replace(/^\/+/, ""); // strip leading /
    if (ftpPickerTarget === "god") {
      setCustomGodPathState(raw);
    } else {
      setCustomXexPathState(raw);
    }
    setFtpPickerOpen(false);
    setFtpPickerTarget(null);
    setCustomPathStatus(`Caminho FTP selecionado: ${raw}`);
  }

  async function handleExportDb() {
    if (!xboxIp.trim()) {
      setExportDbStatus("Informe o IP do Xbox primeiro.");
      return;
    }
    setExportDbLoading(true);
    setExportDbStatus("Baixando content.db e settings.db do console…");
    try {
      const r = await window.godsendApi.exportAuroraDb();
      if (r.ok) {
        setExportDbStatus(`Exportado para:\n${(r.files || []).join("\n")}`);
      } else {
        setExportDbStatus(`Falha na exportação: ${r.error || "erro desconhecido"}`);
      }
    } catch (err: any) {
      setExportDbStatus(`Falha na exportação: ${err.message || "erro desconhecido"}`);
    } finally {
      setExportDbLoading(false);
    }
  }

  async function handleDataCheck() {
    setDataCheckLoading(true);
    setDataStatusMsg("");
    try {
      const r = await window.godsendApi.getDataStatus();
      if (r.ok) {
        setDataStatus(r);
        setDataStatusMsg(
          `${r.active_jobs} tarefa(s) ativa(s), ${r.pending_ftp_jobs} aguardando FTP, ${r.local_data_mb} MB em dados locais`
        );
      } else {
        setDataStatusMsg(`Falha: ${r.error || "erro desconhecido"}`);
      }
    } finally {
      setDataCheckLoading(false);
    }
  }

  async function handleDataClear() {
    const hasJobs = dataStatus && (dataStatus.active_jobs > 0 || dataStatus.pending_ftp_jobs > 0);
    const warn = hasJobs
      ? `ATENÇÃO: Há ${dataStatus.active_jobs} tarefa(s) ativa(s) e ${dataStatus.pending_ftp_jobs} aguardando FTP.\n\nApagar cancelará todas elas.\n\nDeseja continuar?`
      : "Apagar todos os dados locais (pastas Ready/ e Temp/) e cancelar envios FTP pendentes?\n\nEssa ação não pode ser desfeita.";

    if (!window.confirm(warn)) return;

    setDataClearLoading(true);
    setDataStatusMsg("Limpando...");
    try {
      const r = await window.godsendApi.clearLocalData();
      setDataStatus(null);
      setDataStatusMsg(r.ok ? "Dados locais apagados." : `Falha: ${r.error || "erro desconhecido"}`);
    } finally {
      setDataClearLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full p-3 gap-2.5">

      {/* Scrollable settings body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col pr-3">

          {/* ── Launch at login ── */}
          <Section>
            <label className="flex items-center gap-2.5 text-[13px] cursor-pointer select-none">
              <Checkbox checked={startup} onCheckedChange={handleStartupChange} />
              Abrir o GODsend ao iniciar o sistema
            </label>
          </Section>

          {/* ── App data directory ── */}
          <Section title="Pasta de dados do aplicativo">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                type="text"
                readOnly
                className="flex-1 min-w-[180px]"
                placeholder={`Padrão: ${defaultAppDataDir}`}
                value={appDataDir}
              />
              <Button onClick={handleAppDataBrowse} disabled={appDataSaving}>Procurar&hellip;</Button>
              <Button onClick={handleAppDataReset} disabled={appDataSaving}>Usar padrão</Button>
            </div>
            {appDataStatus && (
              <p className="text-[11px] text-muted-foreground mt-1">{appDataStatus}</p>
            )}
            <Hint>
              Guarda o <strong>config.json</strong>, os logs diários do servidor, o cache
              da biblioteca do Aurora e (por padrão) a pasta <code className="mx-1">runtime/</code>.
              Isto <em>não</em> é o <code className="mx-1">%TEMP%</code> do Windows — são os
              dados do próprio GODsend. Alterar move os dados existentes e
              reinicia o aplicativo. {appDataPortable
                ? "Versão portátil — o padrão é uma pasta ao lado do .exe."
                : "O padrão é a pasta de dados de aplicativos do sistema."}
            </Hint>
          </Section>

          {/* ── Local storage path ── */}
          <Section title="Pasta de armazenamento local">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                type="text"
                readOnly
                className="flex-1 min-w-[180px]"
                placeholder={`Padrão: ${defaultStoragePath}`}
                value={storagePath}
              />
              <Button onClick={handleStorageBrowse}>Procurar&hellip;</Button>
              <Button onClick={handleStorageReset}>Usar padrão</Button>
            </div>
            <Hint>
              Raiz de trabalho do backend (<code className="mx-1">GODSEND_HOME</code>). Contém{" "}
              <code className="mx-1">Temp/</code> (área de trabalho do processamento),{" "}
              <code className="mx-1">Ready/</code> (instalações prontas aguardando FTP),{" "}
              <code className="mx-1">Transfer/</code> (pasta local de ISOs, salvo se alterada
              abaixo) e <code className="mx-1">cache/</code> (listas de títulos Minerva / IA).
              Altere para colocar arquivos grandes em outra unidade sem mover logs e configurações.
            </Hint>
          </Section>

          {/* ── Temporary directories ── */}
          <Section title="Pastas temporárias">
            <PathExplain title="Temp de processamento" path={backendTempPath}>
              Área de trabalho das tarefas ativas em <code>Temp/</code>. Guarda arquivos extraídos,
              pastas de conversão ISO→GOD, staging pós-torrent do Minerva (
              <code>&lt;game&gt;_torrent</code>), buffers de cópia/movimentação do Gerenciador FTP e
              downloads de keyvault de saves. Limpa com <strong>Limpar dados locais</strong> na tela inicial.
              Segue a <strong>Pasta de armazenamento local</strong> — não é configurável à parte.
            </PathExplain>

            <div className="mt-4">
              <p className="text-[12px] font-medium text-[#cad3dc] mb-2">Temp de download de torrent</p>
              <div className="flex flex-wrap gap-2 items-center">
                <Input
                  type="text"
                  readOnly
                  className="flex-1 min-w-[180px]"
                  placeholder={`Padrão: ${defaultTorrentTempPath}`}
                  value={torrentTempPath}
                />
                <Button onClick={handleTorrentTempBrowse}>Procurar&hellip;</Button>
                <Button onClick={handleTorrentTempReset}>Usar padrão</Button>
              </div>
              <PathExplain title="Caminho efetivo" path={torrentTempPath}>
                Onde o <strong>aria2c</strong> grava os pedaços do torrent do Minerva durante o download (
                pastas <code>gd-dl-*</code> e arquivos <code>*.torrent</code> temporários).
                O padrão é <code>Temp/torrent-dl</code> sob a sua pasta de armazenamento, para os downloads ficarem
                na mesma unidade do temp de processamento. Altere para colocar os downloads de torrent
                em um disco específico — mantenha na <strong>mesma unidade</strong> da
                Pasta de armazenamento local quando possível (mover entre unidades é mais lento). Esta opção
                controla o staging do Minerva/aria2c; <em>não</em> é a variável de ambiente{" "}
                <code>%TEMP%</code> / <code>TMP</code> do Windows.
              </PathExplain>
            </div>
          </Section>

          {/* ── Backend server port ── */}
          <Section title="Porta do servidor (backend)">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                type="number"
                min={1}
                max={65535}
                step={1}
                className="w-[110px]"
                placeholder="8080"
                value={serverPort}
                onChange={(e) => setServerPort(e.target.value)}
              />
              <Button onClick={handlePortSave}>Salvar</Button>
              <Button onClick={handlePortReset}>Usar 8080</Button>
            </div>
            <Hint>
              Usada pelo backend local e inserida nos scripts do Aurora durante o envio
              por FTP. Alterar reinicia o backend.
            </Hint>
          </Section>

          {/* ── Xbox connection ── */}
          <Section title="Conexão com o Xbox">
            <div className="space-y-3">
              <div>
                <Label htmlFor="xboxIp">Endereço IP do Xbox</Label>
                <Input
                  id="xboxIp"
                  type="text"
                  className="mt-1 max-w-[480px]"
                  spellCheck={false}
                  placeholder="ex.: 192.168.1.100"
                  value={xboxIp}
                  onChange={(e) => setXboxIp(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ftpUser">Usuário do FTP</Label>
                <Input
                  id="ftpUser"
                  type="text"
                  className="mt-1 max-w-[480px]"
                  spellCheck={false}
                  placeholder="xboxftp"
                  autoComplete="username"
                  value={ftpUser}
                  onChange={(e) => setFtpUser(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ftpPassword">Senha do FTP</Label>
                <Input
                  id="ftpPassword"
                  type="password"
                  className="mt-1 max-w-[480px]"
                  spellCheck={false}
                  placeholder="xboxftp"
                  autoComplete="current-password"
                  value={ftpPassword}
                  onChange={(e) => setFtpPassword(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ftpScriptsPath">Pasta de destino dos scripts (no Xbox)</Label>
                <div className="flex flex-wrap gap-2 items-center mt-1">
                  <Input
                    id="ftpScriptsPath"
                    type="text"
                    className="flex-1 min-w-[180px] max-w-[480px]"
                    spellCheck={false}
                    placeholder="/Hdd1/Aurora/User/Scripts/Utility/GODSend"
                    value={ftpScriptsPath}
                    onChange={(e) => setFtpScriptsPath(e.target.value)}
                  />
                  <Button onClick={handleFtpScriptsPathReset}>Usar padrão</Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={xboxSaveLoading} onClick={handleXboxSave}>
                  Salvar conexão
                </Button>
                <Button disabled={ftpUploadLoading} onClick={handleFtpUpload}>
                  Enviar scripts do Aurora por FTP
                </Button>
                <Button disabled={exportDbLoading} onClick={handleExportDb}>
                  {exportDbLoading ? "Exportando bancos…" : "Exportar bancos do Aurora"}
                </Button>
              </div>
              {xboxConnectionStatus && (
                <Status className="mb-0">{xboxConnectionStatus}</Status>
              )}
              {ftpScriptsStatus && (
                <Status className="mb-0">{ftpScriptsStatus}</Status>
              )}
              {exportDbStatus && (
                <Status className="mb-0 whitespace-pre-wrap">{exportDbStatus}</Status>
              )}
            </div>

            <Hint>
              Clique em <strong>Salvar conexão</strong> para guardar o IP do Xbox, as
              credenciais de FTP e o caminho dos scripts; o backend será reiniciado para
              que as instalações por FTP após o download usem as mesmas credenciais. Ative o FTP no Aurora (Settings
              &rarr; Network &rarr; Enable FTP) antes de usar{" "}
              <strong>Enviar scripts do Aurora por FTP</strong>. O IP do seu PC e a porta
              do backend são inseridos automaticamente no <code>state.lua</code>. O
              caminho precisa ser o mesmo que o Aurora realmente carrega (copie
              do seu cliente FTP). No USB costuma ser{" "}
              <code>/Usb0/Apps/Aurora/User/Scripts/Utility/GODSend</code> &mdash; atenção a{" "}
              <code>Apps</code> e <code>Utility</code> (não <code>Utilities</code>).
              No HDD costuma ser{" "}
              <code>/Hdd1/Aurora/User/Scripts/Utility/GODSend</code>.
            </Hint>

            {/* FTP Debugging (collapsible) */}
            <Collapsible
              open={ftpDebugOpen}
              onOpenChange={setFtpDebugOpen}
              className="mt-3 border border-[#1e242e] rounded-lg overflow-hidden"
            >
              <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-3 py-2 text-[12px] font-semibold text-muted-foreground bg-muted hover:text-foreground hover:bg-accent transition-colors text-left select-none cursor-pointer">
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform duration-150",
                    ftpDebugOpen && "rotate-90"
                  )}
                />
                Ferramentas de diagnóstico de FTP
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 py-2.5 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={ftpTestLoading} onClick={handleFtpTest}>
                    Testar conexão
                  </Button>
                  <Button size="sm" disabled={ftpScanLoading} onClick={handleFtpScan}>
                    Varrer portas da rede
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setFtpDebugLog("");
                      setFtpDebugStatus("");
                    }}
                  >
                    Limpar log
                  </Button>
                </div>
                {ftpDebugStatus && (
                  <Status className="mb-0">{ftpDebugStatus}</Status>
                )}
                <div>
                  <Label htmlFor="ftpScanSubnet">
                    Sub-rede para varrer (ex.: 192.168.1)
                  </Label>
                  <div className="flex flex-wrap gap-2 items-center mt-1">
                    <Input
                      id="ftpScanSubnet"
                      type="text"
                      className="max-w-[200px]"
                      spellCheck={false}
                      placeholder="192.168.1"
                      value={ftpScanSubnet}
                      onChange={(e) => setFtpScanSubnet(e.target.value)}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Porta 21 em .1 &ndash; .254
                    </span>
                  </div>
                </div>
                <pre
                  ref={ftpDebugLogRef}
                  className="p-2 bg-surface border border-border rounded text-[11px] leading-[1.4] text-[#c0c8d4] min-h-[80px] max-h-[220px] overflow-auto whitespace-pre-wrap break-words select-text cursor-text font-mono"
                >
                  {ftpDebugLog}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          </Section>

          {/* ── Local Transfer folder ── */}
          <Section title="Pasta Transfer local (ISOs)">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                type="text"
                readOnly
                className="flex-1 min-w-[180px]"
                placeholder="Padrão: pasta de dados / Transfer"
                value={transferPath}
              />
              <Button onClick={handleTransferBrowse}>Procurar&hellip;</Button>
              <Button onClick={handleTransferReset}>Usar padrão</Button>
            </div>
            <Hint>
              Alterar reinicia o backend. O script do Xbox usa esta pasta para a
              &ldquo;Biblioteca local&rdquo;.
            </Hint>
          </Section>

          {/* ── Save backup folder ── */}
          <Section title="Pasta de backup de saves">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                type="text"
                readOnly
                className="flex-1 min-w-[180px]"
                placeholder="Padrão: a mesma da pasta Transfer"
                value={saveBackupPath}
              />
              <Button onClick={handleSaveBackupBrowse}>Procurar&hellip;</Button>
              <Button onClick={handleSaveBackupReset}>Usar padrão</Button>
            </div>
            <Hint>
              Os backups de saves baixados ficam aqui. Se não definida, usa a pasta
              Transfer. Estrutura:{" "}
              <code>Saves/&lt;gamertag&gt; (&lt;XUID&gt;)/&lt;game&gt; - &lt;titleID&gt;/</code>.
            </Hint>

            <div className="flex flex-wrap gap-2 items-center mt-2">
              <Button onClick={handleBackupAllSaves} disabled={backupAllBusy}>
                {backupAllBusy ? "Salvando backup…" : "Fazer backup de todos os perfis e saves"}
              </Button>
            </div>
            {backupAllStatus && <Status className="mt-2">{backupAllStatus}</Status>}
            <Hint>
              Baixa todos os pacotes de perfil e todos os saves por jogo do Xbox
              conectado para a pasta acima. Perfis com gamertag identificável são
              agrupados pelo nome; os demais usam o XUID.
            </Hint>
          </Section>

          {/* ── Game cache ── */}
          <Section title="Cache de jogos">
            {cacheStatus && (
              <Status className="mb-2">{cacheStatus}</Status>
            )}
            <Button disabled={cacheLoading} onClick={handleCacheRefresh}>
              Atualizar todos os caches
            </Button>
            <Hint>
              Os caches são carregados do disco ao iniciar e nunca são atualizados
              automaticamente. Clique para rebaixar todas as listas de jogos do Internet
              Archive e os caches de sistemas de ROM que você já navegou.
            </Hint>
          </Section>

          {/* ── Internet Archive account ── */}
          <Section title="Conta do Internet Archive">
            <div className="space-y-3">
              {iaSessionStatus && (
                <Status className="mb-0">{iaSessionStatus}</Status>
              )}
              <div>
                <Label htmlFor="iaEmail">E-mail</Label>
                <Input
                  id="iaEmail"
                  type="email"
                  className="mt-1 max-w-[480px]"
                  spellCheck={false}
                  autoComplete="username"
                  placeholder="Seu e-mail do archive.org"
                  value={iaEmail}
                  onChange={(e) => setIaEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="iaPassword">Senha</Label>
                <Input
                  id="iaPassword"
                  type="password"
                  className="mt-1 max-w-[480px]"
                  spellCheck={false}
                  autoComplete="current-password"
                  placeholder="Não é armazenada — usada só para entrar"
                  value={iaPassword}
                  onChange={(e) => setIaPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={iaLoginLoading} onClick={handleIALogin}>
                  Entrar &amp; reiniciar backend
                </Button>
                <Button onClick={handleIALogout}>Sair</Button>
              </div>
            </div>
            <Hint>
              Usa a API de login oficial do archive.org. Os cookies de sessão são salvos
              localmente; sua senha nunca é armazenada.
            </Hint>
          </Section>

          {/* ── ROM install path ── */}
          <Section title="Pasta de instalação de ROMs (no Xbox)">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                type="text"
                className="flex-1 min-w-[180px] max-w-[480px]"
                placeholder={String.raw`Padrão: Emulators\RetroArch\roms`}
                value={romPath}
                onChange={(e) => setRomPath(e.target.value)}
              />
              <Button onClick={handleRomPathSave}>Salvar</Button>
              <Button onClick={handleRomPathReset}>Usar padrão</Button>
            </div>
            <Hint>
              Caminho relativo à unidade para instalar ROMs. Cada sistema recebe uma subpasta
              (ex.:&nbsp;\NES\, \SNES\). Alterar reinicia o backend.
            </Hint>
          </Section>

          {/* ── Aria2 / Minerva download ports ── */}
          <Section title="Portas de download do Aria2 / Minerva">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <Label htmlFor="aria2Listen">Porta de escuta</Label>
                  <Input
                    id="aria2Listen"
                    type="number"
                    min={1}
                    max={65535}
                    step={1}
                    className="mt-1 w-[110px]"
                    placeholder="(auto)"
                    value={aria2ListenPort}
                    onChange={(e) => setAria2ListenPort(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="aria2Dht">Porta DHT</Label>
                  <Input
                    id="aria2Dht"
                    type="number"
                    min={1}
                    max={65535}
                    step={1}
                    className="mt-1 w-[110px]"
                    placeholder="(auto)"
                    value={aria2DhtPort}
                    onChange={(e) => setAria2DhtPort(e.target.value)}
                  />
                </div>
                <Button onClick={handleAria2Save}>Salvar</Button>
              </div>
              {aria2Status && <Status>{aria2Status}</Status>}
            </div>
            <Hint>
              Portas que o aria2 usa para o tráfego BitTorrent ao baixar do Minerva
              Archive. Deixe em branco para seleção automática. Defina-as se precisar
              abrir regras específicas de firewall. Alterar reinicia o backend.
            </Hint>
          </Section>

          {/* ── Default Xbox drive ── */}
          <Section title="Unidade padrão do Xbox">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Button disabled={driveLoading} onClick={handleFetchDrives}>
                  {driveLoading ? "Buscando\u2026" : "Buscar unidades do Xbox"}
                </Button>
              </div>
              {driveList.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-3 py-1 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    value={defaultDrive}
                    onChange={(e) => setDefaultDrive(e.target.value)}
                  >
                    <option value="">(nenhuma — perguntar a cada vez)</option>
                    {driveList.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
              {driveList.length === 0 && defaultDrive && (
                <div className="flex flex-wrap gap-2 items-center">
                  <Input
                    type="text"
                    className="w-[140px]"
                    placeholder="ex.: Hdd1:"
                    value={defaultDrive}
                    onChange={(e) => setDefaultDrive(e.target.value)}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleDriveSave}>Salvar</Button>
                <Button onClick={handleDriveClear}>Limpar</Button>
              </div>
              {driveStatus && <Status>{driveStatus}</Status>}
            </div>
            <Hint>
              Quando definida, o script do Aurora pula o seletor de unidade em todo download
              e usa esta unidade automaticamente. Clique em{" "}
              <strong>Buscar unidades do Xbox</strong> para listar os dispositivos de
              armazenamento do console via FTP (o IP do Xbox precisa estar configurado). Clique em{" "}
              <strong>Limpar</strong> para redefinir — o Aurora perguntará a unidade a cada
              vez.
            </Hint>
          </Section>

          {/* ── Custom GOD / XEX install paths ── */}
          <Section title="Pastas personalizadas de instalação GOD / XEX">
            <div className="space-y-4">
              {/* GOD path */}
              <div>
                <Label htmlFor="customGodPath">Pasta de instalação GOD (no Xbox)</Label>
                <div className="flex flex-wrap gap-2 items-center mt-1">
                  <Input
                    id="customGodPath"
                    type="text"
                    className="flex-1 min-w-[180px] max-w-[480px]"
                    placeholder="Padrão: Games"
                    value={customGodPath}
                    onChange={(e) => setCustomGodPathState(e.target.value)}
                  />
                  <Button onClick={() => openFtpPicker("god")}>Procurar por FTP&hellip;</Button>
                  <Button onClick={handleCustomGodPathSave}>Salvar</Button>
                  <Button onClick={handleCustomGodPathClear}>Usar padrão</Button>
                </div>
              </div>

              {/* XEX path */}
              <div>
                <Label htmlFor="customXexPath">Pasta de instalação XEX (no Xbox)</Label>
                <div className="flex flex-wrap gap-2 items-center mt-1">
                  <Input
                    id="customXexPath"
                    type="text"
                    className="flex-1 min-w-[180px] max-w-[480px]"
                    placeholder="Padrão: Games"
                    value={customXexPath}
                    onChange={(e) => setCustomXexPathState(e.target.value)}
                  />
                  <Button onClick={() => openFtpPicker("xex")}>Procurar por FTP&hellip;</Button>
                  <Button onClick={handleCustomXexPathSave}>Salvar</Button>
                  <Button onClick={handleCustomXexPathClear}>Usar padrão</Button>
                </div>
              </div>

              {customPathStatus && <Status>{customPathStatus}</Status>}

              {/* Inline FTP directory picker modal */}
              {ftpPickerOpen && (
                <div className="border border-[#1e242e] rounded-lg overflow-hidden bg-[#0d1117]">
                  <div className="px-3 py-2 text-[12px] font-semibold text-muted-foreground bg-muted flex items-center justify-between">
                    <span>
                      Procurar por FTP — {ftpPickerTarget === "god" ? "pasta GOD" : "pasta XEX"}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => setFtpPickerOpen(false)}>
                      Fechar
                    </Button>
                  </div>
                  <div className="px-3 py-2 space-y-2">
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {ftpPickerLoading ? "Carregando..." : ftpPickerPath}
                    </div>
                    <div className="max-h-[200px] overflow-y-auto border border-[#1e242e] rounded">
                      {ftpPickerEntries.length === 0 && !ftpPickerLoading && (
                        <div className="px-3 py-2 text-[12px] text-muted-foreground">
                          Nenhuma pasta encontrada.
                        </div>
                      )}
                      {ftpPickerEntries.map((entry) => (
                        <button
                          key={entry.name}
                          className="w-full text-left px-3 py-1.5 text-[12px] text-[#c0c8d4] hover:bg-[#1e242e] transition-colors flex items-center gap-2"
                          onClick={() => ftpPickerNavigate(entry)}
                        >
                          <span>{entry.name === ".." ? "↑ .." : "📁 " + entry.name}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2 items-center justify-between">
                      <span className="text-[11px] text-muted-foreground">{ftpPickerStatus}</span>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={ftpPickerSelect}>
                          Selecionar esta pasta
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <Hint>
              Quando definidas, as instalações GOD e XEX vão para estas subpastas na unidade
              escolhida, em vez das pastas padrão <code>GOD</code> e <code>XEX</code>.
              Deixe em branco para usar o padrão. Clique em <strong>Procurar por FTP</strong> para escolher uma
              pasta existente no Xbox. O caminho é relativo à raiz da unidade
              (ex.: <code>Games/GOD</code> ou <code>MyXEX</code>).
            </Hint>
          </Section>

          {/* ── Local app data ── */}
          <Section title="Dados locais do aplicativo">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <Button disabled={dataCheckLoading} onClick={handleDataCheck}>
                  {dataCheckLoading ? "Verificando\u2026" : "Verificar status"}
                </Button>
                <Button disabled={dataClearLoading} onClick={handleDataClear}>
                  {dataClearLoading ? "Limpando\u2026" : "Limpar dados locais"}
                </Button>
              </div>
              {dataStatusMsg && (
                <Status className={dataStatus && (dataStatus.active_jobs > 0 || dataStatus.pending_ftp_jobs > 0) ? "text-yellow-400" : ""}>
                  {dataStatusMsg}
                </Status>
              )}
            </div>
            <Hint>
              Mostra as tarefas ativas, as repetições de FTP pendentes e o tamanho total
              dos dados locais (pastas Ready/ e Temp/). <strong>Limpar dados locais</strong>{" "}
              cancela todas as tarefas de FTP pendentes, remove os arquivos de jogos
              baixados/convertidos e zera a fila de tarefas. Uma confirmação avisará se
              houver tarefas ativas ou pendentes.
            </Hint>
          </Section>

        </div>
      </ScrollArea>
    </div>
  );
}
