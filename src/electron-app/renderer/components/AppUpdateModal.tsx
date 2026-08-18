import { useState, useEffect } from "react";
import { Sparkles, Download, CheckCircle2, AlertCircle, X, Loader2, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseDate?: string;
  notes?: string;
  downloadUrl?: string;
  sha256?: string;
  size?: number;
}

interface AppUpdateModalProps {
  updateInfo: UpdateInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onDismissVersion?: (version: string) => void;
}

type ModalState = "prompt" | "downloading" | "downloaded" | "error";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

export default function AppUpdateModal({
  updateInfo,
  isOpen,
  onClose,
  onDismissVersion,
}: AppUpdateModalProps) {
  const [modalState, setModalState] = useState<ModalState>("prompt");
  const [progressPercent, setProgressPercent] = useState(0);
  const [bytesDownloaded, setBytesDownloaded] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState(0);
  const [downloadedFilePath, setDownloadedFilePath] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setModalState("prompt");
      setProgressPercent(0);
      setBytesDownloaded(0);
      setTotalBytes(updateInfo?.size || 0);
      setDownloadSpeed(0);
      setErrorMessage("");
      setIsApplying(false);
    }
  }, [isOpen, updateInfo]);

  useEffect(() => {
    const cleanup = window.godsendApi.onUpdateDownloadProgress((progress: any) => {
      setProgressPercent(progress.percent || 0);
      setBytesDownloaded(progress.bytesDownloaded || 0);
      if (progress.totalBytes) setTotalBytes(progress.totalBytes);
      setDownloadSpeed(progress.speedBytesPerSec || 0);
    });
    return () => cleanup();
  }, []);

  if (!isOpen || !updateInfo) return null;

  async function handleStartDownload() {
    if (!updateInfo?.downloadUrl) {
      setErrorMessage("URL de download indisponível no manifesto.");
      setModalState("error");
      return;
    }

    setModalState("downloading");
    setErrorMessage("");
    setProgressPercent(0);

    try {
      const res = await window.godsendApi.downloadUpdate({
        downloadUrl: updateInfo.downloadUrl,
        sha256: updateInfo.sha256,
        size: updateInfo.size,
      });

      if (!res.ok) {
        setErrorMessage(res.error || "Falha ao baixar atualização.");
        setModalState("error");
        return;
      }

      setDownloadedFilePath(res.filePath || "");
      setModalState("downloaded");
    } catch (err: any) {
      setErrorMessage(err.message || String(err));
      setModalState("error");
    }
  }

  async function handleCancelDownload() {
    try {
      await window.godsendApi.cancelUpdateDownload();
    } catch {}
    setModalState("prompt");
  }

  async function handleApplyAndRestart() {
    setIsApplying(true);
    try {
      await window.godsendApi.applyUpdateAndRestart(downloadedFilePath);
    } catch (err: any) {
      setIsApplying(false);
      setErrorMessage(err.message || "Falha ao reiniciar para atualização.");
      setModalState("error");
    }
  }

  function handleDismiss() {
    if (onDismissVersion && updateInfo?.latestVersion) {
      onDismissVersion(updateInfo.latestVersion);
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#13171e] border border-[#232b38] rounded-xl shadow-2xl max-w-lg w-full overflow-hidden text-foreground">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e242e] bg-[#161c24]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-green-500/10 text-green-400 border border-green-500/20">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-foreground">
                Atualização Disponível
              </h3>
              <p className="text-[11px] text-muted-foreground">
                Xbox 360 Companion • v{updateInfo.latestVersion}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {modalState === "prompt" && (
            <>
              <div className="flex items-center justify-between p-3.5 rounded-lg bg-surface border border-border">
                <div>
                  <span className="text-[11px] text-muted-foreground block">Versão Instalada</span>
                  <span className="text-[13px] font-mono font-medium text-[#cad3dc]">
                    v{updateInfo.currentVersion}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-green-400 font-medium block">Nova Versão</span>
                  <span className="text-[13px] font-mono font-bold text-green-400">
                    v{updateInfo.latestVersion}
                  </span>
                </div>
              </div>

              {updateInfo.releaseDate && (
                <p className="text-[11px] text-muted-foreground">
                  Data de Lançamento: <span className="text-foreground">{updateInfo.releaseDate}</span>
                  {updateInfo.size && (
                    <> • Tamanho: <span className="text-foreground">{formatBytes(updateInfo.size)}</span></>
                  )}
                </p>
              )}

              {updateInfo.notes && (
                <div className="rounded-lg bg-surface/60 border border-border/80 p-3 max-h-36 overflow-y-auto">
                  <p className="text-[11px] font-medium text-[#cad3dc] mb-1">Novidades da versão:</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {updateInfo.notes}
                  </p>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground leading-normal">
                Deseja baixar e aplicar a atualização agora? Seus dados, configurações e histórico serão mantidos.
              </p>
            </>
          )}

          {modalState === "downloading" && (
            <div className="space-y-3 py-2">
              <div className="flex items-center justify-between text-[12px]">
                <span className="text-foreground font-medium flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 text-green-400 animate-bounce" />
                  Baixando atualização...
                </span>
                <span className="font-mono text-green-400 font-bold">{progressPercent}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-2.5 bg-surface rounded-full overflow-hidden border border-border">
                <div
                  className="h-full bg-green-500 transition-all duration-300 rounded-full"
                  style={{ width: `${Math.max(2, progressPercent)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                <span>
                  {formatBytes(bytesDownloaded)} {totalBytes > 0 ? `/ ${formatBytes(totalBytes)}` : ""}
                </span>
                {downloadSpeed > 0 && <span>{formatSpeed(downloadSpeed)}</span>}
              </div>
            </div>
          )}

          {modalState === "downloaded" && (
            <div className="text-center py-3 space-y-3">
              <div className="w-12 h-12 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-[14px] font-semibold text-foreground">
                  Atualização pronta para instalação!
                </h4>
                <p className="text-[11px] text-muted-foreground mt-1">
                  O pacote da versão v{updateInfo.latestVersion} foi baixado e verificado com sucesso via SHA-256.
                </p>
              </div>
            </div>
          )}

          {modalState === "error" && (
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  <span className="font-semibold block mb-0.5">Erro na atualização</span>
                  {errorMessage || "Não foi possível completar a operação de atualização."}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#1e242e] bg-[#161c24]">
          {modalState === "prompt" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                className="text-[12px]"
              >
                Lembrar mais tarde
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleStartDownload}
                className="text-[12px] flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Atualizar agora
              </Button>
            </>
          )}

          {modalState === "downloading" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancelDownload}
              className="text-[12px]"
            >
              Cancelar download
            </Button>
          )}

          {modalState === "downloaded" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-[12px]"
                disabled={isApplying}
              >
                Depois
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleApplyAndRestart}
                disabled={isApplying}
                className="text-[12px] flex items-center gap-1.5"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Reiniciando...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Reiniciar e Atualizar
                  </>
                )}
              </Button>
            </>
          )}

          {modalState === "error" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-[12px]"
              >
                Fechar
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleStartDownload}
                className="text-[12px] flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Tentar novamente
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
