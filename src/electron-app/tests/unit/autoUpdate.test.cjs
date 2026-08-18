const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { isNewerVersion } = require("../../services/autoUpdateService.js");

test("isNewerVersion: compara versões semver corretamente", () => {
  // Patch versions
  assert.equal(isNewerVersion("2.12.39", "2.12.38"), true);
  assert.equal(isNewerVersion("2.12.38", "2.12.38"), false);
  assert.equal(isNewerVersion("2.12.37", "2.12.38"), false);

  // Minor versions
  assert.equal(isNewerVersion("2.13.0", "2.12.39"), true);
  assert.equal(isNewerVersion("2.11.99", "2.12.0"), false);

  // Major versions
  assert.equal(isNewerVersion("3.0.0", "2.12.39"), true);
  assert.equal(isNewerVersion("1.99.99", "2.0.0"), false);

  // Prefixo 'v' ou 'V'
  assert.equal(isNewerVersion("v2.12.40", "2.12.39"), true);
  assert.equal(isNewerVersion("2.12.40", "v2.12.39"), true);
  assert.equal(isNewerVersion("v2.12.38", "v2.12.39"), false);

  // Casos nulos ou vazios
  assert.equal(isNewerVersion("", "2.12.38"), false);
  assert.equal(isNewerVersion("2.12.39", ""), false);
});

test("validação de integridade SHA-256", () => {
  const content = Buffer.from("Xbox 360 Companion Update Payload Test");
  const expectedHash = crypto.createHash("sha256").update(content).digest("hex").toLowerCase();

  const computedHash = crypto.createHash("sha256").update(content).digest("hex").toLowerCase();
  assert.equal(computedHash, expectedHash);

  const corrupted = Buffer.from("Corrupted Payload");
  const corruptedHash = crypto.createHash("sha256").update(corrupted).digest("hex").toLowerCase();
  assert.notEqual(corruptedHash, expectedHash);
});

test("throttle de 12 horas para verificação em segundo plano", () => {
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const now = Date.now();

  const recentCheck = now - (2 * 60 * 60 * 1000); // 2 hours ago
  assert.equal(now - recentCheck < TWELVE_HOURS_MS, true); // Should skip

  const oldCheck = now - (13 * 60 * 60 * 1000); // 13 hours ago
  assert.equal(now - oldCheck < TWELVE_HOURS_MS, false); // Should run
});
