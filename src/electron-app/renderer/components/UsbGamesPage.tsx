import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  FolderOpen, Trash2, Search, HardDrive,
  Gamepad2, AlertTriangle, X, CheckCircle2, ChevronDown,
  RefreshCw, Filter, Check, Download, Wrench, ShieldCheck, ShieldAlert, LogOut
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import DriveRepairModal from "./DriveRepairModal";
import FakeDriveProbeModal from "./FakeDriveProbeModal";

export interface InstalledGame {
  name: string;
  titleId?: string;
  path: string;
  drive: string;
  format: "god" | "xex" | "iso";
  folderName: string;
  sizeBytes?: number;
  localCoverUrl?: string;
}

interface UsbGamesPageProps {
  onNavigateBrowse?: () => void;
  onNavigateHome?: () => void;
  onGamesCountChange?: (count: number) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
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
      { rootMargin: "150px" }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, isIntersecting];
}

// ── Installed Game 2D Card (Standard identical to Catalog / BrowsePage) ───────
interface InstalledGameCardProps {
  game: InstalledGame;
  onOpenFolder: (path: string) => void;
  onDelete: (game: InstalledGame) => void;
}

function InstalledGameCard({ game, onOpenFolder, onDelete }: InstalledGameCardProps) {
  const [cover, setCover] = useState<string | null | undefined>(undefined);
  const [ref, isVisible] = useIntersectionObserver<HTMLDivElement>();

  useEffect(() => {
    if (!isVisible) return undefined;

    // 0. If game already has a local cover file in its folder, use it immediately
    if (game.localCoverUrl) {
      setCover(game.localCoverUrl);
      return undefined;
    }

    let active = true;
    const timeoutId = setTimeout(async () => {
      try {
        // 1. Try fetching cover by cleaned game name
        let r = await window.godsendApi.browseFetchCover(game.name);
        // 2. If not found and game has a Title ID, try fetching by Title ID
        if ((!r || !r.ok || !r.dataUrl) && game.titleId) {
          r = await window.godsendApi.browseFetchCover(game.titleId);
        }
        if (active) {
          setCover(r?.ok && r.dataUrl ? r.dataUrl : null);
        }
      } catch {
        if (active) {
          setCover(null);
        }
      }
    }, 100);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [game.name, game.titleId, game.localCoverUrl, isVisible]);

  return (
    <div
      ref={ref}
      className="group relative flex flex-col rounded-xl border border-border/60 bg-card/60 hover:bg-card/90 hover:border-emerald-500/40 transition-all duration-200 overflow-hidden shadow-xs hover:shadow-md"
    >
      {/* 2D Cover Box (Aspect 3/4 - standard Xbox 360 game case) */}
      <div
        className="relative w-full overflow-hidden border-b border-border/40 bg-muted/30"
        style={{ aspectRatio: "3/4" }}
      >
        {cover === undefined ? (
          <div className="absolute inset-0 bg-gradient-to-r from-muted via-accent/20 to-muted animate-pulse flex items-center justify-center">
            <Gamepad2 className="h-8 w-8 text-muted-foreground/30" />
          </div>
        ) : cover ? (
          <img
            src={cover}
            alt={game.name}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center bg-muted/20">
            <Gamepad2 className="h-10 w-10 text-muted-foreground/40 mb-1" />
            <span className="text-[10px] text-muted-foreground/60 font-mono">Sem capa</span>
          </div>
        )}

        {/* Format Badge Overlay in top-left */}
        <div className="absolute top-2 left-2 z-10 pointer-events-none">
          {game.format === "xex" ? (
            <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-wider uppercase bg-emerald-600 text-white shadow-sm backdrop-blur-xs">
              XEX
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded text-[9px] font-black tracking-wider uppercase bg-sky-600 text-white shadow-sm backdrop-blur-xs">
              GOD
            </span>
          )}
        </div>

        {/* Size Pill Overlay in bottom-right */}
        {game.sizeBytes && game.sizeBytes > 0 && (
          <div className="absolute bottom-1.5 right-1.5 z-10 pointer-events-none">
            <span className="px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-mono font-medium border border-white/10 shadow-xs backdrop-blur-xs">
              {formatBytes(game.sizeBytes)}
            </span>
          </div>
        )}
      </div>

      {/* Info & Metadata */}
      <div className="flex flex-col flex-1 p-2.5">
        <h3
          className="font-semibold text-[12px] leading-tight text-foreground line-clamp-2 min-h-[2.5lh] group-hover:text-emerald-400 transition-colors"
          title={game.name}
        >
          {game.name}
        </h3>

        {/* Title ID & Drive Info */}
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
          <span>{game.titleId || "SEM TID"}</span>
          <span className="truncate max-w-[80px]" title={game.drive}>
            {game.drive}
          </span>
        </div>

        {/* Card Actions */}
        <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            className="flex-1 h-7 text-[11px] gap-1 px-2 hover:bg-emerald-500/15 hover:text-emerald-300 transition-colors cursor-pointer"
            onClick={() => onOpenFolder(game.path)}
            title={`Abrir pasta no Explorer: ${game.path}`}
          >
            <FolderOpen className="h-3 w-3" />
            <span>Pasta</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
            onClick={() => onDelete(game)}
            title={`Excluir jogo "${game.name}"`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page Component ──────────────────────────────────────────────────────
export default function UsbGamesPage({
  onNavigateBrowse,
  onNavigateHome,
  onGamesCountChange,
}: UsbGamesPageProps) {
  const [drives, setDrives] = useState<any[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<string>("ALL");
  const [games, setGames] = useState<InstalledGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState<"all" | "xex" | "god">("all");
  const [sortBy, setSortBy] = useState<"name" | "size" | "format">("name");
  const [deleteCandidate, setDeleteCandidate] = useState<InstalledGame | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [showRepairModal, setShowRepairModal] = useState(false);
  const [showProbeModal, setShowProbeModal] = useState(false);
  const [ejecting, setEjecting] = useState(false);

  // Load drives and installed games
  const refreshAll = useCallback(async () => {
    setLoading(true);
    setActionFeedback(null);
    try {
      // 1. Fetch drives
      const drivesRes = await window.godsendApi.toolsBadAvatarListDrives();
      if (drivesRes && drivesRes.ok && Array.isArray(drivesRes.drives)) {
        setDrives(drivesRes.drives);
        if (selectedDrive === "ALL" && drivesRes.drives.length === 1 && drivesRes.drives[0].rootPath) {
          setSelectedDrive(drivesRes.drives[0].rootPath);
        }
      }

      // 2. Fetch installed games
      const res = await window.godsendApi.browseGetInstalledGames();
      if (res && res.ok && Array.isArray(res.games)) {
        setGames(res.games);
        onGamesCountChange?.(res.games.length);
      } else {
        setGames([]);
        onGamesCountChange?.(0);
      }
    } catch (err: any) {
      setActionFeedback({ msg: `Erro ao buscar jogos: ${err.message}`, type: "error" });
    } finally {
      setLoading(false);
    }
  }, [selectedDrive, onGamesCountChange]);

  useEffect(() => {
    refreshAll();
  }, []);

  // Filtered games based on drive, format, and search
  const filteredGames = useMemo(() => {
    return games
      .filter((g) => {
        // Drive filter
        if (selectedDrive !== "ALL") {
          const driveLetter = selectedDrive.charAt(0).toUpperCase();
          const gameDriveLetter = g.path.charAt(0).toUpperCase();
          if (driveLetter !== gameDriveLetter) return false;
        }

        // Format filter
        if (formatFilter !== "all" && g.format !== formatFilter) {
          return false;
        }

        // Search query
        if (search.trim()) {
          const q = search.toLowerCase();
          const matchesName = (g.name || "").toLowerCase().includes(q);
          const matchesTid = (g.titleId || "").toLowerCase().includes(q);
          const matchesFolder = (g.folderName || "").toLowerCase().includes(q);
          if (!matchesName && !matchesTid && !matchesFolder) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === "size") {
          return (b.sizeBytes || 0) - (a.sizeBytes || 0);
        }
        if (sortBy === "format") {
          return a.format.localeCompare(b.format);
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });
  }, [games, selectedDrive, formatFilter, search, sortBy]);

  // Current active drive stats
  const activeDriveInfo = useMemo(() => {
    if (selectedDrive === "ALL") {
      return drives.find((d) => d.rootPath) || null;
    }
    return drives.find((d) => d.rootPath?.toUpperCase().startsWith(selectedDrive.charAt(0).toUpperCase())) || null;
  }, [drives, selectedDrive]);

  // Actions
  async function handleOpenFolder(folderPath: string) {
    try {
      const res = await window.godsendApi.toolsOpenFolder(folderPath);
      if (!res.ok) {
        setActionFeedback({ msg: res.error || "Não foi possível abrir a pasta.", type: "error" });
      }
    } catch (err: any) {
      setActionFeedback({ msg: err.message, type: "error" });
    }
  }

  async function handleDeleteGame() {
    if (!deleteCandidate) return;
    setDeleting(true);
    setActionFeedback(null);
    try {
      const res = await window.godsendApi.toolsDeleteLocalGame(deleteCandidate.path);
      if (res && res.ok) {
        setActionFeedback({ msg: `Jogo "${deleteCandidate.name}" excluído com sucesso!`, type: "success" });
        setDeleteCandidate(null);
        await refreshAll();
      } else {
        setActionFeedback({ msg: res.error || "Falha ao excluir jogo.", type: "error" });
      }
    } catch (err: any) {
      setActionFeedback({ msg: `Erro ao excluir: ${err.message}`, type: "error" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleEjectDrive(rootPath: string) {
    setEjecting(true);
    setActionFeedback(null);
    try {
      const res = await window.godsendApi.toolsDriveEject(rootPath);
      if (res && res.ok) {
        setActionFeedback({ msg: `Unidade ${rootPath} ejetada com segurança. Você já pode desconectar o pendrive.`, type: "success" });
        await refreshAll();
      } else {
        setActionFeedback({ msg: res.error || "Não foi possível ejetar a unidade.", type: "error" });
      }
    } catch (err: any) {
      setActionFeedback({ msg: `Erro ao ejetar: ${err.message}`, type: "error" });
    } finally {
      setEjecting(false);
    }
  }

  const xexCount = games.filter((g) => g.format === "xex").length;
  const godCount = games.filter((g) => g.format === "god").length;
  const totalSizeBytes = games.reduce((acc, g) => acc + (g.sizeBytes || 0), 0);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background text-foreground">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border/60 bg-surface/80 backdrop-blur-md px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
              <Gamepad2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-lg font-bold tracking-tight text-foreground">
                  Jogos Instalados
                </h1>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/30">
                  {games.length} {games.length === 1 ? "jogo" : "jogos"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Visualização e gerenciamento de títulos instalados diretamente no armazenamento USB e local
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Drive Selector */}
            {drives.length > 0 && (
              <div className="relative">
                <select
                  value={selectedDrive}
                  onChange={(e) => setSelectedDrive(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-background px-3 pr-8 text-xs font-medium text-foreground outline-none focus:border-emerald-500 transition-colors cursor-pointer appearance-none shadow-sm"
                  aria-label="Selecionar Unidade"
                >
                  <option value="ALL">Todas as unidades USB ({games.length})</option>
                  {drives.map((d) => (
                    <option key={d.rootPath} value={d.rootPath}>
                      {d.rootPath} {d.label ? `[${d.label}]` : ""} ({formatBytes(d.sizeBytes)})
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}

            {/* Refresh Button */}
            <Button
              size="sm"
              variant="default"
              disabled={loading}
              onClick={refreshAll}
              className="gap-1.5 h-9 px-3 cursor-pointer"
              title="Atualizar lista de jogos"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin text-emerald-400")} />
              <span>Atualizar</span>
            </Button>

            {/* Drive Tools Actions */}
            {activeDriveInfo?.rootPath && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowRepairModal(true)}
                  className="gap-1.5 h-9 px-2.5 text-xs text-amber-400 border-amber-500/30 hover:bg-amber-500/10 cursor-pointer"
                  title="Executar verificação e reparo de sistema de arquivos FAT32 (CHKDSK)"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Reparar (CHKDSK)</span>
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowProbeModal(true)}
                  className="gap-1.5 h-9 px-2.5 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 cursor-pointer"
                  title="Testar autenticidade e capacidade real da memória flash"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Testar Capacidade</span>
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleOpenFolder(activeDriveInfo.rootPath)}
                  className="gap-1.5 h-9 px-3 cursor-pointer"
                  title={`Abrir unidade ${activeDriveInfo.rootPath} no Explorer`}
                >
                  <FolderOpen className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Abrir</span>
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ejecting}
                  onClick={() => handleEjectDrive(activeDriveInfo.rootPath)}
                  className="gap-1.5 h-9 px-2.5 text-xs text-muted-foreground hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                  title={`Ejetar unidade ${activeDriveInfo.rootPath} com segurança`}
                >
                  <LogOut className={cn("h-3.5 w-3.5", ejecting && "animate-spin")} />
                  <span className="hidden sm:inline">Ejetar</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Drive Health Alert Banner ──────────────────────────────────────── */}
        {activeDriveInfo && (activeDriveInfo.needsRepair || activeDriveInfo.healthStatus === "Warning" || /Repair|Need|Corrupt/i.test(activeDriveInfo.operationalStatus || "")) && (
          <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex flex-wrap items-center justify-between gap-3 text-xs animate-fade-in">
            <div className="flex items-center gap-2.5 text-amber-300">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" />
              <div>
                <strong>Atenção:</strong> O sistema de arquivos da unidade <code className="font-mono bg-amber-950/60 px-1 py-0.5 rounded text-amber-200">{activeDriveInfo.rootPath}</code> necessita de reparo (Status: {activeDriveInfo.operationalStatus || activeDriveInfo.healthStatus}).
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => setShowRepairModal(true)}
                className="h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer gap-1"
              >
                <Wrench className="h-3 w-3" />
                <span>Reparar Agora</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowProbeModal(true)}
                className="h-7 text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/20 cursor-pointer"
              >
                Testar Autenticidade
              </Button>
            </div>
          </div>
        )}

        {/* ── Sub-bar: Drive Metrics & Filters ──────────────────────────────── */}
        <div className="mt-4 pt-3 border-t border-border/40 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Storage specs */}
          <div className="flex flex-wrap items-center gap-2">
            {activeDriveInfo && (
              <span className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2.5 py-1 text-muted-foreground font-mono">
                <HardDrive className="h-3.5 w-3.5 text-emerald-400" />
                <span>{activeDriveInfo.rootPath} {activeDriveInfo.fileSystem ? `(${activeDriveInfo.fileSystem})` : ""}</span>
              </span>
            )}
            <span className="text-muted-foreground">
              Ocupado: <strong className="text-foreground font-mono">{formatBytes(totalSizeBytes)}</strong>
            </span>
            {activeDriveInfo?.freeBytes && (
              <>
                <span className="text-border">•</span>
                <span className="text-muted-foreground">
                  Livre: <strong className="text-emerald-400 font-mono">{formatBytes(activeDriveInfo.freeBytes)}</strong>
                </span>
              </>
            )}
            <span className="text-border">•</span>
            <span className="text-muted-foreground">
              XEX: <strong className="text-emerald-400 font-mono">{xexCount}</strong>
            </span>
            <span className="text-border">•</span>
            <span className="text-muted-foreground">
              GOD: <strong className="text-sky-400 font-mono">{godCount}</strong>
            </span>
          </div>

          {/* Search, Filter & Sort Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou TitleID..."
                className="h-8 w-44 sm:w-56 rounded-lg border border-border bg-background pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-emerald-500 transition-colors shadow-xs"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Format Filter Tabs */}
            <div className="flex items-center rounded-lg border border-border/80 bg-background/50 p-0.5">
              <button
                onClick={() => setFormatFilter("all")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                  formatFilter === "all"
                    ? "bg-emerald-600 text-white font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Todos ({games.length})
              </button>
              <button
                onClick={() => setFormatFilter("xex")}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                  formatFilter === "xex"
                    ? "bg-emerald-600 text-white font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                XEX ({xexCount})
              </button>
              <button
                onClick={() => setFormatFilter("god")}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                  formatFilter === "god"
                    ? "bg-sky-600 text-white font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                GOD ({godCount})
              </button>
            </div>

            {/* Sort Dropdown */}
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="h-8 rounded-lg border border-border bg-background px-2.5 pr-7 text-[11px] font-medium text-foreground outline-none focus:border-emerald-500 transition-colors cursor-pointer appearance-none shadow-xs"
                aria-label="Ordenar por"
              >
                <option value="name">Nome (A-Z)</option>
                <option value="size">Tamanho (Maior)</option>
                <option value="format">Formato (XEX/GOD)</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            </div>
          </div>
        </div>
      </header>

      {/* ── Main Content Area ──────────────────────────────────────────────── */}
      <main className="flex-1 min-h-0 overflow-y-auto p-6">
        {/* Feedback Alert Toast */}
        {actionFeedback && (
          <div
            className={cn(
              "mb-4 flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-xs shadow-md animate-fade-in",
              actionFeedback.type === "success"
                ? "border border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                : "border border-red-500/40 bg-red-950/40 text-red-300"
            )}
          >
            <div className="flex items-center gap-2">
              {actionFeedback.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              )}
              <span>{actionFeedback.msg}</span>
            </div>
            <button
              onClick={() => setActionFeedback(null)}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {loading ? (
          /* Loading Skeleton */
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
            <p className="text-sm font-medium">Buscando jogos instalados...</p>
            <p className="text-xs text-muted-foreground/80">Lendo as pastas Games e Content do dispositivo</p>
          </div>
        ) : games.length === 0 ? (
          /* Empty State: No games found on storage */
          <div className="flex h-full flex-col items-center justify-center text-center max-w-md mx-auto p-6">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/40 border border-border/60 text-muted-foreground mb-4">
              <Gamepad2 className="h-8 w-8 text-emerald-400" />
            </div>
            <h2 className="font-display text-lg font-bold text-foreground">
              Nenhum jogo instalado encontrado
            </h2>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              Não encontramos nenhum jogo nos formatos XEX ou GOD na unidade selecionada. Conecte o pendrive com jogos ou baixe novos títulos diretamente do catálogo.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
              <Button onClick={refreshAll} variant="default" size="sm" className="gap-2 cursor-pointer">
                <RefreshCw className="h-4 w-4" />
                Verificar novamente
              </Button>
              {onNavigateBrowse && (
                <Button onClick={onNavigateBrowse} variant="primary" size="sm" className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer">
                  <Gamepad2 className="h-4 w-4" />
                  Ir para Catálogo de Jogos
                </Button>
              )}
            </div>
          </div>
        ) : filteredGames.length === 0 ? (
          /* Filter Returned 0 results */
          <div className="flex h-full flex-col items-center justify-center text-center p-6 text-muted-foreground">
            <Filter className="h-8 w-8 text-muted-foreground/60 mb-2" />
            <p className="text-sm font-medium text-foreground">Nenhum jogo corresponde aos filtros</p>
            <p className="text-xs mt-1">Tente pesquisar por outro termo ou limpar o filtro de formato.</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(""); setFormatFilter("all"); }}
              className="mt-4 text-xs text-emerald-400 hover:text-emerald-300 cursor-pointer"
            >
              Limpar filtros
            </Button>
          </div>
        ) : (
          /* Game Grid (Identical Layout Pattern to Catalog) */
          <div
            className="grid gap-3.5 pb-6 pr-1"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))" }}
          >
            {filteredGames.map((game) => (
              <InstalledGameCard
                key={game.path}
                game={game}
                onOpenFolder={handleOpenFolder}
                onDelete={setDeleteCandidate}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Delete Confirmation Modal ────────────────────────────────────── */}
      {deleteCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl animate-scale-in">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-display text-base font-bold text-foreground">
                  Excluir Jogo Instalado?
                </h3>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Tem certeza de que deseja apagar o jogo <strong className="text-foreground">{deleteCandidate.name}</strong>?
                </p>
                <div className="mt-3 rounded-lg bg-muted/40 p-2.5 text-[11px] font-mono text-muted-foreground border border-border/40 space-y-1">
                  <div className="truncate"><span className="text-foreground/70">Caminho:</span> {deleteCandidate.path}</div>
                  <div><span className="text-foreground/70">Formato:</span> {deleteCandidate.format.toUpperCase()}</div>
                  {deleteCandidate.sizeBytes && (
                    <div><span className="text-foreground/70">Tamanho:</span> {formatBytes(deleteCandidate.sizeBytes)}</div>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-red-400/90 font-medium">
                  Esta ação não pode ser desfeita e os arquivos serão removidos da unidade.
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2.5">
              <Button
                variant="ghost"
                size="sm"
                disabled={deleting}
                onClick={() => setDeleteCandidate(null)}
                className="text-xs cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={handleDeleteGame}
                className="text-xs gap-1.5 cursor-pointer bg-red-600 hover:bg-red-500 text-white"
              >
                {deleting ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    <span>Excluindo...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Confirmar Exclusão</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Drive Repair Modal (CHKDSK) ────────────────────────────────────── */}
      {activeDriveInfo && (
        <DriveRepairModal
          open={showRepairModal}
          driveRoot={activeDriveInfo.rootPath}
          onClose={() => setShowRepairModal(false)}
          onRepairCompleted={refreshAll}
        />
      )}

      {/* ── Fake Drive / Capacity Authenticity Modal ───────────────────────── */}
      {activeDriveInfo && (
        <FakeDriveProbeModal
          open={showProbeModal}
          driveRoot={activeDriveInfo.rootPath}
          driveLabel={activeDriveInfo.label}
          driveSizeBytes={activeDriveInfo.sizeBytes}
          onClose={() => setShowProbeModal(false)}
        />
      )}
    </div>
  );
}

