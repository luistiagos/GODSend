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
} = require("../../services/coverArtService.js");

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

