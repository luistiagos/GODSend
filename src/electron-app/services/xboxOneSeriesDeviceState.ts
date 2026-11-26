import { promises as fs } from "fs";
import path from "path";
import {
  hasXeniaDevModeMarker,
  XENIA_CONTENT_DIR,
  XENIA_GAMES_DIR,
} from "../infrastructure/xeniaPreparationReceipt";
import type { PreparedDeviceState, XboxOneSeriesDeviceState } from "./preparedUsbDetection";

const XBOX360_MARKER_DIR = ".xbox-downloader";
const XBOX360_MARKER_PATTERN = /^ready-to-play-v\d+\.marker$/i;
const XBOX360_ONLY_PATHS = [
  "BadUpdatePayload/default.xex",
  "Aurora/default.xex",
  "launch.ini",
];

export interface DetectXboxOneSeriesStateOptions {
  /** Sistema de arquivos do volume (ex.: "NTFS", "FAT32", "exFAT", "RAW"). */
  fileSystem?: string;
  /** Estado detectado sob a ótica do Xbox 360 (para detectar preparo de outro console). */
  xbox360PreparedState?: PreparedDeviceState;
  /**
   * Resultado opcional de verificação real de ACL NTFS (`S-1-15-2-1` Allow FullControl OI/CI sem Deny).
   * - `true`: ACL verificada e válida.
   * - `false`: ACL conferida e inválida/ausente.
   * - `undefined`: não verificada externamente; só aceita `preparado-xenia` se `allowUncheckedAcl: true`
   *   ou via callback `checkAcl`.
   */
  aclVerified?: boolean;
  /** Callback assíncrono opcional chamado somente quando o volume é NTFS com marcador Xenia e estrutura válida. */
  checkAcl?: (driveRoot: string) => Promise<boolean>;
}

function deviceRoot(driveRoot: string): string {
  const root = String(driveRoot || "").trim();
  if (!root) return "";
  if (process.platform === "win32") return root.endsWith("\\") ? root : `${root}\\`;
  return root.endsWith("/") ? root : `${root}/`;
}

async function dirExists(root: string, relativePath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(path.join(root, ...relativePath.split("/")));
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function fileExists(root: string, relativePath: string): Promise<boolean> {
  try {
    await fs.lstat(path.join(root, ...relativePath.split("/")));
    return true;
  } catch {
    return false;
  }
}

async function hasXbox360PreparationArtifacts(root: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(path.join(root, XBOX360_MARKER_DIR), { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && XBOX360_MARKER_PATTERN.test(entry.name))) {
      return true;
    }
  } catch {
    // ignore missing .xbox-downloader
  }
  const checks = await Promise.all(XBOX360_ONLY_PATHS.map((rel) => fileExists(root, rel)));
  return checks.some(Boolean);
}

/**
 * Classifica o dispositivo sob a ótica exclusiva do Xbox One / Series X|S (Modo Desenvolvedor / Xenia).
 *
 * Regras de ouro de isolamento:
 * 1. Pendrive preparado para Xbox 360 (`preparado-bloqueado-lt`, `preparado-rgh`, ou contendo
 *    marcador/payload do 360) SEMPRE retorna `"preparado-outro-console"` e NUNCA `"preparado-xenia"`.
 * 2. Apenas volumes NTFS com marcador exclusivo `xenia-devmode-v*.marker`, pastas `Games/` e
 *    `Content/0000000000000000/` e ACL NTFS (`S-1-15-2-1`) comprovada retornam `"preparado-xenia"`.
 * 3. Volume NTFS sem marcador/pastas ou sem ACL válida retorna `"ntfs-sem-permissoes"`, permitindo
 *    ao usuário corrigir permissões sem perder jogos ou formatar do zero.
 */
export async function detectXboxOneSeriesDeviceState(
  driveRoot: string,
  options: DetectXboxOneSeriesStateOptions = {},
): Promise<XboxOneSeriesDeviceState> {
  const root = deviceRoot(driveRoot);
  if (!root) return "sem-preparo";

  // 1. Se já foi identificado como preparado para Xbox 360, bloqueia imediatamente como outro console.
  if (
    options.xbox360PreparedState === "preparado-bloqueado-lt" ||
    options.xbox360PreparedState === "preparado-rgh"
  ) {
    return "preparado-outro-console";
  }

  // Também checa artefatos físicos de preparo do 360 diretamente no disco (caso o chamador não tenha
  // passado `xbox360PreparedState` ou o volume tenha sido convertido preservando arquivos do 360).
  if (await hasXbox360PreparationArtifacts(root)) {
    return "preparado-outro-console";
  }

  // 2. O Xbox One / Series (Modo Desenvolvedor / Xenia) exige estritamente NTFS.
  const fsUpper = String(options.fileSystem ?? "").trim().toUpperCase();
  if (fsUpper && fsUpper !== "NTFS") {
    return "sem-preparo";
  }

  // Se o filesystem não foi informado (ex.: testes em diretório temporário sem drive real),
  // segue apenas se o marcador Xenia existir — caso contrário é sem-preparo.
  const hasMarker = await hasXeniaDevModeMarker(root);
  const [hasGames, hasContent] = await Promise.all([
    dirExists(root, XENIA_GAMES_DIR),
    dirExists(root, XENIA_CONTENT_DIR),
  ]);

  if (!hasMarker || !hasGames || !hasContent) {
    return fsUpper === "NTFS" ? "ntfs-sem-permissoes" : "sem-preparo";
  }

  // 3. Verificação real da ACL NTFS (S-1-15-2-1 / ALL APPLICATION PACKAGES).
  let aclOk = options.aclVerified;
  if (aclOk === undefined && typeof options.checkAcl === "function") {
    try {
      aclOk = await options.checkAcl(root);
    } catch {
      aclOk = false;
    }
  }

  if (aclOk === true) {
    return "preparado-xenia";
  }

  return "ntfs-sem-permissoes";
}
