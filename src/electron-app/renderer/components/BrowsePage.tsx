import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Search, Loader2, WifiOff, Gamepad2, Download,
  RefreshCw, ChevronDown, X, HardDrive, Usb,
  Wifi, CheckCircle2, AlertTriangle, Check, Disc,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "../lib/utils";

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORMS = [
  { id: "xbox360", label: "Xbox 360",      methods: true  },
  { id: "xbox",    label: "Original Xbox", methods: true  },
  { id: "xbla",   label: "XBLA",          methods: false },
  { id: "digital", label: "Digital",       methods: false },
  { id: "dlc",    label: "DLC",           methods: false },
  { id: "xblig",  label: "Indie",         methods: false },
  { id: "games",  label: "Games Archive", methods: true  },
];

const SOURCES = [
  { id: "unified", label: "Catálogo Online" },
  { id: "local",   label: "Biblioteca Local" },
];

const METHODS   = [
  { id: "god",     label: "GOD",     desc: "ISO → Games on Demand" },
  { id: "content", label: "Conteúdo (DLC/Multidisco)", desc: "Pasta de conteúdo (árvore de DLC)" },
  { id: "xex",     label: "XEX",     desc: "Pasta solta (default.xex)" },
];

// ── Small helpers ─────────────────────────────────────────────────────────────

function CenteredOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground min-h-0">
      {children}
    </div>
  );
}

// Pill-style toggle button (source / platform tabs)
interface PillBtnProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}

function PillBtn({ active, onClick, children, className }: PillBtnProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 px-3 py-1 text-[11px] rounded-full whitespace-nowrap transition-colors",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active
          ? "bg-primary text-primary-foreground font-semibold"
          : "text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted",
        className
      )}
    >
      {children}
    </button>
  );
}

// ── Cover art placeholder / loader ────────────────────────────────────────────

interface CoverArtProps {
  dataUrl?: string | null;
  name: string;
  size?: number;
}

function CoverArt({ dataUrl, name, size = 100 }: CoverArtProps) {
  return (
    <div
      className="relative shrink-0 rounded-lg overflow-hidden border border-border bg-muted"
      style={{ width: size, aspectRatio: "3/4" }}
    >
      {dataUrl === undefined ? (
        <div className="absolute inset-0 bg-gradient-to-r from-muted via-accent/30 to-muted animate-pulse" />
      ) : dataUrl === null ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Gamepad2 className="h-7 w-7 text-border" />
        </div>
      ) : (
        <img
          src={dataUrl}
          alt={name}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      )}
    </div>
  );
}

// ── Queue dialog (modal overlay) ──────────────────────────────────────────────

interface LocalDrive {
  rootPath: string;       // e.g. "F:/"
  label: string;          // volume label, e.g. "BADAVATAR"
  freeBytes?: number;
}

// A unified destination shown in the queue dialog dropdown.
interface Destination {
  value: string;          // encoded key, unique per option
  label: string;          // text shown to the user
  kind: "local" | "ftp";
  rootPath?: string;      // for local
  drive?: string;         // for ftp (e.g. "Hdd1:")
}

// "F:/" → "F:"
function driveLetterOf(rootPath: string): string {
  const m = rootPath.match(/^([A-Za-z]):/);
  return m ? `${m[1].toUpperCase()}:` : rootPath.replace(/[/\\]+$/, "");
}

// 12.3 GB livres
function freeLabel(freeBytes?: number): string {
  if (typeof freeBytes !== "number" || freeBytes <= 0) return "";
  const gb = freeBytes / (1024 ** 3);
  return gb >= 1 ? ` · ${gb.toFixed(1)} GB livres` : ` · ${Math.round(freeBytes / (1024 ** 2))} MB livres`;
}

function buildDestinations(localDrives: LocalDrive[], defaultDrive: string, ftpDrives: string[]): Destination[] {
  const dests: Destination[] = [];
  for (const d of localDrives) {
    const letter = driveLetterOf(d.rootPath);
    const name = (d.label ? `${letter} — ${d.label}` : `${letter} (pendrive)`) + freeLabel(d.freeBytes);
    dests.push({ value: `local:${d.rootPath}`, label: name, kind: "local", rootPath: d.rootPath });
  }
  const ftp = [...ftpDrives];
  if (defaultDrive && !ftp.includes(defaultDrive)) ftp.unshift(defaultDrive);
  if (ftp.length === 0) {
    ftp.push("Hdd1:");
  }
  for (const d of ftp) {
    dests.push({ value: `ftp:${d}`, label: `Console (FTP): ${d}`, kind: "ftp", drive: d });
  }
  return dests;
}

interface InstalledGame {
  name: string;
  titleId?: string;
  path: string;
  drive: string;
  format: "god" | "xex" | "iso";
  folderName: string;
}

export interface ParsedDiscGame {
  rawName: string;
  baseTitle: string;
  releaseTitle: string;
  discNumber: number;
  discTotal?: number;
  subtitle?: string;
  isMultiDisc: boolean;
}

export interface ReleaseGroup {
  releaseTitle: string;
  baseTitle: string;
  discs: ParsedDiscGame[];
  isMultiDisc: boolean;
  totalDiscs: number;
}

export interface CatalogGameItem {
  displayTitle: string;
  baseTitle: string;
  releases: ReleaseGroup[];
  allRawNames: string[];
  totalDiscs: number;
  isMultiDisc: boolean;
}

interface QueueDialogProps {
  game: string;
  releaseGroup?: ReleaseGroup;
  platform: string;
  source: string;
  cover?: string | null;
  coverLoading?: boolean;
  defaultDrive: string;
  drives: string[];
  localDrives: LocalDrive[];
  installedGames?: InstalledGame[];
  onClose: () => void;
  onQueue?: () => void;
  simpleMode?: boolean;
  onXboxConfigured?: () => void;
}

function QueueDialog({
  game,
  releaseGroup,
  platform,
  source,
  cover,
  defaultDrive,
  drives,
  localDrives,
  installedGames = [],
  onClose,
  simpleMode = true,
  onXboxConfigured,
}: QueueDialogProps) {
  const hasMethods = source === "local" || (PLATFORMS.find((p) => p.id === platform)?.methods ?? false);
  const destinations = buildDestinations(localDrives, defaultDrive, drives);
  const [destValue, setDestValue] = useState(destinations[0]?.value ?? "");
  const [method, setMethod] = useState("god");
  const [queuing, setQueuing]   = useState(false);
  const [result,  setResult]    = useState<any>(null);
  const [discRec, setDiscRec]   = useState<string | null>(null);
  const selectedDest = destinations.find((d) => d.value === destValue) ?? destinations[0];

  const discsToQueue = useMemo(() => {
    if (releaseGroup && Array.isArray(releaseGroup.discs) && releaseGroup.discs.length > 0) {
      return releaseGroup.discs.map((d) => d.rawName);
    }
    return [game];
  }, [releaseGroup, game]);

  const isMultiDiscGame = (releaseGroup && releaseGroup.discs.length > 1) || discsToQueue.length > 1;

  // Check if this game is already installed on the selected destination drive
  const isAlreadyOnSelectedDest = useMemo(() => {
    if (!selectedDest || selectedDest.kind !== "local" || !selectedDest.rootPath || !installedGames || installedGames.length === 0) {
      return false;
    }
    const destLetter = selectedDest.rootPath.replace(/[/\\]+$/, "").toUpperCase();
    const gameKey = getComparisonKey(getBaseTitle(game));
    return installedGames.some((g) => {
      const gDrive = g.drive.replace(/[/\\]+$/, "").toUpperCase();
      const matchDrive = gDrive.startsWith(destLetter) || destLetter.startsWith(gDrive);
      if (!matchDrive) return false;
      return getComparisonKey(g.name) === gameKey || (g.titleId && game.toUpperCase().includes(g.titleId));
    });
  }, [installedGames, selectedDest, game]);

  const [destType, setDestType] = useState<"local" | "ftp">("local");
  const [showDiscovery, setShowDiscovery] = useState(false);

  // Keep a valid selection when destinations load/refresh.
  useEffect(() => {
    const matching = destinations.filter((d) => d.kind === destType);
    if (matching.length > 0) {
      if (!matching.some((d) => d.value === destValue)) {
        setDestValue(matching[0].value);
      }
    } else if (destType === "ftp") {
      setDestValue("ftp:Hdd1:");
    }
  }, [destinations, destValue, destType]);

  async function handleSelectFtp() {
    try {
      const conn = await window.godsendApi.getXboxConnection();
      if (!conn || !conn.xboxIp) {
        setShowDiscovery(true);
      } else {
        setDestType("ftp");
      }
    } catch (err) {
      setShowDiscovery(true);
    }
  }

  // Fetch disc-info recommendation for applicable platforms
  useEffect(() => {
    if (!hasMethods) return;
    const probeTarget = discsToQueue[0] || game;
    window.godsendApi.browseGetDiscInfo(probeTarget).then((r: any) => {
      if (r.ok && r.recommendation) {
        setDiscRec(r.recommendation);
        // Auto-select recommended method in Simple Mode
        if (simpleMode) {
          setMethod(r.recommendation);
        }
      }
    }).catch(() => {});
  }, [game, discsToQueue, hasMethods, simpleMode]);

  async function handleQueue() {
    if (!selectedDest) {
      setResult({ ok: false, error: "Selecione um destino (pendrive preparado ou console via FTP)." });
      return;
    }
    setQueuing(true);
    setResult(null);

    const r = await window.godsendApi.browseQueueGame({
      game,
      games: discsToQueue,
      platform,
      source,
      installType: hasMethods ? method : "god",
      destinationType: selectedDest.kind,
      drive: selectedDest.drive,
      localRoot: selectedDest.rootPath,
    });
    setQueuing(false);
    setResult(r);
  }

  const queued = result?.ok;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
    >
      <div className="relative bg-background border border-border rounded-xl p-4 w-full max-w-[360px] flex flex-col gap-3 shadow-2xl">

        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Cover + title */}
        <div className="flex gap-3 items-start pr-6">
          <CoverArt dataUrl={cover} name={game} size={80} />
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="text-[13px] font-semibold text-foreground leading-snug break-words">
              {game}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1">
              <p className="text-[10px] text-muted-foreground">
                {source === "local"
                  ? "Biblioteca local"
                  : `${PLATFORMS.find((p) => p.id === platform)?.label ?? platform} · ${SOURCES.find((s) => s.id === source)?.label ?? source}`}
              </p>
              {isMultiDiscGame && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-primary/15 text-primary border border-primary/25">
                  <Disc className="h-2.5 w-2.5" /> {discsToQueue.length} Discos
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Multi-disc details if applicable */}
        {isMultiDiscGame && !queued && (
          <div className="bg-muted/40 border border-border/60 rounded-lg p-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-foreground">
              <span className="flex items-center gap-1.5 text-primary">
                <Disc className="h-3.5 w-3.5" />
                Jogo Multidisco ({discsToQueue.length} Discos)
              </span>
              <span className="text-[9.5px] font-normal text-muted-foreground">Download completo</span>
            </div>
            <p className="text-[10px] text-muted-foreground/90 leading-tight">
              Todos os {discsToQueue.length} discos deste jogo serão baixados e instalados:
            </p>
            <div className="flex flex-col gap-1 mt-0.5 max-h-[90px] overflow-y-auto pr-0.5">
              {(releaseGroup?.discs || discsToQueue.map((g, idx) => ({ rawName: g, discNumber: idx + 1 }))).map((d: any, i: number) => (
                <div key={d.rawName} className="flex items-center justify-between text-[10px] bg-background/80 px-2 py-1 rounded border border-border/40">
                  <span className="font-semibold text-primary">Disco {d.discNumber || (i + 1)}</span>
                  <span className="text-[9.5px] text-muted-foreground truncate max-w-[190px]">
                    {d.subtitle || d.rawName}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Destination selector: Type toggle (USB vs FTP) */}
        {!queued && (
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Destino do jogo
            </label>
            <div className="flex gap-2 bg-muted/35 p-0.5 rounded-lg border border-border/40">
              <button
                type="button"
                onClick={() => setDestType("local")}
                className={cn(
                  "flex-1 py-1 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-all",
                  destType === "local"
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Usb className="h-3.5 w-3.5" />
                Pendrive (USB)
              </button>
              <button
                type="button"
                onClick={handleSelectFtp}
                className={cn(
                  "flex-1 py-1 px-2 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-all",
                  destType === "ftp"
                    ? "bg-green-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Wifi className="h-3.5 w-3.5" />
                Enviar via FTP
              </button>
            </div>

            {destType === "local" ? (
              localDrives.length === 0 ? (
                <p className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-2.5 py-2 leading-relaxed">
                  Nenhum pendrive ou HD local encontrado. Conecte um dispositivo preparado no seu computador.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <div className="relative">
                    <select
                      value={destValue}
                      onChange={(e) => setDestValue(e.target.value)}
                      className={cn(
                        "w-full appearance-none bg-muted border border-border rounded-md",
                        "px-2.5 pr-7 py-1.5 text-[12px] text-foreground focus:outline-none",
                        "focus-visible:ring-1 focus-visible:ring-ring"
                      )}
                    >
                      {destinations.filter((d) => d.kind === "local").map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  </div>
                  <p className="text-[9.5px] text-muted-foreground/70 flex items-center gap-1">
                    <Usb className="h-3 w-3 shrink-0 text-muted-foreground" />
                    O jogo será gravado direto no dispositivo USB conectado.
                  </p>
                </div>
              )
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="relative">
                  <select
                    value={destValue}
                    onChange={(e) => setDestValue(e.target.value)}
                    className={cn(
                      "w-full appearance-none bg-muted border border-border rounded-md",
                      "px-2.5 pr-7 py-1.5 text-[12px] text-foreground focus:outline-none",
                      "focus-visible:ring-1 focus-visible:ring-ring"
                    )}
                  >
                    {destinations.filter((d) => d.kind === "ftp").map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                </div>
                <p className="text-[9.5px] text-muted-foreground/70 flex items-center gap-1">
                  <Wifi className="h-3 w-3 shrink-0 text-green-400" />
                  O jogo será enviado para o Xbox 360 através da rede local.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Install method (GOD / Content / XEX) — only for applicable platforms */}
        {hasMethods && !queued && !simpleMode && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Método de instalação
            </label>
            <div className="flex gap-1.5">
              {METHODS.map((m) => {
                const recommended = discRec === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setMethod(m.id)}
                    title={m.desc + (recommended ? " · Recomendado" : "")}
                    className={cn(
                      "flex-1 py-1 text-[11px] rounded-md border transition-colors",
                      method === m.id
                        ? "bg-primary/20 border-primary/50 text-primary font-semibold"
                        : "bg-muted border-border text-muted-foreground hover:text-foreground",
                      recommended && method !== m.id && "border-yellow-500/40"
                    )}
                  >
                    {m.label}
                    {recommended && (
                      <span className="block text-[8px] text-yellow-400/80 leading-none">
                        rec
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Already downloaded notice */}
        {isAlreadyOnSelectedDest && !queued && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] leading-tight">
            <Check className="h-4 w-4 shrink-0 stroke-[2.5]" />
            <span>Este jogo já está gravado nesta unidade ({selectedDest.label ? `${selectedDest.label} - ${selectedDest.rootPath}` : selectedDest.rootPath}). Você pode reinstalá-lo se desejar.</span>
          </div>
        )}

        {/* Result message */}
        {result && (
          <p className={cn(
            "text-[11px] px-2 py-1.5 rounded-md text-center",
            result.ok
              ? "bg-green-500/10 text-green-400 border border-green-500/20"
              : "bg-red-500/10 text-red-400 border border-red-500/20"
          )}>
            {result.ok
              ? isMultiDiscGame
                ? `Todos os ${discsToQueue.length} discos foram adicionados à fila com sucesso!`
                : `Na fila! Status: ${result.status}`
              : result.error || "Erro desconhecido"}
          </p>
        )}

        {/* Queue button */}
        {!queued ? (
          <Button
            className="w-full font-semibold"
            disabled={queuing}
            onClick={handleQueue}
          >
            {queuing
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Enfileirando {discsToQueue.length > 1 ? `${discsToQueue.length} discos…` : "…"}</>
              : isAlreadyOnSelectedDest
                ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Adicionar à fila novamente</>
                : isMultiDiscGame
                  ? <><Download className="h-3.5 w-3.5 mr-1.5" />Baixar todos os {discsToQueue.length} discos</>
                  : <><Download className="h-3.5 w-3.5 mr-1.5" />Adicionar à fila</>
            }
          </Button>
        ) : (
          <Button variant="outline" className="w-full" onClick={onClose}>
            Concluído
          </Button>
        )}
      </div>

      {showDiscovery && (
        <XboxDiscoveryModal
          onClose={() => setShowDiscovery(false)}
          onSuccess={(detectedIp) => {
            setTimeout(() => {
              setShowDiscovery(false);
              setDestType("ftp");
              if (onXboxConfigured) {
                onXboxConfigured();
              }
            }, 1500);
          }}
        />
      )}
    </div>
  );
}

// ── Xbox Discovery Modal Component ───────────────────────────────────────────
interface XboxDiscoveryModalProps {
  onClose: () => void;
  onSuccess: (detectedIp: string) => void;
}

function XboxDiscoveryModal({ onClose, onSuccess }: XboxDiscoveryModalProps) {
  const [scanState, setScanState] = useState<"idle" | "checking" | "scanning" | "connecting" | "success" | "not-found" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [manualIp, setManualIp] = useState("");
  const [isManualInputVisible, setIsManualInputVisible] = useState(false);

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
      
      await window.godsendApi.setXboxConnection({
        xboxIp: detectedIp,
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
        ftpScriptsPath: "/Hdd1/Aurora/User/Scripts/Utility/GODSend",
      });
      
      const uploadRes = await window.godsendApi.ftpAuroraScripts({
        xboxIp: detectedIp,
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
        ftpScriptsPath: "/Hdd1/Aurora/User/Scripts/Utility/GODSend",
      });
      
      if (uploadRes.ok) {
        setScanState("success");
        setStatusMsg(`Conectado com sucesso ao Xbox 360 (${detectedIp})!`);
        onSuccess(detectedIp);
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
      
      await window.godsendApi.setXboxConnection({
        xboxIp: manualIp.trim(),
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
        ftpScriptsPath: "/Hdd1/Aurora/User/Scripts/Utility/GODSend",
      });
      
      const uploadRes = await window.godsendApi.ftpAuroraScripts({
        xboxIp: manualIp.trim(),
        ftpUser: "xboxftp",
        ftpPassword: "xboxftp",
        ftpScriptsPath: "/Hdd1/Aurora/User/Scripts/Utility/GODSend",
      });
      
      if (uploadRes.ok) {
        setScanState("success");
        setStatusMsg(`Conectado com sucesso ao Xbox 360 (${manualIp.trim()})!`);
        onSuccess(manualIp.trim());
      } else {
        setScanState("error");
        setStatusMsg(`Conexão estabelecida, mas falhou ao enviar os scripts do Aurora.`);
      }
    } catch (err: any) {
      setScanState("error");
      setStatusMsg(`Erro ao conectar: ${err.message || String(err)}`);
    }
  };

  useEffect(() => {
    handleAutoDiscovery();
  }, []);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(6px)" }}
    >
      <div className="relative bg-background border border-border rounded-xl p-5 w-full max-w-[340px] flex flex-col gap-4 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="border-b border-border/40 pb-2 flex items-center gap-1.5">
          <Wifi className="h-4 w-4 text-[#22c55e]" />
          <span className="text-[13px] font-semibold text-foreground">
            Conexão Automática de Rede
          </span>
        </div>

        <div className="flex flex-col items-center justify-center py-4 text-center">
          {(scanState === "checking" || scanState === "scanning" || scanState === "connecting") && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 text-[#22c55e] animate-spin" />
              <p className="text-[12.5px] text-foreground font-medium">{statusMsg}</p>
              <p className="text-[10.5px] text-muted-foreground max-w-xs">
                Certifique-se de que o Xbox está ligado na mesma rede Wi-Fi e com a tela do Aurora aberta.
              </p>
            </div>
          )}

          {scanState === "success" && (
            <div className="flex flex-col items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-400" />
              <p className="text-[12.5px] text-green-400 font-semibold">{statusMsg}</p>
              <p className="text-[10.5px] text-muted-foreground max-w-xs leading-relaxed">
                Conexão de rede testada e scripts do Aurora configurados. Continuando o envio...
              </p>
            </div>
          )}

          {(scanState === "not-found" || scanState === "error") && (
            <div className="flex flex-col items-center gap-3 w-full">
              <AlertTriangle className="h-8 w-8 text-yellow-500" />
              <p className="text-[12.5px] text-yellow-500 font-medium">{statusMsg}</p>
              <p className="text-[10.5px] text-muted-foreground leading-relaxed">
                Não conseguimos encontrar o videogame automaticamente. Verifique se o Xbox está ligado e com a Aurora aberta.
              </p>
              <div className="flex gap-2 mt-2">
                <Button onClick={handleAutoDiscovery} variant="outline" size="sm" className="h-8 text-[11px]">
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Tentar Novamente
                </Button>
                <Button onClick={() => setIsManualInputVisible(!isManualInputVisible)} variant="ghost" size="sm" className="h-8 text-[11px]">
                  Digitar IP
                </Button>
              </div>
            </div>
          )}
        </div>

        {(isManualInputVisible || scanState === "error" || scanState === "not-found") && (
          <div className="border-t border-border/30 pt-3 w-full">
            <label className="block text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
              Endereço de IP do Xbox
            </label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Ex: 192.168.1.50"
                value={manualIp}
                onChange={(e) => setManualIp(e.target.value)}
                className="text-[12px] h-8"
              />
              <Button onClick={handleManualConnect} disabled={!manualIp.trim() || scanState === "connecting"} size="sm" className="h-8 text-[11px]">
                Conectar
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers & Version Selection dialog ────────────────────────────────────────

const DISC_TAG_REGEX = /\s*\((?:Disc|Disk|CD|DVD)\s*(\d+)(?:\s+of\s+(\d+))?\)/i;
const DISC_TRAILING_REGEX = /(?:[-_\s]+)?\b(?:Disc|Disk|CD|DVD)\s*(\d+)(?:\s+of\s+(\d+))?$/i;
const DISC_SUBTITLE_REGEX = /\s*\((Installation|Install|Game|Single-player|Multiplayer|Play|Bonus|Cinematic|Data)\s*Disc\)/i;
const DISC_SUBTITLE_TRAILING_REGEX = /(?:[-_\s]+)?\b(Installation|Install|Game|Single-player|Multiplayer|Play|Bonus|Cinematic|Data)\s*Disc$/i;

function getBaseTitle(raw: string): string {
  return raw
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s*\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDiscGame(raw: string): ParsedDiscGame {
  let discNumber = 1;
  let discTotal: number | undefined;
  let subtitle: string | undefined;
  let isMulti = false;

  const m1 = raw.match(DISC_TAG_REGEX);
  if (m1) {
    discNumber = parseInt(m1[1], 10) || 1;
    if (m1[2]) discTotal = parseInt(m1[2], 10);
    isMulti = true;
  } else {
    const m2 = raw.match(DISC_TRAILING_REGEX);
    if (m2) {
      discNumber = parseInt(m2[1], 10) || 1;
      if (m2[2]) discTotal = parseInt(m2[2], 10);
      isMulti = true;
    }
  }

  const mSub = raw.match(DISC_SUBTITLE_REGEX);
  if (mSub) {
    subtitle = mSub[1] + " Disc";
    isMulti = true;
    if (!m1) {
      const lower = mSub[1].toLowerCase();
      if (lower === "install" || lower === "installation") {
        discNumber = 1;
      } else if (lower === "game" || lower === "play") {
        discNumber = 2;
      }
    }
  } else {
    const mSub2 = raw.match(DISC_SUBTITLE_TRAILING_REGEX);
    if (mSub2) {
      subtitle = mSub2[1] + " Disc";
      isMulti = true;
    }
  }

  const releaseTitle = raw
    .replace(DISC_TAG_REGEX, "")
    .replace(DISC_SUBTITLE_REGEX, "")
    .replace(DISC_TRAILING_REGEX, "")
    .replace(DISC_SUBTITLE_TRAILING_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();

  const baseTitle = getBaseTitle(releaseTitle);

  return {
    rawName: raw,
    baseTitle,
    releaseTitle,
    discNumber,
    discTotal,
    subtitle,
    isMultiDisc: isMulti,
  };
}

function getComparisonKey(baseTitle: string): string {
  let key = baseTitle.toLowerCase();
  
  // Replacements for localized/different spellings
  key = key.replace(/\bbrasil\b/g, "brazil");
  key = key.replace(/\ba era do gelo\b/g, "ice age");
  key = key.replace(/\bac\b/g, "assassin's creed");
  key = key.replace(/\bacdc\b/g, "ac/dc");
  
  // Roman numerals to Arabic numbers
  key = key.replace(/\bxv\b/g, "15");
  key = key.replace(/\bxiv\b/g, "14");
  key = key.replace(/\bxiii\b/g, "13");
  key = key.replace(/\bxii\b/g, "12");
  key = key.replace(/\bxi\b/g, "11");
  key = key.replace(/\bx\b/g, "10");
  key = key.replace(/\bix\b/g, "9");
  key = key.replace(/\bviii\b/g, "8");
  key = key.replace(/\bvii\b/g, "7");
  key = key.replace(/\bvi\b/g, "6");
  key = key.replace(/\biv\b/g, "4");
  key = key.replace(/\biii\b/g, "3");
  key = key.replace(/\bii\b/g, "2");
  key = key.replace(/\bv\b/g, "5"); // after iv, vi, vii, viii, xv, xiv, xiii, xii, xi, ix since they contain v

  // Strip trailing region suffixes from comparison key (e.g. "Game Name Asia" or "Game Name Asia RF")
  let prevKey = "";
  while (key !== prevKey) {
    prevKey = key;
    key = key.replace(/\b(aus|usa|eur|pal|uk|jp|jpn|rf|regionfree|region\s+free|asia|ntsc|kor|chn|eng|spa|ger|fra|ita|rus|por|free)$/g, "").trim();
  }

  // Remove all non-alphanumeric characters for robust comparison
  return key.replace(/[^a-z0-9]/g, "");
}

interface VersionSelectDialogProps {
  baseTitle: string;
  releases: ReleaseGroup[];
  onClose: () => void;
  onSelect: (release: ReleaseGroup) => void;
}

function VersionSelectDialog({ baseTitle, releases, onClose, onSelect }: VersionSelectDialogProps) {
  const [cover, setCover] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    window.godsendApi.browseFetchCover(baseTitle).then((r: any) => {
      setCover(r.ok ? r.dataUrl : null);
    }).catch(() => setCover(null));
  }, [baseTitle]);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
    >
      <div className="relative bg-background border border-border rounded-xl p-4 w-full max-w-[360px] flex flex-col gap-3 shadow-2xl max-h-[90%]">
        
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        {/* Header: Cover + baseTitle */}
        <div className="flex gap-3 items-start pr-6 border-b border-border/50 pb-3">
          <CoverArt dataUrl={cover} name={baseTitle} size={80} />
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="text-[13px] font-semibold text-foreground leading-snug break-words">
              {baseTitle}
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Várias versões disponíveis. Escolha uma para baixar:
            </p>
          </div>
        </div>

        {/* Scrollable List of Versions */}
        <ScrollArea className="flex-1 overflow-y-auto max-h-[250px] pr-1">
          <div className="flex flex-col gap-1.5 py-1">
            {releases.map((rel) => (
              <button
                key={rel.releaseTitle}
                onClick={() => onSelect(rel)}
                className={cn(
                  "w-full text-left p-2.5 rounded-lg border border-border bg-muted/30 hover:bg-accent/40 active:bg-accent hover:border-accent transition-all",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring text-[11px] font-medium leading-relaxed break-words text-foreground/90 hover:text-foreground",
                  "flex flex-col gap-1"
                )}
              >
                <span>{rel.releaseTitle}</span>
                {rel.isMultiDisc && rel.totalDiscs > 1 && (
                  <span className="inline-flex items-center gap-1 text-[9.5px] text-primary font-semibold">
                    <Disc className="h-3 w-3" /> {rel.totalDiscs} Discos incluídos
                  </span>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// ── Lazy loading Intersection Observer Hook ──────────────────────────────────

function useIntersectionObserver<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsIntersecting(true);
          observer.unobserve(el);
        }
      },
      { rootMargin: "100px" }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, isIntersecting];
}

// ── Local library game card ──────────────────────────────────────────────────

interface LocalGameCardProps {
  name: string;
  onClick: () => void;
  isDownloaded?: boolean;
  installedInfo?: InstalledGame;
  isMultiDisc?: boolean;
  totalDiscs?: number;
  versionCount?: number;
}

function LocalGameCard({ name, onClick, isDownloaded, installedInfo, isMultiDisc, totalDiscs, versionCount }: LocalGameCardProps) {
  const [cover, setCover] = useState<string | null | undefined>(undefined);
  const [ref, isVisible] = useIntersectionObserver<HTMLButtonElement>();

  useEffect(() => {
    if (!isVisible) return undefined;

    let active = true;
    const timeoutId = setTimeout(() => {
      window.godsendApi.browseFetchCover(name).then((r: any) => {
        if (active) {
          setCover(r.ok ? r.dataUrl : null);
        }
      }).catch(() => {
        if (active) {
          setCover(null);
        }
      });
    }, 150); // 150ms debounce para evitar requests em rolagem rápida

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [name, isVisible]);

  return (
    <button
      ref={ref}
      onClick={onClick}
      className="group flex flex-col gap-1 rounded-lg p-1.5 hover:bg-accent/40 active:bg-accent transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring text-left"
    >
      <div
        className="relative w-full rounded-lg overflow-hidden border border-border bg-muted"
        style={{ aspectRatio: "3/4" }}
      >
        {cover === undefined ? (
          <div className="absolute inset-0 bg-gradient-to-r from-muted via-accent/30 to-muted animate-pulse" />
        ) : cover ? (
          <img
            src={cover}
            alt={name}
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Gamepad2 className="h-7 w-7 text-border" />
          </div>
        )}

        {/* Multi-disc badge in top-left */}
        {isMultiDisc && totalDiscs && totalDiscs > 1 && (
          <div className="absolute top-1 left-1 z-10 pointer-events-none">
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-bold bg-primary text-primary-foreground shadow-sm backdrop-blur-xs">
              <Disc className="h-2.5 w-2.5 stroke-[2.5]" /> {totalDiscs} Discos
            </span>
          </div>
        )}

        {/* Downloaded badge in top-right */}
        {isDownloaded && (
          <div className="absolute top-1 right-1 z-10 pointer-events-none">
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-600 text-white shadow-sm">
              <Check className="h-2.5 w-2.5 stroke-[3]" /> Baixado
            </span>
          </div>
        )}

        {/* Format badge in bottom-left if local */}
        {installedInfo && (
          <div className="absolute bottom-1 left-1 z-10 pointer-events-none">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-black/75 text-white/90 uppercase backdrop-blur-xs">
              {installedInfo.format}
            </span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-center pb-2">
          {isDownloaded ? (
            <span className="flex items-center gap-1 text-[10px] text-emerald-300 font-semibold px-2 py-0.5 rounded bg-black/60 backdrop-blur-xs">
              <Check className="h-3 w-3 stroke-[3]" /> Baixado
            </span>
          ) : (
            <Download className="h-4 w-4 text-white/80" />
          )}
        </div>
      </div>
      <span className="text-[10px] leading-tight text-foreground/80 group-hover:text-foreground text-center line-clamp-2 min-h-[2lh] w-full">
        {name}
      </span>
      {installedInfo && (
        <span className="text-[9px] text-muted-foreground/70 text-center truncate px-0.5 -mt-1 w-full">
          {installedInfo.drive}
        </span>
      )}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface BrowsePageProps {
  simpleMode?: boolean;
}

export default function BrowsePage({ simpleMode = true }: BrowsePageProps) {
  const [source,   setSource]   = useState("unified");
  const [platform, setPlatform] = useState("xbox360");
  const [status,   setStatus]   = useState("idle");  // idle|loading|cache-building|ready|empty|error
  const [games,    setGames]    = useState<string[]>([]);
  const [cacheProgress, setCacheProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [filter,   setFilter]   = useState("");
  const [defaultDrive, setDefaultDrive] = useState("");

  const [selected,     setSelected]     = useState<string | null>(null);
  const [selectedReleaseGroup, setSelectedReleaseGroup] = useState<ReleaseGroup | undefined>(undefined);
  const [cover,        setCover]        = useState<string | null | undefined>(undefined);
  const [drives,       setDrives]       = useState<string[]>([]);
  const [localDrives,  setLocalDrives]  = useState<LocalDrive[]>([]);
  const [installedGames, setInstalledGames] = useState<InstalledGame[]>([]);
  const filterRef = useRef<HTMLInputElement>(null);

  const isLocal = source === "local";

  // Load local prepared drives (primary), plus default + FTP drives (secondary),
  // and scan for installed games on USB drives/local storage.
  const refreshDestinations = useCallback(() => {
    window.godsendApi.toolsBadAvatarListDrives().then((r: any) => {
      const list = (r?.ok && Array.isArray(r.drives)) ? r.drives : [];
      setLocalDrives(list.map((d: any) => ({
        rootPath: String(d.rootPath || ""),
        label: String(d.label || ""),
        freeBytes: typeof d.freeBytes === "number" ? d.freeBytes : undefined,
      })).filter((d: LocalDrive) => d.rootPath));
    }).catch(() => setLocalDrives([]));

    window.godsendApi.browseGetInstalledGames().then((r: any) => {
      if (r?.ok && Array.isArray(r.games)) {
        setInstalledGames(r.games);
      }
    }).catch(() => setInstalledGames([]));

    window.godsendApi.getDefaultXboxDrive().then((d: string) => {
      if (d) setDefaultDrive(d);
    }).catch(() => {});
    window.godsendApi.listXboxDrives().then((r: any) => {
      if (r?.ok && Array.isArray(r.drives) && r.drives.length > 0) {
        setDrives(r.drives);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => { refreshDestinations(); }, [refreshDestinations]);

  // Re-scan destinations whenever the queue dialog opens (a pendrive may have
  // just been prepared/plugged in).
  useEffect(() => { if (selected) refreshDestinations(); }, [selected, refreshDestinations]);

  // Auto-load when platform or source changes
  useEffect(() => {
    loadGames();
  }, [platform, source]);

  async function loadGames() {
    setStatus("loading");
    setGames([]);
    setFilter("");
    setCacheProgress(null);

    if (!isLocal) {
      // Background-refresh installed games so badges update reactively without blocking catalog display
      window.godsendApi.browseGetInstalledGames()
        .then((instRes: any) => {
          if (instRes?.ok && Array.isArray(instRes.games)) {
            setInstalledGames(instRes.games);
          }
        })
        .catch(() => {});

      const r = await window.godsendApi.browseGetGames({ platform, source });
      if (!r.ok) {
        setStatus("error");
        return;
      }
      if (r.loading) {
        setCacheProgress({ loaded: r.loaded, total: r.total });
        setStatus("cache-building");
        return;
      }
      const backendList = Array.isArray(r.games) ? r.games : [];
      setGames(backendList);
      setStatus(backendList.length === 0 ? "empty" : "ready");
      setTimeout(() => filterRef.current?.focus(), 50);
      return;
    }

    // Local library mode: fetch in parallel
    const [instRes, r] = await Promise.all([
      window.godsendApi.browseGetInstalledGames().catch(() => ({ ok: false, games: [] })),
      window.godsendApi.browseGetGames({ platform: "local", source: "local" }).catch(() => ({ ok: false, games: [] }))
    ]);

    let localInstalled: InstalledGame[] = [];
    if (instRes?.ok && Array.isArray(instRes.games)) {
      localInstalled = instRes.games;
      setInstalledGames(instRes.games);
    }

    if (r.loading) {
      setCacheProgress({ loaded: r.loaded, total: r.total });
      setStatus("cache-building");
      return;
    }
    const backendList = Array.isArray(r.games) ? r.games : [];
    let list: string[] = backendList;
    if (isLocal) {
      const combined = new Set<string>();
      for (const g of localInstalled) {
        combined.add(g.name);
      }
      for (const b of backendList) {
        combined.add(b);
      }
      list = Array.from(combined).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }

    setGames(list);
    setStatus(list.length === 0 ? "empty" : "ready");
    setTimeout(() => filterRef.current?.focus(), 50);
  }

  function openGame(name: string, releaseGroup?: ReleaseGroup) {
    setSelected(name);
    setSelectedReleaseGroup(releaseGroup);
    setCover(undefined);
    window.godsendApi.browseFetchCover(name).then((r: any) => {
      setCover(r.ok ? r.dataUrl : null);
    }).catch(() => setCover(null));
  }

  function closeDialog() {
    setSelected(null);
    setSelectedReleaseGroup(undefined);
    setCover(undefined);
  }

  const [versionSelectGame, setVersionSelectGame] = useState<{ baseTitle: string; releases: ReleaseGroup[] } | null>(null);

  const groupedGames = useMemo(() => {
    const map = new Map<string, CatalogGameItem>();

    for (const raw of games) {
      const parsed = parseDiscGame(raw);
      const baseKey = getComparisonKey(parsed.baseTitle);

      let catItem = map.get(baseKey);
      if (!catItem) {
        catItem = {
          displayTitle: parsed.baseTitle,
          baseTitle: parsed.baseTitle,
          releases: [],
          allRawNames: [],
          totalDiscs: 1,
          isMultiDisc: false,
        };
        map.set(baseKey, catItem);
      }

      catItem.allRawNames.push(raw);

      let rel = catItem.releases.find((r) => r.releaseTitle === parsed.releaseTitle);
      if (!rel) {
        rel = {
          releaseTitle: parsed.releaseTitle,
          baseTitle: parsed.baseTitle,
          discs: [],
          isMultiDisc: false,
          totalDiscs: 1,
        };
        catItem.releases.push(rel);
      }

      if (!rel.discs.some((d) => d.rawName === raw)) {
        rel.discs.push(parsed);
      }
    }

    for (const item of map.values()) {
      let maxDiscs = 1;
      let hasMulti = false;
      for (const rel of item.releases) {
        rel.discs.sort((a, b) => a.discNumber - b.discNumber);
        if (rel.discs.length > 1 || rel.discs.some((d) => d.isMultiDisc)) {
          rel.isMultiDisc = true;
          rel.totalDiscs = Math.max(rel.discs.length, rel.discs[0]?.discTotal || 1);
        } else {
          rel.totalDiscs = 1;
        }
        if (rel.totalDiscs > maxDiscs) maxDiscs = rel.totalDiscs;
        if (rel.isMultiDisc) hasMulti = true;
      }
      item.totalDiscs = maxDiscs;
      item.isMultiDisc = hasMulti;
    }

    return map;
  }, [games]);

  const uniqueBaseTitles = useMemo(() => {
    const items = Array.from(groupedGames.values());
    return items.sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
  }, [groupedGames]);

  const filteredBaseTitles = useMemo(() => {
    if (!filter.trim()) {
      return uniqueBaseTitles;
    }
    const f = filter.toLowerCase();
    return uniqueBaseTitles.filter((item) => {
      if (item.displayTitle.toLowerCase().includes(f)) return true;
      if (item.allRawNames.some((n) => n.toLowerCase().includes(f))) return true;
      return item.releases.some((r) => r.releaseTitle.toLowerCase().includes(f));
    });
  }, [uniqueBaseTitles, filter]);

  const { installedComparisonKeys, installedGameMap } = useMemo(() => {
    const keys = new Set<string>();
    const byKey = new Map<string, InstalledGame>();
    for (const g of installedGames) {
      const k = getComparisonKey(g.name);
      keys.add(k);
      byKey.set(k, g);
      if (g.titleId) {
        const tid = g.titleId.toUpperCase();
        keys.add(tid);
        byKey.set(tid, g);
      }
    }
    return { installedComparisonKeys: keys, installedGameMap: byKey };
  }, [installedGames]);

  const getInstalledInfo = useCallback((item: CatalogGameItem) => {
    const baseKey = getComparisonKey(item.displayTitle);
    if (installedGameMap.has(baseKey)) return installedGameMap.get(baseKey);
    for (const raw of item.allRawNames) {
      const k = getComparisonKey(raw);
      if (installedGameMap.has(k)) return installedGameMap.get(k);
    }
    for (const rel of item.releases) {
      const rk = getComparisonKey(rel.releaseTitle);
      if (installedGameMap.has(rk)) return installedGameMap.get(rk);
    }
    return undefined;
  }, [installedGameMap]);

  function handleGameClick(item: CatalogGameItem) {
    if (item.releases.length === 1) {
      openGame(item.releases[0].releaseTitle, item.releases[0]);
    } else if (item.releases.length > 1) {
      setVersionSelectGame({ baseTitle: item.displayTitle, releases: item.releases });
    }
  }

  const effectivePlatform = isLocal ? "local" : platform;

  return (
    <div className="relative flex flex-col h-full p-3 gap-2 overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center gap-2 shrink-0">
        <div className="flex gap-1">
          {SOURCES.map((s) => (
            <PillBtn
              key={s.id}
              active={source === s.id}
              onClick={() => setSource(s.id)}
            >
              {s.id === "local" && <HardDrive className="inline h-3 w-3 mr-1 -mt-px" />}
              {s.label}
            </PillBtn>
          ))}
        </div>
      </header>

      {/* ── Platform tabs (hidden for local library) ── */}
      {!isLocal && (
        <div className="flex gap-1 overflow-x-auto shrink-0 pb-0.5 no-scrollbar">
          {PLATFORMS.map((p) => (
            <PillBtn
              key={p.id}
              active={platform === p.id}
              onClick={() => setPlatform(p.id)}
            >
              {p.label}
            </PillBtn>
          ))}
        </div>
      )}

      {/* ── Content area ── */}

      {status === "loading" && (
        <CenteredOverlay>
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-[13px]">
            {isLocal ? "Lendo a pasta Transfer…" : "Carregando a lista de jogos…"}
          </p>
        </CenteredOverlay>
      )}

      {status === "cache-building" && (
        <CenteredOverlay>
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-[13px]">Montando o cache…</p>
          {cacheProgress && (
            <p className="text-[11px] text-muted-foreground/70">
              {cacheProgress.loaded} / {cacheProgress.total} obtidos
            </p>
          )}
          <p className="text-[11px] text-muted-foreground/60 max-w-[220px] text-center">
            A primeira carga leva um momento. Volte e tente de novo em instantes.
          </p>
          <Button size="sm" variant="outline" onClick={loadGames} className="mt-1">
            <RefreshCw className="h-3 w-3 mr-1.5" />
            Tentar de novo
          </Button>
        </CenteredOverlay>
      )}

      {status === "error" && (
        <CenteredOverlay>
          <WifiOff className="h-7 w-7 text-muted-foreground" />
          <p className="text-[13px]">Não foi possível acessar o servidor.</p>
          <p className="text-[11px] text-muted-foreground/60">
            Verifique se o serviço do GODsend está em execução.
          </p>
          <Button size="sm" onClick={loadGames}>
            <RefreshCw className="h-3 w-3 mr-1.5" />
            Tentar de novo
          </Button>
        </CenteredOverlay>
      )}

      {status === "empty" && (
        <CenteredOverlay>
          {isLocal ? (
            <>
              <HardDrive className="h-7 w-7 text-muted-foreground" />
              <p className="text-[13px]">Nenhum jogo encontrado no pendrive ou na pasta Transfer.</p>
              <p className="text-[11px] text-muted-foreground/60 max-w-[280px] text-center">
                Conecte um pendrive preparado com jogos na pasta Games ou adicione arquivos ISO à pasta Transfer para vê-los aqui.
              </p>
            </>
          ) : (
            <>
              <Gamepad2 className="h-7 w-7 text-muted-foreground" />
              <p className="text-[13px]">Nenhum jogo encontrado.</p>
              <p className="text-[11px] text-muted-foreground/60 max-w-[220px] text-center">
                A lista ainda pode estar sendo montada. Tente de novo em instantes.
              </p>
            </>
          )}
          <Button size="sm" onClick={loadGames}>
            <RefreshCw className="h-3 w-3 mr-1.5" />
            {isLocal ? "Reescanear" : "Tentar de novo"}
          </Button>
        </CenteredOverlay>
      )}

      {status === "ready" && (
        <>
          {/* Search bar */}
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              ref={filterRef}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filtrar ${uniqueBaseTitles.length} título${uniqueBaseTitles.length === 1 ? "" : "s"}…`}
              className={cn(
                "w-full pl-8 pr-3 py-1.5 text-[12px] rounded-md",
                "bg-muted border border-border text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              )}
            />
            {filter && (
              <button
                onClick={() => setFilter("")}
                title="Limpar filtro"
                aria-label="Limpar filtro"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Result count hint */}
          {filter && (
            <p className="text-[10px] text-muted-foreground/60 shrink-0 -mt-1 px-0.5">
              {filteredBaseTitles.length} resultado{filteredBaseTitles.length !== 1 ? "s" : ""}
            </p>
          )}

          {/* Game grid (local library) or text list (store) */}
          <ScrollArea className="flex-1 min-h-0">
            {filteredBaseTitles.length === 0 ? (
              <p className="text-[12px] text-muted-foreground text-center py-8">
                No matches for &ldquo;{filter}&rdquo;
              </p>
            ) : (
              <div
                className="grid gap-2 pb-4 pr-1"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}
              >
                {filteredBaseTitles.map((item) => {
                  const inst = getInstalledInfo(item);
                  return (
                    <LocalGameCard
                      key={item.displayTitle}
                      name={item.displayTitle}
                      onClick={() => handleGameClick(item)}
                      isDownloaded={Boolean(inst)}
                      installedInfo={isLocal ? inst : undefined}
                      isMultiDisc={item.isMultiDisc}
                      totalDiscs={item.totalDiscs}
                      versionCount={item.releases.length}
                    />
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </>
      )}

      {/* ── Version Selection Modal ── */}
      {versionSelectGame && (
        <VersionSelectDialog
          baseTitle={versionSelectGame.baseTitle}
          releases={versionSelectGame.releases}
          onClose={() => setVersionSelectGame(null)}
          onSelect={(rel) => {
            setVersionSelectGame(null);
            openGame(rel.releaseTitle, rel);
          }}
        />
      )}

      {/* ── Queue dialog overlay ── */}
      {selected && (
        <QueueDialog
          game={selected}
          releaseGroup={selectedReleaseGroup}
          platform={effectivePlatform}
          source={source}
          cover={cover}
          defaultDrive={defaultDrive}
          drives={drives}
          localDrives={localDrives}
          installedGames={installedGames}
          onClose={closeDialog}
          simpleMode={simpleMode}
          onXboxConfigured={refreshDestinations}
        />
      )}
    </div>
  );
}
