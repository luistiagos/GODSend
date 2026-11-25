const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeTitleForPopularity,
  getPopularityScore,
  sortCatalogItems,
} = require("../../infrastructure/browseCatalogSort.js");

function makeItem(displayTitle, rawNames = [displayTitle], releaseTitles = [displayTitle]) {
  return {
    displayTitle,
    allRawNames: rawNames,
    releases: releaseTitles.map((releaseTitle) => ({ releaseTitle })),
  };
}

test("browseCatalogSort: default popular mode ranks iconic titles ahead of obscure ones", () => {
  const items = [
    makeItem("0-D Beat Drop"),
    makeItem("ABC Wipeout"),
    makeItem("Call of Duty - Black Ops II"),
    makeItem("Grand Theft Auto V"),
    makeItem("Minecraft"),
    makeItem("Red Dead Redemption"),
    makeItem("Zumba Fitness Core"),
  ];

  const sorted = sortCatalogItems(items, { sortOrder: "popular" });
  assert.deepEqual(
    sorted.map((i) => i.displayTitle),
    [
      "Grand Theft Auto V",
      "Minecraft",
      "Red Dead Redemption",
      "Call of Duty - Black Ops II",
      "0-D Beat Drop",
      "ABC Wipeout",
      "Zumba Fitness Core",
    ],
  );
});

test("browseCatalogSort: normalizes aliases, Redump trailing articles, Roman numerals, and PT-BR tags", () => {
  assert.equal(normalizeTitleForPopularity("Grand Theft Auto V").coreKey, "grand theft auto 5");
  assert.equal(normalizeTitleForPopularity("GTA 5").coreKey, "grand theft auto 5");
  assert.equal(normalizeTitleForPopularity("Elder Scrolls V, The - Skyrim").coreKey, "elder scrolls 5 skyrim");
  assert.equal(normalizeTitleForPopularity("Orange Box, The").coreKey, "orange box");

  const items = [
    makeItem("007 - Blood Stone"),
    makeItem("GTA 5 PT-BR + DLC + TU + SAVE 100 % .GOD"),
    makeItem("Grand Theft Auto V"),
    makeItem("Elder Scrolls V, The - Skyrim"),
    makeItem("Brazukas NOVA ERA 2026"),
  ];

  const sorted = sortCatalogItems(items, { sortOrder: "popular" });
  assert.equal(sorted[0].displayTitle, "Grand Theft Auto V");
  assert.equal(sorted[1].displayTitle, "GTA 5 PT-BR + DLC + TU + SAVE 100 % .GOD");
  assert.equal(sorted[sorted.length - 1].displayTitle, "007 - Blood Stone");
});

test("browseCatalogSort: always places items confirmed without covers last in both popular and alphabetical modes", () => {
  const items = [
    makeItem("0-D Beat Drop"),
    makeItem("Alan Wake"),
    makeItem("Grand Theft Auto V"),
    makeItem("Minecraft"),
    makeItem("Zumba Fitness"),
  ];

  const coverStatusMap = {
    "Grand Theft Auto V": "none", // even a top popular game without cover must go last
    "Alan Wake": "none",
    "Minecraft": "has",
  };

  const popular = sortCatalogItems(items, { sortOrder: "popular", coverStatusMap });
  assert.deepEqual(
    popular.map((i) => i.displayTitle),
    [
      "Minecraft",
      "0-D Beat Drop",
      "Zumba Fitness",
      "Grand Theft Auto V",
      "Alan Wake",
    ],
  );

  const alpha = sortCatalogItems(items, { sortOrder: "alphabetical", coverStatusMap });
  assert.deepEqual(
    alpha.map((i) => i.displayTitle),
    [
      "0-D Beat Drop",
      "Minecraft",
      "Zumba Fitness",
      "Alan Wake",
      "Grand Theft Auto V",
    ],
  );

  // Switching back to popular restores popular order while keeping coverless last
  const backToPopular = sortCatalogItems(alpha, { sortOrder: "popular", coverStatusMap });
  assert.deepEqual(
    backToPopular.map((i) => i.displayTitle),
    popular.map((i) => i.displayTitle),
  );
});

test("browseCatalogSort: demotes pure Addons/Title Updates below playable games in popular mode", () => {
  const items = [
    makeItem("100 Black Chest Tattoo", ["100 Black Chest Tattoo (World) (4D3107D1) (Addon)"]),
    makeItem("Castle Crashers", ["Castle Crashers (World) (XBLA)"]),
    makeItem("2014 FIFA World Cup Brazil - TU 1", ["2014 FIFA World Cup Brazil - TU 1 (World) (Addon)"]),
    makeItem("Aegis Wing", ["Aegis Wing (World) (XBLA)"]),
  ];

  const sorted = sortCatalogItems(items, { sortOrder: "popular" });
  assert.equal(sorted[0].displayTitle, "Castle Crashers");
  assert.equal(sorted[1].displayTitle, "Aegis Wing");
  assert.ok(getPopularityScore(sorted[1]) > getPopularityScore(sorted[2]));
  assert.ok(getPopularityScore(sorted[1]) > getPopularityScore(sorted[3]));
});
