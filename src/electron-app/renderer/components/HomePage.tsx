import { useState, useEffect, useCallback, useRef } from "react";
import {
  Usb, Wifi, Search, Loader2, CheckCircle2, AlertTriangle, Terminal,
  ArrowRight, Settings, Play, HardDrive, RefreshCw
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import BadAvatarUsbPage from "./BadAvatarUsbPage";
import MainNav from "./MainNav";

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
  onLibraryToggle,
  onReconnect,
  libraryLoading,
  onAppendLine,
  queueJobs,
  simpleMode = true,
}: HomePageProps) {
  const outputRef = useRef<HTMLPreElement>(null);
  
  // Simple Mode state
  const [targetMode, setTargetMode] = useState<"usb" | "network">("usb");
  const [scanState, setScanState] = useState<"idle" | "checking" | "scanning" | "connecting" | "success" | "not-found" | "error">("idle");
  const [xboxIp, setXboxIp] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [isManualInputVisible, setIsManualInputVisible] = useState(false);

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

  // Auto-scan when switching to network mode
  useEffect(() => {
    if (targetMode === "network" && scanState === "idle" && !xboxIp) {
      handleAutoDiscovery();
    }
  }, [targetMode]);

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
            onReconnect={onReconnect}
            onLibraryToggle={onLibraryToggle}
            onNavigateQueue={onNavigateQueue}
            onNavigateBrowse={onNavigateBrowse}
            onNavigateSettings={onNavigateSettings}
            onNavigateIso2God={onNavigateIso2God}
            onNavigateIso2Xex={onNavigateIso2Xex}
            onNavigateFtpManager={onNavigateFtpManager}
            onNavigateBadAvatarUsb={onNavigateBadAvatarUsb}
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
          <span
            className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
            title={logInfo?.logsDirectory ?? ""}
          >
            {logInfo?.currentLogFile ? `Log: ${logInfo.currentLogFile}` : ""}
          </span>
          <Button size="sm" className="shrink-0" onClick={handleOpenLogs}>
            Abrir pasta de logs
          </Button>
        </footer>
      </div>
    );
  }

  // ── Render Simple Mode (Friendly Dashboard) ──────────────────────────────
  const isXboxConnected = ftpStatus === "connected";

  return (
    <div className="flex flex-col h-full gap-5 max-w-4xl mx-auto px-4 py-5">
      {/* Welcome Banner */}
      <header className="text-center mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground font-display">
          Bem-vindo ao GODsend-360
        </h1>
        <p className="text-[13px] text-muted-foreground mt-1 max-w-lg mx-auto leading-relaxed">
          Prepare seus jogos de Xbox 360 no computador e envie de forma extremamente simples
          para o seu videogame.
        </p>
      </header>

      {/* Mode Selector Cards — Temporarily hidden in Simple Mode */}
      {/*
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => setTargetMode("usb")}
          className={`flex flex-col text-left p-5 rounded-xl border transition-all ${
            targetMode === "usb"
              ? "bg-[#22c55e]/5 border-[#22c55e] shadow-lg shadow-[#22c55e]/5 ring-1 ring-[#22c55e]/35"
              : "bg-surface/50 border-border hover:bg-surface hover:border-muted-foreground/30"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${targetMode === "usb" ? "bg-[#22c55e]/10 text-[#22c55e]" : "bg-muted text-muted-foreground"}`}>
              <Usb className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-[14px]">Gravar em um Pendrive ou HD</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Ideal para rodar jogos diretamente do USB ou para consoles sem internet.</p>
            </div>
          </div>
        </button>

        <button
          onClick={() => setTargetMode("network")}
          className={`flex flex-col text-left p-5 rounded-xl border transition-all ${
            targetMode === "network"
              ? "bg-[#22c55e]/5 border-[#22c55e] shadow-lg shadow-[#22c55e]/5 ring-1 ring-[#22c55e]/35"
              : "bg-surface/50 border-border hover:bg-surface hover:border-muted-foreground/30"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${targetMode === "network" ? "bg-[#22c55e]/10 text-[#22c55e]" : "bg-muted text-muted-foreground"}`}>
              <Wifi className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-semibold text-[14px]">Enviar direto para o Xbox (Rede)</h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">Transfira os jogos do seu computador direto para o videogame por cabo ou Wi-Fi.</p>
            </div>
          </div>
        </button>
      </div>
      */}

      {/* Main Mode View */}
      <div className="flex-1 card-surface p-5 min-h-[350px] flex flex-col justify-between">
        {targetMode === "usb" ? (
          /* USB Mode: Embed BadAvatarUsbPage */
          <div className="flex-1 flex flex-col">
            <div className="border-b border-border/40 pb-3 mb-4 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                <HardDrive className="h-4 w-4 text-[#22c55e]" />
                Preparação de Dispositivo USB
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <BadAvatarUsbPage onBrowseGames={onNavigateBrowse} />
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
                {isXboxConnected && (
                  <span className="text-[11px] text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Xbox Ativo
                  </span>
                )}
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
