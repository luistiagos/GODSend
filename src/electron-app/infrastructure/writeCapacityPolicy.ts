import { promises as fsPromises } from "fs";
import path from "path";
import { hashFileSha256 } from "./secureComponentStaging";
import {
  verifyTransactionalWritePlan,
  type TransactionalWritePlan,
  type TransactionalWritePlanEntry,
} from "./transactionalWritePlan";

const MIN_FREE_RESERVE_BYTES = 128 * 1024 ** 2;
const FREE_RESERVE_RATIO = 0.02;
const MIN_METADATA_OVERHEAD_BYTES = 4 * 1024 ** 2;

export interface TargetStorageInfo {
  fileSystem: string;
  totalBytes: number;
  freeBytes: number;
  allocationUnitBytes: number;
}

export type ExistingTargetState = "missing" | "identical" | "different";

export interface TargetInventoryEntry {
  relativePath: string;
  state: ExistingTargetState;
  existingSizeBytes: number;
  stagedAllocationBytes: number;
}

export interface WriteCapacityAssessment {
  allowed: boolean;
  blockers: string[];
  storage: TargetStorageInfo;
  inventory: TargetInventoryEntry[];
  filesToWrite: number;
  filesReused: number;
  payloadBytesToStage: number;
  allocatedBytesAtPeak: number;
  metadataOverheadBytes: number;
  safetyReserveBytes: number;
  requiredFreeBytes: number;
  availableAfterPeakBytes: number;
  shortfallBytes: number;
}

function normalizeFileSystem(fileSystem: string): string {
  return String(fileSystem || "").trim().toUpperCase();
}

function validateStorageInfo(storage: TargetStorageInfo): string[] {
  const blockers: string[] = [];
  if (normalizeFileSystem(storage.fileSystem) !== "FAT32") {
    blockers.push(`O destino precisa estar em FAT32; detectado: ${storage.fileSystem || "desconhecido"}.`);
  }
  if (
    !Number.isSafeInteger(storage.totalBytes) ||
    !Number.isSafeInteger(storage.freeBytes) ||
    storage.totalBytes <= 0 ||
    storage.freeBytes < 0 ||
    storage.freeBytes > storage.totalBytes
  ) {
    blockers.push("As informações de capacidade do destino são inválidas.");
  }
  if (
    !Number.isSafeInteger(storage.allocationUnitBytes) ||
    storage.allocationUnitBytes < 512 ||
    storage.allocationUnitBytes > 1024 ** 2 ||
    (storage.allocationUnitBytes & (storage.allocationUnitBytes - 1)) !== 0
  ) {
    blockers.push("O tamanho da unidade de alocação FAT32 é inválido ou desconhecido.");
  }
  return blockers;
}

function allocatedSize(sizeBytes: number, allocationUnitBytes: number): number {
  if (sizeBytes === 0) return 0;
  return Math.ceil(sizeBytes / allocationUnitBytes) * allocationUnitBytes;
}

function resolveInside(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Destino escaparia da raiz durante o inventário: ${relativePath}.`);
  }
  return candidate;
}

async function assertSafeRoot(targetRoot: string): Promise<string> {
  if (!path.isAbsolute(targetRoot)) throw new Error("A raiz do destino precisa ser absoluta.");
  const root = path.resolve(targetRoot);
  const stat = await fsPromises.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("A raiz do destino precisa ser um diretório real.");
  }
  const real = await fsPromises.realpath(root);
  if (
    (process.platform === "win32" ? real.toLowerCase() : real) !==
    (process.platform === "win32" ? root.toLowerCase() : root)
  ) {
    throw new Error("A raiz do destino atravessa link ou redirecionamento de diretório.");
  }
  return root;
}

async function assertExistingAncestorsSafe(root: string, filePath: string): Promise<void> {
  const relative = path.relative(root, path.dirname(filePath));
  if (!relative || relative === ".") return;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fsPromises.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`O destino contém diretório inseguro: ${current}.`);
      }
    } catch (error: any) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

async function inventoryEntry(
  root: string,
  entry: TransactionalWritePlanEntry,
  allocationUnitBytes: number,
): Promise<TargetInventoryEntry> {
  const targetPath = resolveInside(root, entry.relativePath);
  await assertExistingAncestorsSafe(root, targetPath);
  try {
    const stat = await fsPromises.lstat(targetPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`O destino existente não é arquivo regular: ${entry.relativePath}.`);
    }
    const identical = stat.size === entry.sizeBytes && (await hashFileSha256(targetPath)) === entry.sha256;
    return {
      relativePath: entry.relativePath,
      state: identical ? "identical" : "different",
      existingSizeBytes: stat.size,
      stagedAllocationBytes: identical ? 0 : allocatedSize(entry.sizeBytes, allocationUnitBytes),
    };
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    return {
      relativePath: entry.relativePath,
      state: "missing",
      existingSizeBytes: 0,
      stagedAllocationBytes: allocatedSize(entry.sizeBytes, allocationUnitBytes),
    };
  }
}

export async function assessWriteCapacity(
  plan: TransactionalWritePlan,
  targetRoot: string,
  storage: TargetStorageInfo,
): Promise<WriteCapacityAssessment> {
  verifyTransactionalWritePlan(plan);
  const blockers = validateStorageInfo(storage);
  const safeAllocationUnit = blockers.some((blocker) => blocker.includes("unidade de alocação"))
    ? 32 * 1024
    : storage.allocationUnitBytes;
  const root = await assertSafeRoot(targetRoot);
  const inventory: TargetInventoryEntry[] = [];
  for (const entry of plan.entries) {
    inventory.push(await inventoryEntry(root, entry, safeAllocationUnit));
  }

  const filesReused = inventory.filter((entry) => entry.state === "identical").length;
  const filesToWrite = inventory.length - filesReused;
  const payloadBytesToStage = plan.entries.reduce(
    (total, entry, index) => total + (inventory[index].state === "identical" ? 0 : entry.sizeBytes),
    0,
  );
  const allocatedBytesAtPeak = inventory.reduce(
    (total, entry) => total + entry.stagedAllocationBytes,
    0,
  );
  const serializedPlanBytes = Buffer.byteLength(JSON.stringify(plan), "utf8");
  const metadataOverheadBytes = Math.max(
    MIN_METADATA_OVERHEAD_BYTES,
    allocatedSize(serializedPlanBytes * 4, safeAllocationUnit) + safeAllocationUnit * 16,
  );
  const safetyReserveBytes = Number.isSafeInteger(storage.totalBytes) && storage.totalBytes > 0
    ? Math.max(MIN_FREE_RESERVE_BYTES, Math.ceil(storage.totalBytes * FREE_RESERVE_RATIO))
    : MIN_FREE_RESERVE_BYTES;
  const requiredFreeBytes = allocatedBytesAtPeak + metadataOverheadBytes + safetyReserveBytes;
  const usableFreeBytes = Number.isSafeInteger(storage.freeBytes) && storage.freeBytes >= 0
    ? storage.freeBytes
    : 0;
  const availableAfterPeakBytes = usableFreeBytes - allocatedBytesAtPeak - metadataOverheadBytes;
  const shortfallBytes = Math.max(0, requiredFreeBytes - usableFreeBytes);
  if (shortfallBytes > 0) {
    blockers.push(`Espaço livre insuficiente; faltam ${shortfallBytes} bytes incluindo a margem de segurança.`);
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    storage: { ...storage },
    inventory,
    filesToWrite,
    filesReused,
    payloadBytesToStage,
    allocatedBytesAtPeak,
    metadataOverheadBytes,
    safetyReserveBytes,
    requiredFreeBytes,
    availableAfterPeakBytes,
    shortfallBytes,
  };
}

