import { useState, useEffect, useCallback, useRef } from "react";
import {
  Usb, Wifi, Search, Loader2, CheckCircle2, AlertTriangle, Terminal,
  ArrowRight, Settings, Play, HardDrive, RefreshCw, Gamepad2, ArrowLeft
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import BadAvatarUsbPage from "./BadAvatarUsbPage";
import MainNav from "./MainNav";
import {
  nextStepAfterPreparedUsbScan,
  readPreparedUsbDetection,
  type PreparedUsbWizardStep,
} from "../../services/preparedUsbDetection.ts";

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
  onNavigateBrowse: () => void;
  onNavigateIso2God: () => void;
  onNavigateIso2Xex: () => void;
  onNavigateFtpManager: () => void;
  onNavigateBadAvatarUsb: () => void;
  onNavigateUsbGames?: () => void;
  onNavigateHome?: () => void;
  usbGamesCount?: number;
  onLibraryToggle: () => void;
  onReconnect: () => void;
  libraryLoading: boolean;
  onAppendLine: (line: string) => void;
  queueJobs: any[];
  simpleMode?: boolean;
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
  onNavigateUsbGames,
  onNavigateHome,
  usbGamesCount,
  onLibraryToggle,
  onReconnect,
  libraryLoading,
  onAppendLine,
  queueJobs,
  simpleMode = true,
}: HomePageProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  
  // Simple Mode state
  const [wizardStep, setWizardStep] = useState<PreparedUsbWizardStep>("checking-prepared");
  const [preparedDeviceDetected, setPreparedDeviceDetected] = useState(false);
  const [detectedGamesCount, setDetectedGamesCount] = useState<number | null>(null);
  const [preparedCheckBusy, setPreparedCheckBusy] = useState(false);
  const [preparedCheckNotice, setPreparedCheckNotice] = useState("");
  const preparedCheckInFlight = useRef(false);
  const preparedDetectionDismissed = useRef(false);
  const preparedDetectionMounted = useRef(false);
  const [selectedUnlockMode, setSelectedUnlockMode] = useState<boolean | null>(null);
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
      const result = await window.godsendApi.toolsBadAvatarListDrives();
      if (!preparedDetectionMounted.current) return;
      const hasPrepared = readPreparedUsbDetection(result);
      if (hasPrepared === null) {
        if (manual) {
          setPreparedCheckNotice(result?.error || "O Windows ainda não disponibilizou o pendrive. Reconecte-o e tente novamente.");
        }
        setWizardStep((current) => current === "checking-prepared" ? "unlock" : current);
        return;
      }

      setPreparedDeviceDetected(hasPrepared);
      setWizardStep((current) => nextStepAfterPreparedUsbScan(
        current,
        hasPrepared,
        preparedDetectionDismissed.current,
      ));
      if (hasPrepared) {
        setPreparedCheckNotice("");
        window.godsendApi.browseGetInstalledGames().then((r: any) => {
          if (r?.ok && Array.isArray(r.games)) {
            setDetectedGamesCount(r.games.length);
          }
        }).catch(() => {});
      } else if (manual) {
        setPreparedCheckNotice("Nenhum pendrive preparado foi encontrado. Aguarde o Windows mostrar a unidade e verifique novamente.");
      }
    } catch (error: any) {
      if (!preparedDetectionMounted.current) return;
      if (manual) {
        setPreparedCheckNotice(error?.message || "Não foi possível verificar o pendrive agora.");
      }
      setWizardStep((current) => current === "checking-prepared" ? "unlock" : current);
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
        setStatusMsg("Subrede inválida detectada.");
        return;
      }
      
      const subnet = ipParts.slice(0, 3).join(".");
      setScanState("scanning");
      setStatusMsg(`Procurando Xbox 360 na sua subrede (${subnet}.X)...`);
      
      const scanRes = await window.godsendApi.ftpScanPorts(subnet);
      if (!scanRes.ok || !scanRes.hosts || scanRes.hosts.length === 0) {
        setScanState("not-found");
        setStatusMsg("Nenhum console Xbox 360 foi encontrado na rede local.");
        return;
      }
      
      // Try connection on the first found host
      const detectedIp = scanRes.hosts[0];
      setScanState("connecting");
      setStatusMsg(`Configurando conexão e enviando scripts para ${detectedIp}...`);
      
      const testRes = await window.godsendApi.ftpTestConnection({
        xboxIp: detectedIp,
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
      });
      
      if (!testRes.ok) {
        setScanState("not-found");
        setStatusMsg(`Xbox encontrado no IP ${detectedIp}, mas o FTP recusou as credenciais padrão.`);
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
        setStatusMsg(`Conectado ao IP ${detectedIp}, mas falhou ao enviar os scripts do Aurora.`);
      }
    } catch (err: any) {
      setScanState("error");
      setStatusMsg(`Erro durante a busca: ${err.message || String(err)}`);
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
        setStatusMsg(`Falha na conexão FTP para ${manualIp}. Verifique o IP e certifique-se de que a Aurora está aberta.`);
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
        setStatusMsg(`Conexão estabelecida, mas falhou ao enviar os scripts do Aurora.`);
      }
    } catch (err: any) {
      setScanState("error");
      setStatusMsg(`Erro ao conectar: ${err.message || String(err)}`);
    }
  };

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
            onNavigateUsbGames={onNavigateUsbGames}
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
          Prepare seus jogos de Xbox 360 no computador e envie de forma extremamente simples
          para o seu videogame.
        </p>
      </header>

      {/* Main Mode View */}
      <div className={wizardStep === "usb"
        ? "mx-auto w-full max-w-4xl"
        : "card-surface mx-auto flex min-h-[350px] w-full max-w-4xl flex-col justify-between p-5"}
      >
        {wizardStep === "checking-prepared" ? (
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
                  Pendrive Xbox 360 detectado!
                </h1>
                <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                  {detectedGamesCount !== null && detectedGamesCount > 0
                    ? `Encontramos um pendrive ou HD preparado com ${detectedGamesCount} jogo${detectedGamesCount !== 1 ? "s" : ""} gravado${detectedGamesCount !== 1 ? "s" : ""} na pasta Games. Você pode visualizar os títulos já gravados ou ir direto ao catálogo para baixar novos jogos.`
                    : `Encontramos um pendrive ou HD que já está preparado. Você pode visualizar os jogos nele ou ir direto ao catálogo para baixar novos títulos.`
                  }
                </p>
              </header>

              <section className="card-surface p-5 flex flex-col gap-3">
                {onNavigateUsbGames && (
                  <Button
                    variant="primary"
                    className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                    onClick={onNavigateUsbGames}
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
                  onClick={onNavigateBrowse}
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
              </section>
            </div>
          </div>
        ) : wizardStep === "unlock" ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7">
            <div className="animate-fade-in flex flex-col gap-4">
              <header className="mb-5 text-center relative">
                {preparedDeviceDetected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute left-0 top-1 text-muted-foreground hover:text-foreground text-[12px] flex items-center gap-1.5 p-0"
                    onClick={() => setWizardStep("prepared-detected")}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Voltar
                  </Button>
                )}
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/10 text-green-400">
                  <Gamepad2 className="h-6 w-6" />
                </div>
                <h1 className="font-display text-xl font-bold text-foreground">
                  Modo de Instalação
                </h1>
                <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                  Primeiro selecione o tipo de desbloqueio do seu console Xbox 360.
                </p>
              </header>

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
                  onClick={() => setWizardStep("method")}
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
                onBrowseGames={onNavigateBrowse}
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
                    <Button onClick={onNavigateBrowse} className="mt-2" size="sm">
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
