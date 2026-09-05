import React, { useState, useEffect } from "react";
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, X, RefreshCw, Zap, HardDrive } from "lucide-react";
import { Button } from "./ui/button";

interface FakeDriveProbeModalProps {
  open: boolean;
  driveRoot: string;
  driveLabel?: string;
  driveSizeBytes?: number;
  onClose: () => void;
}

interface ProbeProgress {
  phase: string;
  percent: number;
  currentGb: number;
  totalGb: number;
  status: string;
  detail?: string;
}

export default function FakeDriveProbeModal({
  open,
  driveRoot,
  driveLabel,
  driveSizeBytes,
  onClose,
}: FakeDriveProbeModalProps) {
  const [running, setRunning] = useState(false);
  const [fastMode, setFastMode] = useState(true);
  const [progress, setProgress] = useState<ProbeProgress | null>(null);
  const [result, setResult] = useState<{
    ok: boolean;
    authentic: boolean;
    wrapAroundDetected: boolean;
    readErrorsDetected: boolean;
    summary: string;
    details: string;
    realCapacityEstimateBytes?: number;
    advertisedSizeBytes?: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setRunning(false);
      setProgress(null);
      setResult(null);
      return;
    }

    const removeListener = window.godsendApi.onDriveProbeProgress((data: ProbeProgress) => {
      if (data) {
        setProgress(data);
      }
    });

    return () => {
      removeListener?.();
    };
  }, [open]);

  if (!open) return null;

  async function handleStartProbe() {
    setRunning(true);
    setProgress({
      phase: "init",
      percent: 0,
      currentGb: 0,
      totalGb: 0,
      status: "Iniciando verificação de autenticidade...",
    });
    setResult(null);

    try {
      const res = await window.godsendApi.toolsDriveProbeFake(driveRoot, fastMode);
      if (res && res.result) {
        setResult(res.result);
      } else {
        setResult({
          ok: false,
          authentic: false,
          wrapAroundDetected: false,
          readErrorsDetected: true,
          summary: res?.error || "Falha ao executar teste de capacidade.",
          details: res?.error || "O teste não pôde ser concluído.",
        });
      }
    } catch (err: any) {
      setResult({
        ok: false,
        authentic: false,
        wrapAroundDetected: false,
        readErrorsDetected: true,
        summary: err?.message || "Erro inesperado durante o teste.",
        details: err?.message || "O teste foi interrompido.",
      });
    } finally {
      setRunning(false);
    }
  }

  async function handleCancelProbe() {
    try {
      await window.godsendApi.toolsDriveProbeFakeCancel();
    } catch {}
    setRunning(false);
  }

  const driveGb = driveSizeBytes && driveSizeBytes > 0 ? (driveSizeBytes / (1024 ** 3)).toFixed(1) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
      <div className="card-surface w-full max-w-xl flex flex-col max-h-[85vh] rounded-2xl shadow-2xl border border-border/80 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">Testar Autenticidade e Capacidade Real</h2>
              <p className="text-[11px] text-muted-foreground font-mono">
                Unidade: {driveRoot} {driveLabel ? `[${driveLabel}]` : ""} {driveGb ? `(${driveGb} GB)` : ""}
              </p>
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
            <HardDrive className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              Este teste grava e valida pequenos blocos de verificação (com SHA-256) em posições estratégicas da memória. Se o pendrive tiver chip reprogramado (capacidade adulterada), o teste detectará a sobrescrita imediata do setor inicial sem danificar seus arquivos existentes.
            </div>
          </div>

          {/* Option: Fast Mode */}
          {!running && !result && (
            <div className="rounded-xl border border-border/60 bg-surface p-3 flex items-center justify-between">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-amber-400" />
                  Modo Rápido (Recomendado)
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Valida 6 checkpoints ao longo de toda a capacidade em menos de 1 minuto.
                </span>
              </div>
              <input
                type="checkbox"
                checked={fastMode}
                onChange={(e) => setFastMode(e.target.checked)}
                className="h-4 w-4 accent-emerald-500 rounded cursor-pointer"
              />
            </div>
          )}

          {/* Progress Bar while running */}
          {running && progress && (
            <div className="flex flex-col gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 animate-fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground">{progress.status}</span>
                <span className="font-mono text-emerald-400 font-bold">{progress.percent}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300 rounded-full"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              {progress.detail && (
                <span className="text-[11px] text-muted-foreground font-mono">{progress.detail}</span>
              )}
            </div>
          )}

          {/* Result Card */}
          {result && (
            <div
              className={`rounded-xl border p-4 text-xs flex flex-col gap-2.5 animate-fade-in ${
                result.authentic
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : result.wrapAroundDetected
                  ? "border-red-500/40 bg-red-500/15 text-red-200"
                  : "border-amber-500/40 bg-amber-500/15 text-amber-200"
              }`}
            >
              <div className="flex items-start gap-2.5">
                {result.authentic ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                ) : result.wrapAroundDetected ? (
                  <ShieldAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <h4 className="font-bold text-sm leading-tight mb-1">
                    {result.authentic
                      ? "Pendrive Autêntico e Confiável!"
                      : result.wrapAroundDetected
                      ? "ALERTA: Pendrive com Capacidade Falsificada!"
                      : "Atenção: Inconsistências na Memória Flash"}
                  </h4>
                  <p className="leading-relaxed opacity-90">{result.summary}</p>
                </div>
              </div>

              {result.details && (
                <div className="mt-1 pt-2 border-t border-current/20 text-[11px] opacity-80 leading-relaxed font-mono">
                  {result.details}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-border/60 px-5 py-3.5 bg-muted/20 flex items-center justify-end gap-2.5">
          {running ? (
            <Button variant="ghost" size="sm" onClick={handleCancelProbe} className="text-red-400 hover:text-red-300 cursor-pointer">
              Cancelar Teste
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onClose} className="cursor-pointer">
              Fechar
            </Button>
          )}

          {!running && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleStartProbe}
              className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>{result ? "Testar Novamente" : "Iniciar Teste de Autenticidade"}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
