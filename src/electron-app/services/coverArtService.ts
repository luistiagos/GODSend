import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fetchHttpImage } from "../infrastructure/httpHelper";

export interface CoverResult {
  ok: boolean;
  dataUrl?: string;
}

export interface XboxUnityCoverEntry {
  titleId: string;
  front: string | null;
  thumbnail: string | null;
  url: string | null;
  official: boolean;
  rating: number | null;
  source?: string;
  assetType?: string;
}

// In-memory cache: base-title → { ok, dataUrl? }
export const browseCoverCache = new Map<string, CoverResult>();

// ── Title Dataset & Curated Title IDs ───────────────────────────────────────
const titleToIdMap = new Map<string, Set<string>>();
let titleDatasetLoaded = false;

const CURATED_TITLE_IDS: Record<string, string | string[]> = {
  // GTA Franchise
  "grand theft auto v": "545408A7",
  "gta v": "545408A7",
  "gta 5": "545408A7",
  "grand theft auto 5": "545408A7",
  "grand thief auto 5": "545408A7",
  "grand thief auto v": "545408A7",
  "grand theft auto iv": "545407F2",
  "gta iv": "545407F2",
  "gta 4": "545407F2",
  "grand theft auto 4": "545407F2",
  "grand thief auto 4": "545407F2",
  "grand thief auto iv": "545407F2",
  "grand theft auto episodes from liberty city": "545407F2",
  "gta episodes from liberty city": "545407F2",
  "episodes from liberty city": "545407F2",
  "grand theft auto the ballad of gay tony": "545407F2",
  "the ballad of gay tony": "545407F2",
  "grand theft auto the lost and damned": "545407F2",
  "the lost and damned": "545407F2",
  "grand theft auto san andreas": ["545408B8", "54540841", "54540086"],
  "gta san andreas": ["545408B8", "54540841", "54540082"],
  "grand theft auto vice city": ["5454000F", "54540073"],
  "gta vice city": ["5454000F", "54540073"],
  "grand theft auto 3": "5454000E",
  "grand theft auto iii": "5454000E",
  "gta 3": "5454000E",
  "gta iii": "5454000E",

  // Top Xbox 360 Games
  "minecraft": "584111F7",
  "minecraft xbox 360 edition": "584111F7",
  "the elder scrolls v skyrim": "425307E6",
  "skyrim": "425307E6",
  "red dead redemption": "5454082B",
  "rdr": "5454082B",
  "bully scholarship edition": "5454081A",
  "bully": "54540832",
  "call of duty black ops": "41560855",
  "call of duty black ops ii": "415608C3",
  "call of duty black ops 2": "415608C3",
  "call of duty black ops iii": "4156091D",
  "call of duty black ops 3": "4156091D",
  "call of duty modern warfare": "415607E6",
  "call of duty 4 modern warfare": "415607E6",
  "call of duty modern warfare 2": "41560817",
  "call of duty modern warfare ii": "41560817",
  "call of duty modern warfare 3": "415608CB",
  "call of duty modern warfare iii": "415608CB",
  "call of duty mw3": "415608CB",
  "call of duty world at war": "4156081C",
  "call of duty ghosts": "415608FC",
  "call of duty advanced warfare": "41560914",
  "far cry 3": "5553088C",
  "far cry 4": "555308CA",
  "assassins creed ii": "5553083B",
  "assassins creed 2": "5553083B",
  "assassins creed iv black flag": "555308C2",
  "assassins creed 4 black flag": "555308C2",
  "battlefield 3": "45410950",
  "battlefield 4": "454109BA",
  "battlefield bad company 2": "454108A8",
  "halo 3": "4D5307E6",
  "halo 4": "4D530919",
  "halo reach": "4D53085B",
  "gears of war 3": "4D5308AB",
  "gears of war judgment": "4D530A26",
  "forza motorsport 4": "4D530910",
  "forza horizon 2": "4D530AA4",
  "need for speed most wanted": ["454107D9", "45410961"],
  "left 4 dead 2": "454108D4",
  "portal 2": "45410912",
  "max payne 3": "5454086B",
  "la noire": "5454086C",
  "l a noire": "5454086C",
  "dark souls ii": "4E4D083E",
  "dark souls 2": "4E4D083E",
  "diablo iii": "415608D6",
  "diablo 3": "415608D6",
  "fallout 3": "425307D5",
  "fallout new vegas": "425307E0",
  "saints row iv": "4B4D07F6",
  "saints row 4": "4B4D07F6",
  "dead space 2": "454108DF",
  "dead space 3": "4541099D",
  "bioshock infinite": "5454085D",
  "borderlands 2": "5454087C"
};

export function normalizeTitleKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s*\[.*?\]/g, "")
    .replace(/grand thief auto/gi, "grand theft auto")
    .replace(/a era do gelo/gi, "ice age")
    .replace(/['":;,.!?_~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function indexTitleInMap(rawTitle: string, tid: string): void {
  if (!rawTitle || !tid || !/^[0-9A-Fa-f]{8}$/.test(tid)) return;
  const id = tid.toUpperCase();
  const n = normalizeTitleKey(rawTitle);
  if (!n) return;
  if (!titleToIdMap.has(n)) {
    titleToIdMap.set(n, new Set());
  }
  titleToIdMap.get(n)!.add(id);
}

export function ensureTitleDatabaseLoaded(): void {
  if (titleDatasetLoaded) return;
  titleDatasetLoaded = true;

  // 1. Index curated dictionary
  for (const [title, ids] of Object.entries(CURATED_TITLE_IDS)) {
    if (Array.isArray(ids)) {
      for (const id of ids) indexTitleInMap(title, id);
    } else {
      indexTitleInMap(title, ids);
    }
  }

  // 2. Search for dataset files in resources, cache or source directories
  const candidateDirs: string[] = [];
  if ((process as any).resourcesPath) {
    candidateDirs.push(path.join((process as any).resourcesPath, "cache", "title_id_datasets"));
    candidateDirs.push(path.join((process as any).resourcesPath, "cache"));
  }
  candidateDirs.push(path.join(__dirname, "..", "..", "cache", "title_id_datasets"));
  candidateDirs.push(path.join(__dirname, "..", "..", "..", "cache", "title_id_datasets"));
  candidateDirs.push(path.join(process.cwd(), "cache", "title_id_datasets"));
  candidateDirs.push(path.join(process.cwd(), "src", "server", "data"));

  for (const dir of candidateDirs) {
    try {
      if (!fs.existsSync(dir)) continue;

      // Try xboxdb_browse_pairs.json
      const xboxdbPath = path.join(dir, "xboxdb_browse_pairs.json");
      if (fs.existsSync(xboxdbPath)) {
        try {
          const xboxdb = JSON.parse(fs.readFileSync(xboxdbPath, "utf8"));
          for (const v of Object.values(xboxdb) as any[]) {
            if (v?.title && v?.id) indexTitleInMap(v.title, v.id);
          }
        } catch {}
      }

      // Try gist_title_ids.json
      const gistPath = path.join(dir, "gist_title_ids.json");
      if (fs.existsSync(gistPath)) {
        try {
          const gist = JSON.parse(fs.readFileSync(gistPath, "utf8"));
          for (const v of Object.values(gist) as any[]) {
            if (v?.title && v?.titleid) indexTitleInMap(v.title, v.titleid);
          }
        } catch {}
      }

      // Try iso2god_titles.jsonl
      const jsonlPath = path.join(dir, "iso2god_titles.jsonl");
      if (fs.existsSync(jsonlPath)) {
        try {
          const lines = fs.readFileSync(jsonlPath, "utf8").split("\n");
          for (const l of lines) {
            if (!l.trim()) continue;
            try {
              const item = JSON.parse(l);
              if (item?.Name && item?.TitleID) indexTitleInMap(item.Name, item.TitleID);
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }
}

// ── Disk Cache Helpers ───────────────────────────────────────────────────────
function getDiskCoverCacheDir(): string {
  const appData = process.env.APPDATA || (process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : path.join(os.homedir(), ".config"));
  const dir = path.join(appData, "Xbox 360 Companion", "cache", "covers");
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {}
  return dir;
}

// Known corrupted/misassigned legacy cover keys that must be purged from disk
const LEGACY_CORRUPTED_CACHE_PREFIXES = [
  "grand_theft_auto_5",
  "grand_theft_auto_4",
  "grand_theft_auto_v",
  "grand_theft_auto_iv",
  "gta_5",
  "gta_4",
  "gta_v",
  "gta_iv",
  "grand_theft_auto_-_episodes_from_liberty_city",
  "grand_theft_auto_san_andreas",
  "gta_san_andreas_hd_br",
  "grand_thief_auto"
];

let legacyCachePurged = false;
export function purgeCorruptedLegacyCoverCache(): void {
  if (legacyCachePurged) return;
  legacyCachePurged = true;
  try {
    const cacheDir = getDiskCoverCacheDir();
    if (!fs.existsSync(cacheDir)) return;
    const files = fs.readdirSync(cacheDir);
    for (const f of files) {
      const lower = f.toLowerCase();
      for (const prefix of LEGACY_CORRUPTED_CACHE_PREFIXES) {
        if (lower.startsWith(prefix)) {
          try { fs.unlinkSync(path.join(cacheDir, f)); } catch {}
          break;
        }
      }
    }
    // Also clear in-memory cache
    browseCoverCache.clear();
  } catch {}
}

export function getCachedCoverFromDisk(key: string): string | null {
  try {
    purgeCorruptedLegacyCoverCache();
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const cacheDir = getDiskCoverCacheDir();
    const jpgPath = path.join(cacheDir, `${safeKey}.jpg`);
    const pngPath = path.join(cacheDir, `${safeKey}.png`);
    if (fs.existsSync(jpgPath)) {
      const buf = fs.readFileSync(jpgPath);
      if (buf.length >= 100) {
        return `data:image/jpeg;base64,${buf.toString("base64")}`;
      }
    }
    if (fs.existsSync(pngPath)) {
      const buf = fs.readFileSync(pngPath);
      if (buf.length >= 100) {
        return `data:image/png;base64,${buf.toString("base64")}`;
      }
    }
  } catch {}
  return null;
}

export function saveCoverToDisk(key: string, buf: Buffer, mime = "image/jpeg"): void {
  try {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const cacheDir = getDiskCoverCacheDir();
    const ext = mime === "image/png" ? ".png" : ".jpg";
    const filePath = path.join(cacheDir, `${safeKey}${ext}`);
    fs.writeFileSync(filePath, buf);
  } catch {}
}

/** Strip ALL parenthetical/bracketed suffixes to get a bare base title. */
export function baseTitleForCover(raw: string): string {
  return raw
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s*\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clean a Redump/No-Intro game name for a cover-art search query. */
export function cleanTitleForSearch(raw: string): string {
  return raw
    .replace(/\s*\([^)]*(?:USA|EUR|PAL|NTSC|Japan|World|Australia|Germany|Europe|Asia|Russia|Italy|Spain|UK|US|En|Ja|Fr|De|Es|It|Pt|Zh|Ko|Pl|Ru|Nl|Sv|No|Da|Fi|El|Tr|Cs|Hu|Multi|Disc|Install|Play|Bonus|Demo|Addon|DLC|XBLIG|XBLA|Title Update|Rev|v\d)[^)]*\)/gi, "")
    .replace(/\s*\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Generate a prioritized list of search queries / TitleIDs for a game title. */
export function generateSearchCandidates(gameName: string): string[] {
  ensureTitleDatabaseLoaded();
  const candidates: string[] = [];
  const discoveredTitleIds = new Set<string>();

  const add = (q: string) => {
    q = q.trim().replace(/\s+/g, " ");
    if (q && !candidates.includes(q)) {
      candidates.push(q);
    }
  };

  const addId = (id: string) => {
    id = id.trim().toUpperCase();
    if (/^[0-9A-F]{8}$/.test(id)) {
      discoveredTitleIds.add(id);
    }
  };

  // 1. Check if raw gameName is already an 8-hex TitleID
  const trimmed = gameName.trim();
  if (/^[0-9A-F]{8}$/i.test(trimmed)) {
    return [trimmed.toUpperCase()];
  }

  // 2. Base clean title
  const clean = cleanTitleForSearch(gameName);
  if (!clean) return [];

  // Check direct TitleID lookup on normalized clean title
  const cleanNorm = normalizeTitleKey(clean);
  const cleanIds = titleToIdMap.get(cleanNorm);
  if (cleanIds) {
    for (const id of cleanIds) addId(id);
  }

  // 3. Typo corrections and common replacements
  let replaced = clean
    .replace(/grand thief auto/gi, "Grand Theft Auto")
    .replace(/a era do gelo/gi, "Ice Age")
    .replace(/^ac\b/gi, "Assassin's Creed")
    .replace(/^acdc\b/gi, "AC/DC")
    .replace(/brasil/gi, "Brazil")
    .replace(/^0 d\b/gi, "0D");

  add(clean);
  add(replaced);

  // Check TitleID on replaced
  const replacedNorm = normalizeTitleKey(replaced);
  const replacedIds = titleToIdMap.get(replacedNorm);
  if (replacedIds) {
    for (const id of replacedIds) addId(id);
  }

  // 4. Franchise expansions & synonyms
  // GTA expansions
  if (/\bgrand theft auto\b/i.test(replaced)) {
    const gtaShort = replaced.replace(/\bgrand theft auto\b/gi, "GTA");
    add(gtaShort);
    const gtaShortNorm = normalizeTitleKey(gtaShort);
    const gtaIds = titleToIdMap.get(gtaShortNorm);
    if (gtaIds) { for (const id of gtaIds) addId(id); }
  }
  if (/\bgta\b/i.test(replaced)) {
    const gtaLong = replaced.replace(/\bgta\b/gi, "Grand Theft Auto");
    add(gtaLong);
    const gtaLongNorm = normalizeTitleKey(gtaLong);
    const gtaIds = titleToIdMap.get(gtaLongNorm);
    if (gtaIds) { for (const id of gtaIds) addId(id); }
  }

  // Call of Duty expansions
  if (/\bcall of duty\b/i.test(replaced)) {
    const codShort = replaced.replace(/\bcall of duty\b/gi, "COD");
    add(codShort);
    const codIds = titleToIdMap.get(normalizeTitleKey(codShort));
    if (codIds) { for (const id of codIds) addId(id); }
  }
  if (/\bcod\b/i.test(replaced)) {
    const codLong = replaced.replace(/\bcod\b/gi, "Call of Duty");
    add(codLong);
    const codIds = titleToIdMap.get(normalizeTitleKey(codLong));
    if (codIds) { for (const id of codIds) addId(id); }
  }

  // Need for Speed expansions
  if (/\bneed for speed\b/i.test(replaced)) {
    const nfsShort = replaced.replace(/\bneed for speed\b/gi, "NFS");
    add(nfsShort);
    const nfsIds = titleToIdMap.get(normalizeTitleKey(nfsShort));
    if (nfsIds) { for (const id of nfsIds) addId(id); }
  }
  if (/\bnfs\b/i.test(replaced)) {
    const nfsLong = replaced.replace(/\bnfs\b/gi, "Need for Speed");
    add(nfsLong);
    const nfsIds = titleToIdMap.get(normalizeTitleKey(nfsLong));
    if (nfsIds) { for (const id of nfsIds) addId(id); }
  }

  // Skyrim & Elder Scrolls
  if (/the elder scrolls.*skyrim/i.test(replaced) || /tes.*skyrim/i.test(replaced)) {
    add("Skyrim");
    add("The Elder Scrolls V: Skyrim");
    addId("425307E6");
  }

  // Minecraft
  if (/^minecraft\b/i.test(replaced)) {
    add("Minecraft: Xbox 360 Edition");
    add("Minecraft");
    addId("584111F7");
    addId("4D530A81");
  }

  // Bully
  if (/bully scholarship/i.test(replaced)) {
    add("Bully Scholarship Ed.");
    add("Bully: Scholarship Edition");
    add("Bully");
    addId("5454081A");
    addId("54540832");
  }

  // 5. Roman <-> Arabic numeral conversion
  const numMap: [RegExp, string][] = [
    [/\b10\b/g, "X"], [/\bX\b/gi, "10"],
    [/\b9\b/g, "IX"], [/\bIX\b/gi, "9"],
    [/\b8\b/g, "VIII"], [/\bVIII\b/gi, "8"],
    [/\b7\b/g, "VII"], [/\bVII\b/gi, "7"],
    [/\b6\b/g, "VI"], [/\bVI\b/gi, "6"],
    [/\b5\b/g, "V"], [/\bV\b/gi, "5"],
    [/\b4\b/g, "IV"], [/\bIV\b/gi, "4"],
    [/\b3\b/g, "III"], [/\bIII\b/gi, "3"],
    [/\b2\b/g, "II"], [/\bII\b/gi, "2"],
    [/\b1\b/g, "I"], [/\bI\b/gi, "1"],
  ];

  const currentCandidates = [...candidates];
  for (const c of currentCandidates) {
    if (/^[0-9A-F]{8}$/i.test(c)) continue;
    for (const [pattern, replacement] of numMap) {
      if (pattern.test(c)) {
        const converted = c.replace(pattern, replacement);
        add(converted);
        const convNorm = normalizeTitleKey(converted);
        const convIds = titleToIdMap.get(convNorm);
        if (convIds) {
          for (const id of convIds) addId(id);
        }
      }
    }
  }

  // 6. Strip brand prefixes safely
  const stripBrands = (q: string) => {
    return q
      .replace(/^(EA Sports|Tom Clancy's|Tom Clancys|Peter Jackson's|Sid Meier's|James Bond|James Bond 007|Disney's|Disneys|Disney|LEGO|Lego|Marvel's|Marvels|Marvel|Adidas)\s+/i, "")
      .trim();
  };
  add(stripBrands(clean));
  add(stripBrands(replaced));

  // Prioritize discovered Title IDs at the very top
  const idList = Array.from(discoveredTitleIds);
  const textList = candidates.filter((c) => !/^[0-9A-F]{8}$/i.test(c));

  return [...idList, ...textList];
}

/** Check whether a candidate item name from XboxUnity is a false positive match for the search term. */
function isValidUnityCoverMatch(searchTerm: string, item: any): boolean {
  if (!item || typeof item !== "object") return false;
  // If search term was an exact 8-hex TitleID, XboxUnity returns exact matches
  if (/^[0-9A-F]{8}$/i.test(searchTerm)) return true;

  const itemName = item.name ? normalizeTitleKey(item.name) : "";
  const queryNorm = normalizeTitleKey(searchTerm);
  if (!itemName || !queryNorm) return true;

  // Specific guard for GTA franchise to prevent "Grand Theft Auto Vice City" matching "Grand Theft Auto V"
  if (/\b(v|5)\b/.test(queryNorm) && !/\b(v|5)\b/.test(itemName)) return false;
  if (/\b(iv|4)\b/.test(queryNorm) && !/\b(iv|4)\b/.test(itemName)) return false;
  if (/\b(iii|3)\b/.test(queryNorm) && !/\b(iii|3)\b/.test(itemName)) return false;
  if (/\b(ii|2)\b/.test(queryNorm) && !/\b(ii|2)\b/.test(itemName)) return false;

  if (!queryNorm.includes("vice city") && itemName.includes("vice city")) return false;
  if (!queryNorm.includes("san andreas") && itemName.includes("san andreas")) return false;
  if (!queryNorm.includes("liberty city") && itemName.includes("liberty city") && !queryNorm.includes("iv") && !queryNorm.includes("4")) return false;

  return true;
}

export async function fetchXboxUnityCoverWithMeta(searchTerm: string): Promise<{ buf: Buffer; titleId: string } | null> {
  const url     = `http://xboxunity.net/api/Covers/${encodeURIComponent(searchTerm)}`;
  const jsonBuf = await fetchHttpImage(url);
  if (!jsonBuf || jsonBuf.length === 0) return null;
  let items: any[];
  try { items = JSON.parse(jsonBuf.toString("utf8")); } catch { return null; }
  if (!Array.isArray(items) || items.length === 0) return null;

  // Filter out false positive matches on text search
  const validItems = items.filter((item) => isValidUnityCoverMatch(searchTerm, item));
  if (validItems.length === 0) return null;

  const sorted = [...validItems].sort((a, b) => {
    if (b.official && !a.official) return 1;
    if (a.official && !b.official) return -1;
    return (Number(b.rating) || 0) - (Number(a.rating) || 0);
  });
  const row      = sorted[0];
  const coverUrl = row.front || row.thumbnail || row.url;
  if (!coverUrl) return null;

  const tidRaw  = row.titleid ?? row.TitleID;
  const ts      = String(tidRaw ?? "").trim();
  const titleId = /^[0-9A-F]{8}$/i.test(ts) ? ts.toUpperCase() : "";

  const buf = await fetchHttpImage(coverUrl);
  if (!buf || buf.length < 100) return null;
  return { buf, titleId };
}

export async function searchXboxUnityCovers(searchTerm: string): Promise<XboxUnityCoverEntry[]> {
  const url     = `http://xboxunity.net/api/Covers/${encodeURIComponent(searchTerm)}`;
  const jsonBuf = await fetchHttpImage(url);
  if (!jsonBuf || jsonBuf.length === 0) return [];
  let items: any[];
  try { items = JSON.parse(jsonBuf.toString("utf8")); } catch { return []; }
  if (!Array.isArray(items)) return [];

  const validItems = items.filter((item) => isValidUnityCoverMatch(searchTerm, item));

  return validItems
    .map((item) => ({
      titleId:   String(item.titleid || item.TitleID || "").toUpperCase(),
      front:     item.front     || null,
      thumbnail: item.thumbnail || null,
      url:       item.url       || null,
      official:  !!item.official,
      rating:    item.rating != null ? Number(item.rating) : null,
    }))
    .filter((r) => r.front || r.thumbnail || r.url)
    .sort((a, b) => {
      if (b.official !== a.official) return a.official ? -1 : 1;
      return (b.rating || 0) - (a.rating || 0);
    });
}

const invalidStoreTitleHex = new Set(["00000000", "FFFFFFFF"]);

function normalizeKeyStore(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function titleRankStore(query: string, title: string): number {
  const q = normalizeKeyStore(query);
  const t = normalizeKeyStore(title);
  if (!q || !t) return 99;
  if (q === t) return 0;
  if (t.includes(q) || q.includes(t)) return 1;
  return 2;
}

function extractTitleIdFromStoreProductJsonStr(jsonStr: string): string {
  const primaryMatch = jsonStr.match(/ProductGroupName"\s*:\s*"[^"]*\(([0-9A-F]{8})\)/i);
  if (primaryMatch) {
    const h = primaryMatch[1].toUpperCase();
    if (!invalidStoreTitleHex.has(h)) return h;
  }
  for (const match of jsonStr.matchAll(/\(([0-9A-F]{8})\)/gi)) {
    const h = match[1].toUpperCase();
    if (!invalidStoreTitleHex.has(h)) return h;
  }
  return "";
}

export async function fetchMicrosoftStoreTitleIdForBrowse(searchTerm: string): Promise<string> {
  const p = new URLSearchParams({
    languages:              "en-us",
    market:                 "US",
    platformdependencyname: "Windows.Xbox",
    productFamilyNames:     "Games",
    query:                  searchTerm,
    topProducts:            "10",
  });
  let res: Response;
  try {
    res = await fetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest?${p}`,
      { headers: { "User-Agent": "Mozilla/5.0 GODsend-browse-cover" } }
    );
  } catch { return ""; }
  if (!res.ok) return "";
  let asj: any;
  try { asj = await res.json(); } catch { return ""; }

  const candidates: { productId: string; title: string; type: string }[] = [];
  for (const fam of asj.Results || []) {
    for (const pr of fam.Products || []) {
      if (pr?.ProductId && pr?.Title) {
        candidates.push({ productId: pr.ProductId, title: String(pr.Title), type: pr.Type || "" });
      }
    }
  }
  candidates.sort((a, b) => {
    const g  = (t: string) => (t === "Game" ? 0 : 1);
    const tg = g(a.type) - g(b.type);
    if (tg !== 0) return tg;
    return titleRankStore(searchTerm, a.title) - titleRankStore(searchTerm, b.title);
  });

  for (let i = 0; i < Math.min(2, candidates.length); i++) {
    const q2 = new URLSearchParams({
      bigIds:         candidates[i].productId,
      market:         "US",
      languages:      "en-us",
      fieldsTemplate: "details",
    });
    let pr: Response;
    try {
      pr = await fetch(`https://displaycatalog.mp.microsoft.com/v7.0/products?${q2}`, {
        headers: { "User-Agent": "Mozilla/5.0 GODsend-browse-cover" },
      });
    } catch { continue; }
    if (!pr.ok) continue;
    let pj: any;
    try { pj = await pr.json(); } catch { continue; }
    const hex = extractTitleIdFromStoreProductJsonStr(JSON.stringify(pj));
    if (/^[0-9A-F]{8}$/.test(hex)) return hex;
  }
  return "";
}

export async function tryXboxCdnFromMicrosoftStoreSearch(searchTerm: string): Promise<Buffer | null> {
  const hex = await fetchMicrosoftStoreTitleIdForBrowse(searchTerm);
  if (!hex) return null;
  const xboxUrl = `http://catalog.xboxlive.com/Catalog/Product/CoverArt/${hex}/en-US/1`;
  const xboxBuf = await fetchHttpImage(xboxUrl);
  return xboxBuf && xboxBuf.length >= 100 ? xboxBuf : null;
}

export async function fetchWikipediaCover(articleTitle: string): Promise<Buffer | null> {
  const url     = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(articleTitle)}`;
  const jsonBuf = await fetchHttpImage(url);
  if (!jsonBuf) return null;
  let parsed: any;
  try { parsed = JSON.parse(jsonBuf.toString("utf8")); } catch { return null; }
  if (parsed.type !== "standard") return null;
  const imgUrl = parsed.originalimage?.source || parsed.thumbnail?.source;
  if (!imgUrl) return null;
  const buf = await fetchHttpImage(imgUrl);
  return buf && buf.length >= 100 ? buf : null;
}

export async function fetchXboxCdnAssets(
  titleIdHex: string,
  locale = "en-US"
): Promise<{ background: string[]; banner: string[]; icon: string[]; screenshot: string[]; cover: string[] }> {
  const result = {
    background: [] as string[], banner: [] as string[],
    icon: [] as string[], screenshot: [] as string[], cover: [] as string[],
  };
  if (!titleIdHex || !/^[0-9A-F]{8}$/i.test(titleIdHex)) return result;

  const catalogUrl =
    `http://catalog-cdn.xboxlive.com/Catalog/Catalog.asmx/Query` +
    `?methodName=FindGames` +
    `&Names=Locale&Values=${locale}` +
    `&Names=LegalLocale&Values=${locale}` +
    `&Names=Store&Values=1&Names=PageSize&Values=100&Names=PageNum&Values=1` +
    `&Names=DetailView&Values=5&Names=OfferFilterLevel&Values=1` +
    `&Names=MediaIds&Values=66acd000-77fe-1000-9115-d802${titleIdHex.toUpperCase()}` +
    `&Names=UserTypes&Values=2` +
    `&Names=MediaTypes&Values=1&Names=MediaTypes&Values=21` +
    `&Names=MediaTypes&Values=23&Names=MediaTypes&Values=37&Names=MediaTypes&Values=46`;

  try {
    const xmlBuf = await fetchHttpImage(catalogUrl);
    if (!xmlBuf || xmlBuf.length === 0) return result;
    const xml = xmlBuf.toString("utf8");

    for (const [, block] of xml.matchAll(/<live:image[^>]*>([\s\S]*?)<\/live:image>/gi)) {
      const urlM  = (block as string).match(/<live:fileUrl[^>]*>\s*(https?:\/\/[^\s<]+)\s*<\/live:fileUrl>/i);
      const typeM = (block as string).match(/<live:relationshipType[^>]*>\s*(\d+)\s*<\/live:relationshipType>/i);
      if (!urlM) continue;
      const url  = urlM[1].trim();
      const type = typeM ? parseInt(typeM[1], 10) : -1;
      if (type === 15 || type === 23) result.icon.push(url);
      else if (type === 25)           result.background.push(url);
      else if (type === 27)           result.banner.push(url);
    }

    for (const [, block] of xml.matchAll(/<live:slideShow[^>]*>([\s\S]*?)<\/live:slideShow>/gi)) {
      const urlM = (block as string).match(/<live:fileUrl[^>]*>\s*(https?:\/\/[^\s<]+)\s*<\/live:fileUrl>/i);
      if (urlM) result.screenshot.push(urlM[1].trim());
    }

    const coverUrl = `http://catalog.xboxlive.com/Catalog/Product/CoverArt/${titleIdHex.toUpperCase()}/${locale}/1`;
    const coverBuf = await fetchHttpImage(coverUrl);
    if (coverBuf && coverBuf.length >= 100) {
      const mime = (coverBuf[0] === 0xFF && coverBuf[1] === 0xD8) ? "image/jpeg" : "image/png";
      result.cover.push(`data:${mime};base64,${coverBuf.toString("base64")}`);
    }
  } catch { /* ignore catalog errors */ }
  return result;
}

export async function resolveTitleIdHex(term: string): Promise<string | null> {
  if (!term) return null;
  const trimmed = term.trim();
  if (/^[0-9A-F]{8}$/i.test(trimmed)) return trimmed.toUpperCase();

  ensureTitleDatabaseLoaded();
  const norm = normalizeTitleKey(trimmed);
  const directIds = titleToIdMap.get(norm);
  if (directIds && directIds.size > 0) {
    return Array.from(directIds)[0];
  }

  const candidates = generateSearchCandidates(trimmed);
  for (const c of candidates) {
    if (/^[0-9A-F]{8}$/i.test(c)) return c.toUpperCase();
  }

  const covers = await searchXboxUnityCovers(trimmed);
  const first  = covers.find((c) => c.titleId && /^[0-9A-F]{8}$/.test(c.titleId));
  return first ? first.titleId : null;
}
