const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateProbeBlock,
  verifyProbeBlock,
} = require("../../services/fakeDriveProbeService.js");

test("generateProbeBlock gera bloco determinístico de 2 MB com hash válido", () => {
  const block1 = generateProbeBlock(1, 1024 * 1024 * 500, "salt-test-123");
  assert.equal(block1.buffer.length, 2 * 1024 * 1024);
  assert.ok(block1.hash.length === 64);

  const block1Repeat = generateProbeBlock(1, 1024 * 1024 * 500, "salt-test-123");
  assert.equal(block1.hash, block1Repeat.hash);

  const block2 = generateProbeBlock(2, 1024 * 1024 * 1000, "salt-test-123");
  assert.notEqual(block1.hash, block2.hash);
});

test("verifyProbeBlock valida com sucesso bloco íntegro", () => {
  const block = generateProbeBlock(5, 1024 * 1024 * 2000, "salt-test-abc");
  const result = verifyProbeBlock(block.buffer, block.hash, 5);
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test("verifyProbeBlock detecta corrupção ou sobrescrita em bloco adulterado", () => {
  const block = generateProbeBlock(3, 1024 * 1024 * 800, "salt-test-xyz");
  const corruptedBuffer = Buffer.from(block.buffer);
  corruptedBuffer[100] = (corruptedBuffer[100] + 1) % 256;

  const result = verifyProbeBlock(corruptedBuffer, block.hash, 3);
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes("Dados corrompidos ou sobrescritos"));
});

test("verifyProbeBlock identifica leitura de zeros como falha de controlador", () => {
  const zeroBuffer = Buffer.alloc(2 * 1024 * 1024, 0);
  const result = verifyProbeBlock(zeroBuffer, "dummy-hash", 1);
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes("preenchido com zeros"));
});
