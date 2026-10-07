import fs from "fs";
import path from "path";
import { listFat32UsbDrives, type UsbDriveInfo } from "./badAvatarUsbService";
import { readConfig } from "./settingsService";
import { xboxBuildGameNameMap } from "./auroraLibraryService";
import { appendAppEvent } from "../infrastructure/serverLog";

// Every disk access here is asynchronous, and that is load-bearing: the scan runs in Electron's
// main process and walks every file of every game to size it. With fs.*Sync, an external HD with a
// large library froze the window ("Não está respondendo") for 70–105 s per scan, and the blocked
// loop turned finished PowerShell enumerations into a false "O Windows ainda está reconhecendo...".
// See docs/bugs/*/electron-main-varredura-sincrona-de-jogos-instalados-*.md before adding a *Sync.
const fsp = fs.promises;

export interface InstalledGameInfo {
  name: string;
  titleId?: string;
  path: string;
  drive: string;
  format: "god" | "xex" | "iso";
  folderName: string;
  sizeBytes?: number;
  localCoverUrl?: string;
}

const HEX_8_REGEX = /^[0-9A-F]{8}$/i;
const NAME_TITLE_ID_REGEX = /^(.+?)\s*-\s*([0-9A-F]{8})$/i;

/**
 * Multi-disc rips name their top-level folder after the disc ("Disc2", "DVD 1"), so an install
 * made from one carries a folder that says which disc it was, not which game it is. Such a name
 * has to give way to the Title ID lookup, or the library lists "Disc2" instead of the game.
 */
const GENERIC_DISC_NAME_REGEX = /^(?:(?:game|install(?:ation)?|content|bonus|play)[ _.-]*)?(?:disc|disk|dvd|cd)[ _.-]*[0-9]*$/i;

const MAX_SIZE_SCAN_DEPTH = 16;

/** Dashboard/system title. Identifies Xbox update data — and every Kinect and speech package bundled inside a game. */
const SYSTEM_TITLE_ID = "FFFE07DF";

const KNOWN_CONTENT_TYPES = new Set([
  "00007000", // Games on Demand (GOD)
  "000D0000", // Xbox Live Arcade (XBLA)
  "00000002", // Digital Game / Extracted Content / DLC
  "00004000", // Xbox Originals
  "00080000", // Demos
  "00020000", // Indie Games (XBLIG)
  "00040000", // Title Updates / DLC / Arcade
]);

const SYSTEM_CONTAINER_NAMES = new Set([
  "$systemupdate",
  "$$systemupdate",
  "system volume information",
  "content",
  ".xbox-downloader",
  ".xbox-360-companion-temp",
  "badupdatepayload",
  "aurora",
  "games",
  "jogos",
  "xbox360",
  "xbox 360",
  "rgh",
  "xex",
  "god",
  "apps",
]);

/** Async fs.existsSync: false on any error. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readDirEntries(dirPath: string): Promise<fs.Dirent[] | null> {
  try {
    return await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }
}

/**
 * How long the expensive part of a game's analysis (sizing every file, probing STFS headers,
 * reading the cover) is reused. The UI polls the scan every 5–7 s and the scan result itself lives
 * only 15 s; redoing that work per poll kept an external HD busy most of the time. Directory
 * listings are still redone on every scan, so a game copied or deleted shows up within 15 s — only
 * the size of a folder that already existed can be up to this old.
 */
const GAME_INFO_TTL_MS = 10 * 60_000;
const SLOW_SCAN_LOG_MS = 1_000;

const gameInfoCache = new Map<string, { info: InstalledGameInfo; at: number }>();
const scanStats = { analyzed: 0, reused: 0, filesSized: 0, slowestFolder: "", slowestMs: 0 };

/** Only games are kept: a folder still being copied may not look like one yet. */
async function cachedGameInfo(
  fullPath: string,
  driveLabel: string,
  analyze: () => Promise<InstalledGameInfo | null>
): Promise<InstalledGameInfo | null> {
  const key = `${fullPath.toLowerCase()}|${driveLabel}`;
  const hit = gameInfoCache.get(key);
  if (hit && Date.now() - hit.at < GAME_INFO_TTL_MS) {
    scanStats.reused++;
    return hit.info;
  }
  scanStats.analyzed++;
  const startedAt = Date.now();
  const info = await analyze();
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs > scanStats.slowestMs) {
    scanStats.slowestMs = elapsedMs;
    scanStats.slowestFolder = path.basename(fullPath);
  }
  if (info) gameInfoCache.set(key, { info, at: Date.now() });
  else gameInfoCache.delete(key);
  return info;
}

let nameMapCache: { map: Map<string, string>; at: number } | null = null;

/** xboxBuildGameNameMap reads and parses ~5 MB of bundled JSON synchronously; once per TTL is enough. */
function gameNameMap(): Map<string, string> {
  if (!nameMapCache || Date.now() - nameMapCache.at >= GAME_INFO_TTL_MS) {
    nameMapCache = { map: xboxBuildGameNameMap(), at: Date.now() };
  }
  return nameMapCache.map;
}

/**
 * Normalizes a drive root to uppercase format (e.g. "F:\" -> "F:").
 */
export function normalizeDriveLetter(rootPath: string): string {
  const m = String(rootPath || "").match(/^([A-Za-z]):/);
  return m ? `${m[1].toUpperCase()}:` : rootPath.replace(/[/\\]+$/, "");
}

/**
 * Parses a godsend.ini file if present to extract title, titleId and type.
 */
async function readGodsendIni(dirPath: string): Promise<{ titleName?: string; titleId?: string; type?: string } | null> {
  try {
    const content = await fsp.readFile(path.join(dirPath, "godsend.ini"), "utf8");
    const lines = content.split(/\r?\n/);
    let titleName: string | undefined;
    let titleId: string | undefined;
    let type: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("titlename=")) {
        titleName = trimmed.slice("titlename=".length).trim();
      } else if (trimmed.startsWith("titleid=")) {
        titleId = trimmed.slice("titleid=".length).trim().toUpperCase();
      } else if (trimmed.startsWith("type=")) {
        type = trimmed.slice("type=".length).trim().toLowerCase();
      }
    }
    return { titleName, titleId, type };
  } catch {
    return null;
  }
}

/**
 * Checks whether a folder/file name contains corrupted characters or unprintable control codes.
 */
export function isCorruptedFolderName(name: string): boolean {
  if (!name || typeof name !== "string") return true;
  const trimmed = name.trim();
  if (trimmed.length === 0) return true;
  // Non-printable control characters (0x00-0x1F, 0x7F-0x9F) or Unicode replacement character (\uFFFD)
  if (/[\x00-\x1F\x7F-\x9F\uFFFD]/.test(name)) return true;
  return false;
}

/**
 * Checks whether a folder has a standard GOD subfolder or any known Xbox content structure.
 */
async function hasGodOrContentSubfolder(dirPath: string): Promise<boolean> {
  const entries = await readDirEntries(dirPath);
  if (!entries) return false;
  for (const entry of entries) {
    if (isCorruptedFolderName(entry.name)) continue;
    const lower = entry.name.toLowerCase();
    if (entry.isDirectory()) {
      if (KNOWN_CONTENT_TYPES.has(entry.name.toUpperCase()) || lower.endsWith(".data")) {
        return true;
      }
    } else if (entry.isFile()) {
      if (lower.endsWith(".data")) return true;
    }
  }
  return false;
}

/**
 * Checks whether a folder contains a default.xex file (or one level deep).
 */
async function hasDefaultXex(dirPath: string): Promise<boolean> {
  if (await pathExists(path.join(dirPath, "default.xex"))) return true;
  if (await pathExists(path.join(dirPath, "Default.xex"))) return true;
  const entries = await readDirEntries(dirPath);
  if (!entries) return false;
  for (const entry of entries) {
    if (entry.isDirectory() && !isCorruptedFolderName(entry.name)) {
      if (await pathExists(path.join(dirPath, entry.name, "default.xex"))) return true;
      if (await pathExists(path.join(dirPath, entry.name, "Default.xex"))) return true;
    }
  }
  return false;
}

/**
 * Inspects a single candidate game folder and returns InstalledGameInfo if valid.
 */
async function parseGameFolder(
  fullPath: string,
  folderName: string,
  driveLabel: string,
  nameMap?: Map<string, string>
): Promise<InstalledGameInfo | null> {
  if (isCorruptedFolderName(folderName)) return null;
  const lower = folderName.toLowerCase();
  if (SYSTEM_CONTAINER_NAMES.has(lower)) return null;

  try {
    // Check godsend.ini manifest
    const ini = await readGodsendIni(fullPath);
    let titleName: string | undefined = ini?.titleName;
    let titleId: string | undefined = ini?.titleId;
    let format: "god" | "xex" | undefined = ini?.type === "xex" ? "xex" : ini?.type === "god" ? "god" : undefined;

    const isDefaultXex = await hasDefaultXex(fullPath);
    const isGodSub = await hasGodOrContentSubfolder(fullPath);

    // Pattern: "Game Name - 4D5307E6"
    const match = folderName.match(NAME_TITLE_ID_REGEX);
    if (match) {
      if (!titleName) titleName = match[1].trim();
      if (!titleId) titleId = match[2].toUpperCase();
    }

    // Check if folderName itself is an 8-char hex TitleID
    if (!titleId && HEX_8_REGEX.test(folderName)) {
      titleId = folderName.toUpperCase();
    }

    // Check if any direct subdirectory is an 8-char hex TitleID (e.g. Games/Street Fighter/584107F4)
    if (!titleId) {
      const subs = (await readDirEntries(fullPath)) ?? [];
      for (const sub of subs) {
        if (sub.isDirectory() && !isCorruptedFolderName(sub.name) && HEX_8_REGEX.test(sub.name)) {
          titleId = sub.name.toUpperCase();
          break;
        }
      }
    }

    // Probe STFS LIVE/PIRS header if Title ID is still unknown
    if (!titleId) {
      titleId = (await probeStfsTitleId(fullPath)) || undefined;
    }

    // Skip Xbox 360 system/dashboard update data. Such data carries no executable of its own,
    // so a folder that has one is a game that merely bundles Kinect/speech packages signed
    // under the system title — drop the misleading ID rather than the game.
    if (titleId === SYSTEM_TITLE_ID) {
      if (!isDefaultXex && !ini) {
        return null;
      }
      titleId = undefined;
    }

    // Determine format
    if (!format) {
      if (isDefaultXex) {
        format = "xex";
      } else if (isGodSub || titleId) {
        format = "god";
      }
    }

    // STRICT VALIDATION:
    // If it has NO godsend.ini, NO default.xex, NO GOD/Content subfolders, and NO valid titleId/STFS container,
    // then this is NOT an Xbox 360 game (it's a random, non-game, or corrupted folder).
    if (!ini && !isDefaultXex && !isGodSub && !titleId) {
      return null;
    }

    if (!format) {
      format = "god";
    }

    // Lookup name by Title ID when the folder names no game: missing, the bare hex TitleID, or
    // a rip's disc placeholder.
    if ((!titleName || titleName === titleId || GENERIC_DISC_NAME_REGEX.test(titleName)) && titleId && nameMap) {
      const mapped = nameMap.get(titleId);
      if (mapped) titleName = mapped;
    }

    if (!titleName) {
      titleName = folderName;
    }

    if (isCorruptedFolderName(titleName)) {
      return null;
    }

    // Clean up scene/release names (e.g. "Gears.of.War.1.USA.X360-ZTM" -> "Gears of War 1")
    if (titleName.includes(".") && !titleName.includes(" ")) {
      const cleaned = titleName
        .replace(/\.(USA|EUR|PAL|NTSC|JAP|X360|ZTM|COMPLEX|MARVEL|STRANGE|SPARE|DAGGER|PROTOCOL).*$/i, "")
        .replace(/\./g, " ")
        .trim();
      if (cleaned.length > 2) {
        titleName = cleaned;
      }
    }

    const sizeBytes = await getDirectorySizeBytes(fullPath);

    // Reject empty folders with 0 bytes that have no actual executable or valid ini
    if (sizeBytes === 0 && !ini && !isDefaultXex && !isGodSub) {
      return null;
    }

    const localCoverUrl = await findLocalCoverDataUrl(fullPath);

    return {
      name: titleName,
      titleId,
      path: fullPath,
      drive: driveLabel,
      format,
      folderName,
      sizeBytes,
      localCoverUrl,
    };
  } catch {
    return null;
  }
}

/**
 * Scans a single Games directory for GOD and XEX games.
 */
export async function scanGamesDirectory(
  gamesDir: string,
  driveLabel: string,
  nameMap?: Map<string, string>
): Promise<InstalledGameInfo[]> {
  const games: InstalledGameInfo[] = [];
  const entries = await readDirEntries(gamesDir);
  if (!entries) return games;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isCorruptedFolderName(entry.name)) continue;
    const fullPath = path.join(gamesDir, entry.name);
    const game = await cachedGameInfo(fullPath, driveLabel, () => parseGameFolder(fullPath, entry.name, driveLabel, nameMap));
    if (game) {
      games.push(game);
    }
  }

  return games;
}

async function getDirectorySizeBytes(dirPath: string, depth = 0): Promise<number> {
  // Xbox game trees nest deeply (media/tracks/<track>/<asset>, Content/0000000000000000/
  // <titleID>/<type>/), so a shallow cap silently reports multi-GB titles as a few MB.
  if (depth > MAX_SIZE_SCAN_DEPTH) return 0;
  let total = 0;
  const entries = await readDirEntries(dirPath);
  if (!entries) return 0;
  for (const entry of entries) {
    if (isCorruptedFolderName(entry.name)) continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirectorySizeBytes(full, depth + 1);
    } else if (entry.isFile()) {
      scanStats.filesSized++;
      try {
        total += (await fsp.stat(full)).size;
      } catch {}
    }
  }
  return total;
}

async function findLocalCoverDataUrl(dirPath: string): Promise<string | undefined> {
  const coverFiles = [
    "cover.jpg", "cover.png", "cover.jpeg",
    "folder.jpg", "folder.png",
    "poster.jpg", "poster.png",
    "boxart.jpg", "boxart.png",
    "artwork.jpg", "artwork.png"
  ];
  for (const name of coverFiles) {
    const p = path.join(dirPath, name);
    try {
      const stat = await fsp.stat(p);
      if (stat.isFile() && stat.size >= 100 && stat.size < 5000000) {
        const buf = await fsp.readFile(p);
        const mime = (buf[0] === 0xFF && buf[1] === 0xD8) ? "image/jpeg" : (buf[0] === 0x89 && buf[1] === 0x50) ? "image/png" : "image/jpeg";
        return `data:${mime};base64,${buf.toString("base64")}`;
      }
    } catch {}
  }
  return undefined;
}

async function probeStfsTitleId(dirPath: string, depth = 0): Promise<string | null> {
  if (depth > 4) return null;
  // A game's own container wins over any system package bundled inside it, but a folder that
  // holds nothing but system packages still reports SYSTEM_TITLE_ID, so parseGameFolder can
  // recognise it as dashboard data rather than listing it as a game.
  let systemOnly: string | null = null;
  const entries = await readDirEntries(dirPath);
  if (!entries) return systemOnly;
  for (const entry of entries) {
    if (isCorruptedFolderName(entry.name)) continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const sub = await probeStfsTitleId(full, depth + 1);
      if (sub && sub !== SYSTEM_TITLE_ID) return sub;
      if (sub) systemOnly = sub;
    } else {
      try {
        const s = await fsp.stat(full);
        if (s.size >= 0x364 && s.size < 60000000) {
          const buf = Buffer.alloc(0x364);
          const handle = await fsp.open(full, "r");
          let read = 0;
          try {
            read = (await handle.read(buf, 0, 0x364, 0)).bytesRead;
          } finally {
            await handle.close();
          }
          if (read >= 0x364) {
            const magic = buf.toString("ascii", 0, 4);
            if (magic === "LIVE" || magic === "PIRS" || magic === "CON ") {
              const tid = buf.toString("hex", 0x360, 0x364).toUpperCase();
              if (HEX_8_REGEX.test(tid) && tid !== "00000000" && tid !== "FFFFFFFF") {
                // Kinect and speech packages that ship inside ordinary games
                // (Database.xmplr, NuiIdentity.bin.be, nuisp*) carry the system title, so
                // they must not decide the folder's identity — keep looking for the game.
                if (tid !== SYSTEM_TITLE_ID) return tid;
                systemOnly = tid;
              }
            }
          }
        }
      } catch {}
    }
  }
  return systemOnly;
}

/**
 * Scans Content/0000000000000000 on a drive for GOD/XBLA/DLC games.
 */
export async function scanContentDirectory(
  contentDir: string,
  driveLabel: string,
  nameMap?: Map<string, string>
): Promise<InstalledGameInfo[]> {
  const games: InstalledGameInfo[] = [];
  const entries = await readDirEntries(contentDir);
  if (!entries) return games;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isCorruptedFolderName(entry.name)) continue;
    const tid = entry.name.toUpperCase();
    if (!HEX_8_REGEX.test(tid)) continue;

    // Skip system dashboard/avatar updates
    if (tid === SYSTEM_TITLE_ID) {
      continue;
    }

    const fullPath = path.join(contentDir, entry.name);
    const game = await cachedGameInfo(fullPath, driveLabel, () =>
      parseContentTitleFolder(fullPath, entry.name, tid, driveLabel, nameMap)
    );
    if (game) {
      games.push(game);
    }
  }

  return games;
}

/** One Content/0000000000000000/<TitleID> folder; null when it holds no content. */
async function parseContentTitleFolder(
  fullPath: string,
  folderName: string,
  tid: string,
  driveLabel: string,
  nameMap?: Map<string, string>
): Promise<InstalledGameInfo | null> {
  try {
    // Check if this Title ID folder has any content subdirectories or files
    const subdirs = await fsp.readdir(fullPath, { withFileTypes: true });
    if (subdirs.length === 0) return null;

    let hasValidContent = false;
    for (const sub of subdirs) {
      if (isCorruptedFolderName(sub.name)) continue;
      if (sub.isDirectory()) {
        const subUpper = sub.name.toUpperCase();
        if (KNOWN_CONTENT_TYPES.has(subUpper) || subUpper.startsWith("000")) {
          hasValidContent = true;
          break;
        }
      } else if (sub.isFile()) {
        hasValidContent = true;
        break;
      }
    }
    if (!hasValidContent) return null;

    let titleName = nameMap?.get(tid) || tid;
    const ini = await readGodsendIni(fullPath);
    if (ini?.titleName) titleName = ini.titleName;

    // If title name is still just the hex TID, look for a named container file inside subfolders
    if (titleName === tid) {
      try {
        for (const sub of subdirs) {
          if (isCorruptedFolderName(sub.name)) continue;
          if (sub.isDirectory()) {
            const files = await fsp.readdir(path.join(fullPath, sub.name), { withFileTypes: true });
            for (const f of files) {
              if (isCorruptedFolderName(f.name)) continue;
              if (f.isFile() && !/^[0-9A-F]{40}$/i.test(f.name) && !/^\d+$/.test(f.name) && !f.name.endsWith(".data")) {
                titleName = f.name;
                break;
              }
            }
          }
          if (titleName !== tid) break;
        }
      } catch {}
    }

    if (isCorruptedFolderName(titleName)) return null;

    const sizeBytes = await getDirectorySizeBytes(fullPath);

    const localCoverUrl = await findLocalCoverDataUrl(fullPath);

    return {
      name: titleName,
      titleId: tid,
      path: fullPath,
      drive: driveLabel,
      format: "god",
      folderName,
      sizeBytes,
      localCoverUrl,
    };
  } catch {
    /* skip individual entry */
    return null;
  }
}

/**
 * Scans a folder for raw .iso files.
 */
export async function scanIsoDirectory(isoDir: string, driveLabel: string): Promise<InstalledGameInfo[]> {
  const games: InstalledGameInfo[] = [];
  const entries = await readDirEntries(isoDir);
  if (!entries) return games;

  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    if (isCorruptedFolderName(entry.name)) continue;
    const n = entry.name;
    if (n.toLowerCase().endsWith(".iso")) {
      const name = path.basename(n, path.extname(n));
      if (isCorruptedFolderName(name)) continue;
      games.push({
        name,
        path: path.join(isoDir, n),
        drive: driveLabel,
        format: "iso",
        folderName: n,
      });
    }
  }

  return games;
}

/**
 * Scans a single drive root across all potential game folders.
 */
async function scanDriveRoot(
  driveRoot: string,
  driveLabel: string,
  nameMap: Map<string, string>,
  seenPaths: Set<string>,
  outGames: InstalledGameInfo[]
): Promise<void> {
  const candidateFolderNames = [
    "Games", "games", "Jogos", "jogos",
    "Xbox360", "xbox360", "Xbox 360", "xbox 360",
    "RGH", "rgh", "XEX", "xex", "GOD", "god",
  ];

  const scannedDirs = new Set<string>();

  for (const folder of candidateFolderNames) {
    const fullDir = path.join(driveRoot, folder);
    const lowerKey = fullDir.toLowerCase();
    if (scannedDirs.has(lowerKey) || !(await pathExists(fullDir))) continue;
    scannedDirs.add(lowerKey);

    const found = await scanGamesDirectory(fullDir, driveLabel, nameMap);
    for (const g of found) {
      const pKey = g.path.toLowerCase();
      if (!seenPaths.has(pKey)) {
        seenPaths.add(pKey);
        outGames.push(g);
      }
    }
  }

  // Check Content/0000000000000000 in drive root
  const contentDir = path.join(driveRoot, "Content", "0000000000000000");
  const foundContent = await scanContentDirectory(contentDir, driveLabel, nameMap);
  for (const g of foundContent) {
    const pKey = g.path.toLowerCase();
    if (!seenPaths.has(pKey)) {
      seenPaths.add(pKey);
      outGames.push(g);
    }
  }

  // Check direct root-level game folders (e.g. E:\Gears of War 3 - 4D5308AB\)
  const rootEntries = (await readDirEntries(driveRoot)) ?? [];
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue;
    if (isCorruptedFolderName(entry.name)) continue;
    const lower = entry.name.toLowerCase();
    if (SYSTEM_CONTAINER_NAMES.has(lower) || candidateFolderNames.some((c) => c.toLowerCase() === lower)) {
      continue;
    }
    const fullPath = path.join(driveRoot, entry.name);
    const game = await cachedGameInfo(fullPath, driveLabel, async () =>
      await hasDefaultXex(fullPath) || await hasGodOrContentSubfolder(fullPath) || NAME_TITLE_ID_REGEX.test(entry.name)
        ? parseGameFolder(fullPath, entry.name, driveLabel, nameMap)
        : null
    );
    if (game) {
      const pKey = game.path.toLowerCase();
      if (!seenPaths.has(pKey)) {
        seenPaths.add(pKey);
        outGames.push(game);
      }
    }
  }
}

/**
 * Returns available Windows drive letters (D: through Z:) that exist and are ready.
 */
async function getWindowsCandidateDriveRoots(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const roots: string[] = [];
  const startCode = "D".charCodeAt(0);
  const endCode = "Z".charCodeAt(0);

  for (let code = startCode; code <= endCode; code++) {
    const letter = String.fromCharCode(code);
    const rootPath = `${letter}:\\`;
    if (await pathExists(rootPath)) {
      roots.push(rootPath);
    }
  }
  return roots;
}

let cachedScanResult: InstalledGameInfo[] | null = null;
let lastScanTimestamp = 0;
let inFlightScanPromise: Promise<InstalledGameInfo[]> | null = null;
const SCAN_CACHE_TTL_MS = 15_000;

/**
 * Invalidates the in-memory installed games cache so the next call performs a fresh scan.
 */
export function invalidateInstalledGamesCache(): void {
  cachedScanResult = null;
  lastScanTimestamp = 0;
  gameInfoCache.clear();
  nameMapCache = null;
}

/**
 * Scans all connected USB drives and configured local directories for installed games.
 */
export async function scanUsbAndLocalGames(forceRefresh = false): Promise<InstalledGameInfo[]> {
  const now = Date.now();
  if (!forceRefresh && cachedScanResult && (now - lastScanTimestamp < SCAN_CACHE_TTL_MS)) {
    return cachedScanResult;
  }
  if (inFlightScanPromise) {
    return inFlightScanPromise;
  }

  inFlightScanPromise = (async () => {
    try {
      const startedAt = Date.now();
      Object.assign(scanStats, { analyzed: 0, reused: 0, filesSized: 0, slowestFolder: "", slowestMs: 0 });
      const nameMap = gameNameMap();
      const allGames: InstalledGameInfo[] = [];
      const seenPaths = new Set<string>();
      const processedRoots = new Set<string>();

      // 1. Scan connected safe USB / removable drives
      let usbDrives: UsbDriveInfo[] = [];
      try {
        usbDrives = await listFat32UsbDrives();
      } catch {
        usbDrives = [];
      }

      for (const drive of usbDrives) {
        if (!drive.rootPath) continue;
        const letter = normalizeDriveLetter(drive.rootPath);
        const driveDisplay = drive.label && drive.label !== "Sem nome" && drive.label !== "No Label"
          ? `${letter} (${drive.label})`
          : letter;
        processedRoots.add(normalizeDriveLetter(drive.rootPath).toLowerCase());

        await scanDriveRoot(drive.rootPath, driveDisplay, nameMap, seenPaths, allGames);
      }

      // 2. Safety fallback: scan any connected Windows drives (D: to Z:) that have Xbox game folders
      if (process.platform === "win32") {
        const winRoots = await getWindowsCandidateDriveRoots();
        for (const r of winRoots) {
          const letter = normalizeDriveLetter(r);
          if (processedRoots.has(letter.toLowerCase())) continue;
          processedRoots.add(letter.toLowerCase());

          // Only scan non-USB volume if it has an Xbox indicator folder
          let hasXboxFolders = false;
          for (const f of ["Games", "games", "Jogos", "jogos", "Xbox360", "xbox360", "Aurora", "Content"]) {
            if (await pathExists(path.join(r, f))) {
              hasXboxFolders = true;
              break;
            }
          }

          if (hasXboxFolders) {
            await scanDriveRoot(r, letter, nameMap, seenPaths, allGames);
          }
        }
      }

      // 3. Scan configured Transfer folder (for ISOs and local transfers)
      const config = readConfig();
      const transferFolder = config.transferFolder;
      if (transferFolder && await pathExists(transferFolder)) {
        const isoGames = await scanIsoDirectory(transferFolder, "Transfer");
        for (const g of isoGames) {
          if (!seenPaths.has(g.path.toLowerCase())) {
            seenPaths.add(g.path.toLowerCase());
            allGames.push(g);
          }
        }

        const gamesInTransfer = await scanGamesDirectory(path.join(transferFolder, "Games"), "Transfer", nameMap);
        for (const g of gamesInTransfer) {
          if (!seenPaths.has(g.path.toLowerCase())) {
            seenPaths.add(g.path.toLowerCase());
            allGames.push(g);
          }
        }
      }

      // Sort alphabetically by name
      allGames.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

      // Without this, a slow scan reaches support only as gaps in the log (the 2026-10-03 case).
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= SLOW_SCAN_LOG_MS) {
        appendAppEvent(
          "browse",
          `varredura de jogos instalados: ${allGames.length} jogo(s) em ${elapsedMs} ms ` +
            `(${scanStats.analyzed} pasta(s) analisada(s), ${scanStats.reused} reaproveitada(s), ` +
            `${scanStats.filesSized} arquivo(s) medido(s); mais lenta: "${scanStats.slowestFolder}" ${scanStats.slowestMs} ms)`
        );
      }

      cachedScanResult = allGames;
      lastScanTimestamp = Date.now();
      return allGames;
    } finally {
      inFlightScanPromise = null;
    }
  })();

  return inFlightScanPromise;
}
