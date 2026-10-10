const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeTitleKey,
  cleanTitleForSearch,
  baseTitleForCover,
  generateSearchCandidates,
  generateSearchCandidateEntries,
  isValidUnityCoverMatch,
  normalizeArticles,
  stripPossessives,
  resolveTitleIdHex,
  ensureTitleDatabaseLoaded,
  CUSTOM_COVER_URLS,
  getCachedCoverFromDisk,
  hasCustomCover,
  COVER_CACHE_VERSION,
  resetCoverCachePurgeForTests,
} = require("../../services/coverArtService.js");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// The disk cache lives under %APPDATA%; never let a test purge the real one of whoever runs the suite.
const TEST_APPDATA = fs.mkdtempSync(path.join(os.tmpdir(), "cover-cache-test-"));
process.env.APPDATA = TEST_APPDATA;
const USER_COVERS_DIR = path.join(TEST_APPDATA, "Xbox 360 Companion", "cache", "covers");
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(200, 7)]);

test("coverArtService: a cover saved before the current cache version is discarded, not served", () => {
  fs.mkdirSync(USER_COVERS_DIR, { recursive: true });
  // The exact stale file seen on the owner's machine: Pacific Carriers' key holding Vietnam's image.
  fs.writeFileSync(path.join(USER_COVERS_DIR, "air_conflicts_pacific_carriers.jpg"), FAKE_JPEG);
  fs.rmSync(path.join(USER_COVERS_DIR, ".cover-cache-version"), { force: true });
  resetCoverCachePurgeForTests();

  assert.equal(getCachedCoverFromDisk("Air Conflicts Pacific Carriers"), null);
  assert.equal(fs.existsSync(path.join(USER_COVERS_DIR, "air_conflicts_pacific_carriers.jpg")), false);
  assert.equal(fs.readFileSync(path.join(USER_COVERS_DIR, ".cover-cache-version"), "utf8"), COVER_CACHE_VERSION);
});

test("coverArtService: a cover saved under the current cache version is kept and served", () => {
  fs.mkdirSync(USER_COVERS_DIR, { recursive: true });
  fs.writeFileSync(path.join(USER_COVERS_DIR, ".cover-cache-version"), COVER_CACHE_VERSION);
  fs.writeFileSync(path.join(USER_COVERS_DIR, "air_conflicts_secret_wars.jpg"), FAKE_JPEG);
  resetCoverCachePurgeForTests();

  const cover = getCachedCoverFromDisk("Air Conflicts Secret Wars");
  assert.ok(cover && cover.startsWith("data:image/jpeg;base64,"));
  assert.equal(fs.existsSync(path.join(USER_COVERS_DIR, "air_conflicts_secret_wars.jpg")), true);
});

test("coverArtService: hasCustomCover finds a mod's dedicated cover by name, never by its base TitleID", () => {
  assert.equal(hasCustomCover("EA FC 26 Legacy Edition"), true);
  assert.equal(hasCustomCover("EA FC 26 Legacy Edition (Xbox 360 RGH)"), true);
  assert.equal(hasCustomCover("454109F4"), false);
  assert.equal(hasCustomCover("Halo 3"), false);
  assert.equal(hasCustomCover(""), false);
});

test("coverArtService: normalizeTitleKey handles typos, brackets, and roman numerals", () => {
  assert.equal(normalizeTitleKey("Grand Thief Auto 5"), "grand theft auto 5");
  assert.equal(normalizeTitleKey("Grand Theft Auto V (USA) (En,Fr,Es)"), "grand theft auto v");
  assert.equal(normalizeTitleKey("A Era do Gelo 3 [GOD]"), "ice age 3");
  assert.equal(normalizeTitleKey("Call of Duty: Black Ops II"), "call of duty black ops ii");
});

test("coverArtService: cleanTitleForSearch strips languages, regions, and disc labels", () => {
  const raw = "Grand Theft Auto V (World) (En,Fr,De,Es,It,Pt,Zh,Ko,Pl,Ru) (Disc 1) (Install)";
  const clean = cleanTitleForSearch(raw);
  assert.equal(clean, "Grand Theft Auto V");

  const raw2 = "Grand Theft Auto IV (USA) (En,Fr,De,Es,It)";
  assert.equal(cleanTitleForSearch(raw2), "Grand Theft Auto IV");
});

test("coverArtService: generateSearchCandidates maps GTA 5 and variations to TitleID 545408A7", () => {
  const gtaVQueries = [
    "Grand Theft Auto V",
    "Grand Theft Auto 5",
    "Grand Thief Auto 5",
    "GTA 5",
    "GTA V",
    "Grand Theft Auto V (World) (En,Fr,De,Es,It,Pt,Zh,Ko,Pl,Ru) (Disc 1) (Install)"
  ];

  for (const q of gtaVQueries) {
    const candidates = generateSearchCandidates(q);
    assert.ok(candidates.length > 0, `Candidates empty for query: ${q}`);
    assert.ok(
      candidates.includes("545408A7"),
      `Expected candidates for "${q}" to include TitleID 545408A7. Got: ${JSON.stringify(candidates)}`
    );
    // TitleID should be prioritized at index 0
    assert.equal(candidates[0], "545408A7", `Expected 545408A7 to be first candidate for "${q}"`);
  }
});

test("coverArtService: generateSearchCandidates maps GTA 4 and variations to TitleID 545407F2", () => {
  const gtaIVQueries = [
    "Grand Theft Auto IV",
    "Grand Theft Auto 4",
    "Grand Thief Auto 4",
    "GTA 4",
    "GTA IV",
    "Grand Theft Auto IV (USA) (En,Fr,De,Es,It)",
    "Grand Theft Auto - Episodes from Liberty City",
    "GTA Episodes from Liberty City",
    "Episodes from Liberty City"
  ];

  for (const q of gtaIVQueries) {
    const candidates = generateSearchCandidates(q);
    assert.ok(candidates.length > 0, `Candidates empty for query: ${q}`);
    assert.ok(
      candidates.includes("545407F2"),
      `Expected candidates for "${q}" to include TitleID 545407F2. Got: ${JSON.stringify(candidates)}`
    );
    assert.equal(candidates[0], "545407F2", `Expected 545407F2 to be first candidate for "${q}"`);
  }
});

test("coverArtService: generateSearchCandidates maps top games to exact TitleIDs", () => {
  const cases = [
    { title: "Call of Duty: Black Ops II", expectedId: "415608C3" },
    { title: "Call of Duty: Black Ops 2", expectedId: "415608C3" },
    { title: "The Elder Scrolls V: Skyrim", expectedId: "425307E6" },
    { title: "Skyrim", expectedId: "425307E6" },
    { title: "Minecraft", expectedId: "584111F7" },
    { title: "Minecraft: Xbox 360 Edition", expectedId: "584111F7" },
    { title: "Bully: Scholarship Edition", expectedId: "5454081A" },
    { title: "Red Dead Redemption", expectedId: "5454082B" },
    { title: "Far Cry 3", expectedId: "5553088C" },
    { title: "Far Cry 4", expectedId: "555308CA" }
  ];

  for (const { title, expectedId } of cases) {
    const candidates = generateSearchCandidates(title);
    assert.ok(
      candidates.includes(expectedId),
      `Expected candidates for "${title}" to include ${expectedId}. Got: ${JSON.stringify(candidates)}`
    );
  }
});

test("coverArtService: resolveTitleIdHex resolves GTA variations deterministically", async () => {
  assert.equal(await resolveTitleIdHex("Grand Theft Auto V"), "545408A7");
  assert.equal(await resolveTitleIdHex("GTA 5"), "545408A7");
  assert.equal(await resolveTitleIdHex("Grand Thief Auto 5"), "545408A7");
  assert.equal(await resolveTitleIdHex("Grand Theft Auto IV"), "545407F2");
  assert.equal(await resolveTitleIdHex("GTA 4"), "545407F2");
  assert.equal(await resolveTitleIdHex("Grand Thief Auto 4"), "545407F2");
  assert.equal(await resolveTitleIdHex("Skyrim"), "425307E6");
  assert.equal(await resolveTitleIdHex("545408A7"), "545408A7");
});

test("coverArtService: normalizeArticles and stripPossessives normalize articles and possessives", () => {
  assert.equal(normalizeArticles("lego the lord of the rings"), "lego lord of rings");
  assert.equal(normalizeArticles("the elder scrolls"), "elder scrolls");
  assert.equal(normalizeArticles("a kingdom for keflings"), "kingdom for keflings");

  assert.equal(stripPossessives("lego marvel s avengers"), "lego marvel avengers");
  assert.equal(stripPossessives("peter jackson s king kong"), "peter jackson king kong");
  assert.equal(stripPossessives("tom clancy s splinter cell"), "tom clancy splinter cell");
});

test("coverArtService: normalizeTitleKey handles html entities, registered marks, and trademarks", () => {
  assert.equal(normalizeTitleKey("LEGO&#039;s Marvel"), "lego s marvel");
  assert.equal(normalizeTitleKey("LEGO® Marvel's Avengers"), "lego marvel s avengers");
  assert.equal(normalizeTitleKey("Tom Clancy&amp;s Splinter Cell"), "tom clancy s splinter cell");
  assert.equal(stripPossessives(normalizeTitleKey("Tom Clancy&amp;s Splinter Cell")), "tom clancy splinter cell");
});

test("coverArtService: generateSearchCandidates maps LEGO The Lord of the Rings to TitleID 5752081D", () => {
  const query = "LEGO The Lord of the Rings (USA, Europe) (En,Fr,De,Es,It,Nl,Da)";
  const candidates = generateSearchCandidates(query);
  assert.ok(candidates.length > 0, "Candidates empty for query");
  assert.ok(
    candidates.includes("5752081D"),
    `Expected candidates for "${query}" to include 5752081D. Got: ${JSON.stringify(candidates)}`
  );
  assert.equal(candidates[0], "5752081D", "Expected 5752081D to be the first candidate");
});

test("coverArtService: generateSearchCandidates maps LEGO Marvel Avengers to TitleID 5752084F", () => {
  const query = "LEGO Marvel Avengers (USA) (En,Fr,De,Es,It,Nl,Pt,Da,Pl,Ru)";
  const candidates = generateSearchCandidates(query);
  assert.ok(candidates.length > 0, "Candidates empty for query");
  assert.ok(
    candidates.includes("5752084F"),
    `Expected candidates for "${query}" to include 5752084F. Got: ${JSON.stringify(candidates)}`
  );
  assert.equal(candidates[0], "5752084F", "Expected 5752084F to be the first candidate");
});

test("coverArtService: generateSearchCandidateEntries preserves requiredBrand for stripped brand queries", () => {
  const query = "LEGO The Lord of the Rings";
  const entries = generateSearchCandidateEntries(query);
  const strippedEntry = entries.find((e) => e.term === "The Lord of the Rings");
  assert.ok(strippedEntry, "Expected stripped candidate 'The Lord of the Rings' to exist");
  assert.equal(strippedEntry.requiredBrand, "LEGO", "Expected requiredBrand to be 'LEGO'");

  const marvelQuery = "LEGO Marvel Avengers";
  const marvelEntries = generateSearchCandidateEntries(marvelQuery);
  const marvelStripped = marvelEntries.find((e) => e.term === "Marvel Avengers");
  assert.ok(marvelStripped, "Expected stripped candidate 'Marvel Avengers' to exist");
  assert.equal(marvelStripped.requiredBrand, "LEGO", "Expected requiredBrand to be 'LEGO'");
});

test("coverArtService: isValidUnityCoverMatch rejects franchise false positives when brand is required (fixtures)", () => {
  // Fixture: Real XboxUnity response for "The Lord of the Rings" (War in the North)
  const unityWarInNorthItem = {
    titleid: "575207EF",
    name: "The Lord of the Rings: War in the North",
    official: true,
    rating: 5,
    front: "http://assets.xboxunity.net/api/boxartfront/12345"
  };

  // When searching with brand stripped ("The Lord of the Rings") but requiring "LEGO", War in the North MUST be rejected
  assert.equal(
    isValidUnityCoverMatch("The Lord of the Rings", unityWarInNorthItem, "LEGO"),
    false,
    "War in the North must be rejected when LEGO brand is required"
  );

  // When searching without brand requirement (client actually searching for War in the North), it must be accepted
  assert.equal(
    isValidUnityCoverMatch("The Lord of the Rings", unityWarInNorthItem),
    true,
    "War in the North should be accepted when brand is not required"
  );

  // Fixture: Real XboxUnity response for "Marvel Avengers" (Battle for Earth)
  const unityBattleForEarthItem = {
    titleid: "555308AD",
    name: "Marvel Avengers: Battle for Earth",
    official: true,
    rating: 4,
    front: "http://assets.xboxunity.net/api/boxartfront/67890"
  };

  // When searching with brand stripped ("Marvel Avengers") but requiring "LEGO", Battle for Earth MUST be rejected
  assert.equal(
    isValidUnityCoverMatch("Marvel Avengers", unityBattleForEarthItem, "LEGO"),
    false,
    "Battle for Earth must be rejected when LEGO brand is required"
  );

  // Fixtures: Real LEGO items from XboxUnity
  const unityLegoLotrItem = {
    titleid: "5752081D",
    name: "LEGO Lord of the Rings",
    official: true,
    rating: 4,
    front: "http://assets.xboxunity.net/api/boxartfront/11111"
  };
  assert.equal(
    isValidUnityCoverMatch("The Lord of the Rings", unityLegoLotrItem, "LEGO"),
    true,
    "LEGO Lord of the Rings must be accepted when LEGO brand is required"
  );

  const unityLegoMarvelItem = {
    titleid: "5752084F",
    name: "LEGO® Marvel's Avengers",
    official: true,
    rating: null,
    front: "http://assets.xboxunity.net/api/boxartfront/25287"
  };
  assert.equal(
    isValidUnityCoverMatch("Marvel Avengers", unityLegoMarvelItem, "LEGO"),
    true,
    "LEGO® Marvel's Avengers must be accepted when LEGO brand is required"
  );
});

test("coverArtService: EA FC 26 Legacy Edition custom cover and curated TitleID mapping", () => {
  const candidates = generateSearchCandidates("EA FC 26 Legacy Edition");
  assert.ok(candidates.includes("454109F9"), "EA FC 26 should map to FIFA 19 TitleID 454109F9");

  assert.equal(
    CUSTOM_COVER_URLS["ea fc 26 legacy edition"],
    "https://down-br.img.susercontent.com/file/br-11134207-820li-mo2rdptzkiyp5c"
  );

  const diskCover = getCachedCoverFromDisk("EA FC 26 Legacy Edition");
  assert.ok(diskCover && diskCover.startsWith("data:image/jpeg;base64,"), "Disk cover must be found");
});



test("coverArtService: catalog spellings without apostrophe, with ' 1' or edition tags still find the TitleID", () => {
  // Names from the catalog whose cover used to come from a stale disk cache (bug of 2026-10-09).
  const expected = {
    "Assassins Creed 1": "555307D4",
    "Assassin’s Creed [RF]": "555307D4",
    "Assassins_Creed_Rogue": "555308CE",
    "Assassins_Creed_Brotherhood": "5553085D",
    "Assassin's Creed II - Game of the Year Edition (Europe) (En,Fr,De,Es,It,Nl,Sv,No,Da)": "5553083B",
    "Batman Arkham City GOTY": "57520802",
    "Call Of Duty Black Ops 1": "41560855",
    "Dragon Ball Raging Blast 1": "4E4D0803",
    "Grid 1": "434D07FF",
  };
  for (const [name, tid] of Object.entries(expected)) {
    assert.equal(generateSearchCandidates(name)[0], tid, name);
  }
});

test("coverArtService: games of the same franchise keep distinct TitleIDs", () => {
  assert.equal(generateSearchCandidates("Air Conflicts Pacific Carriers")[0], "413307D6");
  assert.equal(generateSearchCandidates("Air Conflicts Secret Wars")[0], "4B5907E0");
  assert.equal(generateSearchCandidates("Air Conflicts Vietnam")[0], "413307D9");
  // An exact spelling wins over the spelling-insensitive key.
  assert.equal(generateSearchCandidates("Assassin's Creed II")[0], "5553083B");
});
