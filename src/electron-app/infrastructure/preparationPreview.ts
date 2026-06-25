import { randomUUID } from "crypto";
import { constants as fsConstants, promises as fsPromises } from "fs";
import path from "path";
import {
  buildCleanDeviceImage,
  type CleanDeviceImageResult,
  type ExtractedTrustedComponent,
} from "./cleanDeviceImage";
import { hashFileSha256, verifyComponentFile } from "./secureComponentStaging";
import {
  extractTrustedZipToStaging,
  type SecureZipExtractionResult,
} from "./secureZipExtractor";
import {
  buildTransactionalWritePlan,
  type TransactionalWritePlan,
} from "./transactionalWritePlan";
import type {
  TrustedComponent,
  TrustedComponentManifest,
} from "./trustedComponentManifest";
import { validateTrustedComponentManifest } from "./trustedComponentManifest";
import {
  assessWriteCapacity,
  type TargetStorageInfo,
  type WriteCapacityAssessment,
} from "./writeCapacityPolicy";

export interface ConsolePreparationPrerequisites {
  dashboardVersion: string;
  avatarDataInstalledConfirmed: boolean;
  networkDisconnectedConfirmed: boolean;
  nonPersistentExploitAcknowledged: boolean;
  exploitProfileSafetyAcknowledged: boolean;
}

export interface ConsolePreparationAssessment {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
  normalizedDashboardVersion: string;
}

export interface PreviewComponentSummary {
  id: string;
  role: TrustedComponent["role"];
  version: string;
  archiveFormat: TrustedComponent["archive"]["format"];
  extractedFiles: number;
  extractedBytes: number;
}

export interface PreparationPreviewInput {
  /** Manifesto que o chamador já verificou com verifySignedComponentManifest. */
  trustedManifest: TrustedComponentManifest;
  componentArchivePaths: Readonly<Record<string, string>>;
  workspaceRoot: string;
  targetRoot: string;
  targetStorage: TargetStorageInfo;
  deviceFingerprint: string;
  console: ConsolePreparationPrerequisites;
  autoStartSeconds?: number;
  now?: Date;
}

export interface PreparationPreviewReport {
  mode: "read-only-preview";
  ready: boolean;
  blockers: string[];
  warnings: string[];
  sessionId: string;
  sessionRoot: string;
  targetWritesPerformed: false;
  console: ConsolePreparationAssessment;
  components: PreviewComponentSummary[];
  image: {
    root: string;
    fileCount: number;
    totalBytes: number;
  };
  plan: TransactionalWritePlan;
  capacity: WriteCapacityAssessment;
}

const PREVIEW_WARNINGS = [
  "O desbloqueio é temporário: precisa ser executado novamente após reiniciar ou desligar o console.",
  "Nunca entre no perfil do exploit, principalmente na Xbox Live.",
  "Mantenha Wi-Fi e cabo de rede desconectados durante o uso para reduzir o risco de banimento.",
  "A exploração pode exigir novas tentativas; o projeto original informa cerca de 30% de sucesso e até 20 minutos.",
];

function normalizedDashboardVersion(value: string): string {
  const compact = String(value || "").trim();
  return compact === "17559" || compact === "2.0.17559.0" ? "2.0.17559.0" : compact;
}

export function assessConsolePreparationPrerequisites(
  prerequisites: ConsolePreparationPrerequisites,
): ConsolePreparationAssessment {
  const blockers: string[] = [];
  const dashboardVersion = normalizedDashboardVersion(prerequisites.dashboardVersion);
  if (dashboardVersion !== "2.0.17559.0") {
    blockers.push("O console precisa estar no dashboard 2.0.17559.0 (17559)." );
  }
  if (!prerequisites.avatarDataInstalledConfirmed) {
    blockers.push("Confirme que os dados oficiais de Avatar da atualização 17559 estão instalados.");
  }
  if (!prerequisites.networkDisconnectedConfirmed) {
    blockers.push("Desconecte o Wi-Fi e o cabo de rede do console antes de continuar.");
  }
  if (!prerequisites.nonPersistentExploitAcknowledged) {
    blockers.push("Confirme que entendeu que o desbloqueio não persiste após reiniciar ou desligar.");
  }
  if (!prerequisites.exploitProfileSafetyAcknowledged) {
    blockers.push("Confirme que nunca entrará no perfil do exploit, especialmente na Xbox Live.");
  }
  return {
    allowed: blockers.length === 0,
    blockers,
    warnings: [...PREVIEW_WARNINGS],
    normalizedDashboardVersion: dashboardVersion,
  };
}

async function createSafeSessionRoot(workspaceRoot: string): Promise<{ sessionId: string; sessionRoot: string }> {
  if (!path.isAbsolute(workspaceRoot)) throw new Error("A raiz de trabalho da prévia precisa ser absoluta.");
  const root = path.resolve(workspaceRoot);
  const stat = await fsPromises.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("A raiz de trabalho da prévia precisa ser um diretório real.");
  }
  const realRoot = await fsPromises.realpath(root);
  if (
    (process.platform === "win32" ? realRoot.toLowerCase() : realRoot) !==
    (process.platform === "win32" ? root.toLowerCase() : root)
  ) {
    throw new Error("A raiz de trabalho da prévia atravessa link ou redirecionamento.");
  }
  const sessionId = randomUUID();
  const sessionRoot = path.join(root, `preview-${sessionId}`);
  await fsPromises.mkdir(sessionRoot, { recursive: false });
  return { sessionId, sessionRoot };
}

function validateArchiveSelection(
  manifest: TrustedComponentManifest,
  archivePaths: Readonly<Record<string, string>>,
): TrustedComponent[] {
  if (!archivePaths || typeof archivePaths !== "object" || Array.isArray(archivePaths)) {
    throw new Error("A seleção de arquivos dos componentes é inválida.");
  }
  const prototype = Object.getPrototypeOf(archivePaths);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("A seleção de arquivos dos componentes precisa ser um objeto simples.");
  }
  const byId = new Map(manifest.components.map((component) => [component.id, component]));
  for (const id of Object.keys(archivePaths)) {
    if (!byId.has(id)) throw new Error(`Arquivo fornecido para componente desconhecido: ${id}.`);
  }
  for (const component of manifest.components) {
    if (component.required && (!Object.hasOwn(archivePaths, component.id) || !archivePaths[component.id])) {
      throw new Error(`Componente obrigatório ausente na prévia: ${component.id}.`);
    }
  }
  return manifest.components.filter(
    (component) => Object.hasOwn(archivePaths, component.id) && Boolean(archivePaths[component.id]),
  );
}

async function stageRawComponent(
  sourcePath: string,
  extractionRoot: string,
  component: TrustedComponent,
): Promise<SecureZipExtractionResult> {
  if (!path.isAbsolute(sourcePath)) throw new Error(`O arquivo de ${component.id} precisa ter caminho absoluto.`);
  const verification = await verifyComponentFile(sourcePath, component.source);
  if (!verification.valid) {
    throw new Error(`O arquivo raw de ${component.id} não corresponde ao manifesto: ${verification.reason}`);
  }
  const outputPath = path.join(extractionRoot, component.id);
  await fsPromises.mkdir(outputPath, { recursive: false });
  const destination = path.join(outputPath, component.source.fileName);
  await fsPromises.copyFile(sourcePath, destination, fsConstants.COPYFILE_EXCL);
  const copiedHash = await hashFileSha256(destination);
  const copiedStat = await fsPromises.lstat(destination);
  if (!copiedStat.isFile() || copiedStat.isSymbolicLink() || copiedStat.size !== verification.actualSizeBytes || copiedHash !== verification.actualSha256) {
    throw new Error(`A cópia raw de ${component.id} mudou durante o staging.`);
  }
  const handle = await fsPromises.open(destination, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  return {
    outputPath,
    files: [{
      sourcePath: destination,
      archivePath: component.source.fileName,
      sizeBytes: copiedStat.size,
      sha256: copiedHash,
    }],
    totalBytes: copiedStat.size,
    entryCount: 1,
  };
}

async function extractSelectedComponents(
  components: TrustedComponent[],
  archivePaths: Readonly<Record<string, string>>,
  extractionRoot: string,
): Promise<ExtractedTrustedComponent[]> {
  await fsPromises.mkdir(extractionRoot, { recursive: false });
  const extracted: ExtractedTrustedComponent[] = [];
  for (const component of components) {
    const archivePath = archivePaths[component.id];
    if (!path.isAbsolute(archivePath)) {
      throw new Error(`O arquivo de ${component.id} precisa ter caminho absoluto.`);
    }
    const extraction = component.archive.format === "zip"
      ? await extractTrustedZipToStaging(archivePath, extractionRoot, component)
      : await stageRawComponent(archivePath, extractionRoot, component);
    extracted.push({ component, extraction });
  }
  return extracted;
}

/**
 * Executa todo o ensaio no PC. A única operação sobre targetRoot é o inventário
 * de leitura feito por assessWriteCapacity; esta função não formata nem grava o destino.
 */
export async function createPreparationPreview(
  input: PreparationPreviewInput,
): Promise<PreparationPreviewReport> {
  const trustedManifest = validateTrustedComponentManifest(
    input.trustedManifest,
    input.now ?? new Date(),
  );
  const selectedComponents = validateArchiveSelection(trustedManifest, input.componentArchivePaths);
  const consoleAssessment = assessConsolePreparationPrerequisites(input.console);
  const { sessionId, sessionRoot } = await createSafeSessionRoot(input.workspaceRoot);
  try {
    const extracted = await extractSelectedComponents(
      selectedComponents,
      input.componentArchivePaths,
      path.join(sessionRoot, "components"),
    );
    const image: CleanDeviceImageResult = await buildCleanDeviceImage(
      trustedManifest,
      extracted,
      path.join(sessionRoot, "image"),
      { autoStartSeconds: input.autoStartSeconds, now: input.now },
    );
    const plan = await buildTransactionalWritePlan({
      sourceRoot: image.imageRoot,
      deviceFingerprint: input.deviceFingerprint,
      manifestId: trustedManifest.manifestId,
      manifestRelease: trustedManifest.release,
      entries: image.files,
    }, input.now);
    const capacity = await assessWriteCapacity(plan, input.targetRoot, input.targetStorage);
    const blockers = [...consoleAssessment.blockers, ...capacity.blockers];
    return {
      mode: "read-only-preview",
      ready: blockers.length === 0,
      blockers,
      warnings: [...consoleAssessment.warnings],
      sessionId,
      sessionRoot,
      targetWritesPerformed: false,
      console: consoleAssessment,
      components: extracted.map(({ component, extraction }) => ({
        id: component.id,
        role: component.role,
        version: component.version,
        archiveFormat: component.archive.format,
        extractedFiles: extraction.files.length,
        extractedBytes: extraction.totalBytes,
      })),
      image: {
        root: image.imageRoot,
        fileCount: image.files.length,
        totalBytes: image.files.reduce((total, file) => total + file.sizeBytes, 0),
      },
      plan,
      capacity,
    };
  } catch (error) {
    await fsPromises.rm(sessionRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
