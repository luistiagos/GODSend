export type CatalogSortOrder = "popular" | "alphabetical";
export type CoverStatus = "has" | "none";

export interface SortableCatalogItem {
  displayTitle: string;
  allRawNames: string[];
  releases: { releaseTitle: string }[];
}

export interface SortCatalogOptions {
  sortOrder: CatalogSortOrder;
  coverStatusMap?: Record<string, CoverStatus>;
  coverHintSet?: ReadonlySet<string>;
}

/**
 * Curated popularity tiers across Xbox 360, Original Xbox, XBLA, Digital and
 * popular PT-BR / RGH releases. Earlier entries score higher.
 */
const POPULAR_TITLES_RANKED: readonly string[] = [
  // Top tier icons
  "grand theft auto 5",
  "minecraft",
  "minecraft xbox 360 edition",
  "red dead redemption",
  "call of duty black ops 2",
  "grand theft auto san andreas",
  "grand theft auto 4",
  "elder scrolls 5 skyrim",
  "call of duty modern warfare 2",
  "call of duty modern warfare 3",
  "call of duty black ops",
  "call of duty black ops 1",
  "ea fc 26 legacy edition",
  "ea fc 26",
  "ea sports fc 26 legacy edition",
  "brazukas nova era 2026",
  "brazukas premium 2026 atualizado abril multi narradores",
  "brazukas pes2025",
  "pes brazukas 2026 fevereiro",
  "pes 2018",
  "fifa 19",
  "fifa 18",
  "fifa 17",
  "halo 3",
  "halo reach",
  "halo 4",
  "gears of war 3",
  "gears of war 2",
  "gears of war",
  "gears of war 1",
  "forza horizon 2",
  "forza horizon",
  "forza horizon 1",
  "forza motorsport 4",
  "call of duty 4 modern warfare",
  "call of duty modern warfare",
  "call of duty modern warfare 1",
  "call of duty ghosts",
  "call of duty black ops 3",
  "call of duty advanced warfare",
  "call of duty world at war",
  "assassins creed 4 black flag",
  "assassins creed 2",
  "assassins creed brotherhood",
  "assassins creed 3",
  "assassins creed revelations",
  "assassins creed rogue",
  "assassins creed",
  "assassins creed 1",
  "far cry 3",
  "far cry 4",
  "batman arkham city",
  "batman arkham asylum",
  "batman arkham origins",
  "left 4 dead 2",
  "left 4 dead",
  "left 4 dead 1",
  "resident evil 4",
  "resident evil 5",
  "resident evil 6",
  "resident evil revelations 2",
  "resident evil revelations",
  "resident evil 1 hd remaster",
  "resident evil 0 hd remaster",
  "dark souls",
  "dark souls 1",
  "dark souls 2",
  "dark souls prepare to die edition",
  "dark souls 2 scholar of the first sin",
  "mortal kombat",
  "mortal kombat 9",
  "mortal kombat komplete edition",
  "need for speed most wanted",
  "need for speed most wanted 2005",
  "need for speed most wanted 2012",
  "need for speed underground 2",
  "need for speed carbon",
  "need for speed hot pursuit",
  "need for speed rivals",
  "bully scholarship edition",
  "bully",
  "skate 3",
  "skate 2",
  "max payne 3",
  "l a noire",
  "la noire",
  "battlefield 4",
  "battlefield 3",
  "battlefield bad company 2",
  "fallout 3",
  "fallout new vegas",
  "borderlands 2",
  "borderlands",
  "bioshock infinite",
  "bioshock",
  "bioshock 2",
  "diablo 3",
  "diablo 3 reaper of souls ultimate evil edition",
  "portal 2",
  "orange box",
  "half life 2",
  "tomb raider",
  "rise of the tomb raider",
  "watch dogs",
  "sleeping dogs",
  "saints row 4",
  "saints row the third",
  "saints row 2",
  "alan wake",
  "alan wakes american nightmare",
  "dragon ball xenoverse",
  "dragon ball z budokai hd collection",
  "dragon ball raging blast 2",
  "naruto shippuden ultimate ninja storm 3",
  "naruto shippuden ultimate ninja storm 3 full burst",
  "naruto shippuden ultimate ninja storm revolution",
  "naruto shippuden ultimate ninja storm 2",
  "naruto shippuden ultimate ninja storm generations",
  "naruto the broken bond",
  "naruto rise of a ninja",
  "fifa 14",
  "fifa 15",
  "fifa 16",
  "2014 fifa world cup brazil",
  "2010 fifa world cup south africa",
  "pes 2016",
  "pes 2014",
  "pes 2013",
  "nba 2k14",
  "nba 2k16",
  "wwe 2k14",
  "wwe 2k17",
  "ufc undisputed 3",
  "mass effect 2",
  "mass effect 3",
  "mass effect",
  "dead space",
  "dead space 2",
  "dead space 3",
  "witcher 2 assassins of kings",
  "witcher 2 assassins of kings enhanced edition",
  "elder scrolls 4 oblivion",
  "dishonored",
  "metal gear solid 5 the phantom pain",
  "metal gear solid hd collection",
  "metal gear rising revengeance",
  "devil may cry 4",
  "devil may cry hd collection",
  "dmc devil may cry",
  "bayonetta",
  "ninja gaiden 2",
  "ninja gaiden black",
  "castlevania lords of shadow",
  "castlevania lords of shadow 2",
  "dantes inferno",
  "dead island",
  "dead island riptide",
  "dead rising",
  "dead rising 2",
  "fable 2",
  "fable 3",
  "fable anniversary",
  "fable 1 anniversary",
  "fable",
  "burnout paradise",
  "burnout 3 takedown",
  "burnout revenge",
  "midnight club los angeles",
  "midnight club 3 dub edition",
  "grand theft auto episodes from liberty city",
  "grand theft auto vice city",
  "grand theft auto 3",
  "halo combat evolved",
  "halo 1 combat evolved",
  "halo combat evolved anniversary",
  "halo 2",
  "halo 3 odst",
  "street fighter 4",
  "ultra street fighter 4",
  "super street fighter 4",
  "tekken 6",
  "tekken tag tournament 2",
  "injustice gods among us",
  "marvel vs capcom 3",
  "ultimate marvel vs capcom 3",
  "marvel vs capcom 2",
  "lego batman",
  "lego batman 1",
  "lego batman 2 dc super heroes",
  "lego batman 2",
  "lego batman 3 beyond gotham",
  "lego batman 3",
  "lego marvel super heroes",
  "lego star wars the complete saga",
  "lego jurassic world",
  "lego harry potter years 1 4",
  "lego harry potter years 5 7",
  "lego indiana jones",
  "sonic generations",
  "sonic unleashed",
  "sonic adventure",
  "sonic adventure 2",
  "rayman legends",
  "rayman origins",
  "guitar hero 3 legends of rock",
  "guitar hero world tour",
  "guitar hero metallica",
  "rock band 3",
  "just dance 2015",
  "just dance 2016",
  "just dance 2017",
  "just dance 2018",
  "just dance 4",
  "kinect sports",
  "kinect adventures",
  "alien isolation",
  "metro last light",
  "metro 2033",
  "wolfenstein the new order",
  "crysis 2",
  "crysis 3",
  "hitman absolution",
  "mafia 2",
  "splinter cell blacklist",
  "splinter cell chaos theory",
  "dragons dogma",
  "dragons dogma dark arisen",
  "kingdoms of amalur reckoning",
  "south park the stick of truth",
  "mirror s edge",
  "mirrors edge",
  "silent hill homecoming",
  "silent hill downpour",
  "silent hill hd collection",
  "evil within",
  "shadow of mordor",
  "middle earth shadow of mordor",
  "spec ops the line",
  "prototype",
  "prototype 2",
  "xcom enemy unknown",
  "black",
  "star wars knights of the old republic",
  "star wars knights of the old republic 2",
  "simpsons hit run",
  "simpsons game",
  "spider man shattered dimensions",
  "spider man web of shadows",
  "amazing spider man",
  "amazing spider man 2",
  "def jam fight for ny",
  "tony hawks pro skater 4",
  "tony hawks underground",
  "tony hawks underground 2",
  "conker live reloaded",
  "psychonauts",
  "chaves kart",
  "castle crashers",
  "limbo",
  "braid",
  "super meat boy",
  "terraria",
  "state of decay",
  "walking dead",
  "wolf among us",
  "trials hd",
  "trials evolution",
  "shadow complex",
  "geometry wars retro evolved 2",
  "scott pilgrim vs the world the game",
  "banjo kazooie",
  "banjo tooie",
  "crash of the titans",
  "crash mind over mutant",
  "crash twinsanity",
  "battleblock theater",
  "minecraft story mode",
  "minecraft story mode the complete adventure",
];

const POPULAR_TITLE_SCORE_MAP: Map<string, number> = (() => {
  const m = new Map<string, number>();
  const baseScore = 10_000;
  for (let i = 0; i < POPULAR_TITLES_RANKED.length; i++) {
    const key = POPULAR_TITLES_RANKED[i];
    if (!m.has(key)) {
      m.set(key, baseScore - i * 20);
    }
  }
  return m;
})();

const POPULAR_FRANCHISE_RULES: readonly [RegExp, number][] = [
  [/\bgrand theft auto\b/i, 4800],
  [/\bminecraft\b/i, 4700],
  [/\bred dead\b/i, 4600],
  [/\bcall of duty\b/i, 4550],
  [/\b(?:ea fc|ea sports fc|brazukas|bomba patch|fifa|pes|pro evolution soccer)\b/i, 4450],
  [/\bhalo\b/i, 4400],
  [/\bgears of war\b/i, 4350],
  [/\bforza\b/i, 4300],
  [/\bassassins creed\b/i, 4200],
  [/\bfar cry\b/i, 4150],
  [/\bbatman arkham\b/i, 4100],
  [/\bresident evil\b/i, 4050],
  [/\bdark souls\b/i, 4000],
  [/\belder scrolls\b/i, 3950],
  [/\bmortal kombat\b/i, 3900],
  [/\bneed for speed\b/i, 3850],
  [/\bbattlefield\b/i, 3800],
  [/\bnaruto\b/i, 3750],
  [/\bdragon ball\b/i, 3700],
  [/\bleft 4 dead\b/i, 3650],
  [/\blego\b/i, 3550],
  [/\bfallout\b/i, 3500],
  [/\bborderlands\b/i, 3450],
  [/\bbioshock\b/i, 3400],
  [/\bskate\b/i, 3350],
  [/\bmass effect\b/i, 3300],
  [/\bdead space\b/i, 3250],
  [/\btomb raider\b/i, 3200],
  [/\bsaints row\b/i, 3150],
  [/\bfable\b/i, 3100],
  [/\bburnout\b/i, 3050],
  [/\bmetal gear\b/i, 3000],
  [/\bdevil may cry\b/i, 2950],
  [/\bstreet fighter\b/i, 2900],
  [/\btekken\b/i, 2850],
  [/\bsonic\b/i, 2800],
  [/\bcrash\b/i, 2750],
  [/\bguitar hero\b/i, 2700],
  [/\brock band\b/i, 2650],
  [/\bjust dance\b/i, 2600],
  [/\bkinect\b/i, 2550],
  [/\bwwe\b/i, 2500],
  [/\bufc\b/i, 2450],
  [/\bnba 2k\b/i, 2400],
  [/\bsplinter cell\b/i, 2350],
  [/\bninja gaiden\b/i, 2300],
  [/\bsilent hill\b/i, 2250],
  [/\bmidnight club\b/i, 2200],
  [/\btony hawk\b/i, 2150],
  [/\bdead island\b/i, 2100],
  [/\bdead rising\b/i, 2050],
  [/\brayman\b/i, 2000],
  [/\bstar wars\b/i, 1950],
  [/\bspider man\b/i, 1900],
];

const ROMAN_NUMERALS: readonly [RegExp, string][] = [
  [/\bxv\b/g, "15"],
  [/\bxiv\b/g, "14"],
  [/\bxiii\b/g, "13"],
  [/\bxii\b/g, "12"],
  [/\bxi\b/g, "11"],
  [/\bx\b/g, "10"],
  [/\bix\b/g, "9"],
  [/\bviii\b/g, "8"],
  [/\bvii\b/g, "7"],
  [/\bvi\b/g, "6"],
  [/\biv\b/g, "4"],
  [/\biii\b/g, "3"],
  [/\bii\b/g, "2"],
  [/\bv\b/g, "5"],
];

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#0*39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#?\w+;/g, " ");
}

/** Move Redump's trailing article ("Elder Scrolls V, The - Skyrim") to the front. */
function fixTrailingArticle(s: string): string {
  return s.replace(/,\s*(the|a|an|die|der|das|el|la|os|as)\b/gi, " ");
}

/**
 * Normalize a catalog display title for popularity matching.
 * Strips region/language tags, punctuation, articles, Roman numerals, and
 * common RGH/translation suffixes while returning metadata about mods/editions.
 */
export function normalizeTitleForPopularity(raw: string): {
  key: string;
  coreKey: string;
  isModOrPatch: boolean;
} {
  let s = decodeHtmlEntities(String(raw || ""))
    .replace(/[®™©]/g, "")
    .replace(/\s*\(.*?\)/g, " ")
    .replace(/\s*\[.*?\]/g, " ");

  s = fixTrailingArticle(s)
    .toLowerCase()
    .replace(/brasil/g, "brazil")
    .replace(/a era do gelo/g, "ice age")
    .replace(/grand thief auto/g, "grand theft auto")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Handle common abbreviations & spelling variants
  s = s
    .replace(/\bgta\b/g, "grand theft auto")
    .replace(/\bcod\b/g, "call of duty")
    .replace(/\bnfs\b/g, "need for speed")
    .replace(/\bmgs\b/g, "metal gear solid")
    .replace(/^ac\b/g, "assassins creed")
    .replace(/\bassassin s creed\b/g, "assassins creed")
    .replace(/\bdragon s dogma\b/g, "dragons dogma")
    .replace(/\bdante s inferno\b/g, "dantes inferno")
    .replace(/\btony hawk s\b/g, "tony hawks")
    .replace(/\balan wake s\b/g, "alan wakes");

  for (const [pattern, replacement] of ROMAN_NUMERALS) {
    s = s.replace(pattern, replacement);
  }

  s = s.replace(/^(the|a|an)\s+/i, "").replace(/\s+/g, " ").trim();

  const isModOrPatch = /\b(mod|patch|atualizacao|atualização|save 100|kaizo|dark v\d+|remaster)\b/i.test(s);

  // Strip trailing localization/format/edition noise to match the core title
  let core = s
    .replace(/\b(xbox 360|rgh|xploit|pt br|ptbr|dublado|legendado|traducao|tradução|dlc s|dlcs|dlc|tu|god|xbla|save 100|goty|game of the year edition|essentials edition|limited edition|classic|aus|asia|br|ger|usa|eur|pal|rf|og online|full)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip trailing "+ mod ..." noise from core title if there's a clear prefix
  core = core.replace(/\s+\bmod\b.*$/i, "").trim();

  return { key: s, coreKey: core || s, isModOrPatch };
}

function isPureAddonOrAvatarItem(item: SortableCatalogItem): boolean {
  if (!item.allRawNames || item.allRawNames.length === 0) return false;
  return item.allRawNames.every((raw) =>
    /\((?:Addon|Theme|Gamerpic|Avatar|Video)\)/i.test(raw) ||
    /\bTU\s*\d+\b/i.test(raw)
  );
}

/**
 * Compute a deterministic popularity score for a grouped catalog item.
 * Higher scores appear first when sorting by "Mais populares".
 */
export function getPopularityScore(
  item: SortableCatalogItem,
  options: { hasCoverHint?: boolean } = {},
): number {
  const releaseCount = Array.isArray(item.releases) ? item.releases.length : 1;

  // Demote pure Addons / Avatar props / Title Updates below all playable games.
  if (isPureAddonOrAvatarItem(item)) {
    return -2500 + Math.min(releaseCount, 12);
  }

  const { key, coreKey, isModOrPatch } = normalizeTitleForPopularity(item.displayTitle);

  let score = 0;

  // 1. Exact curated popularity match (check full key first, then stripped core key)
  const exactScore = POPULAR_TITLE_SCORE_MAP.get(key) ?? POPULAR_TITLE_SCORE_MAP.get(coreKey);
  if (exactScore !== undefined) {
    score = exactScore;
    if (isModOrPatch && POPULAR_TITLE_SCORE_MAP.get(key) === undefined) {
      // Keep base/official releases slightly ahead of fan mod variants of the same title
      score -= 8;
    }
  } else {
    // 2. Popular franchise / series match
    for (const [pattern, franchiseScore] of POPULAR_FRANCHISE_RULES) {
      if (pattern.test(coreKey) || pattern.test(key)) {
        score = franchiseScore;
        if (isModOrPatch) score -= 25;
        break;
      }
    }
  }

  // 3. Multi-release / multi-region prominence (mainstream titles have more cataloged releases)
  score += Math.min(releaseCount, 12) * 35;

  // 4. Local cover / TitleID hint boost (separates real cataloged games from unmapped junk)
  if (options.hasCoverHint) {
    score += 200;
  }

  return score;
}

/**
 * Sort catalog items by the selected order ("popular" or "alphabetical"),
 * always placing items confirmed to have no cover at the end.
 */
export function sortCatalogItems<T extends SortableCatalogItem>(
  items: readonly T[],
  options: SortCatalogOptions,
): T[] {
  const { sortOrder, coverStatusMap = {}, coverHintSet } = options;

  if (items.length <= 1) return [...items];

  const scores = sortOrder === "popular"
    ? new Map<T, number>(
        items.map((item) => [
          item,
          getPopularityScore(item, {
            hasCoverHint: coverStatusMap[item.displayTitle] === "has" || coverHintSet?.has(item.displayTitle),
          }),
        ]),
      )
    : null;

  return [...items].sort((a, b) => {
    const aNoCover = coverStatusMap[a.displayTitle] === "none" ? 1 : 0;
    const bNoCover = coverStatusMap[b.displayTitle] === "none" ? 1 : 0;
    if (aNoCover !== bNoCover) {
      return aNoCover - bNoCover;
    }

    if (scores) {
      const diff = (scores.get(b) ?? 0) - (scores.get(a) ?? 0);
      if (diff !== 0) return diff;
    }

    return a.displayTitle.localeCompare(b.displayTitle, undefined, { sensitivity: "base" });
  });
}
