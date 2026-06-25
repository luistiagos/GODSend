import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import {
  createPreparationPreview,
  type ConsolePreparationPrerequisites,
  type PreparationPreviewReport,
} from "../infrastructure/preparationPreview";
import { stageTrustedComponent } from "../infrastructure/secureComponentStaging";
import { requireSafeWindowsUsbTarget } from "../infrastructure/windowsUsbDeviceService";
import { loadTrustedComponentManifest } from "./preparationReadinessService";

export interface PreparationPreviewRequest {
  driveRoot: string;
  expectedDeviceFingerprint: string;
  console: ConsolePreparationPrerequisites;
}

export interface PreparationPreviewProgress {
  stage: "manifest" | "download" | "device" | "compose" | "complete";
  percent: number;
  status: string;
  componentId?: string;
}

export type PreparationPreviewProgressCallback = (progress: PreparationPreviewProgress) => void;

export interface PublicPreparationPreviewReport {
  mode: "read-only-preview";
  ready: boolean;
  targetWritesPerformed: false;
  sessionId: string;
  manifestId: string;
  manifestRelease: string;
  blockers: string[];
  warnings: string[];
  components: PreparationPreviewReport["components"];
  image: {
    fileCount: number;
    totalBytes: number;
  };
  plan: {
    hash: string;
    fileCount: number;
    totalBytes: number;
  };
  capacity: {
    allowed: boolean;
    filesToWrite: number;
    filesReused: number;
    requiredFreeBytes: number;
    freeBytes: number;
    shortfallBytes: number;
  };
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`${field} contém campos não permitidos: ${extras.join(", ")}.`);
}

export function validatePreparationPreviewRequest(request: PreparationPreviewRequest): void {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("A solicitação de prévia é inválida.");
  }
  assertOnlyKeys(
    request as unknown as Record<string, unknown>,
    ["driveRoot", "expectedDeviceFingerprint", "console"],
    "A solicitação de prévia",
  );
  if (typeof request.driveRoot !== "string" || !/^[a-z]:\\$/i.test(request.driveRoot.trim())) {
    throw new Error("Selecione novamente uma unidade USB válida.");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(request.expectedDeviceFingerprint || ""))) {
    throw new Error("A identidade do dispositivo é inválida; atualize a lista.");
  }
  const console = request.console;
  if (!console || typeof console !== "object" || Array.isArray(console)) {
    throw new Error("As confirmações do console estão ausentes.");
  }
  assertOnlyKeys(
    console as unknown as Record<string, unknown>,
    [
      "dashboardVersion",
      "avatarDataInstalledConfirmed",
      "networkDisconnectedConfirmed",
      "nonPersistentExploitAcknowledged",
      "exploitProfileSafetyAcknowledged",
    ],
    "As confirmações do console",
  );
  if (typeof console.dashboardVersion !== "string" || console.dashboardVersion.length > 30) {
    throw new Error("A versão do dashboard informada é inválida.");
  }
  for (const field of [
    "avatarDataInstalledConfirmed",
    "networkDisconnectedConfirmed",
    "nonPersistentExploitAcknowledged",
    "exploitProfileSafetyAcknowledged",
  ] as const) {
    if (typeof console[field] !== "boolean") throw new Error("As confirmações do console são inválidas.");
  }
}

function ensureRealDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("A área de trabalho da prévia não é um diretório real.");
  }
  const resolved = path.resolve(directory);
  const real = fs.realpathSync(directory);
  if ((process.platform === "win32" ? resolved.toLowerCase() : resolved) !==
      (process.platform === "win32" ? real.toLowerCase() : real)) {
    throw new Error("A área de trabalho da prévia atravessa link ou redirecionamento.");
  }
}

function releaseCacheKey(manifestId: string, release: string): string {
  return createHash("sha256").update(`${manifestId}\n${release}`, "utf8").digest("hex");
}

export function toPublicPreparationPreviewReport(
  report: PreparationPreviewReport,
): PublicPreparationPreviewReport {
  return {
    mode: report.mode,
    ready: report.ready,
    targetWritesPerformed: false,
    sessionId: report.sessionId,
    manifestId: report.plan.manifestId,
    manifestRelease: report.plan.manifestRelease,
    blockers: [...report.blockers],
    warnings: [...report.warnings],
    components: report.components.map((component) => ({ ...component })),
    image: {
      fileCount: report.image.fileCount,
      totalBytes: report.image.totalBytes,
    },
    plan: {
      hash: report.plan.planHash,
      fileCount: report.plan.entries.length,
      totalBytes: report.plan.totalBytes,
    },
    capacity: {
      allowed: report.capacity.allowed,
      filesToWrite: report.capacity.filesToWrite,
      filesReused: report.capacity.filesReused,
      requiredFreeBytes: report.capacity.requiredFreeBytes,
      freeBytes: report.capacity.storage.freeBytes,
      shortfallBytes: report.capacity.shortfallBytes,
    },
  };
}

export async function runTrustedPreparationPreview(
  request: PreparationPreviewRequest,
  userDataRoot: string,
  onProgress: PreparationPreviewProgressCallback = () => {},
  signal?: AbortSignal,
): Promise<PublicPreparationPreviewReport> {
  if (signal?.aborted) throw Object.assign(new Error("Operação cancelada."), { name: "AbortError" });
  validatePreparationPreviewRequest(request);
  if (process.platform !== "win32") {
    throw new Error("A prévia segura de dispositivo está disponível somente no Windows nesta fase.");
  }

  onProgress({ stage: "manifest", percent: 2, status: "Verificando o manifesto assinado…" });
  const now = new Date();
  const manifest = loadTrustedComponentManifest(now);

  onProgress({ stage: "device", percent: 5, status: "Revalidando o dispositivo físico…" });
  await requireSafeWindowsUsbTarget(request.driveRoot, request.expectedDeviceFingerprint);

  const preparationRoot = path.join(path.resolve(userDataRoot), "preparation");
  const previewRoot = path.join(preparationRoot, "previews");
  const componentRoot = path.join(
    preparationRoot,
    "components",
    releaseCacheKey(manifest.manifestId, manifest.release),
  );
  ensureRealDirectory(previewRoot);
  ensureRealDirectory(componentRoot);

  const componentArchivePaths: Record<string, string> = Object.create(null);
  const totalComponents = manifest.components.length;
  for (let index = 0; index < totalComponents; index++) {
    const component = manifest.components[index];
    const startPercent = 8 + Math.floor((index / totalComponents) * 52);
    const span = Math.max(1, Math.floor(52 / totalComponents));
    onProgress({
      stage: "download",
      percent: startPercent,
      status: `Verificando ${component.displayName}…`,
      componentId: component.id,
    });
    const staged = await stageTrustedComponent(component, componentRoot, (progress) => {
      const ratio = progress.totalBytes > 0 ? progress.receivedBytes / progress.totalBytes : 0;
      onProgress({
        stage: "download",
        percent: Math.min(60, startPercent + Math.floor(ratio * span)),
        status: `Baixando e verificando ${component.displayName}…`,
        componentId: component.id,
      });
    }, { signal });
    componentArchivePaths[component.id] = staged.filePath;
  }

  if (signal?.aborted) throw Object.assign(new Error("Operação cancelada."), { name: "AbortError" });
  onProgress({ stage: "device", percent: 64, status: "Confirmando novamente o dispositivo físico…" });
  const device = await requireSafeWindowsUsbTarget(
    request.driveRoot,
    request.expectedDeviceFingerprint,
  );

  onProgress({ stage: "compose", percent: 70, status: "Montando a prévia segura no computador…" });
  const report = await createPreparationPreview({
    trustedManifest: manifest,
    componentArchivePaths,
    workspaceRoot: previewRoot,
    targetRoot: device.rootPath,
    targetStorage: {
      fileSystem: device.fileSystem,
      totalBytes: device.partitionSizeBytes || device.sizeBytes,
      freeBytes: device.freeBytes,
      allocationUnitBytes: device.allocationUnitBytes,
    },
    deviceFingerprint: device.fingerprint,
    console: request.console,
    now,
  });

  if (signal?.aborted) {
    fs.rmSync(report.sessionRoot, { recursive: true, force: true });
    throw Object.assign(new Error("Operação cancelada."), { name: "AbortError" });
  }
  await requireSafeWindowsUsbTarget(request.driveRoot, request.expectedDeviceFingerprint);
  onProgress({ stage: "complete", percent: 100, status: "Prévia concluída; nenhum arquivo foi gravado no dispositivo." });
  return toPublicPreparationPreviewReport(report);
}
