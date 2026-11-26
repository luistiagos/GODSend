import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Gamepad2,
  HardDrive,
  Info,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Usb,
} from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { formatErrorForUser } from "../../infrastructure/userFriendlyError.ts";
import {
  isSmallCapacityForXeniaGames,
  XBOX_ONE_SERIES_MBR_MAX_BYTES,
} from "../../infrastructure/xboxOneSeriesDiskLayoutPolicy.ts";
import {
  XENIA_DEVICE_STATE_BADGE,
} from "../../services/preparedDeviceCopy.ts";
import type {
  PreparedDeviceState,
  XboxOneSeriesDeviceState,
} from "../../services/preparedUsbDetection.ts";

interface XeniaMountedDrive {
  rootPath: string;
  label: string;
  sizeBytes: number;
  fingerprint?: string;
  friendlyName?: string;
  manufacturer?: string;
  fileSystem?: string;
  freeBytes?: number;
  diskNumber?: number;
  volumeGuid?: string;
  safety?: {
    allowed: boolean;
    codes?: string[];
    reasons: string[];
  };
  preparedState?: PreparedDeviceState;
  xboxOneSeriesState?: XboxOneSeriesDeviceState;
}

interface UnassignedDisk {
  diskNumber: number;
  friendlyName: string;
  manufacturer: string;
  sizeBytes: number;
  partitionStyle: string;
  diskUniqueId: string;
  serialNumber: string;
  operationalStatus: string;
  isOffline: boolean;
  isReadOnly: boolean;
}

const BLOCK_REASONS: Record<string, string> = {
  NOT_USB: "Este disco fica dentro do computador e não é um pendrive ou HD externo. Escolha um pendrive ou HD ligado na entrada USB.",
  BOOT_OR_SYSTEM: "Este é o disco do Windows. Por segurança ele nunca é alterado — escolha um pendrive ou HD ligado na entrada USB.",
  WINDOWS_VOLUME: "Esta é a unidade onde o Windows está instalado. Escolha um pendrive ou HD ligado na entrada USB.",
  DISK_ZERO: "Este é o disco principal do computador. Escolha um pendrive ou HD ligado na entrada USB.",
  READ_ONLY: "Este pendrive ou HD está travado contra gravação. Destrave a chavinha física dele e clique em Atualizar.",
  OFFLINE: "Este pendrive ou HD não está pronto no Windows. Desconecte e conecte novamente e clique em Atualizar.",
  AMBIGUOUS_IDENTITY: "O Windows não conseguiu reconhecer este pendrive ou HD corretamente. Troque de porta USB ou use outro dispositivo.",
  INVALID_CAPACITY: "Tamanho não reconhecido ou menor que 1 GB. Use um pendrive ou HD de pelo menos 1 GB.",
  MULTIPLE_MOUNTED_PARTITIONS: "Este dispositivo está dividido em mais de uma unidade. Use outro pendrive/HD ou remova as partições extras antes de preparar.",
};

function blockReason(device?: XeniaMountedDrive): string {
  const code = device?.safety?.codes?.find((c) => BLOCK_REASONS[c]);
  if (code) return BLOCK_REASONS[code];
  return device?.safety?.reasons?.[0] || "Escolha outro pendrive ou HD USB.";
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const tb = bytes / (1024 ** 4);
  if (tb >= 1) return `${tb.toFixed(1)} TB`;
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 ** 2))} MB`;
}

export interface XboxOneSeriesUsbPageProps {
  onBrowseGames?: () => void;
  onBackToPrevious?: () => void;
  embedded?: boolean;
}

export default function XboxOneSeriesUsbPage({
  onBrowseGames,
  onBackToPrevious,
  embedded = false,
}: XboxOneSeriesUsbPageProps) {
  const [drives, setDrives] = useState<XeniaMountedDrive[]>([]);
  const [unassignedDisks, setUnassignedDisks] = useState<UnassignedDisk[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formatDrive, setFormatDrive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [preparedDriveRoot, setPreparedDriveRoot] = useState("");
  const [preparedPartitionStyle, setPreparedPartitionStyle] = useState("");
  const [ejecting, setEjecting] = useState(false);
  const [ejected, setEjected] = useState(false);
  const [ejectError, setEjectError] = useState("");

  const refreshDevices = useCallback(async (manual = false) => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await window.godsendApi.toolsXeniaListDrives({ fresh: manual });
      if (!res?.ok) {
        setDrives([]);
        setUnassignedDisks([]);
        setSelectedKey("");
        setLoadError(res?.error || "Não foi possível procurar dispositivos USB.");
        return;
      }
      const nextDrives: XeniaMountedDrive[] = Array.isArray(res.drives) ? res.drives : [];
      const nextUnassigned: UnassignedDisk[] = Array.isArray(res.unassignedDisks) ? res.unassignedDisks : [];
      setDrives(nextDrives);
      setUnassignedDisks(nextUnassigned);

      setSelectedKey((current) => {
        const allKeys = [
          ...nextDrives.map((d) => `vol:${d.rootPath}`),
          ...nextUnassigned.map((u) => `disk:${u.diskNumber}`),
        ];
        if (current && allKeys.includes(current)) return current;
        const preferredXenia = nextDrives.find((d) => d.xboxOneSeriesState === "preparado-xenia" && d.safety?.allowed);
        if (preferredXenia) return `vol:${preferredXenia.rootPath}`;
        const preferredSafe = nextDrives.find((d) => d.safety?.allowed);
        if (preferredSafe) return `vol:${preferredSafe.rootPath}`;
        if (nextUnassigned.length > 0) return `disk:${nextUnassigned[0].diskNumber}`;
        return allKeys[0] || "";
      });
    } catch (err: any) {
      setDrives([]);
      setUnassignedDisks([]);
      setSelectedKey("");
      setLoadError(formatErrorForUser(err, { area: "drive-maintenance" }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDevices(false);
  }, [refreshDevices]);

  useEffect(() => {
    if (!window.godsendApi?.onXeniaPrepareProgress) return undefined;
    return window.godsendApi.onXeniaPrepareProgress(
      (progress: { status?: string; percent?: number; detail?: string }) => {
        setStatus(`${progress.status || "Preparando…"}${progress.detail ? ` · ${progress.detail}` : ""}`);
        setPercent(Number(progress.percent) || 0);
      },
    );
  }, []);

  const selectedMounted = useMemo(
    () => (selectedKey.startsWith("vol:") ? drives.find((d) => `vol:${d.rootPath}` === selectedKey) : undefined),
    [drives, selectedKey],
  );
  const selectedUnassigned = useMemo(
    () => (selectedKey.startsWith("disk:") ? unassignedDisks.find((u) => `disk:${u.diskNumber}` === selectedKey) : undefined),
    [unassignedDisks, selectedKey],
  );

  const isNtfsMounted = Boolean(
    selectedMounted && String(selectedMounted.fileSystem || "").trim().toUpperCase() === "NTFS",
  );
  const isXbox360Drive = selectedMounted?.xboxOneSeriesState === "preparado-outro-console";
  const formatRequired = Boolean(
    selectedUnassigned || !isNtfsMounted || isXbox360Drive,
  );

  // Sempre força formatação quando o volume não é NTFS válido, é de Xbox 360 ou está sem letra.
  useEffect(() => {
    if (formatRequired) {
      setFormatDrive(true);
    }
  }, [formatRequired, selectedKey]);

  const hasStableVolume = Boolean(
    selectedMounted && /^\\\\\?\\Volume\{[0-9a-f-]+\}\\?$/i.test(selectedMounted.volumeGuid || ""),
  );
  const deviceAllowed = selectedMounted
    ? selectedMounted.safety?.allowed === true && hasStableVolume
    : Boolean(selectedUnassigned && !selectedUnassigned.isReadOnly);

  const selectedSizeBytes = selectedMounted?.sizeBytes ?? selectedUnassigned?.sizeBytes ?? 0;
  const isSmallCapacity = isSmallCapacityForXeniaGames(selectedSizeBytes);
  const isOver2Tb = selectedSizeBytes > XBOX_ONE_SERIES_MBR_MAX_BYTES;

  const canPrepare = Boolean(
    (selectedMounted || selectedUnassigned) &&
      deviceAllowed &&
      !loading &&
      !busy &&
      !done,
  );

  async function handlePrepare() {
    if (!canPrepare) return;
    const effectiveFormat = formatRequired || formatDrive;

    if (effectiveFormat) {
      let confirmMsg: string;
      if (selectedUnassigned) {
        confirmMsg =
          `Formatar o HD/Pendrive sem letra (${selectedUnassigned.friendlyName} — ${formatBytes(selectedUnassigned.sizeBytes)}) em NTFS e preparar para o Xbox One / Series (Xenia)?\n\n` +
          `Todos os dados/jogos originais presentes neste dispositivo serão apagados para que ele volte a funcionar no computador e no Xenia.`;
      } else if (isXbox360Drive) {
        confirmMsg =
          `ATENÇÃO: O dispositivo ${selectedMounted?.rootPath} está preparado para o XBOX 360!\n\n` +
          `Formatar em NTFS para o Xbox One / Series vai APAGAR o desbloqueio (BadAvatar/Aurora) e os arquivos do Xbox 360 gravados nele.\n\n` +
          `Deseja continuar e transformar este dispositivo para uso no Xbox One / Series (Xenia)?`;
      } else {
        confirmMsg =
          `Formatar ${selectedMounted?.rootPath} em NTFS e aplicar as permissões do Xbox One / Series (Modo Desenvolvedor / Xenia)?\n\n` +
          `Todos os arquivos existentes nesta unidade serão apagados.`;
      }
      if (!window.confirm(confirmMsg)) return;
    }

    setBusy(true);
    setDone(false);
    setPreparedDriveRoot("");
    setPreparedPartitionStyle("");
    setEjected(false);
    setEjectError("");
    setError("");
    setStatus("Iniciando preparação para Xbox One / Series…");
    setPercent(5);

    try {
      const payload = selectedUnassigned
        ? {
            targetKind: "unassigned-disk",
            diskNumber: selectedUnassigned.diskNumber,
            expectedDiskBytes: selectedUnassigned.sizeBytes,
            expectedDiskUniqueId: selectedUnassigned.diskUniqueId,
            expectedSerialNumber: selectedUnassigned.serialNumber,
            formatDrive: true,
            label: "XENIA_USB",
          }
        : {
            targetKind: "volume",
            driveRoot: selectedMounted!.rootPath,
            expectedDeviceFingerprint: selectedMounted!.fingerprint,
            formatDrive: effectiveFormat,
            label: "XENIA_USB",
          };

      const res = await window.godsendApi.toolsXeniaPrepare(payload);
      if (!res?.ok) {
        throw new Error(res?.error || "Não foi possível preparar o dispositivo para Xbox One / Series.");
      }
      const finalRoot = res.result?.driveRoot || selectedMounted?.rootPath || "";
      setPreparedDriveRoot(finalRoot);
      setPreparedPartitionStyle(res.result?.partitionStyle || "");
      setDone(true);
      setStatus(`Pronto! ${finalRoot} está formatado em NTFS com as permissões do Xbox One / Series verificadas.`);
      setPercent(100);
      await refreshDevices(true);
    } catch (err: any) {
      setError(err?.message || "Não foi possível preparar o dispositivo.");
      await refreshDevices(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleEject() {
    const targetRoot = preparedDriveRoot || selectedMounted?.rootPath;
    if (!targetRoot || ejecting) return;
    setEjecting(true);
    setEjectError("");
    try {
      const res = await window.godsendApi.toolsDriveEject(targetRoot);
      if (res?.ok) {
        setEjected(true);
        await refreshDevices(true);
      } else {
        setEjectError(
          formatErrorForUser(res?.error || "Não foi possível ejetar o dispositivo agora.", {
            area: "drive-maintenance",
            driveRoot: targetRoot,
          }),
        );
      }
    } catch (err: any) {
      setEjectError(formatErrorForUser(err, { area: "drive-maintenance", driveRoot: targetRoot }));
    } finally {
      setEjecting(false);
    }
  }

  const totalDevices = drives.length + unassignedDisks.length;

  return (
    <main className={embedded ? "mx-auto w-full max-w-3xl" : "mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7"}>
      <section className={embedded ? "w-full" : "card-surface overflow-hidden p-4 sm:p-5 md:p-6"}>
        <div className="animate-fade-in flex flex-col gap-4 sm:gap-5">
          <header className="text-center relative">
            {onBackToPrevious && !embedded && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute left-0 top-1 text-muted-foreground hover:text-foreground text-[12px] flex items-center gap-1.5 p-0"
                onClick={onBackToPrevious}
              >
                &larr; Voltar
              </Button>
            )}
            <div className="mx-auto mb-2 inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-300">
              <Gamepad2 className="h-3.5 w-3.5" />
              Xbox One / Xbox Series X|S · Modo Desenvolvedor (Xenia)
            </div>
            <h1 className="font-display text-xl font-bold text-foreground">
              Prepare seu pendrive ou HD para o Xbox One / Series
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Conecte seu pendrive ou HD externo. Vamos formatar em <strong className="text-foreground">NTFS</strong>,
              aplicar todas as permissões que o <strong className="text-foreground">Xenia</strong> exige (sem precisar
              usar o XboxMediaUSB) e testar se ficou tudo funcionando.
            </p>
          </header>

          {/* Seletor de dispositivo */}
          <section className="rounded-xl border border-border/50 bg-background/10 p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <Usb className="h-4 w-4 text-sky-400" />
              <h2 className="text-[13px] font-semibold text-foreground">Dispositivo conectado</h2>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                disabled={loading || busy}
                onClick={() => refreshDevices(true)}
              >
                {loading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5" />}
                Atualizar
              </Button>
            </div>

            {loadError ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-[12px] leading-relaxed text-red-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
                <span>{loadError}</span>
              </div>
            ) : totalDevices === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
                <HardDrive className="h-5 w-5 shrink-0" />
                Conecte um pendrive ou HD externo USB e clique em Atualizar.
              </div>
            ) : (
              <>
                <select
                  aria-label="Pendrive ou HD para Xbox One / Series"
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-sky-500/70"
                  value={selectedKey}
                  disabled={loading || busy}
                  onChange={(event) => {
                    setSelectedKey(event.target.value);
                    setDone(false);
                    setPreparedDriveRoot("");
                    setPreparedPartitionStyle("");
                    setEjected(false);
                    setEjectError("");
                    setStatus("");
                    setError("");
                  }}
                >
                  {drives.map((drive) => (
                    <option key={`vol:${drive.rootPath}`} value={`vol:${drive.rootPath}`}>
                      {drive.rootPath} — {drive.friendlyName || drive.label}
                      {formatBytes(drive.sizeBytes) ? ` (${formatBytes(drive.sizeBytes)})` : ""}
                      {drive.fileSystem ? ` · ${drive.fileSystem}` : ""}
                      {drive.xboxOneSeriesState === "preparado-xenia"
                        ? " [Pronto Xenia]"
                        : drive.xboxOneSeriesState === "preparado-outro-console"
                          ? " [Xbox 360]"
                          : ""}
                    </option>
                  ))}
                  {unassignedDisks.map((disk) => (
                    <option key={`disk:${disk.diskNumber}`} value={`disk:${disk.diskNumber}`}>
                      HD/Pendrive USB (Sem letra / Formato Xbox) — {disk.friendlyName}
                      {formatBytes(disk.sizeBytes) ? ` (${formatBytes(disk.sizeBytes)})` : ""}
                    </option>
                  ))}
                </select>

                {/* Metadados do dispositivo selecionado */}
                {selectedMounted && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/45 px-3 py-2.5 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {[selectedMounted.manufacturer, selectedMounted.friendlyName || selectedMounted.label]
                        .filter(Boolean)
                        .join(" ") || selectedMounted.rootPath}
                    </span>
                    {selectedMounted.fileSystem && <span>{selectedMounted.fileSystem}</span>}
                    {formatBytes(selectedMounted.freeBytes) && (
                      <span>{formatBytes(selectedMounted.freeBytes)} livres</span>
                    )}
                    <span className={deviceAllowed ? "text-sky-400" : "text-red-300"}>
                      {deviceAllowed ? "Pronto para preparar" : "Não pode ser usado"}
                    </span>
                  </div>
                )}

                {selectedUnassigned && (
                  <div className="mt-3 rounded-lg border border-sky-500/35 bg-sky-950/20 px-3 py-3 text-[12px] text-sky-100 flex items-start gap-2.5">
                    <Info className="h-4 w-4 shrink-0 text-sky-400 mt-0.5" />
                    <div>
                      <span className="font-semibold block text-sky-300">
                        HD/Pendrive detectado sem letra no Windows (provavelmente formatado pelo Xbox)
                      </span>
                      Se você conectou este HD no Xbox One/Series antes e clicou em “Formatar para Jogos e Aplicativos”,
                      o Windows não mostra a letra dele. Clicando em <strong>Preparar</strong> abaixo, nós recuperamos
                      este dispositivo, formatamos em NTFS e deixamos pronto para o Xenia (os dados anteriores serão apagados).
                    </div>
                  </div>
                )}

                {/* Badge de estado (inclui aviso forte quando é pendrive de Xbox 360!) */}
                {selectedMounted?.xboxOneSeriesState && XENIA_DEVICE_STATE_BADGE[selectedMounted.xboxOneSeriesState] && (() => {
                  const badge = XENIA_DEVICE_STATE_BADGE[selectedMounted.xboxOneSeriesState]!;
                  const green = badge.tone === "green";
                  return (
                    <div
                      className={`mt-3 rounded-lg border px-3 py-3 text-[12px] text-gray-200 flex items-start gap-2.5 ${
                        green
                          ? "border-emerald-500/35 bg-emerald-950/20"
                          : "border-amber-500/40 bg-amber-950/20"
                      }`}
                    >
                      {green
                        ? <Check className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                        : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />}
                      <div>
                        <span className={`font-semibold block ${green ? "text-emerald-400" : "text-amber-400"}`}>
                          {badge.title}
                        </span>
                        {badge.detail}
                      </div>
                    </div>
                  );
                })()}

                {/* Aviso leve não-bloqueante para dispositivos < 16 GB (G7) */}
                {isSmallCapacity && (
                  <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-950/15 px-3 py-2.5 text-[11.5px] text-amber-200 flex items-start gap-2.5">
                    <Info className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <span className="font-semibold text-amber-300">Espaço reduzido ({formatBytes(selectedSizeBytes)}):</span>{" "}
                      Você pode preparar normalmente, mas jogos de Xbox 360 costumam ocupar entre 6 GB e 8 GB cada. Para guardar vários jogos, recomendamos um pendrive ou HD de pelo menos 32 GB ou mais.
                    </div>
                  </div>
                )}

                {/* Nota positiva para HDs > 2 TB (GPT automático, G7) */}
                {isOver2Tb && (
                  <div className="mt-3 rounded-lg border border-sky-500/30 bg-sky-950/15 px-3 py-2.5 text-[11.5px] text-sky-200 flex items-start gap-2.5">
                    <Check className="h-4 w-4 shrink-0 text-sky-400 mt-0.5" />
                    <div>
                      <span className="font-semibold text-sky-300">Capacidade total aproveitada ({formatBytes(selectedSizeBytes)}):</span>{" "}
                      Diferente do Xbox 360, o Xbox One / Series aceita discos acima de 2 TB — vamos formatar automaticamente em <strong>GPT + NTFS</strong> para liberar todo o espaço do seu HD.
                    </div>
                  </div>
                )}

                {selectedMounted && !deviceAllowed && (
                  <p className="mt-2 text-[11px] leading-relaxed text-red-300">
                    {!hasStableVolume && selectedMounted.safety?.allowed
                      ? "O Windows ainda não forneceu a identificação completa deste volume. Clique em Atualizar ou reconecte o dispositivo."
                      : blockReason(selectedMounted)}
                  </p>
                )}
              </>
            )}
          </section>

          {/* Cards de ação */}
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/50 bg-background/10 flex items-start gap-3 p-4">
              <div className="mt-0.5 rounded-lg bg-sky-500/10 p-2 text-sky-400">
                <Check className="h-4 w-4" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-foreground">
                  NTFS + Permissões Xbox + Pastas Xenia
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Aplica automaticamente todas as permissões do Modo Desenvolvedor (substituindo o XboxMediaUSB),
                  cria <code>Games</code> e <code>Content</code> e valida o acesso antes de concluir.
                </p>
              </div>
            </div>

            <label
              className={`rounded-xl border border-border/50 bg-background/10 flex items-start gap-3 p-4 ${
                formatRequired || !deviceAllowed ? "opacity-80" : "cursor-pointer"
              }`}
            >
              <Checkbox
                checked={formatRequired ? true : formatDrive}
                disabled={formatRequired || !deviceAllowed || loading || busy}
                onCheckedChange={(value) => setFormatDrive(value === true)}
                className="mt-0.5"
              />
              <span>
                <span className="text-[13px] font-semibold text-foreground">
                  {formatRequired ? "Formatar em NTFS (obrigatório)" : "Formatar e preparar do zero (NTFS)"}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                  {selectedUnassigned
                    ? "Obrigatório para recuperar este HD sem letra e formatá-lo em NTFS."
                    : isXbox360Drive
                      ? "Obrigatório porque este pendrive está em FAT32 para Xbox 360 — o Xbox One / Series exige NTFS."
                      : !isNtfsMounted
                        ? `Obrigatório porque o dispositivo está em ${selectedMounted?.fileSystem || "outro formato"} — o Xenia exige NTFS.`
                        : "Opcional. Desmarque se quiser apenas corrigir/reaplicar as permissões do Xenia preservando os jogos que já estão neste HD NTFS."}
                </span>
              </span>
            </label>
          </section>

          {/* Guias rápidos para leigos */}
          <details className="rounded-lg border border-amber-500/35 bg-amber-500/5 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
            <summary className="cursor-pointer font-medium text-amber-200">
              ⚠️ MUITO IMPORTANTE ao conectar o HD no Xbox One / Series (Leia antes!)
            </summary>
            <div className="mt-2 space-y-2 text-amber-100/90">
              <p>
                Quando você plugar este pendrive ou HD no <strong>Xbox One ou Xbox Series</strong>, o videogame vai mostrar
                uma tela perguntando como deseja usar o dispositivo:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  Escolha sempre <strong>“Usar para Mídia”</strong> (ou aperte <strong>B</strong> para fechar a mensagem).
                </li>
                <li>
                  <strong>NUNCA clique em “Formatar dispositivo de armazenamento”</strong> no console! Se clicar nisso, o Xbox
                  apaga todos os jogos e trava o HD só para jogos originais (e o PC deixa de enxergá-lo).
                </li>
              </ul>
            </div>
          </details>

          <details className="rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">
              Como abrir os jogos (e DLCs / XBLA) no Xenia no Xbox One / Series?
            </summary>
            <ol className="mt-2.5 list-decimal space-y-1.5 pl-4">
              <li>
                No computador, depois de preparar aqui, clique em <strong>Adicionar jogos</strong> e baixe os títulos que quiser direto para este pendrive/HD.
              </li>
              <li>
                Quando terminar a fila de downloads, clique em <strong>Ejetar pendrive/HD com segurança</strong> antes de retirar do PC.
              </li>
              <li>
                Conecte o pendrive/HD na entrada USB do Xbox One/Series (preferencialmente USB 3.0) com o <strong>Modo Desenvolvedor</strong> ativado.
              </li>
              <li>
                Abra o <strong>Xenia</strong>, selecione abrir jogo e navegue até a unidade externa (geralmente <code>E:\Games\</code>).
              </li>
              <li>
                <strong>DLCs, XBLA e Disco 1 (ex.: GTA V):</strong> o aplicativo salva esses pacotes automaticamente em <code>Content\0000000000000000\</code>. No Xenia, você pode apontar a pasta de conteúdo ou usar <em>Install Content</em> escolhendo os arquivos dessa pasta.
              </li>
            </ol>
          </details>

          {/* Botão principal */}
          <div>
            <Button
              variant="primary"
              className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 text-white"
              disabled={!canPrepare}
              onClick={handlePrepare}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : done ? (
                <Check className="h-4 w-4" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {busy
                ? "Preparando para Xbox One / Series…"
                : done
                  ? "Dispositivo pronto para o Xenia!"
                  : formatRequired || formatDrive
                    ? "Formatar e preparar para Xbox One / Series"
                    : "Corrigir permissões (preservando jogos)"}
            </Button>
          </div>

          {/* Progresso e conclusão */}
          {(busy || status || error || done) && (
            <div
              className={`rounded-lg border px-3.5 py-3 ${
                error
                  ? "border-red-500/30 bg-red-500/10"
                  : done
                    ? "border-sky-500/40 bg-sky-950/20"
                    : "border-border bg-muted/30"
              }`}
            >
              <div
                className="h-2 overflow-hidden rounded-full bg-background"
                role="progressbar"
                aria-label="Progresso da preparação Xbox One / Series"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.max(0, Math.min(100, Math.round(percent)))}
              >
                <div
                  className={`h-full transition-all duration-300 ${error ? "bg-red-500" : "bg-sky-500"}`}
                  style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
                />
              </div>
              <p
                className={`mt-2 text-[11.5px] ${
                  error ? "text-red-300" : done ? "text-sky-300 font-medium" : "text-muted-foreground"
                }`}
                aria-live="polite"
              >
                {error || status}
              </p>

              {done && !error && (
                <>
                  <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[11.5px] leading-relaxed text-amber-200">
                    <strong className="block text-amber-300 mb-1">
                      ⚠️ Lembrete obrigatório ao plugar no Xbox One / Series:
                    </strong>
                    Quando o console perguntar como usar este dispositivo, escolha sempre{" "}
                    <strong>Usar para Mídia</strong> (ou aperte B). <strong>NUNCA</strong> clique em “Formatar dispositivo de armazenamento”.
                  </div>

                  <p className="mt-2.5 text-[11.5px] leading-relaxed text-gray-200">
                    Tudo verificado{preparedPartitionStyle ? ` (NTFS · ${preparedPartitionStyle} · permissões ALL APPLICATION PACKAGES confirmadas)` : ""}!
                    Agora clique em <strong>Adicionar jogos</strong> abaixo para baixar jogos direto para este dispositivo — ou clique em <strong>Ejetar com segurança</strong> se já quiser levar ao console.
                  </p>

                  {ejected ? (
                    <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[11.5px] font-medium text-emerald-300">
                      <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                      <span>Dispositivo ejetado com segurança! Você já pode removê-lo do PC e conectar no Xbox One / Series.</span>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-col gap-2">
                      {onBrowseGames && (
                        <Button
                          className="h-10 w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                          onClick={onBrowseGames}
                        >
                          <Gamepad2 className="h-4 w-4 mr-1.5" />
                          Adicionar jogos (Xbox One / Series)
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="h-10 w-full border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20"
                        disabled={ejecting || !(preparedDriveRoot || selectedMounted?.rootPath)}
                        onClick={handleEject}
                      >
                        {ejecting ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        ) : (
                          <LogOut className="h-4 w-4 mr-1.5" />
                        )}
                        {ejecting ? "Ejetando com segurança…" : "Ejetar pendrive/HD com segurança"}
                      </Button>
                      {ejectError && (
                        <p className="text-[11px] leading-relaxed text-amber-300">{ejectError}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
