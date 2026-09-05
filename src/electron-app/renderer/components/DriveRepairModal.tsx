import React, { useState, useEffect, useRef } from "react";
import { Wrench, CheckCircle2, AlertTriangle, X, Terminal, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "./ui/button";

interface DriveRepairModalProps {
  open: boolean;
  driveRoot: string;
  onClose: () => void;
  onRepairCompleted?: () => void;
}

export default function DriveRepairModal({
  open,
  driveRoot,
  onClose,
  onRepairCompleted,
}: DriveRepairModalProps) {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<{ ok: boolean; summary: string; repaired: boolean } | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setRunning(false);
      setLogs([]);
      setResult(null);
      return;
    }

    const removeListener = window.godsendApi.onDriveRepairProgress((data) => {
      if (data && data.line) {
        setLogs((prev) => [...prev, data.line]);
      }
    });

    return () => {
      removeListener?.();
    };
  }, [open]);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  if (!open) return null;

  async function handleStartRepair() {
    setRunning(true);
    setLogs([`[INÍCIO] Iniciando verificação e reparo de sistema de arquivos em ${driveRoot}...`]);
    setResult(null);

    try {
      const res = await window.godsendApi.toolsDriveRepair(driveRoot);
      if (res && res.result) {
        setResult({
          ok: res.ok,
          summary: res.result.summary || "Reparo finalizado.",
          repaired: res.result.repaired,
        });
      } else {
        setResult({
          ok: false,
          summary: res?.error || "Falha ao executar reparo de disco.",
          repaired: false,
        });
      }
      onRepairCompleted?.();
    } catch (err: any) {
      setResult({
        ok: false,
        summary: err?.message || "Erro inesperado durante o reparo.",
        repaired: false,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
      <div className="card-surface w-full max-w-xl flex flex-col max-h-[85vh] rounded-2xl shadow-2xl border border-border/80 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Wrench className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Reparar Sistema de Arquivos (CHKDSK)</h2>
              <p className="text-[11px] text-muted-foreground font-mono">Unidade alvo: {driveRoot}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={running}
            onClick={onClose}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content Body */}
        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          <div className="rounded-xl border border-border/60 bg-muted/15 p-3.5 text-xs text-muted-foreground leading-relaxed flex items-start gap-2.5">
            <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              O utilitário CHKDSK verificará todas as tabelas de alocação FAT32, corrigirá ponteiros de cluster desincronizados e removerá ou recuperará entradas de arquivos corrompidas.
            </div>
          </div>

          {/* Terminal output box */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground font-medium px-1">
              <span className="flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                Saída do Reparo
              </span>
              {running && (
                <span className="flex items-center gap-1.5 text-amber-400">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Reparando...
                </span>
              )}
            </div>
            <div
              ref={terminalRef}
              className="h-48 w-full rounded-xl bg-black/90 p-3 font-mono text-[11px] text-zinc-300 overflow-y-auto border border-white/10 space-y-1 select-text shadow-inner"
            >
              {logs.length === 0 ? (
                <span className="text-zinc-500">Clique em &quot;Iniciar Reparo&quot; para iniciar o CHKDSK na unidade {driveRoot}...</span>
              ) : (
                logs.map((line, idx) => (
                  <div key={idx} className="break-all whitespace-pre-wrap leading-tight">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Result Banner */}
          {result && (
            <div
              className={`rounded-xl border p-3.5 text-xs flex items-start gap-2.5 animate-fade-in ${
                result.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              }`}
            >
              {result.ok ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 font-medium">{result.summary}</div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-border/60 px-5 py-3.5 bg-muted/20 flex items-center justify-end gap-2.5">
          <Button variant="ghost" size="sm" disabled={running} onClick={onClose} className="cursor-pointer">
            Fechar
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={running}
            onClick={handleStartRepair}
            className="gap-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold cursor-pointer"
          >
            {running ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Reparando Unidade...</span>
              </>
            ) : (
              <>
                <Wrench className="h-3.5 w-3.5" />
                <span>Iniciar Reparo</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
