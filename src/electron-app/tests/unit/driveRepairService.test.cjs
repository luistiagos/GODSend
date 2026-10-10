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

const { summarizeChkdskExit } = require("../../services/driveRepairService.js");

test("summarizeChkdskExit: processo morto por sinal (code null) é falha, nunca código 0", () => {
  const r = summarizeChkdskExit(null, "Nenhuma ação necessária.");
  assert.equal(r.ok, false);
  assert.equal(r.repaired, false);
  assert.equal(r.exitCode, -1);
  assert.match(r.summary, /interrompido/);
});

test("summarizeChkdskExit: códigos reais do chkdsk", () => {
  assert.deepEqual(
    [summarizeChkdskExit(0, "Não há problemas").ok, summarizeChkdskExit(0, "Não há problemas").summary],
    [true, "Nenhum erro encontrado. O sistema de arquivos está íntegro."],
  );
  const fixed = summarizeChkdskExit(1, "O Windows corrigiu o sistema de arquivos.");
  assert.equal(fixed.ok, true);
  assert.equal(fixed.repaired, true);
  const failed = summarizeChkdskExit(3, "Não foi possível verificar.");
  assert.equal(failed.ok, false);
  assert.match(failed.summary, /código 3/);
});
