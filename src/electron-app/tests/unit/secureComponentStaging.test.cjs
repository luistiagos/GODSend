const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  assertTrustedComponentDownloadUrl,
  stageTrustedComponent,
  verifyComponentFile,
} = require("../../infrastructure/secureComponentStaging.js");

const source = {
  url: "https://downloads.example.test/aurora.zip",
  redirectHosts: [],
  fileName: "aurora.zip",
  sizeBytes: 5,
  sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
};

const component = {
  id: "aurora",
  displayName: "Aurora",
  version: "test-1",
  required: true,
  source,
  license: {
    spdx: "MIT",
    projectUrl: "https://example.test/aurora",
    redistributionApproved: true,
    attribution: "Fixture de teste.",
  },
  archive: {
    format: "zip",
    installPath: "Aurora",
    maxExtractedBytes: 1024,
    maxEntries: 20,
  },
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-staging-test-"));
}

test("valida tamanho e SHA-256 de arquivo em staging", async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const file = path.join(root, "aurora.zip");
  fs.writeFileSync(file, "hello");
  const result = await verifyComponentFile(file, source);
  assert.equal(result.valid, true);
  assert.equal(result.actualSizeBytes, 5);
});

test("recusa conteúdo adulterado mesmo quando o tamanho é igual", async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const file = path.join(root, "aurora.zip");
  fs.writeFileSync(file, "HELLO");
  const result = await verifyComponentFile(file, source);
  assert.equal(result.valid, false);
  assert.match(result.reason, /SHA-256/i);
});

test("recusa arquivo com tamanho divergente antes do hash", async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const file = path.join(root, "aurora.zip");
  fs.writeFileSync(file, "hello!");
  const result = await verifyComponentFile(file, source);
  assert.equal(result.valid, false);
  assert.match(result.reason, /tamanho divergente/i);
});

test("reutiliza cache somente quando a integridade confere", async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const componentDir = path.join(root, component.id);
  fs.mkdirSync(componentDir);
  fs.writeFileSync(path.join(componentDir, source.fileName), "hello");
  const result = await stageTrustedComponent(component, root);
  assert.equal(result.reused, true);
  assert.equal(result.sha256, source.sha256);
});

test("recusa identificador que tentaria escapar do staging", async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await assert.rejects(
    () => stageTrustedComponent({ ...component, id: "../escape" }, root),
    /identificador de componente não validado/i,
  );
});

test("recusa raiz de staging relativa", async () => {
  await assert.rejects(
    () => stageTrustedComponent(component, "relative-staging"),
    /raiz de staging precisa ser absoluta/i,
  );
});

test("cancelamento anterior ao staging não cria pasta nem inicia download", async (t) => {
  const root = tempDir();
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => stageTrustedComponent(component, root, undefined, { signal: controller.signal }),
    (error) => error?.name === "AbortError",
  );
  assert.equal(fs.existsSync(path.join(root, component.id)), false);
});

test("aceita somente origem inicial ou host de redirecionamento assinado", () => {
  const withRedirect = { ...source, redirectHosts: ["cdn.example.test"] };
  assert.doesNotThrow(() =>
    assertTrustedComponentDownloadUrl("https://cdn.example.test/file.zip", withRedirect),
  );
  assert.throws(
    () => assertTrustedComponentDownloadUrl("https://other.example.test/file.zip", withRedirect),
    /host não autorizado/i,
  );
});

test("recusa downgrade de redirecionamento para HTTP", () => {
  assert.throws(
    () => assertTrustedComponentDownloadUrl("http://downloads.example.test/file.zip", source),
    /sair de HTTPS/i,
  );
});
