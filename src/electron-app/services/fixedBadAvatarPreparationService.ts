import { createHash } from "crypto";
import fs, { promises as fsPromises } from "fs";
import path from "path";
import { formatVolumeFat32 } from "../infrastructure/fat32Format";
import { getBundledResourcesRoot, getRepoRoot } from "../infrastructure/fileSystem";
import { executeTransactionalWriteToDevice } from "../infrastructure/simulatedTransactionalWriter";
import { buildTransactionalWritePlan, validateXboxTargetRelativePath } from "../infrastructure/transactionalWritePlan";
import { assessWriteCapacity } from "../infrastructure/writeCapacityPolicy";
import { requireSafeWindowsUsbTarget } from "../infrastructure/windowsUsbDeviceService";

const PACKAGE_INDEX_FILE_NAME = "badavatar-package.json";

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
): `${string}-${string}-${string}-${string}-${string}` {
  const hex = createHash("sha256").update(`${bundleHash}:${fingerprint}`, "utf8").digest("hex");
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

async function waitForSameDevice(root: string, fingerprint: string) {
  let lastError: any;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return await requireSafeWindowsUsbTarget(root, fingerprint);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error("O dispositivo não voltou a ficar disponível após a formatação.");
}

export async function prepareFixedBadAvatarDevice(
  request: FixedPreparationRequest,
  onProgress: (progress: FixedPreparationProgress) => void,
): Promise<FixedPreparationResult> {
  if (process.platform !== "win32") throw new Error("A preparação está disponível somente no Windows.");
  if (!request?.requirementsAccepted) {
    throw new Error("Confirme os requisitos do Xbox 360 antes de preparar o dispositivo.");
  }
  if (!request?.driveRoot || !/^[a-f0-9]{64}$/i.test(request?.expectedDeviceFingerprint || "")) {
    throw new Error("Atualize a lista e selecione novamente o pendrive ou HD.");
  }

  let device = await requireSafeWindowsUsbTarget(request.driveRoot, request.expectedDeviceFingerprint);
  if (request.formatDrive) {
    await formatVolumeFat32(request.driveRoot, (progress) => {
      onProgress({ status: progress.status, percent: Math.min(12, progress.percent) });
    });
    device = await waitForSameDevice(request.driveRoot, request.expectedDeviceFingerprint);
  }

  if (String(device.fileSystem || "").toUpperCase() !== "FAT32") {
    throw new Error("O dispositivo precisa estar em FAT32. Marque “Formatar antes” e tente novamente.");
  }

  const { assetsRoot, index } = loadPackageIndex();
  const sourceRoot = firstExistingDirectory(payloadCandidates(assetsRoot, index));
  if (!sourceRoot) throw new Error(`A versão ${index.release} não foi encontrada no aplicativo.`);
  const manifest = loadManifest(assetsRoot, index);
  onProgress({ status: `Verificando o pacote ${manifest.release}…`, percent: 14 });

  const actualPaths = (await listPayloadFiles(sourceRoot)).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const expectedPaths = manifest.files.map((file) => file.path).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  if (actualPaths.length !== expectedPaths.length || actualPaths.some((item, index) => item !== expectedPaths[index])) {
    throw new Error(`Os arquivos incorporados da versão ${manifest.release} não correspondem ao catálogo.`);
  }

  const plan = await buildTransactionalWritePlan({
    sourceRoot,
    deviceFingerprint: request.expectedDeviceFingerprint,
    manifestId: manifest.manifestId,
    manifestRelease: manifest.release,
    entries: manifest.files.map((file) => ({
      sourcePath: path.join(sourceRoot, ...file.path.split("/")),
      relativePath: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
    })),
  }, new Date(manifest.createdAt), deterministicTransactionId(manifest.bundleSha256, request.expectedDeviceFingerprint));

  onProgress({ status: "Verificando espaço disponível…", percent: 20 });
  device = await requireSafeWindowsUsbTarget(request.driveRoot, request.expectedDeviceFingerprint);
  const capacity = await assessWriteCapacity(plan, request.driveRoot, {
    fileSystem: device.fileSystem,
    totalBytes: device.partitionSizeBytes || device.sizeBytes,
    freeBytes: device.freeBytes,
    allocationUnitBytes: device.allocationUnitBytes,
  });
  if (!capacity.allowed) throw new Error(capacity.blockers[0] || "O dispositivo não possui espaço suficiente.");

  const result = await executeTransactionalWriteToDevice(plan, request.driveRoot, {
    revalidateTarget: async () => {
      await requireSafeWindowsUsbTarget(request.driveRoot, request.expectedDeviceFingerprint);
    },
    onProgress: (progress) => onProgress({
      status: progress.status,
      percent: 24 + Math.floor(progress.percent * 0.76),
      detail: `${Math.min(progress.completedFiles + 1, progress.totalFiles)}/${progress.totalFiles}`,
    }),
  });

  return {
    release: manifest.release,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    writtenFiles: result.writtenFiles,
    reusedFiles: result.reusedFiles,
    resumed: result.resumed,
  };
}
