const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeTitleKey,
  cleanTitleForSearch,
  baseTitleForCover,
  generateSearchCandidates,
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
