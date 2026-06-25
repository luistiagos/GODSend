import { createHash, randomUUID } from "crypto";
import { promises as fsPromises } from "fs";
import path from "path";
import { canonicalizeJson } from "./trustedComponentManifest";
import { hashFileSha256 } from "./secureComponentStaging";

export const WRITE_PLAN_VERSION = 1;
export const FAT32_MAX_FILE_BYTES = 0xffff_ffff;
export const MAX_WRITE_PLAN_ENTRIES = 100_000;

const ALLOWED_TOP_LEVEL_NAMES = new Set([
  "apps",
  "aurora",
  "badupdatepayload",
  "content",
  "games",
  "launch.ini",
  "lhelper.xex",
  "usbdsecpatch.xex",
  ".xbox-downloader",
]);

const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface WritePlanSourceEntry {
  sourcePath: string;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface BuildWritePlanInput {
  sourceRoot: string;
  deviceFingerprint: string;
  manifestId: string;
  manifestRelease: string;
  entries: WritePlanSourceEntry[];
}

export interface TransactionalWritePlanEntry extends WritePlanSourceEntry {
  entryId: string;
}

export interface TransactionalWritePlan {
  planVersion: 1;
  transactionId: string;
  createdAt: string;
  sourceRoot: string;
  deviceFingerprint: string;
  manifestId: string;
  manifestRelease: string;
  totalBytes: number;
  entries: TransactionalWritePlanEntry[];
  planHash: string;
}

function requiredText(value: string, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new Error(`${field} é inválido.`);
  }
  return value;
}

function normalizeHash(value: string, field: string): string {
  const normalized = requiredText(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${field} não é SHA-256 válido.`);
  return normalized;
}

export function validateXboxTargetRelativePath(value: string): string {
  const text = requiredText(value, "relativePath", 240);
  if (
    text.startsWith("/") ||
    text.includes("\\") ||
    /^[a-z]:/i.test(text) ||
    /[\x00-\x1f:*?"<>|]/.test(text)
  ) {
    throw new Error(`Caminho de destino não permitido: ${text}.`);
  }
  const segments = text.split("/");
  if (segments.length > 64) throw new Error(`Caminho de destino possui segmentos demais: ${text}.`);
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      WINDOWS_RESERVED_NAMES.test(segment)
    ) {
      throw new Error(`Caminho de destino contém segmento inseguro: ${text}.`);
    }
  }
  if (!ALLOWED_TOP_LEVEL_NAMES.has(segments[0].toLowerCase())) {
    throw new Error(`Destino fora da estrutura Xbox 360 permitida: ${text}.`);
  }
  if (segments[0].toLowerCase() === "launch.ini" && segments.length !== 1) {
    throw new Error("launch.ini somente pode existir na raiz do dispositivo.");
  }
  return segments.join("/");
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function assertPathHasNoSymlinks(root: string, filePath: string): Promise<void> {
  const relative = path.relative(root, filePath);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = await fsPromises.lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`A origem contém link simbólico: ${filePath}.`);
  }
}

function entryId(relativePath: string, sha256: string, sizeBytes: number): string {
  return createHash("sha256")
    .update(`${relativePath.toLowerCase()}\n${sha256}\n${sizeBytes}`, "utf8")
    .digest("hex");
}

function planHash(plan: Omit<TransactionalWritePlan, "planHash">): string {
  return createHash("sha256").update(canonicalizeJson(plan), "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export async function buildTransactionalWritePlan(
  input: BuildWritePlanInput,
  now = new Date(),
  transactionId = randomUUID(),
): Promise<TransactionalWritePlan> {
  if (!path.isAbsolute(input.sourceRoot)) throw new Error("sourceRoot precisa ser absoluto.");
  const sourceRoot = path.resolve(input.sourceRoot);
  const rootStat = await fsPromises.lstat(sourceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("sourceRoot precisa ser um diretório real, sem link simbólico.");
  }
  const canonicalRoot = await fsPromises.realpath(sourceRoot);
  if (!/^[a-f0-9]{64}$/i.test(input.deviceFingerprint)) {
    throw new Error("A impressão digital do dispositivo é inválida.");
  }
  const manifestId = requiredText(input.manifestId, "manifestId", 100);
  const manifestRelease = requiredText(input.manifestRelease, "manifestRelease", 80);
  if (!Array.isArray(input.entries) || input.entries.length === 0 || input.entries.length > MAX_WRITE_PLAN_ENTRIES) {
    throw new Error(`O plano precisa conter entre 1 e ${MAX_WRITE_PLAN_ENTRIES} arquivos.`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transactionId)) {
    throw new Error("transactionId inválido.");
  }

  const seenTargets = new Set<string>();
  const entries: TransactionalWritePlanEntry[] = [];
  let totalBytes = 0;
  for (let index = 0; index < input.entries.length; index++) {
    const candidate = input.entries[index];
    if (!path.isAbsolute(candidate.sourcePath)) {
      throw new Error(`entries[${index}].sourcePath precisa ser absoluto.`);
    }
    const sourcePath = path.resolve(candidate.sourcePath);
    if (!isPathInside(sourceRoot, sourcePath)) {
      throw new Error(`entries[${index}].sourcePath está fora do staging confiável.`);
    }
    await assertPathHasNoSymlinks(sourceRoot, sourcePath);
    const canonicalSource = await fsPromises.realpath(sourcePath);
    if (!isPathInside(canonicalRoot, canonicalSource)) {
      throw new Error(`entries[${index}].sourcePath escapou do staging confiável.`);
    }
    const stat = await fsPromises.lstat(canonicalSource);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`entries[${index}].sourcePath não é um arquivo regular.`);
    }
    if (!Number.isSafeInteger(candidate.sizeBytes) || candidate.sizeBytes < 0 || candidate.sizeBytes > FAT32_MAX_FILE_BYTES) {
      throw new Error(`entries[${index}].sizeBytes não cabe em FAT32.`);
    }
    if (stat.size !== candidate.sizeBytes) {
      throw new Error(`entries[${index}] mudou de tamanho depois do staging.`);
    }
    const sha256 = normalizeHash(candidate.sha256, `entries[${index}].sha256`);
    const actualSha256 = await hashFileSha256(canonicalSource);
    if (actualSha256 !== sha256) {
      throw new Error(`entries[${index}] mudou de conteúdo depois do staging.`);
    }
    const relativePath = validateXboxTargetRelativePath(candidate.relativePath);
    const caseInsensitiveTarget = relativePath.toLowerCase();
    if (seenTargets.has(caseInsensitiveTarget)) {
      throw new Error(`Destino duplicado no plano: ${relativePath}.`);
    }
    seenTargets.add(caseInsensitiveTarget);
    totalBytes += candidate.sizeBytes;
    if (!Number.isSafeInteger(totalBytes)) throw new Error("O tamanho total do plano excede o limite seguro.");
    entries.push({
      entryId: entryId(relativePath, sha256, candidate.sizeBytes),
      sourcePath: canonicalSource,
      relativePath,
      sizeBytes: candidate.sizeBytes,
      sha256,
    });
  }

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en", { sensitivity: "base" }));
  const unsignedPlan: Omit<TransactionalWritePlan, "planHash"> = {
    planVersion: WRITE_PLAN_VERSION,
    transactionId,
    createdAt: now.toISOString(),
    sourceRoot: canonicalRoot,
    deviceFingerprint: input.deviceFingerprint.toLowerCase(),
    manifestId,
    manifestRelease,
    totalBytes,
    entries,
  };
  const plan: TransactionalWritePlan = { ...unsignedPlan, planHash: planHash(unsignedPlan) };
  return deepFreeze(plan);
}

export function verifyTransactionalWritePlan(plan: TransactionalWritePlan): void {
  const { planHash: expected, ...contents } = plan;
  const actual = planHash(contents);
  if (!/^[a-f0-9]{64}$/.test(expected) || actual !== expected) {
    throw new Error("O plano de escrita foi alterado depois de sua criação.");
  }
}
