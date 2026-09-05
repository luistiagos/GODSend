const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractDriveLetter,
} = require("../../services/driveRepairService.js");

test("extractDriveLetter extrai corretamente a letra da unidade em vários formatos", () => {
  assert.equal(extractDriveLetter("E:\\"), "E");
  assert.equal(extractDriveLetter("e:\\"), "E");
  assert.equal(extractDriveLetter("F:"), "F");
  assert.equal(extractDriveLetter("d"), "D");
  assert.equal(extractDriveLetter("  G:\\Games  "), "G");
});
