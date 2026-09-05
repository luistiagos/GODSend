import fs from "fs";
import path from "path";
import { listFat32UsbDrives, type UsbDriveInfo } from "./badAvatarUsbService";
import { readConfig } from "./settingsService";
import { xboxBuildGameNameMap } from "./auroraLibraryService";

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
function readGodsendIni(dirPath: string): { titleName?: string; titleId?: string; type?: string } | null {
  try {
    const iniPath = path.join(dirPath, "godsend.ini");
    if (!fs.existsSync(iniPath)) return null;
    const content = fs.readFileSync(iniPath, "utf8");
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
function hasGodOrContentSubfolder(dirPath: string): boolean {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
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
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Checks whether a folder contains a default.xex file (or one level deep).
 */
function hasDefaultXex(dirPath: string): boolean {
  try {
    const direct = path.join(dirPath, "default.xex");
    if (fs.existsSync(direct)) return true;
    const directCase = path.join(dirPath, "Default.xex");
    if (fs.existsSync(directCase)) return true;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !isCorruptedFolderName(entry.name)) {
        const subXex = path.join(dirPath, entry.name, "default.xex");
        if (fs.existsSync(subXex)) return true;
        const subXexCase = path.join(dirPath, entry.name, "Default.xex");
        if (fs.existsSync(subXexCase)) return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Inspects a single candidate game folder and returns InstalledGameInfo if valid.
 */
function parseGameFolder(
  fullPath: string,
  folderName: string,
  driveLabel: string,
  nameMap?: Map<string, string>
): InstalledGameInfo | null {
  if (isCorruptedFolderName(folderName)) return null;
  const lower = folderName.toLowerCase();
  if (SYSTEM_CONTAINER_NAMES.has(lower)) return null;

  try {
    // Check godsend.ini manifest
    const ini = readGodsendIni(fullPath);
    let titleName: string | undefined = ini?.titleName;
    let titleId: string | undefined = ini?.titleId;
    let format: "god" | "xex" | undefined = ini?.type === "xex" ? "xex" : ini?.type === "god" ? "god" : undefined;

    const isDefaultXex = hasDefaultXex(fullPath);
    const isGodSub = hasGodOrContentSubfolder(fullPath);

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
      try {
        const subs = fs.readdirSync(fullPath, { withFileTypes: true });
        for (const sub of subs) {
          if (sub.isDirectory() && !isCorruptedFolderName(sub.name) && HEX_8_REGEX.test(sub.name)) {
            titleId = sub.name.toUpperCase();
            break;
          }
        }
      } catch {}
    }

    // Probe STFS LIVE/PIRS header if Title ID is still unknown
    if (!titleId) {
      titleId = probeStfsTitleId(fullPath) || undefined;
    }

    // Skip Xbox 360 system/dashboard update data
    if (titleId === "FFFE07DF") {
      return null;
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

    // Lookup name by Title ID if name is missing or is just the hex TitleID
    if ((!titleName || titleName === titleId) && titleId && nameMap) {
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

    let sizeBytes = 0;
    try {
      sizeBytes = getDirectorySizeBytes(fullPath);
    } catch {}

    // Reject empty folders with 0 bytes that have no actual executable or valid ini
    if (sizeBytes === 0 && !ini && !isDefaultXex && !isGodSub) {
      return null;
    }

    const localCoverUrl = findLocalCoverDataUrl(fullPath);

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
export function scanGamesDirectory(
  gamesDir: string,
  driveLabel: string,
  nameMap?: Map<string, string>
): InstalledGameInfo[] {
  const games: InstalledGameInfo[] = [];
  if (!fs.existsSync(gamesDir)) return games;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(gamesDir, { withFileTypes: true });
  } catch {
    return games;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isCorruptedFolderName(entry.name)) continue;
    const fullPath = path.join(gamesDir, entry.name);
    const game = parseGameFolder(fullPath, entry.name, driveLabel, nameMap);
    if (game) {
      games.push(game);
    }
  }

  return games;
}

function getDirectorySizeBytes(dirPath: string, depth = 0): number {
  if (depth > 3) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (isCorruptedFolderName(entry.name)) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirectorySizeBytes(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {}
      }
    }
  } catch {}
  return total;
}

function findLocalCoverDataUrl(dirPath: string): string | undefined {
  const coverFiles = [
    "cover.jpg", "cover.png", "cover.jpeg",
    "folder.jpg", "folder.png",
    "poster.jpg", "poster.png",
    "boxart.jpg", "boxart.png",
    "artwork.jpg", "artwork.png"
  ];
  for (const name of coverFiles) {
    const p = path.join(dirPath, name);
    if (fs.existsSync(p)) {
      try {
        const stat = fs.statSync(p);
        if (stat.isFile() && stat.size >= 100 && stat.size < 5000000) {
          const buf = fs.readFileSync(p);
          const mime = (buf[0] === 0xFF && buf[1] === 0xD8) ? "image/jpeg" : (buf[0] === 0x89 && buf[1] === 0x50) ? "image/png" : "image/jpeg";
          return `data:${mime};base64,${buf.toString("base64")}`;
        }
      } catch {}
    }
  }
  return undefined;
}

function probeStfsTitleId(dirPath: string, depth = 0): string | null {
  if (depth > 4) return null;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (isCorruptedFolderName(entry.name)) continue;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = probeStfsTitleId(full, depth + 1);
        if (sub) return sub;
      } else {
        try {
          const s = fs.statSync(full);
          if (s.size >= 0x364 && s.size < 60000000) {
            const fd = fs.openSync(full, "r");
            const buf = Buffer.alloc(0x364);
            const read = fs.readSync(fd, buf, 0, 0x364, 0);
            fs.closeSync(fd);
            if (read >= 0x364) {
              const magic = buf.toString("ascii", 0, 4);
              if (magic === "LIVE" || magic === "PIRS" || magic === "CON ") {
                const tid = buf.toString("hex", 0x360, 0x364).toUpperCase();
                if (HEX_8_REGEX.test(tid) && tid !== "00000000" && tid !== "FFFFFFFF") {
                  return tid;
                }
              }
            }
          }
        } catch {}
      }
    }
  } catch {}
  return null;
}

/**
 * Scans Content/0000000000000000 on a drive for GOD/XBLA/DLC games.
 */
export function scanContentDirectory(
  contentDir: string,
  driveLabel: string,
  nameMap?: Map<string, string>
): InstalledGameInfo[] {
  const games: InstalledGameInfo[] = [];
  if (!fs.existsSync(contentDir)) return games;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(contentDir, { withFileTypes: true });
  } catch {
    return games;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (isCorruptedFolderName(entry.name)) continue;
    const tid = entry.name.toUpperCase();
    if (!HEX_8_REGEX.test(tid)) continue;

    // Skip system dashboard/avatar updates
    if (tid === "FFFE07DF") {
      continue;
    }

    const fullPath = path.join(contentDir, entry.name);

    try {
      // Check if this Title ID folder has any content subdirectories or files
      const subdirs = fs.readdirSync(fullPath, { withFileTypes: true });
      if (subdirs.length === 0) continue;

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
      if (!hasValidContent) continue;

      let titleName = nameMap?.get(tid) || tid;
      const ini = readGodsendIni(fullPath);
      if (ini?.titleName) titleName = ini.titleName;

      // If title name is still just the hex TID, look for a named container file inside subfolders
      if (titleName === tid) {
        try {
          for (const sub of subdirs) {
            if (isCorruptedFolderName(sub.name)) continue;
            if (sub.isDirectory()) {
              const files = fs.readdirSync(path.join(fullPath, sub.name), { withFileTypes: true });
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

      if (isCorruptedFolderName(titleName)) continue;

      let sizeBytes = 0;
      try {
        sizeBytes = getDirectorySizeBytes(fullPath);
      } catch {}

      const localCoverUrl = findLocalCoverDataUrl(fullPath);

      games.push({
        name: titleName,
        titleId: tid,
        path: fullPath,
        drive: driveLabel,
        format: "god",
        folderName: entry.name,
        sizeBytes,
        localCoverUrl,
      });
    } catch {
      /* skip individual entry */
    }
  }

  return games;
}

/**
 * Scans a folder for raw .iso files.
 */
export function scanIsoDirectory(isoDir: string, driveLabel: string): InstalledGameInfo[] {
  const games: InstalledGameInfo[] = [];
  if (!fs.existsSync(isoDir)) return games;

  try {
    const entries = fs.readdirSync(isoDir, { withFileTypes: true });
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
  } catch {
    /* ignore */
  }

  return games;
}

/**
 * Scans a single drive root across all potential game folders.
 */
function scanDriveRoot(
  driveRoot: string,
  driveLabel: string,
  nameMap: Map<string, string>,
  seenPaths: Set<string>,
  outGames: InstalledGameInfo[]
): void {
  const candidateFolderNames = [
    "Games", "games", "Jogos", "jogos",
    "Xbox360", "xbox360", "Xbox 360", "xbox 360",
    "RGH", "rgh", "XEX", "xex", "GOD", "god",
  ];

  const scannedDirs = new Set<string>();

  for (const folder of candidateFolderNames) {
    const fullDir = path.join(driveRoot, folder);
    const lowerKey = fullDir.toLowerCase();
    if (scannedDirs.has(lowerKey) || !fs.existsSync(fullDir)) continue;
    scannedDirs.add(lowerKey);

    const found = scanGamesDirectory(fullDir, driveLabel, nameMap);
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
  if (fs.existsSync(contentDir)) {
    const foundContent = scanContentDirectory(contentDir, driveLabel, nameMap);
    for (const g of foundContent) {
      const pKey = g.path.toLowerCase();
      if (!seenPaths.has(pKey)) {
        seenPaths.add(pKey);
        outGames.push(g);
      }
    }
  }

  // Check direct root-level game folders (e.g. E:\Gears of War 3 - 4D5308AB\)
  try {
    const rootEntries = fs.readdirSync(driveRoot, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      if (isCorruptedFolderName(entry.name)) continue;
      const lower = entry.name.toLowerCase();
      if (SYSTEM_CONTAINER_NAMES.has(lower) || candidateFolderNames.some((c) => c.toLowerCase() === lower)) {
        continue;
      }
      const fullPath = path.join(driveRoot, entry.name);
      if (hasDefaultXex(fullPath) || hasGodOrContentSubfolder(fullPath) || NAME_TITLE_ID_REGEX.test(entry.name)) {
        const game = parseGameFolder(fullPath, entry.name, driveLabel, nameMap);
        if (game) {
          const pKey = game.path.toLowerCase();
          if (!seenPaths.has(pKey)) {
            seenPaths.add(pKey);
            outGames.push(game);
          }
        }
      }
    }
  } catch {}
}

/**
 * Returns available Windows drive letters (D: through Z:) that exist and are ready.
 */
function getWindowsCandidateDriveRoots(): string[] {
  if (process.platform !== "win32") return [];
  const roots: string[] = [];
  const startCode = "D".charCodeAt(0);
  const endCode = "Z".charCodeAt(0);

  for (let code = startCode; code <= endCode; code++) {
    const letter = String.fromCharCode(code);
    const rootPath = `${letter}:\\`;
    try {
      if (fs.existsSync(rootPath)) {
        roots.push(rootPath);
      }
    } catch {}
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
      const nameMap = xboxBuildGameNameMap();
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

        scanDriveRoot(drive.rootPath, driveDisplay, nameMap, seenPaths, allGames);
      }

      // 2. Safety fallback: scan any connected Windows drives (D: to Z:) that have Xbox game folders
      if (process.platform === "win32") {
        const winRoots = getWindowsCandidateDriveRoots();
        for (const r of winRoots) {
          const letter = normalizeDriveLetter(r);
          if (processedRoots.has(letter.toLowerCase())) continue;
          processedRoots.add(letter.toLowerCase());

          // Only scan non-USB volume if it has an Xbox indicator folder
          const hasXboxFolders = [
            "Games", "games", "Jogos", "jogos", "Xbox360", "xbox360", "Aurora", "Content"
          ].some((f) => fs.existsSync(path.join(r, f)));

          if (hasXboxFolders) {
            scanDriveRoot(r, letter, nameMap, seenPaths, allGames);
          }
        }
      }

      // 3. Scan configured Transfer folder (for ISOs and local transfers)
      const config = readConfig();
      const transferFolder = config.transferFolder;
      if (transferFolder && fs.existsSync(transferFolder)) {
        const isoGames = scanIsoDirectory(transferFolder, "Transfer");
        for (const g of isoGames) {
          if (!seenPaths.has(g.path.toLowerCase())) {
            seenPaths.add(g.path.toLowerCase());
            allGames.push(g);
          }
        }

        const gamesInTransfer = scanGamesDirectory(path.join(transferFolder, "Games"), "Transfer", nameMap);
        for (const g of gamesInTransfer) {
          if (!seenPaths.has(g.path.toLowerCase())) {
            seenPaths.add(g.path.toLowerCase());
            allGames.push(g);
          }
        }
      }

      // Sort alphabetically by name
      allGames.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

      cachedScanResult = allGames;
      lastScanTimestamp = Date.now();
      return allGames;
    } finally {
      inFlightScanPromise = null;
    }
  })();

  return inFlightScanPromise;
}
