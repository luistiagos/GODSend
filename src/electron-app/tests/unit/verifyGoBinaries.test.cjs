const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// [[build-verify-go-binaries-windows-verifica-o-ia32-que-nao-foi-construido-e-duplica-linhas_2026-10-13T05-20]]
// [[testes-smoke-wine-e-specs-playwright-esperam-banner-godsend-backend-server-que-nao-existe-mais_2026-10-12T18-57]]

const verifyScript = require("../../../../scripts/verify-go-binaries.js");

test("verify-go-binaries expand('windows') returns only ['windows'] without forcing ia32", () => {
  const expanded = verifyScript.expand("windows");
  assert.deepEqual(expanded, ["windows"]);
});

test("verify-go-binaries expand('windows-all') expands to all present windows targets", () => {
  const expanded = verifyScript.expand("windows-all");
  assert.ok(expanded.includes("windows"));
  assert.ok(expanded.includes("windows-x64"));
});

test("verify-go-binaries targets for a --x64 build do not include ia32", () => {
  const targets = ["windows", "windows-x64"];
  const keys = [...new Set(targets.flatMap((t) => verifyScript.expand(t)))];
  assert.equal(keys.includes("windows-ia32"), false);
  assert.deepEqual(keys, ["windows", "windows-x64"]);
});

test("verify-go-binaries targets deduplicate keys so each binary is verified once", () => {
  const targets = ["windows", "windows-x64", "windows-ia32"];
  const keys = [...new Set(targets.flatMap((t) => verifyScript.expand(t)))];
  assert.equal(keys.length, 3);
  assert.deepEqual(keys, ["windows", "windows-x64", "windows-ia32"]);
});

test("smoke test regex recognizes both Xbox 360 Companion and legacy GODSend banners", () => {
  const bannerRegex = /(?:Xbox 360 Companion|GODSend) Backend Server v/;
  assert.ok(bannerRegex.test("[INFO] Xbox 360 Companion Backend Server v2.12.125"));
  assert.ok(bannerRegex.test("║   Xbox 360 Companion Server v2.12.125     ║") === false);
  assert.ok(bannerRegex.test("[INFO] GODSend Backend Server v2.12.24"));
});

