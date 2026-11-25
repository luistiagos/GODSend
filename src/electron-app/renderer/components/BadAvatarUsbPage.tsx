import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Gamepad2,
  HardDrive,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Usb,
  Wrench,
} from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import DriveRepairModal from "./DriveRepairModal";
import { formatErrorForUser } from "../../infrastructure/userFriendlyError.ts";
import {
  canSkipPreparation,
  readPersistedRghDeclaration,
  writePersistedRghDeclaration,
  type PreparedDeviceState,
} from "../../services/preparedUsbDetection.ts";
import {
  DEVICE_STATE_BADGE,
  SKIP_SCREEN_TEXT,
} from "../../services/preparedDeviceCopy.ts";
import { XBOX360_SYSTEM_UPDATE_USB_URL } from "../../infrastructure/navigationPolicy.ts";
import { isSamePhysicalUsbSelection } from "../../infrastructure/usbSelectionIdentity.ts";

interface UsbDrive {
  rootPath: string;
  label: string;
  sizeBytes: number;
  fingerprint?: string;
  diskUniqueId?: string;
  serialNumber?: string;
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
  needsRepair?: boolean;
  healthStatus?: string;
  operationalStatus?: string;
}

// Mensagens curtas e acionáveis para o usuário leigo, mapeadas pelos códigos
// estáveis de deviceSafetyPolicy.ts. Cai para o motivo técnico quando o código
// for desconhecido.
const BLOCK_REASONS: Record<string, string> = {
  NOT_USB: "Este disco fica dentro do computador e não é um pendrive ou HD externo. Escolha um pendrive ou HD ligado na entrada USB.",
  BOOT_OR_SYSTEM: "Este é o disco do Windows. Por segurança ele nunca é alterado — escolha um pendrive ou HD ligado na entrada USB.",
  WINDOWS_VOLUME: "Esta é a unidade onde o Windows está instalado. Escolha um pendrive ou HD ligado na entrada USB.",
  DISK_ZERO: "Este é o disco principal do computador. Escolha um pendrive ou HD ligado na entrada USB.",
  READ_ONLY: "Este pendrive ou HD está travado contra gravação. Destrave a chavinha física dele e clique em Atualizar.",
  OFFLINE: "Este pendrive ou HD não está pronto no Windows. Desconecte e conecte ele novamente e clique em Atualizar.",
  AMBIGUOUS_IDENTITY: "O Windows não conseguiu reconhecer este pendrive ou HD corretamente. Troque de porta USB ou use outro pendrive ou HD.",
  INVALID_CAPACITY: "Tamanho não reconhecido ou menor que 1 GB. Use um pendrive ou HD de pelo menos 1 GB.",
  MULTIPLE_MOUNTED_PARTITIONS: "Este dispositivo está dividido em mais de uma unidade. Marque “Formatar antes” para juntar tudo ou use outro pendrive ou HD.",
};

function blockReason(device?: UsbDrive): string {
  const code = device?.safety?.codes?.find((c) => BLOCK_REASONS[c]);
  if (code) return BLOCK_REASONS[code];
  return device?.safety?.reasons?.[0] || "Escolha outro pendrive ou HD USB.";
}

interface BadAvatarUsbPageProps {
  onBrowseGames?: () => void;
  onBackActionChange?: (action: (() => void) | null) => void;
  initialIsRghOnly?: boolean | null;
  startAtPreparation?: boolean;
  onBackToPrevious?: () => void;
  embedded?: boolean;
}

// Teto de um volume que o Xbox 360 consegue ler: a tabela MBR guarda a contagem
// de setores em 32 bits (2³² × 512 B) e o campo BPB_TotSec32 do FAT32 também é de
// 32 bits — os dois limites caem em 2 TiB. Ver docs/CAPACIDADE-E-ESPACO.md.
const MBR_MAX_VOLUME_BYTES = 2 * 1024 ** 4;

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const tb = bytes / (1024 ** 4);
  if (tb >= 1) return `${tb.toFixed(1)} TB`;
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 ** 2))} MB`;
}

export default function BadAvatarUsbPage({
  onBrowseGames,
  onBackActionChange,
  initialIsRghOnly = null,
  startAtPreparation = false,
  onBackToPrevious,
  embedded = false,
}: BadAvatarUsbPageProps) {
  const [drives, setDrives] = useState<UsbDrive[]>([]);
  const [selectedDrive, setSelectedDrive] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formatAvailable, setFormatAvailable] = useState(false);
  const [formatDrive, setFormatDrive] = useState(false);
  const [requirementsAccepted, setRequirementsAccepted] = useState(false);
  const [isRghOnly, setIsRghOnly] = useState<boolean | null>(null);
  const [preparationEnabled, setPreparationEnabled] = useState(false);
  const [preparationBlockers, setPreparationBlockers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [preparedDriveRoot, setPreparedDriveRoot] = useState("");
  const [ejecting, setEjecting] = useState(false);
  const [ejected, setEjected] = useState(false);
  const [ejectError, setEjectError] = useState("");
  const [repairModalOpen, setRepairModalOpen] = useState(false);

  // Wizard state: "detect" | "unlock-selection" | "preparation"
  const [step, setStep] = useState<"detect" | "unlock-selection" | "preparation" | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    if (initialIsRghOnly !== null) {
      setIsRghOnly(initialIsRghOnly);
    }
  }, [initialIsRghOnly]);

  const refreshDrives = useCallback(async (
    manual = false,
  ): Promise<{ ok: boolean; drives: UsbDrive[]; error?: string }> => {
    setLoading(true);
    setLoadError("");
    let refreshedResult: { ok: boolean; drives: UsbDrive[]; error?: string } = {
      ok: false,
      drives: [],
      error: "Não foi possível procurar dispositivos USB.",
    };
    const drivesPromise = window.godsendApi.toolsBadAvatarListDrives({ fresh: manual }).then((driveResult: any) => {
      if (!driveResult?.ok) {
        const message = driveResult?.error || "Não foi possível procurar dispositivos USB.";
        setDrives([]);
        setSelectedDrive("");
        setLoadError(message);
        refreshedResult = { ok: false, drives: [], error: message };
      } else {
        const nextDrives = Array.isArray(driveResult.drives) ? driveResult.drives : [];
        setDrives(nextDrives);
        setSelectedDrive((current) => {
          if (current && nextDrives.some((drive: UsbDrive) => drive.rootPath === current)) {
            return current;
          }
          const safeDrive = nextDrives.find((drive: UsbDrive) => drive.safety?.allowed);
          return (safeDrive || nextDrives[0])?.rootPath || "";
        });
        refreshedResult = { ok: true, drives: nextDrives };
      }
    }).catch(() => {
      setDrives([]);
      setSelectedDrive("");
      setLoadError("Não foi possível procurar dispositivos USB.");
      refreshedResult = {
        ok: false,
        drives: [],
        error: "Não foi possível procurar dispositivos USB.",
      };
    });

    const readinessPromise = window.godsendApi.toolsBadAvatarIsAdmin().then((readinessResult: any) => {
      if (readinessResult?.ok) {
        setFormatAvailable(readinessResult.hasFat32FormatExe === true);
        setPreparationEnabled(readinessResult.preparationEnabled === true);
        setPreparationBlockers(
          Array.isArray(readinessResult.preparationBlockers)
            ? readinessResult.preparationBlockers
            : [],
        );
        if (readinessResult.hasFat32FormatExe !== true) setFormatDrive(false);
      }
    });

    await Promise.allSettled([drivesPromise, readinessPromise]);
    setLoading(false);
    setHasLoadedOnce(true);
    return refreshedResult;
  }, []);

  useEffect(() => {
    refreshDrives(false);
  }, [refreshDrives]);

  const declaredRghOrPersisted = isRghOnly === false
    ? false
    : (isRghOnly === true || readPersistedRghDeclaration());

  // Initial step setup once drives are loaded
  useEffect(() => {
    if (hasLoadedOnce && step === null) {
      const hasPrepared = drives.some((d) => canSkipPreparation(d.preparedState, declaredRghOrPersisted));
      if (startAtPreparation && initialIsRghOnly !== null) {
        setStep("preparation");
      } else if (hasPrepared) {
        setStep("detect");
      } else {
        setStep("unlock-selection");
      }
    }
  }, [hasLoadedOnce, drives, step, startAtPreparation, initialIsRghOnly, declaredRghOrPersisted]);

  // Redirect to unlock-selection if the prepared device is disconnected
  useEffect(() => {
    if (step === "detect" && hasLoadedOnce && !loading && drives.length > 0 &&
        !drives.some((d) => canSkipPreparation(d.preparedState, declaredRghOrPersisted))) {
      setStep("unlock-selection");
    }
  }, [step, hasLoadedOnce, loading, drives, declaredRghOrPersisted]);

  // Propagate back action changes up to parent (for custom header alignment)
  useEffect(() => {
    if (!onBackActionChange) return;

    const hasPrepared = drives.some((d) => canSkipPreparation(d.preparedState, declaredRghOrPersisted));

    if (step === "preparation") {
      onBackActionChange(() => onBackToPrevious || (() => setStep("unlock-selection")));
    } else if (step === "unlock-selection" && hasPrepared) {
      onBackActionChange(() => () => setStep("detect"));
    } else if (step === "detect" && onBackToPrevious) {
      onBackActionChange(() => onBackToPrevious);
    } else {
      onBackActionChange(null);
    }

    return () => {
      onBackActionChange(null);
    };
  }, [step, drives, onBackActionChange, onBackToPrevious, declaredRghOrPersisted]);

  useEffect(() => window.godsendApi.onBadAvatarPrepareProgress(
    (progress: { status?: string; percent?: number; detail?: string }) => {
      setStatus(`${progress.status || "Preparando…"}${progress.detail ? ` · ${progress.detail}` : ""}`);
      setPercent(Number(progress.percent) || 0);
    },
  ), []);

  const selectedDevice = useMemo(
    () => drives.find((drive) => drive.rootPath === selectedDrive),
    [drives, selectedDrive],
  );
  const skipEligibleState = useMemo(
    () => drives.find((drive) => canSkipPreparation(drive.preparedState, declaredRghOrPersisted))?.preparedState,
    [drives, declaredRghOrPersisted],
  );
  const deviceAllowed = selectedDevice?.safety?.allowed === true;
  const hasStableVolumeIdentity = /^\\\\\?\\Volume\{[0-9a-f-]+\}\\?$/i.test(
    selectedDevice?.volumeGuid || "",
  );
  const safeFormattingAvailable = formatAvailable && deviceAllowed && hasStableVolumeIdentity;
  useEffect(() => {
    if (!safeFormattingAvailable) setFormatDrive(false);
  }, [safeFormattingAvailable]);
  // Um preparo concluído não rearma o botão: qualquer clique ou Enter que chegasse depois
  // recomeçava tudo, e o cliente via a barra "voltar do começo" sem saber se podia tirar o
  // pendrive. Escolher outra unidade na lista libera de novo
  // [[badavatar-preparo-recomeca-sozinho-depois-de-chegar-ao-fim_2026-10-20T13-28]].
  const canPrepare = Boolean(
    preparationEnabled &&
      deviceAllowed &&
      (isRghOnly === true || (isRghOnly === false && requirementsAccepted)) &&
      !loading &&
      !busy &&
      !done,
  );

  const deviceName = selectedDevice
    ? [selectedDevice.manufacturer, selectedDevice.friendlyName || selectedDevice.label]
      .filter(Boolean)
      .join(" ")
    : "";

  async function handlePrepare() {
    if (!canPrepare || !selectedDevice?.fingerprint) return;
    const previousDevice = selectedDevice;
    const targetRoot = previousDevice.rootPath;
    const driveLabel = targetRoot.replace(/\\+$/, "");
    let prepareInvoked = false;

    setBusy(true);
    setDone(false);
    setPreparedDriveRoot("");
    setEjected(false);
    setEjectError("");
    setError("");
    setStatus("Conferindo dispositivo conectado…");
    setPercent(0);
    try {
      const refreshed = await refreshDrives(true);
      if (!refreshed.ok) {
        throw new Error(
          refreshed.error ||
            `Não foi possível acessar o seu pendrive ou HD (${driveLabel}). Verifique a conexão USB e tente novamente.`,
        );
      }
      const latestDevice = refreshed.drives.find((drive) => drive.rootPath === targetRoot);
      if (!latestDevice || !latestDevice.fingerprint) {
        throw new Error(
          `O seu pendrive ou HD (${driveLabel}) não foi encontrado. Reconecte o dispositivo e tente novamente.`,
        );
      }
      if (!isSamePhysicalUsbSelection(previousDevice, latestDevice)) {
        throw new Error(
          `O dispositivo conectado em ${driveLabel} mudou desde a seleção anterior. Confira o pendrive ou HD exibido acima e clique em “Preparar pendrive/HD” novamente.`,
        );
      }
      if (latestDevice.safety?.allowed !== true) {
        throw new Error(blockReason(latestDevice));
      }

      const latestHasStableVolume = /^\\\\\?\\Volume\{[0-9a-f-]+\}\\?$/i.test(
        latestDevice.volumeGuid || "",
      );
      const effectiveFormatDrive = formatDrive && formatAvailable && latestHasStableVolume;
      if (effectiveFormatDrive) {
        const confirmed = window.confirm(
          `Formatar ${latestDevice.rootPath} e preparar para o Xbox 360?\n\nOs jogos instalados nesta unidade serão apagados.\n\nNota: Perfis pessoais e saves de jogos encontrados no pendrive serão salvos em backup no computador e restaurados automaticamente após a formatação.`,
        );
        if (!confirmed) {
          setStatus("");
          return;
        }
      }

      setStatus("Iniciando preparação…");
      prepareInvoked = true;
      const response = await window.godsendApi.toolsBadAvatarPrepare({
        driveRoot: latestDevice.rootPath,
        expectedDeviceFingerprint: latestDevice.fingerprint,
        formatDrive: effectiveFormatDrive,
        requirementsAccepted,
        isRghOnly: isRghOnly === true,
      });
      if (!response?.ok) throw new Error(response?.error || "Não foi possível preparar o dispositivo.");
      setPreparedDriveRoot(latestDevice.rootPath);
      setDone(true);
      setStatus("Pronto! O pendrive está preparado para o Xbox 360.");
      setPercent(100);
      await refreshDrives(true);
    } catch (prepareError: any) {
      setError(prepareError?.message || "Não foi possível preparar o dispositivo.");
      if (prepareInvoked) {
        await refreshDrives(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleEjectPreparedDrive() {
    const targetRoot = preparedDriveRoot || selectedDevice?.rootPath || selectedDrive;
    if (!targetRoot || ejecting) return;
    setEjecting(true);
    setEjectError("");
    try {
      const res = await window.godsendApi.toolsDriveEject(targetRoot);
      if (res && res.ok) {
        setEjected(true);
        await refreshDrives(true);
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

  // Loading spinner during initial load (where step is not decided yet)
  if (!hasLoadedOnce || step === null) {
    return (
      <main className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center gap-3 px-4 py-5 text-muted-foreground sm:px-7">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-[13px]">Buscando dispositivos USB conectados…</p>
      </main>
    );
  }

  // Step 1: Detect Page
  if (step === "detect") {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7">
        <div className="animate-fade-in flex flex-col gap-4">
          <header className="mb-5 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/10 text-green-400">
              <Check className="h-6 w-6" />
            </div>
            <h1 className="font-display text-xl font-bold text-foreground">
              {SKIP_SCREEN_TEXT[skipEligibleState === "preparado-rgh" ? "preparado-rgh" : "preparado-bloqueado-lt"].title}
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              {SKIP_SCREEN_TEXT[skipEligibleState === "preparado-rgh" ? "preparado-rgh" : "preparado-bloqueado-lt"].detail}
            </p>
          </header>

          <section className="card-surface p-5 flex flex-col gap-3">
            {onBrowseGames && (
              <Button
                variant="primary"
                className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2"
                onClick={onBrowseGames}
              >
                <Gamepad2 className="h-4 w-4" />
                Pular e ir para o catálogo de jogos
              </Button>
            )}

            <Button
              variant="default"
              className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2"
              onClick={() => setStep("unlock-selection")}
            >
              <ShieldCheck className="h-4 w-4" />
              Preparar pendrive/HD
            </Button>
          </section>
        </div>
      </main>
    );
  }

  // Step 2: Unlock Selection Page
  if (step === "unlock-selection") {
    const hasPrepared = drives.some((d) => canSkipPreparation(d.preparedState, declaredRghOrPersisted));

    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7">
        <div className="animate-fade-in flex flex-col gap-4">
          <header className="mb-5 text-center relative">
            {hasPrepared && !onBackActionChange && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute left-0 top-1 text-muted-foreground hover:text-foreground text-[12px] flex items-center gap-1.5 p-0"
                onClick={() => setStep("detect")}
              >
                &larr; Voltar
              </Button>
            )}
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/10 text-green-400">
              <Gamepad2 className="h-6 w-6" />
            </div>
            <h1 className="font-display text-xl font-bold text-foreground">
              Modo de Instalação
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Selecione o tipo de desbloqueio do seu console Xbox 360 para preparar o pendrive ou HD.
            </p>
          </header>

          <section className="card-surface p-4 sm:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
              <button
                type="button"
                className={`h-11 px-3 rounded-lg border text-[13px] font-medium transition-colors cursor-pointer ${isRghOnly === false
                  ? "border-green-500 bg-green-950/20 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/30"
                  }`}
                onClick={() => setIsRghOnly(false)}
                disabled={loading || busy}
              >
                Xbox Bloqueado ou LT
              </button>
              <button
                type="button"
                className={`h-11 px-3 rounded-lg border text-[13px] font-medium transition-colors cursor-pointer ${isRghOnly === true
                  ? "border-green-500 bg-green-950/20 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/30"
                  }`}
                onClick={() => setIsRghOnly(true)}
                disabled={loading || busy}
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
                  Ligue o Xbox 360 pressing o botão de <span className="font-medium text-foreground">Ejetar Bandeja (Eject)</span>. Se o videogame ligar em uma tela azul com textos brancos escrita <span className="font-medium text-foreground">XeLL Reloaded</span>, seu console é RGH.
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
              onClick={() => {
                if (isRghOnly !== null) {
                  writePersistedRghDeclaration(isRghOnly);
                }
                setStep("preparation");
              }}
              disabled={isRghOnly === null}
            >
              Avançar
            </Button>
          </section>
        </div>
      </main>
    );
  }

  // Step 3: Preparation Page
  return (
    <main className={embedded ? "mx-auto w-full max-w-3xl" : "mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7"}>
      <section className={embedded ? "w-full" : "card-surface overflow-hidden p-4 sm:p-5 md:p-6"}>
        <div className="animate-fade-in flex flex-col gap-4 sm:gap-5">
        <header className="text-center relative">
          {!onBackActionChange && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute left-0 top-1 text-muted-foreground hover:text-foreground text-[12px] flex items-center gap-1.5 p-0"
              onClick={() => {
                if (onBackToPrevious) {
                  onBackToPrevious();
                  return;
                }
                setStep("unlock-selection");
              }}
            >
              &larr; Voltar
            </Button>
          )}
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/10 text-green-400">
            <Gamepad2 className="h-6 w-6" />
          </div>
          <h1 className="font-display text-xl font-bold text-foreground">
            Prepare seu pendrive ou HD
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            {isRghOnly
              ? "Conecte seu dispositivo e clique em preparar. A Dash Aurora e o arquivo de boot launch.ini serão instalados."
              : "Conecte seu dispositivo e clique em preparar. O BadAvatar e o Aurora serão instalados e configurados automaticamente."}
          </p>
        </header>

        <section className="rounded-xl border border-border/50 bg-background/10 p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <Usb className="h-4 w-4 text-green-400" />
            <h2 className="text-[13px] font-semibold text-foreground">Dispositivo conectado</h2>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={loading || busy}
              onClick={() => refreshDrives(true)}
            >
              {loading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Atualizar
            </Button>
          </div>

          {loadError ? (
            <div
              className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-3 text-[12px] leading-relaxed ${
                /reconhecendo|atualizar/i.test(loadError)
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              }`}
            >
              <AlertTriangle
                className={`h-4 w-4 shrink-0 ${
                  /reconhecendo|atualizar/i.test(loadError) ? "text-amber-400" : "text-red-400"
                }`}
              />
              <span>{loadError}</span>
            </div>
          ) : drives.length === 0 ? (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-4 text-[12px] text-muted-foreground">
              <HardDrive className="h-5 w-5 shrink-0" />
              Conecte um pendrive ou HD USB e clique em Atualizar.
            </div>
          ) : (
            <>
              <select
                aria-label="Pendrive ou HD"
                className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-green-500/70"
                value={selectedDrive}
                disabled={loading || busy}
                onChange={(event) => {
                  setSelectedDrive(event.target.value);
                  setDone(false);
                  setPreparedDriveRoot("");
                  setEjected(false);
                  setEjectError("");
                  setStatus("");
                }}
              >
                {drives.map((drive) => (
                  <option key={drive.fingerprint || drive.rootPath} value={drive.rootPath}>
                    {drive.rootPath} — {drive.friendlyName || drive.label}
                    {formatBytes(drive.sizeBytes) ? ` (${formatBytes(drive.sizeBytes)})` : ""}
                  </option>
                ))}
              </select>

              {selectedDevice && (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/45 px-3 py-2.5 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{deviceName || selectedDevice.rootPath}</span>
                  {selectedDevice.fileSystem && <span>{selectedDevice.fileSystem}</span>}
                  {formatBytes(selectedDevice.freeBytes) && (
                    <span>{formatBytes(selectedDevice.freeBytes)} livres</span>
                  )}
                  <span className={deviceAllowed ? "text-green-400" : "text-red-300"}>
                    {deviceAllowed ? "Pronto para uso" : "Não pode ser usado"}
                  </span>
                </div>
              )}

              {selectedDevice?.preparedState && DEVICE_STATE_BADGE[selectedDevice.preparedState] && (() => {
                const badge = DEVICE_STATE_BADGE[selectedDevice.preparedState]!;
                const green = badge.tone === "green";
                return (
                  <div className={`mt-3 rounded-lg border px-3 py-3 text-[12px] text-gray-200 flex items-center gap-2.5 ${green ? "border-green-500/35 bg-green-950/20" : "border-amber-500/40 bg-amber-950/20"}`}>
                    {green
                      ? <Check className="h-4 w-4 shrink-0 text-green-400" />
                      : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />}
                    <div>
                      <span className={`font-semibold block ${green ? "text-green-400" : "text-amber-400"}`}>{badge.title}</span>
                      {badge.detail}
                    </div>
                  </div>
                );
              })()}

              {selectedDevice && (selectedDevice.needsRepair || selectedDevice.healthStatus === "Warning" || /Repair|Need|Corrupt/i.test(selectedDevice.operationalStatus || "")) && (
                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-3 text-[12px] text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <span className="font-semibold block text-amber-400">Sistema de arquivos com inconsistências</span>
                      Use &quot;Reparar (CHKDSK)&quot; para corrigir a tabela FAT32 preservando seus jogos, perfil e saves.
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-amber-500/50 hover:bg-amber-500/20 text-amber-200 text-xs font-medium"
                    onClick={() => setRepairModalOpen(true)}
                  >
                    <Wrench className="h-3.5 w-3.5 mr-1.5" />
                    Reparar (CHKDSK)
                  </Button>
                </div>
              )}

              {selectedDevice && selectedDevice.sizeBytes > MBR_MAX_VOLUME_BYTES && (
                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-950/20 px-3 py-3 text-[12px] text-amber-200 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <span className="font-semibold block text-amber-400">
                      Só 2 TB deste disco ficarão acessíveis
                    </span>
                    Este disco tem {formatBytes(selectedDevice.sizeBytes)}, mas o Xbox 360 lê FAT32 em
                    MBR, e esse formato não endereça mais de 2 TB — cerca de{" "}
                    {formatBytes(selectedDevice.sizeBytes - MBR_MAX_VOLUME_BYTES)} não poderão ser
                    usados no console, nem criando uma segunda partição.{" "}
                    <span className="text-amber-300/80">
                      Não é defeito do disco: o espaço volta inteiro se você reformatá-lo para uso no
                      computador.
                    </span>
                  </div>
                </div>
              )}

              {selectedDevice && !deviceAllowed && (
                <p className="mt-2 text-[11px] leading-relaxed text-red-300">
                  {blockReason(selectedDevice)}
                </p>
              )}

            </>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border/50 bg-background/10 flex items-start gap-3 p-4">
            <div className="mt-0.5 rounded-lg bg-green-500/10 p-2 text-green-400">
              <Check className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-foreground">
                {isRghOnly ? "Aurora + launch.ini" : "BadAvatar + Aurora"}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {isRghOnly
                  ? "Os arquivos essenciais de boot serão copiados de forma limpa e otimizada."
                  : "Já incluídos. Você não precisa escolher pacotes nem configurar pastas."}
              </p>
            </div>
          </div>

          <label className={`rounded-xl border border-border/50 bg-background/10 flex items-start gap-3 p-4 ${!safeFormattingAvailable ? "opacity-60" : "cursor-pointer"}`}>
            <Checkbox
              checked={formatDrive}
              disabled={!safeFormattingAvailable || loading || busy}
              onCheckedChange={(value) => setFormatDrive(value === true)}
              className="mt-0.5"
            />
            <span>
              <span className="text-[13px] font-semibold text-foreground">Formatar antes</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                Opcional. Apaga tudo do dispositivo e prepara em FAT32.
                {safeFormattingAvailable
                  ? selectedDevice?.diskNumber === -1
                    ? " O modo alternativo revalidará o volume e o disco USB antes de apagar; o Windows pedirá sua autorização."
                    : " O Windows pedirá sua autorização antes de começar."
                  : " O formatador FAT32 não está disponível ou o dispositivo não passou na validação de segurança."}
              </span>
            </span>
          </label>
        </section>

        {!isRghOnly && (
          <>
            <details className="rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Como funciona e o que esperar
              </summary>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>
                  O BadAvatar é <span className="font-medium text-foreground">temporário</span>: sempre que
                  o Xbox liga ou reinicia, conecte o pendrive e permaneça na tela de escolha de perfis sem entrar em nenhum perfil.
                </li>
                <li>Pode não funcionar logo de primeira — às vezes leva algumas tentativas.</li>
                <li>
                  Preparar o pendrive <span className="font-medium text-foreground">não modifica nada de
                    forma permanente</span> no console. A memória interna (NAND) não é tocada.
                </li>
                <li>Mantenha o Xbox sem internet (Wi-Fi e cabo de rede desconectados) durante o uso.</li>
                <li>Nunca entre na Xbox Live usando o perfil do exploit.</li>
              </ul>
            </details>

            <details className="rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Como verificar a versão do sistema (dashboard) do meu Xbox 360?
              </summary>
              <div className="mt-2.5 space-y-2 text-muted-foreground">
                <p>Para o BadAvatar funcionar, seu Xbox 360 deve estar na versão de sistema <strong>17559</strong>. Siga este passo a passo para verificar no videogame:</p>
                <ol className="list-decimal pl-4 space-y-1.5 mb-3">
                  <li>Ligue o console (sem nenhum jogo inserido).</li>
                  <li>No menu inicial oficial do Xbox, navegue todo para a direita até a aba <strong>Configurações</strong>.</li>
                  <li>Selecione a opção <strong>Sistema</strong> e depois <strong>Configurações do Console</strong>.</li>
                  <li>Desça a lista de opções e selecione <strong>Informações do Sistema</strong>.</li>
                  <li>No painel à direita, procure a versão escrita ao lado de <strong>Painel:</strong> (exemplo: <strong>2.0.17559.0</strong>). Se terminar com <strong>17559</strong>, o console é compatível!</li>
                </ol>
                <div className="border-t border-border/40 pt-2.5 mt-2.5">
                  <span className="font-semibold text-foreground block mb-1">⚠️ Importante (Atualização de Avatares):</span>
                  Os Avatares dos perfis no menu do Xbox devem estar <strong>coloridos e completos</strong>. Se os avatares estiverem cinzas (silhuetas sem corpo), significa que falta a atualização de Avatar/Kinect no console e o BadAvatar não funcionará até que ela seja instalada.
                </div>
              </div>
            </details>

            <details className="rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Como corrigir os avatares cinzas (instalar dados de avatar/Kinect)?
              </summary>
              <div className="mt-2.5 space-y-2 text-muted-foreground">
                <p>Se os avatares dos perfis estiverem cinzas (silhuetas sem corpo) no menu oficial do Xbox 360, instale a atualização oficial da Microsoft pelo pendrive, sem conectar o console à internet:</p>
                <ol className="list-decimal pl-4 space-y-1.5 mb-3">
                  <li>
                    <strong>Identifique a versão do seu painel:</strong> Vá em <em>Configurações &gt; Sistema &gt; Configurações do Console &gt; Informações do Sistema</em> e anote o número da Dashboard (exemplo: se terminar em 17559, sua versão é a 17559).
                  </li>
                  <li>
                    <strong>Baixe a atualização oficial:</strong>{" "}
                    <a
                      href={XBOX360_SYSTEM_UPDATE_USB_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-green-500 underline underline-offset-2 hover:text-green-400"
                    >
                      clique aqui para baixar a atualização 17559 do site da Microsoft
                    </a>{" "}
                    (abre no navegador). O arquivo se chama <code>SystemUpdate_17559_USB.zip</code> e tem cerca de 110 MB; se o seu tiver bem menos, o download parou no meio — baixe de novo.
                  </li>
                  <li>
                    <strong>Prepare o pendrive:</strong> Formate um pendrive em <strong>FAT32</strong> e extraia o ZIP <strong>direto na raiz</strong> dele. A pasta <code>$SystemUpdate</code> precisa ficar na raiz (ex.: <code>E:\$SystemUpdate</code>), e não dentro de outra pasta como <code>SystemUpdate_17559_USB</code>. Mantenha o nome <code>$SystemUpdate</code>, com um cifrão — não renomeie.
                  </li>
                  <li>
                    <strong>Instale no console:</strong> Com o Xbox 360 desligado, conecte o pendrive na entrada USB. Ligue o console e selecione <strong>Sim</strong> na mensagem que aparecerá na tela inicial pedindo para aplicar a atualização de recursos de avatar/Kinect.
                  </li>
                </ol>
              </div>
            </details>

            <details className="rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                O perfil ABadAvatar não apareceu no Xbox 360? Veja o que conferir
              </summary>
              <ol className="mt-2.5 list-decimal space-y-1.5 pl-4 text-muted-foreground">
                <li>
                  <strong>Ejete com segurança antes de tirar do PC:</strong> sempre clique em{" "}
                  <strong>Ejetar pendrive com segurança</strong> ao terminar (ou use &quot;Remover Hardware com Segurança&quot; no Windows). Puxar o pendrive direto pode deixar a gravação incompleta.
                </li>
                <li>
                  <strong>Use a entrada USB frontal e deixe só este pendrive conectado:</strong> desconecte outros pendrives ou HDs USB do console durante a ativação.
                </li>
                <li>
                  <strong>Desative o Login Automático:</strong> aperte o <strong>Botão Guia</strong> do controle &gt;{" "}
                  <em>Configurações &gt; Perfil &gt; Preferências de Entrada &gt; Login Automático: Desativado</em>, para o Xbox parar na tela de perfis.
                </li>
                <li>
                  <strong>Se não aparecer na 1ª tentativa, troque de porta USB e reinicie:</strong> desligue o console completamente, conecte na outra entrada USB frontal e ligue sem internet. Se preferir, ligue o console primeiro, aguarde a tela de perfis e só então conecte o pendrive.
                </li>
                <li>
                  <strong>Se aparecer &quot;0 KB&quot; em Armazenamento &gt; Dispositivo USB:</strong> teste o pendrive em{" "}
                  <strong>Jogos Instalados &gt; Testar Capacidade</strong> (para descartar pendrive com capacidade falsificada) ou formate o pendrive pelo próprio Xbox 360 (<em>Configurações &gt; Sistema &gt; Armazenamento &gt; Dispositivo USB &gt; aperte Y &gt; Formatar</em>, <strong>não</strong> escolha &quot;Configurar Agora&quot;) e prepare novamente aqui <strong>sem</strong> marcar &quot;Formatar antes&quot;.
                </li>
                <li>
                  <strong>Console sem Disco Rígido e sem memória interna (4 GB):</strong> modelos sem nenhum armazenamento interno não leem perfis gravados diretamente no pendrive comum.
                </li>
              </ol>
            </details>

            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
              <Checkbox
                checked={requirementsAccepted}
                disabled={loading || busy}
                onCheckedChange={(value) => setRequirementsAccepted(value === true)}
                className="mt-0.5"
              />
              <span>
                Meu Xbox 360 está no dashboard 17559, com os dados de Avatar instalados e ficará
                desconectado da rede durante o uso do BadAvatar.
              </span>
            </label>
          </>
        )}

        {isRghOnly && (
          <div className="rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground block mb-1">Como funciona o Boot RGH</span>
            Ao plugar este pendrive/HD no Xbox 360 com RGH, o painel Aurora carregará automaticamente no boot usando o arquivo <code className="bg-muted px-1 py-0.5 rounded">launch.ini</code> configurado. Os jogos baixados aparecerão na tela na hora.
          </div>
        )}

        <div>
          <Button
            variant={canSkipPreparation(selectedDevice?.preparedState, isRghOnly) ? "default" : "primary"}
            className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2"
            disabled={!canPrepare}
            onClick={handlePrepare}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : done ? <Check className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? "Preparando…" : done ? "Pendrive pronto" : "Preparar pendrive/HD"}
          </Button>
        </div>

        {(busy || status || error || done) && (
          <div className={`rounded-lg border px-3 py-3 ${error ? "border-red-500/30 bg-red-500/10" : done ? "border-green-500/40 bg-green-950/20" : "border-border bg-muted/30"}`}>
            <div
              className="h-2 overflow-hidden rounded-full bg-background"
              role="progressbar"
              aria-label="Progresso da preparação"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.max(0, Math.min(100, Math.round(percent)))}
            >
              <div
                className={`h-full transition-all duration-300 ${error ? "bg-red-500" : "bg-green-500"}`}
                style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
              />
            </div>
            <p
              className={`mt-2 text-[11px] ${error ? "text-red-300" : done ? "text-green-400" : "text-muted-foreground"}`}
              aria-live="polite"
            >
              {error || status}
            </p>
            {error && (error.includes("Reparar (CHKDSK)") || error.includes("sistema de arquivos danificado")) && (
              <div className="mt-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-500/50 hover:bg-red-500/20 text-red-200 text-xs font-semibold"
                  onClick={() => setRepairModalOpen(true)}
                >
                  <Wrench className="h-3.5 w-3.5 mr-1.5" />
                  Reparar Pendrive (CHKDSK) Agora
                </Button>
              </div>
            )}
            {done && !error && (
              <>
                <p className="mt-2 text-[11px] leading-relaxed text-gray-200">
                  {isRghOnly
                    ? "Concluído! Ejete o dispositivo com segurança antes de desconectar, insira no seu Xbox 360 RGH e ligue o videogame para carregar a Aurora automaticamente."
                    : "Antes de tirar do PC, clique em “Ejetar pendrive com segurança”. Depois, conecte na entrada USB frontal do Xbox 360 (sem internet e sem outros pendrives) e fique parado na tela de escolha de perfis sem entrar em nenhum perfil. Em até 2 minutos a Aurora abrirá sozinha. Não desbloqueia de forma permanente — repita a cada vez que ligar."}
                  {!isRghOnly && " O Aurora abrir\u00e1 automaticamente, configurar\u00e1 as pastas de jogos e iniciar\u00e1 a varredura."}
                </p>
                {!isRghOnly && (
                  <p className="mt-2 rounded bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-300 border border-amber-500/20">
                    <strong>Dica de segurança para saves:</strong> Se o seu Xbox 360 tiver Disco Rígido interno ou Unidade de Memória interna, mantenha seu perfil de jogador pessoal e seus saves de jogos nessa memória interna. Use o pendrive apenas para carregar o exploit e os jogos. Assim, se o jogo travar ou houver desligamento repentino, seu progresso não será perdido.
                  </p>
                )}
                {ejected ? (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-500/35 bg-green-500/10 px-3 py-2 text-[11px] font-medium text-green-300">
                    <Check className="h-4 w-4 shrink-0 text-green-400" />
                    <span>Pendrive ejetado com segurança! Você já pode removê-lo do computador e conectar no Xbox 360.</span>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    <Button
                      variant="outline"
                      className="h-10 w-full border-green-500/40 bg-green-500/10 text-green-200 hover:bg-green-500/20"
                      disabled={ejecting || !(preparedDriveRoot || selectedDevice?.rootPath)}
                      onClick={handleEjectPreparedDrive}
                    >
                      {ejecting
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <LogOut className="h-4 w-4" />}
                      {ejecting ? "Ejetando com segurança…" : "Ejetar pendrive com segurança"}
                    </Button>
                    {ejectError && (
                      <p className="text-[11px] leading-relaxed text-amber-300">{ejectError}</p>
                    )}
                  </div>
                )}
              </>
            )}
            {done && onBrowseGames && !ejected && (
              <Button className="mt-2.5 h-10 w-full" onClick={onBrowseGames}>
                <Gamepad2 className="h-4 w-4" />
                Adicionar jogos
              </Button>
            )}
          </div>
        )}

        {!preparationEnabled && (
          <div className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-center text-[11px] text-amber-300">
            A preparação automática ainda não está disponível nesta versão.
            {preparationBlockers.length > 0 && (
              <details className="mt-1 text-left text-muted-foreground">
                <summary className="cursor-pointer text-center">Detalhes técnicos</summary>
                <ul className="mx-auto mt-2 max-w-xl list-disc space-y-1 pl-5">
                  {preparationBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
        </div>
      </section>

      <DriveRepairModal
        open={repairModalOpen}
        driveRoot={selectedDevice?.rootPath || ""}
        onClose={() => setRepairModalOpen(false)}
        onRepairCompleted={async () => {
          await refreshDrives(true);
          setError("");
        }}
      />
    </main>
  );
}
