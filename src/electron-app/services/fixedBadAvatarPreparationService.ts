import { createHash } from "crypto";
import { app } from "electron";
import fs, { promises as fsPromises } from "fs";
import path from "path";
import { formatVolumeFat32 } from "../infrastructure/fat32Format";
import { getBundledResourcesRoot, getRepoRoot } from "../infrastructure/fileSystem";
import {
  AURORA_READY_TO_PLAY_FILTER_PATH,
  generateAuroraReadyToPlayFilterLua,
  generateReadyToPlayMarker,
  generateReadyToPlayLaunchIni,
  READY_TO_PLAY_MARKER_PATH,
  READY_TO_PLAY_CONFIGURATION_VERSION,
} from "../infrastructure/readyToPlayConfiguration";
import { executeTransactionalWriteToDevice } from "../infrastructure/simulatedTransactionalWriter";
import { buildTransactionalWritePlan, validateXboxTargetRelativePath } from "../infrastructure/transactionalWritePlan";
import { assessWriteCapacity } from "../infrastructure/writeCapacityPolicy";
import {
  enumerateSafeWindowsUsbDevices,
  requireSafeWindowsUsbTarget,
} from "../infrastructure/windowsUsbDeviceService";

const PACKAGE_INDEX_FILE_NAME = "badavatar-package.json";
const DEVICE_REVALIDATION_INTERVAL_MS = 10_000;

interface FixedPayloadPackageIndex {
  schemaVersion: 1;
  directoryName: string;
  manifestFileName: string;
  release: string;
  bundleSha256: string;
}

interface FixedPayloadManifestFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

interface FixedPayloadManifest {
  manifestVersion: 1;
  manifestId: string;
  release: string;
  createdAt: string;
  bundleSha256: string;
  fileCount: number;
  totalBytes: number;
  files: FixedPayloadManifestFile[];
}

export interface FixedPreparationRequest {
  driveRoot: string;
  expectedDeviceFingerprint: string;
  formatDrive: boolean;
  requirementsAccepted: boolean;
  isRghOnly?: boolean;
}

export interface FixedPreparationProgress {
  status: string;
  percent: number;
  detail?: string;
}

export interface FixedPreparationResult {
  release: string;
  fileCount: number;
  totalBytes: number;
  writtenFiles: number;
  reusedFiles: number;
  resumed: boolean;
}

function assetsCandidates(): string[] {
  return [
    path.join(getBundledResourcesRoot(), "assets"),
    path.join(getRepoRoot(), "src", "electron-app", "assets"),
  ];
}

function loadPackageIndex(): { assetsRoot: string; index: FixedPayloadPackageIndex } {
  for (const assetsRoot of assetsCandidates()) {
    const indexPath = path.join(assetsRoot, PACKAGE_INDEX_FILE_NAME);
    if (!fs.existsSync(indexPath)) continue;
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (
      index?.schemaVersion !== 1 ||
      !/^badavatar-[0-9A-Za-z._-]+$/.test(index?.directoryName || "") ||
      !/^badavatar-[0-9A-Za-z._-]+\.manifest\.json$/.test(index?.manifestFileName || "") ||
      typeof index?.release !== "string" ||
      !/^[a-f0-9]{64}$/.test(index?.bundleSha256 || "")
    ) {
      throw new Error("O arquivo da versão ativa do BadAvatar é inválido.");
    }
    return { assetsRoot, index: index as FixedPayloadPackageIndex };
  }
  throw new Error("O arquivo da versão ativa do BadAvatar não foi encontrado.");
}

function payloadCandidates(assetsRoot: string, index: FixedPayloadPackageIndex): string[] {
  return [
    process.env.GODSEND_BADAVATAR_PAYLOAD || "",
    path.join(assetsRoot, index.directoryName),
  ].filter(Boolean);
}

function firstExistingDirectory(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // Try the next bundled/development location.
    }
  }
  return null;
}

function firstExistingFile(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Try the next bundled/development location.
    }
  }
  return null;
}

function deterministicTransactionId(
  bundleHash: string,
  fingerprint: string,
  scope = "",
): `${string}-${string}-${string}-${string}-${string}` {
  const seed = scope ? `${bundleHash}:${fingerprint}:${scope}` : `${bundleHash}:${fingerprint}`;
  const hex = createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function loadManifest(assetsRoot: string, index: FixedPayloadPackageIndex): FixedPayloadManifest {
  const manifestPath = firstExistingFile([path.join(assetsRoot, index.manifestFileName)]);
  if (!manifestPath) throw new Error(`O manifesto da versão ${index.release} não foi encontrado.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest?.manifestVersion !== 1 ||
    manifest?.manifestId !== "godsend.fixed.badavatar" ||
    typeof manifest?.release !== "string" ||
    !Number.isFinite(Date.parse(manifest?.createdAt)) ||
    !/^[a-f0-9]{64}$/.test(manifest?.bundleSha256 || "") ||
    !Number.isSafeInteger(manifest?.fileCount) ||
    !Number.isSafeInteger(manifest?.totalBytes) ||
    !Array.isArray(manifest?.files) ||
    manifest.files.length !== manifest.fileCount
  ) {
    throw new Error(`O manifesto da versão ${index.release} é inválido.`);
  }
  const seen = new Set<string>();
  let totalBytes = 0;
  const bundleHash = createHash("sha256");
  for (const file of manifest.files) {
    const relativePath = validateXboxTargetRelativePath(file?.path);
    const key = relativePath.toLowerCase();
    if (seen.has(key)) throw new Error(`Arquivo duplicado no pacote fixo: ${relativePath}.`);
    if (!Number.isSafeInteger(file?.sizeBytes) || file.sizeBytes < 0 || !/^[a-f0-9]{64}$/.test(file?.sha256 || "")) {
      throw new Error(`Entrada inválida no pacote fixo: ${relativePath}.`);
    }
    seen.add(key);
    totalBytes += file.sizeBytes;
    bundleHash.update(`${key}\n${file.sizeBytes}\n${file.sha256}\n`, "utf8");
  }
  if (
    manifest.release !== index.release ||
    manifest.bundleSha256 !== index.bundleSha256 ||
    totalBytes !== manifest.totalBytes ||
    bundleHash.digest("hex") !== manifest.bundleSha256
  ) {
    throw new Error(`O catálogo da versão ${index.release} foi alterado.`);
  }
  return manifest as FixedPayloadManifest;
}

async function listPayloadFiles(root: string, directory = root, output: string[] = []): Promise<string[]> {
  for (const entry of await fsPromises.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`O pacote contém um link não permitido: ${entry.name}.`);
    if (entry.isDirectory()) await listPayloadFiles(root, fullPath, output);
    else if (entry.isFile()) output.push(path.relative(root, fullPath).split(path.sep).join("/"));
  }
  return output;
}

async function createReadyToPlayStagingDirectory(sourceRoot: string, transactionId: string): Promise<string> {
  const directoryName = `.godsend-ready-to-play-${transactionId}`;
  const candidates = [
    path.join(path.dirname(sourceRoot), directoryName),
    path.join(app.getPath("temp"), directoryName),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      await fsPromises.rm(candidate, { recursive: true, force: true });
      await fsPromises.mkdir(candidate);
      return candidate;
    } catch (error) {
      lastError = error;
      await fsPromises.rm(candidate, { recursive: true, force: true }).catch(() => {});
    }
  }
  throw lastError || new Error("N\u00e3o foi poss\u00edvel criar o staging da configura\u00e7\u00e3o autom\u00e1tica.");
}

async function stagePayloadEntry(sourcePath: string, destinationPath: string): Promise<void> {
  await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
  try {
    await fsPromises.link(sourcePath, destinationPath);
  } catch {
    await fsPromises.copyFile(sourcePath, destinationPath);
  }
}

async function replaceGeneratedEntry(
  entries: Array<{ sourcePath: string; relativePath: string; sizeBytes: number; sha256: string }>,
  stagingRoot: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const key = relativePath.toLowerCase();
  const destinationPath = path.join(stagingRoot, ...relativePath.split("/"));
  await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true });
  await fsPromises.rm(destinationPath, { force: true });
  await fsPromises.writeFile(destinationPath, contents, "utf8");
  const stat = await fsPromises.stat(destinationPath);
  const existingIndex = entries.findIndex((entry) => entry.relativePath.toLowerCase() === key);
  if (existingIndex >= 0) entries.splice(existingIndex, 1);
  entries.push({
    sourcePath: destinationPath,
    relativePath,
    sizeBytes: stat.size,
    sha256: createHash("sha256").update(contents, "utf8").digest("hex"),
  });
}

export function inspectFixedPayloadReadiness(): {
  ready: boolean;
  blocker?: string;
  release?: string;
  fileCount?: number;
  totalBytes?: number;
} {
  try {
    const { assetsRoot, index } = loadPackageIndex();
    const root = firstExistingDirectory(payloadCandidates(assetsRoot, index));
    if (!root) return { ready: false, blocker: `A versão ${index.release} não foi incorporada ao aplicativo.` };
    const manifest = loadManifest(assetsRoot, index);
    return {
      ready: true,
      release: manifest.release,
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
    };
  } catch (error: any) {
    return { ready: false, blocker: error?.message || String(error) };
  }
}

async function waitForFormattedDevice(root: string, expectedVolumeBytes: number) {
  const normalizedRoot = root.trim().toUpperCase();
  let lastError: any;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const matches = (await enumerateSafeWindowsUsbDevices()).filter(
        (candidate) => candidate.rootPath.trim().toUpperCase() === normalizedRoot,
      );
      if (matches.length !== 1 || !matches[0].safety.allowed) {
        throw new Error("O dispositivo formatado ainda não voltou a ficar disponível com segurança.");
      }
      const candidate = matches[0];
      const actualBytes = candidate.partitionSizeBytes || candidate.sizeBytes;
      const tolerance = Math.max(16 * 1024 ** 2, Math.floor(expectedVolumeBytes * 0.01));
      if (Math.abs(actualBytes - expectedVolumeBytes) > tolerance) {
        throw new Error("A capacidade mudou após a formatação; selecione o dispositivo novamente.");
      }
      if (String(candidate.fileSystem || "").toUpperCase() !== "FAT32") {
        throw new Error("O dispositivo voltou a aparecer, mas ainda não está em FAT32.");
      }
      return candidate;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error("O dispositivo não voltou a ficar disponível após a formatação.");
}

function createThrottledUsbTargetRevalidator(root: string, fingerprint: string): () => Promise<void> {
  let lastFullValidationAt = 0;
  let pendingFullValidation: Promise<void> | null = null;

  return async () => {
    try {
      await fsPromises.access(root);
    } catch {
      lastFullValidationAt = 0;
      throw new Error("O dispositivo USB não está acessível. Reconecte o pendrive e tente novamente.");
    }

    const now = Date.now();
    if (now - lastFullValidationAt < DEVICE_REVALIDATION_INTERVAL_MS) return;

    if (!pendingFullValidation) {
      pendingFullValidation = requireSafeWindowsUsbTarget(root, fingerprint)
        .then(() => {
          lastFullValidationAt = Date.now();
        })
        .finally(() => {
          pendingFullValidation = null;
        });
    }
    await pendingFullValidation;
  };
}

export async function prepareFixedBadAvatarDevice(
  request: FixedPreparationRequest,
  onProgress: (progress: FixedPreparationProgress) => void,
): Promise<FixedPreparationResult> {
  if (process.platform !== "win32") throw new Error("A preparação está disponível somente no Windows.");
  if (!request?.isRghOnly && !request?.requirementsAccepted) {
    throw new Error("Confirme os requisitos do Xbox 360 antes de preparar o dispositivo.");
  }
  if (!request?.driveRoot || !/^[a-f0-9]{64}$/i.test(request?.expectedDeviceFingerprint || "")) {
    throw new Error("Atualize a lista e selecione novamente o pendrive ou HD.");
  }

  let device = await requireSafeWindowsUsbTarget(request.driveRoot, request.expectedDeviceFingerprint);
  if (request.formatDrive) {
    const expectedVolumeBytes = device.partitionSizeBytes || device.sizeBytes;
    await formatVolumeFat32(request.driveRoot, (progress) => {
      onProgress({ status: progress.status, percent: Math.min(12, progress.percent) });
    }, "BADAVATAR", {
      expectedVolumeGuid: device.volumeGuid,
      expectedVolumeBytes,
    });
    device = await waitForFormattedDevice(request.driveRoot, expectedVolumeBytes);
  }

  const effectiveDeviceFingerprint = device.fingerprint;

  if (String(device.fileSystem || "").toUpperCase() !== "FAT32") {
    throw new Error("O dispositivo precisa estar em FAT32. Marque “Formatar antes” e tente novamente.");
  }

  const { assetsRoot, index } = loadPackageIndex();
  let sourceRoot = firstExistingDirectory(payloadCandidates(assetsRoot, index));
  if (!sourceRoot) throw new Error(`A versão ${index.release} não foi encontrada no aplicativo.`);
  const manifest = loadManifest(assetsRoot, index);
  onProgress({ status: `Verificando o pacote ${manifest.release}…`, percent: 14 });
  const transactionScope = request.isRghOnly
    ? `rgh-only-ready-to-play-v${READY_TO_PLAY_CONFIGURATION_VERSION}`
    : `badavatar-ready-to-play-v${READY_TO_PLAY_CONFIGURATION_VERSION}`;
  const transactionId = deterministicTransactionId(
    manifest.bundleSha256,
    effectiveDeviceFingerprint,
    transactionScope,
  );

  const actualPaths = (await listPayloadFiles(sourceRoot)).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const expectedPaths = manifest.files.map((file) => file.path).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  if (actualPaths.length !== expectedPaths.length || actualPaths.some((item, index) => item !== expectedPaths[index])) {
    throw new Error(`Os arquivos incorporados da versão ${manifest.release} não correspondem ao catálogo.`);
  }

  let entries = manifest.files.map((file) => ({
    sourcePath: path.join(sourceRoot, ...file.path.split("/")),
    relativePath: file.path,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
  }));

  let tempStagingDir: string | null = null;

  try {
    if (request.isRghOnly) {
      entries = entries.filter((entry) => entry.relativePath.startsWith("Aurora/"));
    }

    onProgress({ status: "Configurando inicializa\u00e7\u00e3o e biblioteca do Aurora\u2026", percent: 17 });
    tempStagingDir = await createReadyToPlayStagingDirectory(sourceRoot, transactionId);
    for (const entry of entries) {
      const destinationPath = path.join(tempStagingDir, ...entry.relativePath.split("/"));
      await stagePayloadEntry(entry.sourcePath, destinationPath);
      entry.sourcePath = destinationPath;
    }

    await replaceGeneratedEntry(
      entries,
      tempStagingDir,
      AURORA_READY_TO_PLAY_FILTER_PATH,
      generateAuroraReadyToPlayFilterLua(),
    );
    await replaceGeneratedEntry(
      entries,
      tempStagingDir,
      READY_TO_PLAY_MARKER_PATH,
      generateReadyToPlayMarker(),
    );
    await replaceGeneratedEntry(
      entries,
      tempStagingDir,
      "launch.ini",
      generateReadyToPlayLaunchIni(),
    );
    sourceRoot = tempStagingDir;

    const plan = await buildTransactionalWritePlan({
      sourceRoot,
      deviceFingerprint: effectiveDeviceFingerprint,
      manifestId: manifest.manifestId,
      manifestRelease: manifest.release,
      entries,
    }, new Date(manifest.createdAt), transactionId);

    onProgress({ status: "Verificando espaço disponível…", percent: 20 });
    device = await requireSafeWindowsUsbTarget(request.driveRoot, effectiveDeviceFingerprint);
    const capacity = await assessWriteCapacity(plan, request.driveRoot, {
      fileSystem: device.fileSystem,
      totalBytes: device.partitionSizeBytes || device.sizeBytes,
      freeBytes: device.freeBytes,
      allocationUnitBytes: device.allocationUnitBytes,
    });
    if (!capacity.allowed) throw new Error(capacity.blockers[0] || "O dispositivo não possui espaço suficiente.");

    const revalidateTarget = createThrottledUsbTargetRevalidator(
      request.driveRoot,
      effectiveDeviceFingerprint,
    );
    await revalidateTarget();

    const result = await executeTransactionalWriteToDevice(plan, request.driveRoot, {
      revalidateTarget,
      onProgress: (progress) => onProgress({
        status: progress.status,
        percent: 24 + Math.floor(progress.percent * 0.76),
        detail: `${Math.min(progress.completedFiles + 1, progress.totalFiles)}/${progress.totalFiles}`,
      }),
    });

    return {
      release: manifest.release,
      fileCount: plan.entries.length,
      totalBytes: plan.totalBytes,
      writtenFiles: result.writtenFiles,
      reusedFiles: result.reusedFiles,
      resumed: result.resumed,
    };
  } finally {
    if (tempStagingDir) {
      await fsPromises.rm(tempStagingDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
