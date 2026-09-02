import { useEffect, useRef, useState } from "react";
import {
  RefreshCw, Settings, Gamepad2, Loader2, RotateCcw, ListOrdered,
  Store, Wrench, Disc, FolderOpen, HardDrive, Terminal, Usb, Home,
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export function FtpIndicator({ status }: { status: string }) {
  const dotClass =
    status === "connected"   ? "bg-green-500"
    : status === "checking"  ? "bg-yellow-400 animate-pulse"
    :                          "bg-muted-foreground/40";

  const label =
    status === "connected"   ? "FTP conectado"
    : status === "checking"  ? "Verificando FTP…"
    :                          "FTP indisponível";

  return (
    <div
      className="flex items-center gap-1.5 h-8 px-1 select-none"
      title={label}
      aria-label={label}
    >
      <div className={cn("w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300", dotClass)} />
      <span className="text-[10px] font-medium text-muted-foreground leading-none tracking-wide">
        FTP
      </span>
    </div>
  );
}

interface ToolboxDropdownProps {
  onIso2God: () => void;
  onIso2Xex: () => void;
  onFtpManager: () => void;
  onBadAvatarUsb: () => void;
  onBrowse?: () => void;
  onSettings?: () => void;
  simpleMode?: boolean;
  active?: boolean;
}

export function ToolboxDropdown({
  onIso2God,
  onIso2Xex,
  onFtpManager,
  onBadAvatarUsb,
  onBrowse,
  onSettings,
  simpleMode = false,
  active,
}: ToolboxDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        size="sm"
        title={simpleMode ? "Abrir outras funções" : "Mais opções e ferramentas"}
        aria-label={simpleMode ? undefined : "Mais opções e ferramentas"}
        aria-haspopup="menu"
        aria-expanded={open}
        variant={active ? "primary" : "default"}
        onClick={() => setOpen(!open)}
        className={cn(
          "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
          active && "ring-1 ring-accent ring-offset-1 ring-offset-background"
        )}
      >
        <Wrench className="h-4 w-4 text-orange-400" />
        <span className="hidden sm:inline">{simpleMode ? "Outras funções" : "Ferramentas"}</span>
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-surface border border-border rounded-lg shadow-lg overflow-hidden animate-fade-in">
          {simpleMode && onBrowse && (
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
              onClick={() => { setOpen(false); onBrowse(); }}
            >
              <Store className="h-3.5 w-3.5 text-blue-400" />
              Baixar Jogos
            </button>
          )}
          {simpleMode && onSettings && (
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
              onClick={() => { setOpen(false); onSettings(); }}
            >
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
              Configurações
            </button>
          )}
          {simpleMode && <div className="border-t border-border/60" />}
          <button
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
            onClick={() => { setOpen(false); onIso2God(); }}
          >
            <Disc className="h-3.5 w-3.5 text-blue-400" />
            ISO para GOD
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
            onClick={() => { setOpen(false); onIso2Xex(); }}
          >
            <FolderOpen className="h-3.5 w-3.5 text-green-400" />
            ISO para XEX
          </button>
          {!simpleMode && (
            <button
              className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
              onClick={() => { setOpen(false); onBadAvatarUsb(); }}
            >
              <Usb className="h-3.5 w-3.5 text-orange-400" />
              Preparar dispositivo
            </button>
          )}
          <button
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-[12px] text-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
            onClick={() => { setOpen(false); onFtpManager(); }}
          >
            <HardDrive className="h-3.5 w-3.5 text-yellow-400" />
            Gerenciador FTP
          </button>
        </div>
      )}
    </div>
  );
}

export interface MainNavProps {
  ftpStatus: string;
  currentPage: "home" | "library" | "settings" | "queue" | "browse" | "iso2god" | "iso2xex" | "ftpmanager" | "badavatarusb" | "usb-games";
  libraryAvailable?: boolean;
  libraryLoading: boolean;
  queueJobs: any[];
  usbGamesCount?: number;
  onReconnect: () => void;
  onLibraryToggle: () => void;
  onNavigateHome?: () => void;
  onNavigateUsbGames?: () => void;
  onNavigateQueue: () => void;
  onNavigateBrowse: () => void;
  onNavigateSettings: () => void;
  onNavigateIso2God: () => void;
  onNavigateIso2Xex: () => void;
  onNavigateFtpManager: () => void;
  onNavigateBadAvatarUsb: () => void;
  simpleMode?: boolean;
}

export default function MainNav({
  ftpStatus,
  currentPage,
  libraryAvailable,
  libraryLoading,
  queueJobs,
  usbGamesCount,
  onReconnect,
  onLibraryToggle,
  onNavigateHome,
  onNavigateUsbGames,
  onNavigateQueue,
  onNavigateBrowse,
  onNavigateSettings,
  onNavigateIso2God,
  onNavigateIso2Xex,
  onNavigateFtpManager,
  onNavigateBadAvatarUsb,
  simpleMode = true,
}: MainNavProps) {
  const ftpChecking  = ftpStatus === "checking";
  const showLibBtn   = libraryAvailable || libraryLoading;
  const hasQueueJobs = Array.isArray(queueJobs) && queueJobs.length > 0;
  const onHome       = currentPage === "home";

  const activeBtnClass = "ring-1 ring-accent ring-offset-1 ring-offset-background";

  if (currentPage === "badavatarusb" && !simpleMode) {
    return (
      <div className="flex items-center">
        <ToolboxDropdown
          onIso2God={onNavigateIso2God}
          onIso2Xex={onNavigateIso2Xex}
          onFtpManager={onNavigateFtpManager}
          onBadAvatarUsb={onNavigateBadAvatarUsb}
          onBrowse={onNavigateBrowse}
          onSettings={onNavigateSettings}
          simpleMode
        />
      </div>
    );
  }

  if (simpleMode) {
    return (
      <div className="flex items-center gap-1.5">
        <FtpIndicator status={ftpStatus} />

        <Button
          size="sm"
          title="Início"
          aria-label="Início"
          variant={currentPage === "home" ? "primary" : "default"}
          onClick={onNavigateHome}
          className={cn(
            "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
            currentPage === "home" && activeBtnClass
          )}
        >
          <Home className="h-4 w-4 text-sky-400" />
          <span className="hidden sm:inline">Início</span>
        </Button>

        {onNavigateUsbGames && (
          <Button
            size="sm"
            title="Jogos Instalados"
            aria-label="Jogos Instalados"
            variant={currentPage === "usb-games" ? "primary" : "default"}
            onClick={onNavigateUsbGames}
            className={cn(
              "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
              currentPage === "usb-games" && activeBtnClass
            )}
          >
            <Usb className="h-4 w-4 text-emerald-400" />
            <span className="hidden sm:inline">Jogos Instalados</span>
            {typeof usbGamesCount === "number" && usbGamesCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                {usbGamesCount}
              </span>
            )}
          </Button>
        )}

        {showLibBtn && (
          <Button
            size="sm"
            title={libraryLoading ? "Conectando ao Xbox…" : "Biblioteca do Xbox"}
            aria-label={libraryLoading ? "Conectando ao Xbox…" : "Biblioteca do Xbox"}
            disabled={libraryLoading}
            variant={currentPage === "library" ? "primary" : "default"}
            onClick={onLibraryToggle}
            className={cn(
              "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
              currentPage === "library" && activeBtnClass
            )}
          >
            {libraryLoading
              ? <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
              : <Gamepad2 className="h-4 w-4 text-purple-400" />}
            <span className="hidden sm:inline">Biblioteca Xbox</span>
          </Button>
        )}

        {hasQueueJobs && (
          <Button
            size="sm"
            title={`Fila de tarefas (${queueJobs.length} tarefa${queueJobs.length !== 1 ? "s" : ""})`}
            aria-label={`Fila de tarefas (${queueJobs.length} tarefa${queueJobs.length !== 1 ? "s" : ""})`}
            variant={currentPage === "queue" ? "primary" : "default"}
            onClick={onNavigateQueue}
            className={cn(
              "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
              currentPage === "queue" && activeBtnClass
            )}
          >
            <ListOrdered className="h-4 w-4 text-amber-400" />
            <span className="hidden sm:inline">Fila</span>
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold">
              {queueJobs.length > 9 ? "9+" : queueJobs.length}
            </span>
          </Button>
        )}

        <Button
          size="sm"
          title="Baixar Jogos"
          aria-label="Baixar Jogos"
          variant={currentPage === "browse" ? "primary" : "default"}
          onClick={onNavigateBrowse}
          className={cn(
            "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
            currentPage === "browse" && activeBtnClass
          )}
        >
          <Store className="h-4 w-4 text-blue-400" />
          <span className="hidden sm:inline">Baixar Jogos</span>
        </Button>

        <Button
          size="sm"
          title="Configurações"
          aria-label="Configurações"
          variant={currentPage === "settings" ? "primary" : "default"}
          onClick={onNavigateSettings}
          className={cn(
            "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
            currentPage === "settings" && activeBtnClass
          )}
        >
          <Settings className="h-4 w-4 text-slate-400" />
          <span className="hidden sm:inline">Configurações</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <FtpIndicator status={ftpStatus} />

      <Button
        size="sm"
        title="Reconectar FTP"
        aria-label="Reconectar FTP"
        disabled={ftpChecking}
        onClick={onReconnect}
        className="flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg cursor-pointer"
      >
        {ftpChecking
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="hidden md:inline">Reconectar</span>
      </Button>

      {!onHome && (
        <Button
          size="sm"
          title="Console"
          aria-label="Console"
          variant={currentPage === "home" ? "primary" : "default"}
          onClick={onNavigateHome || onLibraryToggle}
          className={cn(
            "flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg cursor-pointer",
            currentPage === "home" && activeBtnClass
          )}
        >
          <Terminal className="h-4 w-4 text-sky-400" />
          <span className="hidden sm:inline">Console</span>
        </Button>
      )}

      {onNavigateUsbGames && (
        <Button
          size="sm"
          title="Jogos Instalados"
          aria-label="Jogos Instalados"
          variant={currentPage === "usb-games" ? "primary" : "default"}
          onClick={onNavigateUsbGames}
          className={cn(
            "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
            currentPage === "usb-games" && activeBtnClass
          )}
        >
          <Usb className="h-4 w-4 text-emerald-400" />
          <span className="hidden sm:inline">Jogos Instalados</span>
          {typeof usbGamesCount === "number" && usbGamesCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
              {usbGamesCount}
            </span>
          )}
        </Button>
      )}

      {showLibBtn && (
        <Button
          size="sm"
          title={libraryLoading ? "Conectando ao Xbox…" : "Biblioteca do Xbox"}
          aria-label={libraryLoading ? "Conectando ao Xbox…" : "Biblioteca do Xbox"}
          disabled={libraryLoading}
          variant={currentPage === "library" ? "primary" : "default"}
          onClick={onLibraryToggle}
          className={cn(
            "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
            currentPage === "library" && activeBtnClass
          )}
        >
          {libraryLoading
            ? <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
            : <Gamepad2 className="h-4 w-4 text-purple-400" />}
          <span className="hidden sm:inline">Biblioteca Xbox</span>
        </Button>
      )}

      {hasQueueJobs && (
        <Button
          size="sm"
          title={`Fila de tarefas (${queueJobs.length} tarefa${queueJobs.length !== 1 ? "s" : ""})`}
          aria-label={`Fila de tarefas (${queueJobs.length} tarefa${queueJobs.length !== 1 ? "s" : ""})`}
          variant={currentPage === "queue" ? "primary" : "default"}
          onClick={onNavigateQueue}
          className={cn(
            "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
            currentPage === "queue" && activeBtnClass
          )}
        >
          <ListOrdered className="h-4 w-4 text-amber-400" />
          <span className="hidden sm:inline">Fila</span>
          <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold">
            {queueJobs.length > 9 ? "9+" : queueJobs.length}
          </span>
        </Button>
      )}

      <Button
        size="sm"
        title="Baixar Jogos"
        aria-label="Baixar Jogos"
        variant={currentPage === "browse" ? "primary" : "default"}
        onClick={onNavigateBrowse}
        className={cn(
          "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
          currentPage === "browse" && activeBtnClass
        )}
      >
        <Store className="h-4 w-4 text-blue-400" />
        <span className="hidden sm:inline">Baixar Jogos</span>
      </Button>

      <ToolboxDropdown
        onIso2God={onNavigateIso2God}
        onIso2Xex={onNavigateIso2Xex}
        onFtpManager={onNavigateFtpManager}
        onBadAvatarUsb={onNavigateBadAvatarUsb}
        active={currentPage === "iso2god" || currentPage === "iso2xex" || currentPage === "ftpmanager" || currentPage === "badavatarusb"}
      />

      <Button
        size="sm"
        title="Reiniciar serviço"
        aria-label="Reiniciar serviço"
        onClick={() => window.godsendApi.restartProcess()}
        className="flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg cursor-pointer"
      >
        <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="hidden md:inline">Reiniciar</span>
      </Button>

      <Button
        size="sm"
        title="Configurações"
        aria-label="Configurações"
        variant={currentPage === "settings" ? "primary" : "default"}
        onClick={onNavigateSettings}
        className={cn(
          "relative flex items-center gap-1.5 h-8 px-2.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer",
          currentPage === "settings" && activeBtnClass
        )}
      >
        <Settings className="h-4 w-4 text-slate-400" />
        <span className="hidden sm:inline">Configurações</span>
      </Button>
    </div>
  );
}
