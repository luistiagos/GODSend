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
    reasons: string[];
  };
}

interface BadAvatarUsbPageProps {
  onBrowseGames?: () => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / (1024 ** 2))} MB`;
}

export default function BadAvatarUsbPage({ onBrowseGames }: BadAvatarUsbPageProps) {
  const [drives, setDrives] = useState<UsbDrive[]>([]);
  const [selectedDrive, setSelectedDrive] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formatAvailable, setFormatAvailable] = useState(false);
  const [formatDrive, setFormatDrive] = useState(false);
  const [requirementsAccepted, setRequirementsAccepted] = useState(false);
  const [preparationEnabled, setPreparationEnabled] = useState(false);
  const [preparationBlockers, setPreparationBlockers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const refreshDrives = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const drivesPromise = window.godsendApi.toolsBadAvatarListDrives().then((driveResult: any) => {
      if (!driveResult?.ok) {
        setDrives([]);
        setSelectedDrive("");
        setLoadError("Não foi possível procurar dispositivos USB.");
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
  }, []);

  useEffect(() => {
    refreshDrives();
  }, [refreshDrives]);

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
    preparationEnabled && deviceAllowed && requirementsAccepted && !loading && !busy,
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

  return (
    <main className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto px-4 py-5 sm:px-7">
      <header className="mb-5 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-green-500/10 text-green-400">
          <Gamepad2 className="h-6 w-6" />
        </div>
        <h1 className="font-display text-xl font-bold text-foreground">
          Prepare seu pendrive ou HD
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
          Conecte o dispositivo, escolha abaixo e clique em preparar. O BadAvatar e o Aurora
          serão instalados e configurados automaticamente.
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

            {selectedDevice && !deviceAllowed && (
              <p className="mt-2 text-[11px] leading-relaxed text-red-300">
                {selectedDevice.safety?.reasons?.[0] || "Escolha outro dispositivo USB."}
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
            <div className="text-[13px] font-semibold text-foreground">BadAvatar + Aurora</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Já incluídos. Você não precisa escolher pacotes nem configurar pastas.
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

      <div className="mt-4">
        <Button
          variant="primary"
          className="h-11 w-full bg-green-600 text-sm hover:bg-green-500"
          disabled={!canPrepare}
          onClick={handlePrepare}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {busy ? "Preparando…" : "Preparar pendrive/HD"}
        </Button>
      </div>

      {(busy || status || error || done) && (
        <div className={`mt-3 rounded-lg border px-3 py-3 ${error ? "border-red-500/30 bg-red-500/10" : done ? "border-green-500/30 bg-green-500/10" : "border-border bg-muted/30"}`}>
          <div className="h-2 overflow-hidden rounded-full bg-background">
            <div
              className={`h-full transition-all duration-300 ${error ? "bg-red-500" : "bg-green-500"}`}
              style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
            />
          </div>
          <p className={`mt-2 text-[11px] ${error ? "text-red-300" : done ? "text-green-300" : "text-muted-foreground"}`}>
            {error || status}
          </p>
          {done && !error && (
            <p className="mt-2 text-[11px] leading-relaxed text-green-200/80">
              Abra o BadAvatar pelo perfil no console. Isso não desbloqueia o Xbox de forma
              permanente — repita a ativação a cada vez que ligar e mantenha o console sem internet.
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
    </main>
  );
}
