import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Gamepad2,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Usb,
} from "lucide-react";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

interface UsbDrive {
  rootPath: string;
  label: string;
  sizeBytes: number;
  fingerprint?: string;
  friendlyName?: string;
  manufacturer?: string;
  fileSystem?: string;
  freeBytes?: number;
  safety?: {
    allowed: boolean;
    codes?: string[];
    reasons: string[];
  };
  alreadyPrepared?: boolean;
}

// Mensagens curtas e acionáveis para o usuário leigo, mapeadas pelos códigos
// estáveis de deviceSafetyPolicy.ts. Cai para o motivo técnico quando o código
// for desconhecido.
const BLOCK_REASONS: Record<string, string> = {
  NOT_USB: "Este disco não é um pendrive ou HD conectado por USB. Ligue o dispositivo direto numa porta USB.",
  BOOT_OR_SYSTEM: "Este é um disco do sistema. Por segurança ele nunca é usado — escolha um pendrive ou HD USB.",
  WINDOWS_VOLUME: "Esta é a unidade onde o Windows está rodando. Escolha um pendrive ou HD USB.",
  DISK_ZERO: "Este é o disco principal do computador. Escolha um pendrive ou HD USB.",
  READ_ONLY: "O dispositivo está protegido contra gravação. Desative a trava de proteção e clique em Atualizar.",
  OFFLINE: "O dispositivo está offline no Windows. Coloque-o online e clique em Atualizar.",
  AMBIGUOUS_IDENTITY: "O Windows não reconhece um identificador estável deste dispositivo. Tente outra porta USB ou outro pendrive.",
  INVALID_CAPACITY: "Capacidade não reconhecida ou menor que 1 GB. Use um pendrive ou HD de pelo menos 1 GB.",
  MULTIPLE_MOUNTED_PARTITIONS: "Este dispositivo tem mais de uma partição. Use um com partição única ou marque “Formatar antes”.",
};

function blockReason(device?: UsbDrive): string {
  const code = device?.safety?.codes?.find((c) => BLOCK_REASONS[c]);
  if (code) return BLOCK_REASONS[code];
  return device?.safety?.reasons?.[0] || "Escolha outro pendrive ou HD USB.";
}

interface BadAvatarUsbPageProps {
  onBrowseGames?: () => void;
  onBackActionChange?: (action: (() => void) | null) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 ** 2))} MB`;
}

export default function BadAvatarUsbPage({ onBrowseGames, onBackActionChange }: BadAvatarUsbPageProps) {
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

  // Wizard state: "detect" | "unlock-selection" | "preparation"
  const [step, setStep] = useState<"detect" | "unlock-selection" | "preparation" | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const refreshDrives = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const drivesPromise = window.godsendApi.toolsBadAvatarListDrives().then((driveResult: any) => {
      if (!driveResult?.ok) {
        setDrives([]);
        setSelectedDrive("");
        setLoadError(driveResult?.error || "Não foi possível procurar dispositivos USB.");
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
      }
    }).catch(() => {
      setDrives([]);
      setSelectedDrive("");
      setLoadError("Não foi possível procurar dispositivos USB.");
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
  }, []);

  useEffect(() => {
    refreshDrives();
  }, [refreshDrives]);

  // Initial step setup once drives are loaded
  useEffect(() => {
    if (hasLoadedOnce && step === null) {
      const hasPrepared = drives.some((d) => d.alreadyPrepared);
      if (hasPrepared) {
        setStep("detect");
      } else {
        setStep("unlock-selection");
      }
    }
  }, [hasLoadedOnce, drives, step]);

  // Redirect to unlock-selection if the prepared device is disconnected
  useEffect(() => {
    if (step === "detect" && hasLoadedOnce && !loading && drives.length > 0 && !drives.some((d) => d.alreadyPrepared)) {
      setStep("unlock-selection");
    }
  }, [step, hasLoadedOnce, loading, drives]);

  // Propagate back action changes up to parent (for custom header alignment)
  useEffect(() => {
    if (!onBackActionChange) return;

    const hasPrepared = drives.some((d) => d.alreadyPrepared);

    if (step === "preparation") {
      onBackActionChange(() => () => setStep("unlock-selection"));
    } else if (step === "unlock-selection" && hasPrepared) {
      onBackActionChange(() => () => setStep("detect"));
    } else {
      onBackActionChange(null);
    }

    return () => {
      onBackActionChange(null);
    };
  }, [step, drives, onBackActionChange]);

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
  const deviceAllowed = selectedDevice?.safety?.allowed === true;
  const canPrepare = Boolean(
    preparationEnabled &&
      deviceAllowed &&
      (isRghOnly === true || (isRghOnly === false && requirementsAccepted)) &&
      !loading &&
      !busy,
  );

  const deviceName = selectedDevice
    ? [selectedDevice.manufacturer, selectedDevice.friendlyName || selectedDevice.label]
      .filter(Boolean)
      .join(" ")
    : "";

  async function handlePrepare() {
    if (!canPrepare || !selectedDevice?.fingerprint) return;
    if (formatDrive) {
      const confirmed = window.confirm(
        `Formatar ${selectedDevice.rootPath} e preparar para o Xbox 360?\n\nTudo neste dispositivo será apagado.`,
      );
      if (!confirmed) return;
    }
    setBusy(true);
    setDone(false);
    setError("");
    setStatus("Iniciando preparação…");
    setPercent(0);
    try {
      const response = await window.godsendApi.toolsBadAvatarPrepare({
        driveRoot: selectedDevice.rootPath,
        expectedDeviceFingerprint: selectedDevice.fingerprint,
        formatDrive,
        requirementsAccepted,
        isRghOnly: isRghOnly === true,
      });
      if (!response?.ok) throw new Error(response?.error || "Não foi possível preparar o dispositivo.");
      setDone(true);
      setStatus("Pronto! O pendrive está preparado para o Xbox 360.");
      setPercent(100);
      await refreshDrives();
    } catch (prepareError: any) {
      setError(prepareError?.message || "Não foi possível preparar o dispositivo.");
    } finally {
      setBusy(false);
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
              Dispositivo Xbox 360 detectado!
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
              Já existe um desbloqueio ou pastas de jogos (Aurora, exploit ou Content) neste pendrive ou HD. Você pode pular a preparação e baixar/instalar os jogos diretamente.
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
    const hasPrepared = drives.some((d) => d.alreadyPrepared);

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
              onClick={() => setStep("preparation")}
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
    <main className="mx-auto flex w-full max-w-3xl flex-col px-4 pt-1 pb-6 sm:px-7">
      <div className="animate-fade-in flex flex-col gap-4">
        <header className="mb-5 text-center relative">
          {!onBackActionChange && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute left-0 top-1 text-muted-foreground hover:text-foreground text-[12px] flex items-center gap-1.5 p-0"
              onClick={() => setStep("unlock-selection")}
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

        <section className="card-surface p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <Usb className="h-4 w-4 text-green-400" />
            <h2 className="text-[13px] font-semibold text-foreground">Dispositivo conectado</h2>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={loading || busy}
              onClick={refreshDrives}
            >
              {loading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              Atualizar
            </Button>
          </div>

          {loadError ? (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-3 text-[12px] text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {loadError}
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
                onChange={(event) => setSelectedDrive(event.target.value)}
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

              {selectedDevice && selectedDevice.alreadyPrepared && (
                <div className="mt-3 rounded-lg border border-green-500/35 bg-green-950/20 px-3 py-3 text-[12px] text-gray-200 flex items-center gap-2.5">
                  <Check className="h-4 w-4 shrink-0 text-green-400" />
                  <div>
                    <span className="font-semibold block text-green-400">Dispositivo Xbox 360 detectado!</span>
                    Já existe um desbloqueio ou pastas de jogos neste pendrive/HD.
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

        <section className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="card-surface flex items-start gap-3 p-4">
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

          <label className={`card-surface flex items-start gap-3 p-4 ${!formatAvailable ? "opacity-60" : "cursor-pointer"}`}>
            <Checkbox
              checked={formatDrive}
              disabled={!formatAvailable || loading || busy}
              onCheckedChange={(value) => setFormatDrive(value === true)}
              className="mt-0.5"
            />
            <span>
              <span className="text-[13px] font-semibold text-foreground">Formatar antes</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                Opcional. Apaga tudo do dispositivo e prepara em FAT32.
                {formatAvailable
                  ? " O Windows pedirá sua autorização antes de começar."
                  : " O formatador FAT32 não está disponível nesta instalação."}
              </span>
            </span>
          </label>
        </section>

        {!isRghOnly && (
          <>
            <details className="mt-3 rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Como funciona e o que esperar
              </summary>
              <ul className="mt-2 list-disc space-y-1.5 pl-5">
                <li>
                  O BadAvatar é <span className="font-medium text-foreground">temporário</span>: sempre que
                  o Xbox liga ou reinicia, é preciso abrir o perfil de novo para ativá-lo.
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

            <details className="mt-3 rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
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

            <details className="mt-3 rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">
                Como corrigir os avatares cinzas (instalar dados de avatar/Kinect)?
              </summary>
              <div className="mt-2.5 space-y-2 text-muted-foreground">
                <p>Se os avatares dos perfis estiverem cinzas (silhuetas sem corpo) no menu oficial do Xbox 360, siga este procedimento de instalação offline (via pendrive) para não perder o destrave RGH:</p>
                <ol className="list-decimal pl-4 space-y-1.5 mb-3">
                  <li>
                    <strong>Identifique a versão do seu painel:</strong> Vá em <em>Configurações &gt; Sistema &gt; Configurações do Console &gt; Informações do Sistema</em> e anote o número da Dashboard (exemplo: se terminar em 17559, sua versão é a 17559).
                  </li>
                  <li>
                    <strong>Baixe a atualização oficial:</strong> Baixe no PC a atualização oficial de sistema da Microsoft correspondente à sua versão exata (ex: <em>Xbox 360 System Update 17559</em>).
                  </li>
                  <li>
                    <strong>Prepare o pendrive:</strong> Formate um pendrive em <strong>FAT32</strong> no computador e extraia o arquivo ZIP baixado. Você obterá uma pasta chamada <code>$SystemUpdate</code>.
                  </li>
                  <li>
                    <strong>Renomeie a pasta (Importante para RGH):</strong> Para contornar o bloqueio de segurança do destrave, renomeie a pasta de <code>$SystemUpdate</code> para <code>$$SystemUpdate</code> (com dois cifrões).
                  </li>
                  <li>
                    <strong>Instale no console:</strong> Com o Xbox 360 desligado, conecte o pendrive na entrada USB. Ligue o console e selecione <strong>Sim</strong> na mensagem que aparecerá na tela inicial pedindo para aplicar a atualização de recursos de avatar/Kinect.
                  </li>
                </ol>
              </div>
            </details>

            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
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
          <div className="mt-3 rounded-lg border border-border/60 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground block mb-1">Como funciona o Boot RGH</span>
            Ao plugar este pendrive/HD no Xbox 360 com RGH, o painel Aurora carregará automaticamente no boot usando o arquivo <code className="bg-muted px-1 py-0.5 rounded">launch.ini</code> configurado. Os jogos baixados aparecerão na tela na hora.
          </div>
        )}

        <div className="mt-4">
          <Button
            variant={selectedDevice?.alreadyPrepared ? "default" : "primary"}
            className="h-11 w-full text-sm font-semibold flex items-center justify-center gap-2"
            disabled={!canPrepare}
            onClick={handlePrepare}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? "Preparando…" : "Preparar pendrive/HD"}
          </Button>
        </div>

        {(busy || status || error || done) && (
          <div className={`mt-3 rounded-lg border px-3 py-3 ${error ? "border-red-500/30 bg-red-500/10" : done ? "border-green-500/40 bg-green-950/20" : "border-border bg-muted/30"}`}>
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
            {done && !error && (
              <p className="mt-2 text-[11px] leading-relaxed text-gray-200">
                {isRghOnly
                  ? "Concluído! Insira o pendrive/HD no seu Xbox 360 RGH e ligue o videogame para carregar a Aurora automaticamente."
                  : "Abra o BadAvatar pelo perfil no console. Isso não desbloqueia o Xbox de forma permanente — repita a ativação a cada vez que ligar e mantenha o console sem internet."}
              </p>
            )}
            {done && onBrowseGames && (
              <Button className="mt-3 h-10 w-full" onClick={onBrowseGames}>
                <Gamepad2 className="h-4 w-4" />
                Adicionar jogos
              </Button>
            )}
          </div>
        )}

        {!preparationEnabled && (
          <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2.5 text-center text-[11px] text-amber-300">
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
    </main>
  );
}
