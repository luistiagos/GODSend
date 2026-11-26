import { useState, useEffect, useCallback, useRef } from "react";
import {
  Usb, Wifi, Search, Loader2, CheckCircle2, AlertTriangle, Terminal,
  ArrowRight, Settings, Play, HardDrive, RefreshCw, Gamepad2, ArrowLeft,
  Store, FolderOpen, ListOrdered, HelpCircle
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import BadAvatarUsbPage from "./BadAvatarUsbPage";
import XboxOneSeriesUsbPage from "./XboxOneSeriesUsbPage";
import MainNav from "./MainNav";
import xbox360ConsoleImg from "../assets/consoles/xbox-360.webp";
import xboxOneSeriesConsoleImg from "../assets/consoles/xbox-one-series.webp";
import {
  canSkipPreparation,
  canSkipXeniaPreparation,
  hasXboxOneSeriesPreparedDrive,
  nextStepAfterPreparedUsbScan,
  nextStepAfterXeniaUsbScan,
  readPersistedRghDeclaration,
  readPreparedUsbDetection,
  readPreparedXeniaDetection,
  writePersistedRghDeclaration,
  type CatalogConsoleContext,
  type PreparedDeviceState,
  type PreparedUsbWizardStep,
  type XboxOneSeriesDeviceState,
} from "../../services/preparedUsbDetection.ts";
import {
  CROSS_CONSOLE_NOTICE,
  PREPARED_DEVICE_NOTICE,
  PREPARED_DEVICE_SUMMARY,
  PREPARED_DEVICE_TITLE,
} from "../../services/preparedDeviceCopy.ts";
import { formatErrorForUser } from "../../infrastructure/userFriendlyError.ts";

interface LogInfo {
  logsDirectory?: string;
  currentLogFile?: string;
}

interface HomePageProps {
  outputLines: string[];
  logInfo: LogInfo | null;
  ftpStatus: string;
  onNavigateSettings: () => void;
  onNavigateQueue: () => void;
  onNavigateBrowse: (context?: CatalogConsoleContext) => void;
  onNavigateIso2God: () => void;
  onNavigateIso2Xex: () => void;
  onNavigateFtpManager: () => void;
  onNavigateBadAvatarUsb: () => void;
  onNavigateXboxOneSeriesUsb?: () => void;
  onNavigateUsbGames?: (initialDriveRoot?: string) => void;
  onNavigateHome?: () => void;
  usbGamesCount?: number;
  onLibraryToggle: () => void;
  onReconnect: () => void;
  libraryLoading: boolean;
  onAppendLine: (line: string) => void;
  queueJobs: any[];
  simpleMode?: boolean;
  onOpenUpdateModal?: (info: any) => void;
}

export default function HomePage({
  outputLines,
  logInfo,
  ftpStatus,
  onNavigateSettings,
  onNavigateQueue,
  onNavigateBrowse,
  onNavigateIso2God,
  onNavigateIso2Xex,
  onNavigateFtpManager,
  onNavigateBadAvatarUsb,
  onNavigateXboxOneSeriesUsb,
  onNavigateUsbGames,
  onNavigateHome,
  usbGamesCount,
  onLibraryToggle,
  onReconnect,
  libraryLoading,
  onAppendLine,
  queueJobs,
  simpleMode = true,
  onOpenUpdateModal,
}: HomePageProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  
  // Simple Mode state
  const [wizardStep, setWizardStep] = useState<PreparedUsbWizardStep>("welcome-choice");
  const [preparedDeviceState, setPreparedDeviceState] = useState<PreparedDeviceState>("sem-preparo");
  const [xeniaDeviceState, setXeniaDeviceState] = useState<XboxOneSeriesDeviceState>("sem-preparo");
  const [detectedDrives, setDetectedDrives] = useState<any[]>([]);
  const [detectedGamesCount, setDetectedGamesCount] = useState<number | null>(null);
  const [detectedXeniaGamesCount, setDetectedXeniaGamesCount] = useState<number | null>(null);
  const [preparedCheckBusy, setPreparedCheckBusy] = useState(false);
  const [preparedCheckNotice, setPreparedCheckNotice] = useState("");
  const preparedCheckInFlight = useRef(false);
  const preparedDetectionDismissed = useRef(false);
  const xeniaDetectionDismissed = useRef(false);
  const preparedDetectionMounted = useRef(false);
  const [selectedUnlockMode, setSelectedUnlockMode] = useState<boolean | null>(null);
  const selectedUnlockModeRef = useRef<boolean | null>(null);
  selectedUnlockModeRef.current = selectedUnlockMode;
  const [scanState, setScanState] = useState<"idle" | "checking" | "scanning" | "connecting" | "success" | "not-found" | "error">("idle");
  const [xboxIp, setXboxIp] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [isManualInputVisible, setIsManualInputVisible] = useState(false);
  const [backAction, setBackAction] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines]);

  // Load current Xbox IP from settings on mount
  useEffect(() => {
    if (simpleMode) {
      window.godsendApi.getXboxConnection().then((conn: any) => {
        if (conn && conn.xboxIp) {
          setXboxIp(conn.xboxIp);
          setManualIp(conn.xboxIp);
        }
      });
    }
  }, [simpleMode]);

  const checkPreparedDevice = useCallback(async (manual = false) => {
    if (preparedCheckInFlight.current) return;
    preparedCheckInFlight.current = true;
    if (preparedDetectionMounted.current) {
      setPreparedCheckBusy(true);
      if (manual) setPreparedCheckNotice("Verificando o pendrive conectado...");
    }

    try {
      // The 5 s poll reuses the cached list; only the user's own check re-enumerates.
      const result = await window.godsendApi.toolsBadAvatarListDrives({ fresh: manual });
      if (!preparedDetectionMounted.current) return;
      const drivesList = result?.ok === true && Array.isArray(result.drives) ? result.drives : [];
      setDetectedDrives(drivesList);
      const detectedState = readPreparedUsbDetection(result);
      const detectedXeniaState = readPreparedXeniaDetection(result);
      if (detectedState === null) {
        if (manual) {
          setPreparedCheckNotice(result?.error || "O Windows ainda não disponibilizou o pendrive. Reconecte-o e tente novamente.");
        }
        setWizardStep((current) => {
          if (current === "checking-prepared") return "unlock";
          if (current === "checking-prepared-xenia") return "usb-xenia";
          return current;
        });
        return;
      }

      const declaredRgh = selectedUnlockModeRef.current === false
        ? false
        : readPersistedRghDeclaration();
      setPreparedDeviceState(detectedState);
      const safeXeniaState: XboxOneSeriesDeviceState = detectedXeniaState ?? "sem-preparo";
      setXeniaDeviceState(safeXeniaState);
      setWizardStep((current) => {
        if (current === "checking-prepared-xenia") {
          return nextStepAfterXeniaUsbScan(current, safeXeniaState, xeniaDetectionDismissed.current);
        }
        return nextStepAfterPreparedUsbScan(
          current,
          detectedState,
          preparedDetectionDismissed.current,
          declaredRgh,
        );
      });
      if (canSkipPreparation(detectedState, declaredRgh)) {
        setPreparedCheckNotice("");
      } else if (manual) {
        setPreparedCheckNotice(
          hasXboxOneSeriesPreparedDrive(drivesList)
            ? CROSS_CONSOLE_NOTICE.xeniaDriveInXbox360Flow.title
            : PREPARED_DEVICE_NOTICE[detectedState],
        );
      }
    } catch (error: any) {
      if (!preparedDetectionMounted.current) return;
      if (manual) {
        setPreparedCheckNotice(formatErrorForUser(error, { area: "drive-maintenance" }));
      }
      setWizardStep((current) => {
        if (current === "checking-prepared") return "unlock";
        if (current === "checking-prepared-xenia") return "usb-xenia";
        return current;
      });
    } finally {
      preparedCheckInFlight.current = false;
      if (preparedDetectionMounted.current) setPreparedCheckBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!simpleMode) return undefined;
    preparedDetectionMounted.current = true;
    void checkPreparedDevice();
    const timer = window.setInterval(() => void checkPreparedDevice(), 5_000);

    return () => {
      preparedDetectionMounted.current = false;
      window.clearInterval(timer);
    };
  }, [simpleMode, checkPreparedDevice]);

  useEffect(() => {
    if (!simpleMode || (wizardStep !== "prepared-detected" && wizardStep !== "prepared-detected-xenia")) return;
    window.godsendApi.browseGetInstalledGames().then((r: any) => {
      if (!r?.ok || !Array.isArray(r.games)) return;
      if (wizardStep === "prepared-detected") {
        const xbox360Letters = new Set(
          detectedDrives
            .filter((d) => d?.preparedState === "preparado-bloqueado-lt" || d?.preparedState === "preparado-rgh")
            .map((d) => String(d.rootPath || "").charAt(0).toUpperCase())
            .filter(Boolean),
        );
        const filtered = xbox360Letters.size > 0
          ? r.games.filter((g: any) => xbox360Letters.has(String(g?.path || "").charAt(0).toUpperCase()))
          : r.games;
        setDetectedGamesCount(filtered.length);
      } else {
        const xeniaLetters = new Set(
          detectedDrives
            .filter((d) => d?.xboxOneSeriesState === "preparado-xenia")
            .map((d) => String(d.rootPath || "").charAt(0).toUpperCase())
            .filter(Boolean),
        );
        const filtered = xeniaLetters.size > 0
          ? r.games.filter((g: any) => xeniaLetters.has(String(g?.path || "").charAt(0).toUpperCase()))
          : [];
        setDetectedXeniaGamesCount(filtered.length);
      }
    }).catch(() => {});
  }, [simpleMode, wizardStep, detectedDrives]);

  // Auto-scan when switching to network mode
  useEffect(() => {
    if (wizardStep === "network" && scanState === "idle" && !xboxIp) {
      handleAutoDiscovery();
    }
  }, [wizardStep]);

  const handleAutoDiscovery = async () => {
    setScanState("checking");
    setStatusMsg("Obtendo endereço de IP do seu computador...");
    
    try {
      const localIp = await window.godsendApi.getLocalIp();
      if (!localIp || localIp === "127.0.0.1") {
        setScanState("not-found");
        setStatusMsg("Não foi possível detectar a rede local. Verifique sua conexão.");
        return;
      }
      
      const ipParts = localIp.split(".");
      if (ipParts.length !== 4) {
        setScanState("not-found");
        setStatusMsg("Não foi possível identificar a rede do seu computador. Confira se o Wi-Fi ou cabo de rede está conectado e tente novamente.");
        return;
      }
      
      const subnet = ipParts.slice(0, 3).join(".");
      setScanState("scanning");
      setStatusMsg(`Procurando Xbox 360 na mesma rede (${subnet}.X)...`);
      
      const scanRes = await window.godsendApi.ftpScanPorts(subnet);
      if (!scanRes.ok || !scanRes.hosts || scanRes.hosts.length === 0) {
        setScanState("not-found");
        setStatusMsg("Nenhum Xbox 360 foi encontrado na rede. Ligue o videogame com a Aurora aberta, conecte no mesmo Wi-Fi ou cabo de rede e tente de novo.");
        return;
      }
      
      // Try connection on the first found host
      const detectedIp = scanRes.hosts[0];
      setScanState("connecting");
      setStatusMsg(`Configurando conexão e enviando arquivos para ${detectedIp}...`);
      
      const testRes = await window.godsendApi.ftpTestConnection({
        xboxIp: detectedIp,
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
      });
      
      if (!testRes.ok) {
        setScanState("not-found");
        setStatusMsg(`Encontramos o Xbox 360 (${detectedIp}), mas ele recusou o usuário e senha padrão. Confira os dados da Aurora em “Configurações”.`);
        return;
      }
      
      // Save credentials in config
      await window.godsendApi.setXboxConnection({
        xboxIp: detectedIp,
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
        ftpScriptsPath: "/Hdd1/Aurora/User/Scripts/Utility/GODSend",
      });
      
      // Auto-upload Aurora scripts
      const uploadRes = await window.godsendApi.ftpAuroraScripts({
        xboxIp: detectedIp,
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
        ftpScriptsPath: "/Hdd1/Aurora/User/Scripts/Utility/GODSend",
      });
      
      if (uploadRes.ok) {
        setXboxIp(detectedIp);
        setManualIp(detectedIp);
        setScanState("success");
        setStatusMsg(`Conectado com sucesso ao Xbox 360 (${detectedIp})!`);
        onReconnect(); // update FTP status indicator globally
      } else {
        setScanState("not-found");
        setStatusMsg(`Conectado ao Xbox 360 (${detectedIp}), mas não foi possível enviar os arquivos da loja para a Aurora. Verifique se há espaço livre no HD do console e tente novamente.`);
      }
    } catch (err: any) {
      setScanState("error");
      setStatusMsg(formatErrorForUser(err, { area: "ftp" }));
    }
  };

  const handleManualConnect = async () => {
    if (!manualIp.trim()) return;
    setScanState("connecting");
    setStatusMsg(`Tentando conectar ao IP ${manualIp}...`);
    
    try {
      const testRes = await window.godsendApi.ftpTestConnection({
        xboxIp: manualIp.trim(),
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
      });
      
      if (!testRes.ok) {
        setScanState("error");
        setStatusMsg(`Não foi possível conectar ao Xbox 360 (${manualIp}). Confira se o videogame está ligado na Aurora, na mesma rede do computador, e se o IP digitado está correto.`);
        return;
      }
      
      // Save credentials in config
      await window.godsendApi.setXboxConnection({
        xboxIp: manualIp.trim(),
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
        ftpScriptsPath: "/Hdd1/Aurora/User/Scripts/Utility/GODSend",
      });
      
      // Auto-upload Aurora scripts
      const uploadRes = await window.godsendApi.ftpAuroraScripts({
        xboxIp: manualIp.trim(),
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
        ftpScriptsPath: "/Hdd1/Aurora/User/Scripts/Utility/GODSend",
      });
      
      if (uploadRes.ok) {
        setXboxIp(manualIp.trim());
        setScanState("success");
        setStatusMsg(`Conectado com sucesso ao Xbox 360 (${manualIp.trim()})!`);
        onReconnect();
      } else {
        setScanState("error");
        setStatusMsg("Conectado ao Xbox 360, mas não foi possível enviar os arquivos da loja para a Aurora. Tente novamente em instantes.");
      }
    } catch (err: any) {
      setScanState("error");
      setStatusMsg(formatErrorForUser(err, { area: "ftp" }));
    }
  };

  // ── Aviso de atualização para quem desligou a verificação automática ──────
  // Com a verificação automática desligada, `checkForUpdates(false)` retorna
  // cedo (autoUpdateService.ts) e o modal de update nunca aparece sozinho — a
  // única rota até uma versão nova ficava escondida dentro de Configurações.
  const [autoCheckOff, setAutoCheckOff] = useState(false);
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);
  const [updateCheckMsg, setUpdateCheckMsg] = useState("");

  useEffect(() => {
    window.godsendApi.getAutoCheckUpdates()
      .then((r: any) => setAutoCheckOff(r?.ok === true && r.enabled === false))
      .catch(() => {});
  }, []);

  async function handleManualUpdateCheck() {
    setUpdateCheckBusy(true);
    setUpdateCheckMsg("");
    try {
      // force=true: ignora tanto a preferência desligada quanto o intervalo de 12 h.
      const res = await window.godsendApi.checkForUpdates(true);
      if (!res?.ok) {
        setUpdateCheckMsg(formatErrorForUser(res?.error, { area: "update" }));
      } else if (res.updateAvailable) {
        setUpdateCheckMsg(`Versão v${res.latestVersion} disponível.`);
        onOpenUpdateModal?.(res);
      } else {
        setUpdateCheckMsg(`Você já está na versão mais recente${res.currentVersion ? ` (v${res.currentVersion})` : ""}.`);
      }
    } catch (err: any) {
      setUpdateCheckMsg(formatErrorForUser(err, { area: "update" }));
    } finally {
      setUpdateCheckBusy(false);
    }
  }

  async function handleOpenLogs() {
    const r = await window.godsendApi.openLogsFolder();
    if (r && !r.ok && r.error) {
      onAppendLine(`[ERROR] Não foi possível abrir a pasta de logs: ${r.error}`);
    }
  }

  const goToMethod = useCallback(() => {
    setBackAction(null);
    setWizardStep("method");
  }, []);

  const startPreparationFlow = useCallback(() => {
    setPreparedCheckNotice("");
    setWizardStep("console-choice");
  }, []);

  const startXbox360Flow = useCallback(() => {
    preparedDetectionDismissed.current = false;
    setPreparedCheckNotice("");
    setWizardStep("checking-prepared");
    void checkPreparedDevice(false);
  }, [checkPreparedDevice]);

  const startXboxOneSeriesFlow = useCallback(() => {
    xeniaDetectionDismissed.current = false;
    setPreparedCheckNotice("");
    setWizardStep("checking-prepared-xenia");
    void checkPreparedDevice(true);
  }, [checkPreparedDevice]);

  // ── Render Advanced Mode (Legacy terminal logs) ───────────────────────────
  if (!simpleMode) {
    return (
      <div className="flex flex-col h-screen p-3 gap-2.5">
        <header className="flex justify-end items-center shrink-0">
          <MainNav
            ftpStatus={ftpStatus}
            currentPage="home"
            libraryAvailable={ftpStatus === "connected"}
            libraryLoading={libraryLoading}
            queueJobs={queueJobs}
            usbGamesCount={usbGamesCount}
            onReconnect={onReconnect}
            onLibraryToggle={onLibraryToggle}
            onNavigateHome={onNavigateHome}
            onNavigateQueue={onNavigateQueue}
            onNavigateBrowse={onNavigateBrowse}
            onNavigateSettings={onNavigateSettings}
            onNavigateIso2God={onNavigateIso2God}
            onNavigateIso2Xex={onNavigateIso2Xex}
            onNavigateFtpManager={onNavigateFtpManager}
            onNavigateBadAvatarUsb={onNavigateBadAvatarUsb}
            onNavigateXboxOneSeriesUsb={onNavigateXboxOneSeriesUsb}
            onNavigateUsbGames={onNavigateUsbGames ? () => onNavigateUsbGames() : undefined}
            simpleMode={false}
          />
        </header>

        <pre
          ref={outputRef}
          className="flex-1 min-h-0 m-0 p-2.5 bg-surface border border-border rounded-lg overflow-auto whitespace-pre-wrap break-words font-mono text-[13px] leading-[1.4] select-text cursor-text"
        >
          {outputLines.join("\n")}
        </pre>

        <footer className="flex justify-between items-center gap-2.5 shrink-0 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2 font-mono">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                ftpStatus === "connected"
                  ? "bg-[#22c55e]"
                  : ftpStatus === "checking"
                  ? "bg-[#eab308] animate-pulse"
                  : "bg-[#ef4444]"
              }`}
            />
            {ftpStatus === "connected"
              ? "Xbox 360 conectado"
              : ftpStatus === "checking"
              ? "Verificando conexao..."
              : "Desconectado"}
          </div>

          <Button size="sm" className="shrink-0" onClick={handleOpenLogs}>
            Abrir pasta de logs
          </Button>
        </footer>
      </div>
    );
  }

  // ── Render Simple Mode (Friendly Dashboard) ──────────────────────────────
  const isXboxConnected = ftpStatus === "connected";
  const unlockModeLabel = selectedUnlockMode ? "Xbox Desbloqueado RGH" : "Xbox Bloqueado ou LT";

  return (
    <div className="flex h-screen flex-col gap-5 overflow-y-auto px-4 py-5">
      {/* Welcome Banner */}
      <header className="mx-auto mb-2 w-full max-w-4xl text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">
          Bem-vindo ao Xbox 360 Companion
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1 max-w-lg mx-auto leading-relaxed">
          Prepare seus jogos e pendrives/HDs para <strong className="text-foreground">Xbox 360</strong> ou{" "}
          <strong className="text-foreground">Xbox One / Series (Modo Desenvolvedor / Xenia)</strong> de forma simples e guiada.
        </p>
      </header>

      {/* Auto-update disabled notice — the only route to a new version when the
          automatic modal is switched off. */}
      {autoCheckOff && (
        <div className="mx-auto -mt-2 w-full max-w-4xl">
          <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5 text-[11px] leading-normal text-amber-300/90">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div className="min-w-[200px] flex-1 text-left">
              <span className="block font-semibold text-amber-200">
                Verificação automática de atualizações desativada
              </span>
              {updateCheckMsg || "O aplicativo não vai avisar sozinho quando sair uma versão nova."}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              disabled={updateCheckBusy}
              onClick={handleManualUpdateCheck}
            >
              {updateCheckBusy
                ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Verificando…</>
                : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Verificar agora</>}
            </Button>
          </div>
        </div>
      )}

      {/* Main Mode View */}
      <div className={wizardStep === "usb" || wizardStep === "usb-xenia"
        ? "mx-auto w-full max-w-4xl"
        : "card-surface mx-auto flex min-h-[350px] w-full max-w-4xl flex-col justify-between p-5"}
      >
        {wizardStep === "welcome-choice" ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-1 py-1 sm:px-3">
            <header className="text-center">
              <h2 className="font-display text-xl font-bold text-foreground">
                O que você deseja fazer agora?
              </h2>
              <p className="mx-auto mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                Escolha uma das opções abaixo. Você não precisa entender termos técnicos — cada caminho mostra o que fazer passo a passo.
              </p>
            </header>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Fluxo 1: Catálogo de Jogos */}
              <button
                type="button"
                onClick={() => onNavigateBrowse("all")}
                className="group flex flex-col justify-between text-left p-5 rounded-xl border border-border bg-surface/60 hover:bg-surface hover:border-sky-500/70 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/60"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
                      <Store className="h-6 w-6" />
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/20">
                      Sem precisar de pendrive
                    </span>
                  </div>

                  <div>
                    <h3 className="font-display text-[16px] font-bold text-foreground group-hover:text-sky-300 transition-colors">
                      Catálogo de Jogos
                    </h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                      Vá direto para a lista de jogos de Xbox 360 e baixe os arquivos <strong className="text-foreground">para qualquer pasta do seu computador</strong> (ou para um pendrive já preparado).
                    </p>
                  </div>

                  <ul className="space-y-2 rounded-lg bg-background/60 border border-border/50 p-3 text-[11.5px] leading-snug text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <FolderOpen className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-foreground">Salvar em pasta no PC:</strong> clique em qualquer jogo e escolha <em>Pasta no PC</em> para salvar em Downloads, Documentos ou onde preferir.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-foreground">Tudo automático:</strong> o programa baixa, extrai e prepara os arquivos prontos para o Xbox 360.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Gamepad2 className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-foreground">Use como quiser depois:</strong> guarde sua coleção no PC ou copie para um pendrive quando for jogar.
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-[12.5px] font-semibold text-sky-400">
                  <span>Abrir catálogo de jogos</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </button>

              {/* Fluxo 2: Preparar Pendrive / HD */}
              <button
                type="button"
                onClick={startPreparationFlow}
                className="group flex flex-col justify-between text-left p-5 rounded-xl border border-border bg-surface/60 hover:bg-surface hover:border-[#22c55e]/70 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#22c55e]/60"
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="p-2.5 rounded-xl bg-[#22c55e]/10 text-[#22c55e] border border-[#22c55e]/20">
                      <Usb className="h-6 w-6" />
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#22c55e]/10 text-green-300 border border-[#22c55e]/20">
                      Passo a passo guiado
                    </span>
                  </div>

                  <div>
                    <h3 className="font-display text-[16px] font-bold text-foreground group-hover:text-green-300 transition-colors">
                      Preparar Pendrive / HD
                    </h3>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
                      Configure seu pendrive ou HD externo do zero para o seu <strong className="text-foreground">Console</strong>.
                    </p>
                  </div>

                  <ul className="space-y-2 rounded-lg bg-background/60 border border-border/50 p-3 text-[11.5px] leading-snug text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <HelpCircle className="h-3.5 w-3.5 text-[#22c55e] shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-foreground">Escolha seu videogame:</strong> primeiro você escolhe entre Xbox 360 ou Xbox One / Series.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <HardDrive className="h-3.5 w-3.5 text-[#22c55e] shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-foreground">Prepara o USB sozinho:</strong> FAT32 + Aurora/BadAvatar no 360, ou NTFS + permissões do Xenia no Xbox One / Series.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Wifi className="h-3.5 w-3.5 text-[#22c55e] shrink-0 mt-0.5" />
                      <span>
                        <strong className="text-foreground">Ou envio pela rede (RGH):</strong> encontra seu Xbox 360 no Wi-Fi/cabo para mandar os jogos sem tirar o HD.
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-[12.5px] font-semibold text-[#22c55e]">
                  <span>Iniciar preparação do pendrive/HD</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            </section>

            {/* Dica rápida para leigos */}
            <div className="rounded-lg border border-border/50 bg-muted/25 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground block mb-1">
                Na dúvida sobre qual clicar?
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <p>
                  • Quer apenas <strong className="text-foreground">baixar os arquivos dos jogos para o computador</strong> (sem plugar pendrive)? Clique em <strong className="text-sky-300">Catálogo de Jogos</strong>.
                </p>
                <p>
                  • Vai <strong className="text-foreground">preparar um pendrive ou HD para Xbox 360 ou Xbox One / Series</strong>? Clique em <strong className="text-green-300">Preparar Pendrive / HD</strong>.
                </p>
              </div>
            </div>

            {Array.isArray(queueJobs) && queueJobs.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-2.5 text-[12px]">
                <span className="text-amber-200 flex items-center gap-2">
                  <ListOrdered className="h-4 w-4 text-amber-400 shrink-0" />
                  Você tem <strong>{queueJobs.length}</strong> {queueJobs.length === 1 ? "jogo/tarefa na fila de downloads" : "jogos/tarefas na fila de downloads"}.
                </span>
                <Button size="sm" variant="outline" onClick={onNavigateQueue} className="h-7 text-[11px]">
                  Acompanhar Fila
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            )}
          </div>
        ) : wizardStep === "console-choice" ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-1 py-1 sm:px-3 animate-fade-in">
            <header className="text-center relative">
              <Button
                variant="ghost"
                size="sm"
                className="sm:absolute left-0 top-1 mb-2 sm:mb-0 text-muted-foreground hover:text-foreground text-[12px] flex items-center gap-1.5 px-2"
                onClick={() => setWizardStep("welcome-choice")}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </Button>
              <h2 className="font-display text-xl font-bold text-foreground">
                Qual é o seu videogame Xbox?
              </h2>
              <p className="mx-auto mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
                Clique na foto do videogame que você vai usar. Cada console precisa de um formato diferente no pendrive ou HD — nós fazemos tudo no padrão certo para você.
              </p>
            </header>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {/* Opção 1: Xbox 360 */}
              <button
                type="button"
                onClick={startXbox360Flow}
                className="group flex flex-col justify-between text-left overflow-hidden rounded-xl border border-border bg-surface/60 hover:bg-surface hover:border-[#22c55e]/80 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#22c55e]/60"
              >
                <div>
                  <div className="relative w-full aspect-video overflow-hidden border-b border-border/50 bg-[#14181f]">
                    <img
                      src={xbox360ConsoleImg}
                      alt="Consoles Xbox 360 (Fat e Slim) com controle"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      draggable={false}
                    />
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-black/75 border border-[#22c55e]/45 px-2.5 py-0.5 text-[10px] font-semibold text-green-300 backdrop-blur-xs">
                      Xbox 360 · FAT32
                    </span>
                  </div>

                  <div className="p-4 flex flex-col gap-2">
                    <h3 className="font-display text-[17px] font-bold text-foreground group-hover:text-green-300 transition-colors">
                      Se quer para Xbox 360 — clique aqui
                    </h3>
                    <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                      Para qualquer <strong className="text-foreground">Xbox 360</strong> (Fat, Slim ou Super Slim — Travado, LT ou RGH).
                    </p>
                    <p className="text-[11.5px] leading-snug text-muted-foreground/90 rounded-lg bg-background/60 border border-border/50 p-2.5">
                      Prepara o pendrive/HD em <strong className="text-foreground">FAT32</strong> com a dashboard <strong className="text-foreground">Aurora / BadAvatar</strong> pronta para rodar jogos no Xbox 360.
                    </p>
                  </div>
                </div>

                <div className="mx-4 mb-4 pt-3 border-t border-border/40 flex items-center justify-between text-[12.5px] font-semibold text-[#22c55e]">
                  <span>Continuar para Xbox 360</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </button>

              {/* Opção 2: Xbox One / Xbox Series X|S */}
              <button
                type="button"
                onClick={startXboxOneSeriesFlow}
                className="group flex flex-col justify-between text-left overflow-hidden rounded-xl border border-border bg-surface/60 hover:bg-surface hover:border-sky-500/80 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/60"
              >
                <div>
                  <div className="relative w-full aspect-video overflow-hidden border-b border-border/50 bg-[#14181f]">
                    <img
                      src={xboxOneSeriesConsoleImg}
                      alt="Consoles Xbox One, Xbox Series S e Xbox Series X com controle"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      draggable={false}
                    />
                    <span className="absolute top-2.5 left-2.5 rounded-full bg-black/75 border border-sky-400/50 px-2.5 py-0.5 text-[10px] font-semibold text-sky-300 backdrop-blur-xs">
                      Xbox One / Series · Modo Desenvolvedor (Xenia)
                    </span>
                  </div>

                  <div className="p-4 flex flex-col gap-2">
                    <h3 className="font-display text-[17px] font-bold text-foreground group-hover:text-sky-300 transition-colors">
                      Se quer para Xbox One ou Xbox Series — clique aqui
                    </h3>
                    <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                      Para <strong className="text-foreground">Xbox One, One S/X, Xbox Series S ou Series X</strong> já com o <strong className="text-foreground">Modo Desenvolvedor</strong> e <strong className="text-foreground">Xenia</strong>.
                    </p>
                    <p className="text-[11.5px] leading-snug text-muted-foreground/90 rounded-lg bg-background/60 border border-border/50 p-2.5">
                      Formata em <strong className="text-foreground">NTFS</strong> e aplica automaticamente todas as permissões do console (substitui o XboxMediaUSB) — é só baixar os jogos e abrir pelo Xenia.
                    </p>
                  </div>
                </div>

                <div className="mx-4 mb-4 pt-3 border-t border-border/40 flex items-center justify-between text-[12.5px] font-semibold text-sky-400">
                  <span>Continuar para Xbox One / Series</span>
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            </section>

            <div className="rounded-lg border border-border/50 bg-muted/25 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground block mb-1">
                Atenção: um pendrive preparado para um console não serve no outro
              </span>
              <p>
                O <strong className="text-green-300">Xbox 360</strong> usa formato FAT32 (Aurora/BadAvatar), enquanto o{" "}
                <strong className="text-sky-300">Xbox One e Xbox Series</strong> usam formato NTFS com permissões do Modo Desenvolvedor (Xenia).
                Escolha sempre exatamente o videogame em que você vai plugar este pendrive ou HD.
              </p>
            </div>
          </div>
        ) : wizardStep === "checking-prepared-xenia" ? (
          <div className="mx-auto flex h-[300px] w-full max-w-3xl flex-col items-center justify-center gap-3 px-4 py-5 text-muted-foreground sm:px-7">
            <Loader2 className="h-7 w-7 animate-spin text-sky-400" />
            <p className="text-[13px]">Verificando se já existe um pendrive ou HD preparado para Xbox One / Series (Xenia)...</p>
          </div>
        ) : wizardStep === "prepared-detected-xenia" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7">
            <div className="animate-fade-in flex flex-col gap-4">
              <header className="mb-5 text-center">
                <div className="mx-auto mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-500/35 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-300">
                  <Gamepad2 className="h-3.5 w-3.5" />
                  Xbox One / Xbox Series X|S · Modo Desenvolvedor (Xenia)
                </div>
                <div className="mx-auto mb-3 mt-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-400">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h1 className="font-display text-xl font-bold text-foreground">
                  Pendrive/HD preparado para Xbox One / Series encontrado!
                </h1>
                <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                  {detectedXeniaGamesCount !== null && detectedXeniaGamesCount > 0
                    ? `Encontramos seu pendrive ou HD preparado em NTFS (com permissões do Modo Desenvolvedor) e ${detectedXeniaGamesCount} jogo${detectedXeniaGamesCount !== 1 ? "s" : ""} pronto${detectedXeniaGamesCount !== 1 ? "s" : ""} para o Xenia. Você pode ver os jogos já gravados ou ir direto ao catálogo para adicionar mais títulos.`
                    : `Encontramos seu pendrive ou HD preparado em NTFS com as permissões do Modo Desenvolvedor conferidas para o Xenia. Você já pode ir direto ao catálogo para baixar jogos ou ver o conteúdo gravado.`}
                </p>
                <p className="mx-auto mt-2 max-w-xl text-[12px] leading-relaxed text-muted-foreground/90">
                  Este dispositivo serve exclusivamente para <strong>Xbox One e Xbox Series X|S</strong> (Modo Desenvolvedor / Xenia) — não é compatível com Xbox 360.
                </p>
              </header>

              <section className="card-surface p-5 flex flex-col gap-3">
                {onNavigateUsbGames && (
                  <Button
                    variant="primary"
                    className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white"
                    onClick={() => {
                      const xeniaDrive = detectedDrives.find((d) => d?.xboxOneSeriesState === "preparado-xenia");
                      onNavigateUsbGames(xeniaDrive?.rootPath);
                    }}
                  >
                    <Usb className="h-4 w-4" />
                    {detectedXeniaGamesCount !== null && detectedXeniaGamesCount > 0
                      ? `Ver Jogos Instalados (${detectedXeniaGamesCount})`
                      : "Abrir Jogos Instalados"}
                  </Button>
                )}

                <Button
                  variant="default"
                  className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2"
                  onClick={() => onNavigateBrowse("xbox-one-series")}
                >
                  <Gamepad2 className="h-4 w-4" />
                  Ir para o catálogo de jogos (Xbox One / Series)
                </Button>

                <Button
                  variant="ghost"
                  className="h-11 w-full text-sm font-medium flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    xeniaDetectionDismissed.current = true;
                    setWizardStep("usb-xenia");
                  }}
                >
                  <HardDrive className="h-4 w-4" />
                  Preparar novamente / Preparar outro pendrive ou HD
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-8 text-[12px] text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5"
                  onClick={() => setWizardStep("console-choice")}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Voltar para a escolha de console
                </Button>
              </section>
            </div>
          </div>
        ) : wizardStep === "usb-xenia" ? (
          <div className="flex flex-col">
            <div className="border-b border-border/40 pb-3 mb-4 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <HardDrive className="h-4 w-4 text-sky-400" />
                Preparação USB — Xbox One / Series (Xenia)
              </span>
              <Button
                variant="default"
                size="sm"
                className="rounded-full px-3.5 h-7 text-[12px] font-medium"
                onClick={() => {
                  if (canSkipXeniaPreparation(xeniaDeviceState) && !xeniaDetectionDismissed.current) {
                    setWizardStep("prepared-detected-xenia");
                  } else {
                    setWizardStep("console-choice");
                  }
                }}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </Button>
            </div>
            <div>
              <XboxOneSeriesUsbPage
                embedded
                onBrowseGames={() => onNavigateBrowse("xbox-one-series")}
                onBackToPrevious={() => setWizardStep("console-choice")}
              />
            </div>
          </div>
        ) : wizardStep === "checking-prepared" ? (
          <div className="mx-auto flex h-[300px] w-full max-w-3xl flex-col items-center justify-center gap-3 px-4 py-5 text-muted-foreground sm:px-7">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-[13px]">Verificando se já existe um pendrive ou HD preparado...</p>
          </div>
        ) : wizardStep === "prepared-detected" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7">
            <div className="animate-fade-in flex flex-col gap-4">
              <header className="mb-5 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/10 text-green-400">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h1 className="font-display text-xl font-bold text-foreground">
                  {PREPARED_DEVICE_TITLE[preparedDeviceState]}
                </h1>
                <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                  {detectedGamesCount !== null && detectedGamesCount > 0
                    ? `Encontramos um pendrive ou HD preparado com ${detectedGamesCount} jogo${detectedGamesCount !== 1 ? "s" : ""} gravado${detectedGamesCount !== 1 ? "s" : ""} na pasta Games. Você pode visualizar os títulos já gravados ou ir direto ao catálogo para baixar novos jogos.`
                    : `Encontramos um pendrive ou HD que já está preparado. Você pode visualizar os jogos nele ou ir direto ao catálogo para baixar novos títulos.`
                  }
                </p>
                {PREPARED_DEVICE_SUMMARY[preparedDeviceState] && (
                  <p className="mx-auto mt-2 max-w-xl text-[12px] leading-relaxed text-muted-foreground/90">
                    {PREPARED_DEVICE_SUMMARY[preparedDeviceState]}
                  </p>
                )}
              </header>

              <section className="card-surface p-5 flex flex-col gap-3">
                {onNavigateUsbGames && (
                  <Button
                    variant="primary"
                    className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                    onClick={() => {
                      const x360Drive = detectedDrives.find(
                        (d) => d?.preparedState === "preparado-bloqueado-lt" || d?.preparedState === "preparado-rgh",
                      );
                      onNavigateUsbGames(x360Drive?.rootPath);
                    }}
                  >
                    <Usb className="h-4 w-4" />
                    {detectedGamesCount !== null && detectedGamesCount > 0
                      ? `Ver Jogos Instalados (${detectedGamesCount})`
                      : "Abrir Jogos Instalados"
                    }
                  </Button>
                )}

                <Button
                  variant="default"
                  className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2"
                  onClick={() => onNavigateBrowse("xbox360")}
                >
                  <Gamepad2 className="h-4 w-4" />
                  Ir para o catálogo de jogos
                </Button>

                <Button
                  variant="ghost"
                  className="h-11 w-full text-sm font-medium flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    preparedDetectionDismissed.current = true;
                    setSelectedUnlockMode(null);
                    setWizardStep("unlock");
                  }}
                >
                  <HardDrive className="h-4 w-4" />
                  Preparar outro pendrive/HD
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-8 text-[12px] text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5"
                  onClick={() => setWizardStep("console-choice")}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Voltar para a escolha de console
                </Button>
              </section>
            </div>
          </div>
        ) : wizardStep === "unlock" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7">
            <div className="animate-fade-in flex flex-col gap-4">
              <header className="mb-5 text-center relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute left-0 top-1 text-muted-foreground hover:text-foreground text-[12px] flex items-center gap-1.5 p-0"
                  onClick={() => {
                    if (
                      canSkipPreparation(
                        preparedDeviceState,
                        selectedUnlockMode === false ? false : (selectedUnlockMode === true || readPersistedRghDeclaration()),
                      )
                    ) {
                      preparedDetectionDismissed.current = false;
                      setWizardStep("prepared-detected");
                    } else {
                      setWizardStep("console-choice");
                    }
                  }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Voltar
                </Button>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/10 text-green-400">
                  <Gamepad2 className="h-6 w-6" />
                </div>
                <h1 className="font-display text-xl font-bold text-foreground">
                  Modo de Instalação (Xbox 360)
                </h1>
                <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                  Primeiro selecione o tipo de desbloqueio do seu console Xbox 360.
                </p>
              </header>

              {hasXboxOneSeriesPreparedDrive(detectedDrives) && (
                <div className="rounded-lg border border-amber-500/45 bg-amber-950/25 px-3.5 py-3 text-[12px] text-amber-100 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  <div>
                    <span className="font-semibold block text-amber-300">
                      {CROSS_CONSOLE_NOTICE.xeniaDriveInXbox360Flow.title}
                    </span>
                    {CROSS_CONSOLE_NOTICE.xeniaDriveInXbox360Flow.detail}
                  </div>
                </div>
              )}

              <section className="card-surface p-4 sm:p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
                  <button
                    type="button"
                    className={`h-11 px-3 rounded-lg border text-[13px] font-medium transition-colors cursor-pointer ${selectedUnlockMode === false
                      ? "border-green-500 bg-green-950/20 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/30"
                      }`}
                    onClick={() => setSelectedUnlockMode(false)}
                  >
                    Xbox Bloqueado ou LT
                  </button>
                  <button
                    type="button"
                    className={`h-11 px-3 rounded-lg border text-[13px] font-medium transition-colors cursor-pointer ${selectedUnlockMode === true
                      ? "border-green-500 bg-green-950/20 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/30"
                      }`}
                    onClick={() => setSelectedUnlockMode(true)}
                  >
                    Xbox Desbloqueado RGH
                  </button>
                </div>

                <details className="mb-5 rounded-lg border border-border/40 bg-muted/20 px-3.5 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                  <summary className="cursor-pointer font-medium text-foreground hover:text-green-400 select-none">
                    Como saber qual é o desbloqueio do meu Xbox?
                  </summary>
                  <div className="mt-2.5 space-y-2 text-muted-foreground">
                    <div>
                      <span className="font-semibold text-foreground block">1. Como identificar o RGH:</span>
                      Ligue o Xbox 360 pressionando o botão de <span className="font-medium text-foreground">Ejetar Bandeja (Eject)</span>. Se o videogame ligar em uma tela azul com textos brancos escrita <span className="font-medium text-foreground">XeLL Reloaded</span>, seu console é RGH.
                    </div>
                    <div>
                      <span className="font-semibold text-foreground block">2. Como identificar o LT / LT+ 3.0:</span>
                      Se o console liga diretamente na tela oficial do Xbox 360, mas consegue rodar jogos piratas gravados em discos de DVD normais, ele possui desbloqueio LT.
                    </div>
                    <div>
                      <span className="font-semibold text-foreground block">3. Console Travado / Bloqueado:</span>
                      Se o console liga na tela oficial do Xbox 360 e só aceita discos de jogos originais, ele é Travado.
                    </div>
                  </div>
                </details>

                <Button
                  variant="primary"
                  className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2"
                  // Quem declara RGH e tem um pendrive preparado em RGH ganha aqui o caminho de
                  // pular a preparação (e a confirmação fica salva para as próximas aberturas). É
                  // no clique dele, não na varredura de 5 s, que trocaria a tela debaixo de quem
                  // acabou de escolher o modo do console.
                  onClick={() => {
                    if (selectedUnlockMode !== null) {
                      writePersistedRghDeclaration(selectedUnlockMode);
                    }
                    setWizardStep(
                      canSkipPreparation(preparedDeviceState, selectedUnlockMode) && !preparedDetectionDismissed.current
                        ? "prepared-detected"
                        : "method",
                    );
                  }}
                  disabled={selectedUnlockMode === null}
                >
                  Avançar
                </Button>

                <div className="mt-3 flex flex-col items-center gap-2 text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-[12px] text-green-400"
                    onClick={() => {
                      preparedDetectionDismissed.current = false;
                      void checkPreparedDevice(true);
                    }}
                    disabled={preparedCheckBusy}
                  >
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${preparedCheckBusy ? "animate-spin" : ""}`} />
                    {preparedCheckBusy ? "Verificando pendrive..." : "Verificar pendrive preparado novamente"}
                  </Button>
                  {preparedCheckNotice && (
                    <p className="max-w-xl text-[11px] leading-relaxed text-amber-300">
                      {preparedCheckNotice}
                    </p>
                  )}
                </div>
              </section>
            </div>
          </div>
        ) : wizardStep === "method" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7">
            <div className="animate-fade-in flex flex-col gap-4">
              <div className="border-b border-border/40 pb-3 mb-1 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                  <HardDrive className="h-4 w-4 text-[#22c55e]" />
                  Método de envio
                </span>
                <Button
                  variant="default"
                  size="sm"
                  className="rounded-full px-3.5 h-7 text-[12px] font-medium"
                  onClick={() => setWizardStep("unlock")}
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Voltar
                </Button>
              </div>

              <header className="mb-1 text-center">
                <h1 className="font-display text-xl font-bold text-foreground">
                  Como deseja enviar os jogos?
                </h1>
                <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                  Desbloqueio escolhido: <span className="font-medium text-foreground">{unlockModeLabel}</span>.
                </p>
              </header>

              <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <button
                  onClick={() => setWizardStep("usb")}
                  className="flex min-h-[124px] flex-col text-left p-5 rounded-xl border transition-all bg-surface/50 border-border hover:bg-surface hover:border-[#22c55e]/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#22c55e]/60"
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2.5 rounded-lg bg-[#22c55e]/10 text-[#22c55e]">
                      <Usb className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-semibold text-[14px]">Gravar em um Pendrive ou HD</h2>
                        <span className="text-[9px] bg-muted-foreground/10 text-muted-foreground border border-muted-foreground/20 px-1.5 py-0.5 rounded font-medium">Bloqueado / LT / RGH</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">Ideal para rodar jogos diretamente do USB, consoles bloqueados/LT ou RGH sem rede.</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => selectedUnlockMode === true && setWizardStep("network")}
                  disabled={selectedUnlockMode !== true}
                  className={`flex min-h-[124px] flex-col text-left p-5 rounded-xl border transition-all ${
                    selectedUnlockMode === true
                      ? "bg-surface/50 border-border hover:bg-surface hover:border-[#22c55e]/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#22c55e]/60"
                      : "bg-muted/20 border-border opacity-60 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`p-2.5 rounded-lg ${selectedUnlockMode === true ? "bg-[#22c55e]/10 text-[#22c55e]" : "bg-muted text-muted-foreground"}`}>
                      <Wifi className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-semibold text-[14px]">Enviar direto para o Xbox (Rede)</h2>
                        <span className="text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded font-medium">Apenas RGH + Aurora</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">Transfira os jogos do computador direto para o videogame. Requer console RGH com Aurora.</p>
                    </div>
                  </div>
                </button>
              </section>
            </div>
          </div>
        ) : wizardStep === "usb" ? (
          /* USB Mode: Embed BadAvatarUsbPage */
          <div className="flex flex-col">
            <div className="border-b border-border/40 pb-3 mb-4 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <HardDrive className="h-4 w-4 text-[#22c55e]" />
                Preparação de Dispositivo USB
              </span>
              <Button
                variant="default"
                size="sm"
                className="rounded-full px-3.5 h-7 text-[12px] font-medium"
                onClick={backAction || goToMethod}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </Button>
            </div>
            <div>
              <BadAvatarUsbPage
                onBrowseGames={() => onNavigateBrowse("xbox360")}
                initialIsRghOnly={selectedUnlockMode}
                startAtPreparation
                onBackToPrevious={goToMethod}
              />
            </div>
          </div>
        ) : (
          /* Network Mode: Zero-Config Auto Scanner */
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <div className="border-b border-border/40 pb-3 mb-4 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                  <Wifi className="h-4 w-4 text-[#22c55e]" />
                  Conexão Automática de Rede
                </span>
                <div className="flex items-center gap-2">
                  {isXboxConnected && (
                    <span className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Xbox Ativo
                    </span>
                  )}
                  <Button
                    variant="default"
                    size="sm"
                    className="rounded-full px-3.5 h-7 text-[12px] font-medium"
                    onClick={goToMethod}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Voltar
                  </Button>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-lg bg-amber-500/5 border border-amber-500/25 px-3.5 py-2.5 text-[11px] text-amber-300/90 mb-4 text-left leading-normal">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block text-amber-200">Requisito para o Modo Rede:</span>
                  Esta opção é exclusiva para consoles <strong>Desbloqueados (RGH)</strong> com a dashboard <strong>Aurora</strong> aberta e ativa. Consoles originais (Bloqueados) ou com LT não suportam conexão FTP; volte e escolha <strong>Gravar em um Pendrive ou HD</strong>.
                </div>
              </div>

              {/* Status and auto-detect UI */}
              <div className="flex flex-col items-center justify-center py-6 text-center">
                {scanState === "idle" && (
                  <div className="flex flex-col items-center gap-3">
                    <Wifi className="h-10 w-10 text-muted-foreground/60" />
                    <p className="text-[13px] text-muted-foreground">O computador está pronto para procurar seu Xbox 360.</p>
                    <Button onClick={handleAutoDiscovery} size="sm" className="mt-2">
                      <Search className="h-3.5 w-3.5 mr-1.5" />
                      Procurar Xbox na Rede
                    </Button>
                  </div>
                )}

                {(scanState === "checking" || scanState === "scanning" || scanState === "connecting") && (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-10 w-10 text-[#22c55e] animate-spin" />
                    <p className="text-[13px] text-foreground font-medium">{statusMsg}</p>
                    <p className="text-[11px] text-muted-foreground max-w-sm">
                      Certifique-se de que o Xbox está ligado na mesma rede Wi-Fi e com a tela do Aurora aberta.
                    </p>
                  </div>
                )}

                {scanState === "success" && (
                  <div className="flex flex-col items-center gap-3">
                    <CheckCircle2 className="h-10 w-10 text-green-400" />
                    <p className="text-[13px] text-green-400 font-semibold">{statusMsg}</p>
                    <p className="text-[11px] text-muted-foreground max-w-sm leading-relaxed">
                      Conexão de rede testada e scripts do Aurora configurados. Agora você pode ir ao catálogo e enviar jogos diretamente para o console!
                    </p>
                    <Button onClick={() => onNavigateBrowse("xbox360")} className="mt-2" size="sm">
                      <ArrowRight className="h-3.5 w-3.5 mr-1.5" />
                      Ir para o catálogo de jogos
                    </Button>
                  </div>
                )}

                {(scanState === "not-found" || scanState === "error") && (
                  <div className="flex flex-col items-center gap-3">
                    <AlertTriangle className="h-10 w-10 text-yellow-500" />
                    <p className="text-[13px] text-yellow-500 font-medium">{statusMsg}</p>
                    <p className="text-[11px] text-muted-foreground max-w-md leading-relaxed">
                      Não conseguimos encontrar o videogame automaticamente. Verifique se o Xbox está ligado, com o cabo de rede ou Wi-Fi conectado, e com a Aurora aberta.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <Button onClick={handleAutoDiscovery} variant="outline" size="sm">
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        Tentar Novamente
                      </Button>
                      <Button onClick={() => setIsManualInputVisible(!isManualInputVisible)} variant="ghost" size="sm">
                        Digitar IP manualmente
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Manual IP input fallback */}
              {(isManualInputVisible || scanState === "error" || scanState === "not-found") && (
                <div className="mt-4 border-t border-border/30 pt-4 max-w-sm mx-auto">
                  <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                    Endereço de IP do Xbox (Exibido no canto inferior da Aurora)
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Ex: 192.168.1.50"
                      value={manualIp}
                      onChange={(e) => setManualIp(e.target.value)}
                      className="text-[13px]"
                    />
                    <Button onClick={handleManualConnect} disabled={!manualIp.trim() || scanState === "connecting"} size="sm">
                      Conectar
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Quick guide */}
            <div className="mt-4 rounded-lg bg-muted/40 border border-border/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground block mb-1">Como usar no Modo Rede:</span>
              <ul className="list-disc pl-4 space-y-1">
                <li>Ligue o console Xbox 360.</li>
                <li>Abra a dashboard <strong className="text-foreground">Aurora</strong> no videogame.</li>
                <li>Conecte o videogame no seu roteador (via cabo de rede ou na mesma rede Wi-Fi do computador).</li>
                <li>O programa fará a conexão automaticamente e os jogos irão direto para o videogame.</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
