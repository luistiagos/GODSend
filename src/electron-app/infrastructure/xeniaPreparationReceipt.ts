import { promises as fs } from "fs";
import path from "path";

/**
 * Marcador e recibo exclusivos do preparo para Xbox One / Xbox Series X|S (Modo Desenvolvedor / Xenia).
 *
 * IMPORTANTE — Isolamento absoluto com o Xbox 360:
 * - O Xbox 360 usa `.xbox-downloader/ready-to-play-v<N>.marker` e `.xbox-downloader/preparo.json`.
 * - O Xbox One / Series usa `.xbox-downloader/xenia-devmode-v1.marker` e `.xbox-downloader/preparo-xenia.json`.
 * Os nomes são deliberadamente disjuntos para que nenhum código do Xbox 360 (nem versões antigas)
 * confunda um HD preparado para Xbox One/Series com um pendrive de Xbox 360 — e vice-versa.
 */
export const XENIA_MARKER_DIRECTORY = ".xbox-downloader";
export const XENIA_MARKER_VERSION = "v1";
export const XENIA_MARKER_FILENAME = `xenia-devmode-${XENIA_MARKER_VERSION}.marker`;
export const XENIA_MARKER_PATH = `${XENIA_MARKER_DIRECTORY}/${XENIA_MARKER_FILENAME}`;
export const XENIA_MARKER_PATTERN = /^xenia-devmode-v\d+\.marker$/i;
export const XENIA_RECEIPT_PATH = `${XENIA_MARKER_DIRECTORY}/preparo-xenia.json`;

export const XENIA_GAMES_DIR = "Games";
export const XENIA_CONTENT_DIR = "Content/0000000000000000";

export interface XeniaAclVerificationReceipt {
  verified: boolean;
  allApplicationPackagesPresent: boolean;
  restrictedPackagesPresent: boolean;
  everyonePresent: boolean;
  hasDenyRule: boolean;
  inheritanceActive: boolean;
  probeInherited: boolean;
}

export interface XeniaDiskLayoutReceipt {
  verdict: "ok" | "unknown";
  formatted: boolean;
  partitionStyle: string;
  partitionCount: number;
  logicalSectorSize: number;
  physicalSectorSize: number;
  fileSystem: string;
  partitionSizeBytes: number;
  allocationUnitBytes: number;
  model: string;
  manufacturer: string;
}

export interface XeniaPreparationReceipt {
  schemaVersion: 1;
  consoleTarget: "xbox-one-series";
  mode: "xenia-devmode";
  preparedAt: string;
  appVersion: string;
  markerVersion: string;
  formatted: boolean;
  aclVerification: XeniaAclVerificationReceipt;
  diskLayout?: XeniaDiskLayoutReceipt;
}

function normalizeRoot(driveRoot: string): string {
  const root = String(driveRoot || "").trim();
  if (!root) return "";
  if (process.platform === "win32") return root.endsWith("\\") ? root : `${root}\\`;
  return root.endsWith("/") ? root : `${root}/`;
}

export function generateXeniaMarkerContent(): string {
  return `xbox-companion-xenia-devmode-${XENIA_MARKER_VERSION}\r\n`;
}

export function buildXeniaPreparationReceipt(fields: {
  appVersion: string;
  formatted: boolean;
  aclVerification: XeniaAclVerificationReceipt;
  diskLayout?: XeniaDiskLayoutReceipt;
  preparedAt?: Date;
}): XeniaPreparationReceipt {
  return {
    schemaVersion: 1,
    consoleTarget: "xbox-one-series",
    mode: "xenia-devmode",
    preparedAt: (fields.preparedAt || new Date()).toISOString(),
    appVersion: fields.appVersion,
    markerVersion: XENIA_MARKER_VERSION,
    formatted: fields.formatted,
    aclVerification: fields.aclVerification,
    ...(fields.diskLayout ? { diskLayout: fields.diskLayout } : {}),
  };
}

export async function hasXeniaDevModeMarker(driveRoot: string): Promise<boolean> {
  const root = normalizeRoot(driveRoot);
  if (!root) return false;
  try {
    const entries = await fs.readdir(path.join(root, XENIA_MARKER_DIRECTORY), { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && XENIA_MARKER_PATTERN.test(entry.name));
  } catch {
    return false;
  }
}

export async function writeXeniaMarkerAndReceipt(
  driveRoot: string,
  receipt: XeniaPreparationReceipt,
): Promise<{ markerPath: string; receiptPath: string }> {
  const root = normalizeRoot(driveRoot);
  if (!root) throw new Error("Caminho do dispositivo inválido.");

  const markerDir = path.join(root, XENIA_MARKER_DIRECTORY);
  await fs.mkdir(markerDir, { recursive: true });

  const markerPath = path.join(markerDir, XENIA_MARKER_FILENAME);
  const markerHandle = await fs.open(markerPath, "w");
  try {
    await markerHandle.writeFile(generateXeniaMarkerContent(), "utf8");
    await markerHandle.sync();
  } finally {
    await markerHandle.close();
  }

  const receiptPath = path.join(root, ...XENIA_RECEIPT_PATH.split("/"));
  const receiptHandle = await fs.open(receiptPath, "w");
  try {
    await receiptHandle.writeFile(`${JSON.stringify(receipt, null, 2)}\r\n`, "utf8");
    await receiptHandle.sync();
  } finally {
    await receiptHandle.close();
  }

  return { markerPath, receiptPath };
}

export async function readXeniaPreparationReceipt(
  driveRoot: string,
): Promise<XeniaPreparationReceipt | null> {
  const root = normalizeRoot(driveRoot);
  if (!root) return null;
  try {
    const receiptPath = path.join(root, ...XENIA_RECEIPT_PATH.split("/"));
    const raw = await fs.readFile(receiptPath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.consoleTarget === "xbox-one-series" && parsed?.mode === "xenia-devmode") {
      return parsed as XeniaPreparationReceipt;
    }
    return null;
  } catch {
    return null;
  }
}
