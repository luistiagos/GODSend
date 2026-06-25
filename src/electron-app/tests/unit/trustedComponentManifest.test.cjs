const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");

const {
  canonicalizeJson,
  verifySignedComponentManifest,
} = require("../../infrastructure/trustedComponentManifest.js");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const NOW = new Date("2026-06-22T12:00:00.000Z");

function manifest() {
  return {
    schemaVersion: 1,
    manifestId: "xbox360-components.production",
    release: "0.1.0",
    createdAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2027-06-01T00:00:00.000Z",
    components: [
      {
        id: "aurora",
        role: "dashboard-aurora",
        displayName: "Aurora",
        version: "test-1",
        required: true,
        source: {
          url: "https://downloads.example.test/aurora.zip",
          redirectHosts: ["cdn.example.test"],
          fileName: "aurora.zip",
          sizeBytes: 5,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        },
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
      },
    ],
  };
}

function envelope(contents) {
  const signature = sign(
    null,
    Buffer.from(canonicalizeJson(contents), "utf8"),
    privateKey,
  ).toString("base64");
  return {
    schemaVersion: 1,
    algorithm: "Ed25519",
    keyId: "test-key-1",
    manifest: contents,
    signature,
  };
}

function verify(contents) {
  return verifySignedComponentManifest(
    envelope(contents),
    { "test-key-1": publicKey },
    NOW,
  );
}

test("aceita manifesto Ed25519 válido com componentes autorizados", () => {
  const result = verify(manifest());
  assert.equal(result.components[0].id, "aurora");
  assert.equal(result.components[0].source.url, "https://downloads.example.test/aurora.zip");
});

test("recusa adulteração depois da assinatura", () => {
  const original = manifest();
  const signed = envelope(original);
  signed.manifest.components[0].source.sizeBytes = 6;
  assert.throws(
    () => verifySignedComponentManifest(signed, { "test-key-1": publicKey }, NOW),
    /assinatura do manifesto não confere/i,
  );
});

test("recusa chave de confiança desconhecida", () => {
  assert.throws(
    () => verifySignedComponentManifest(envelope(manifest()), {}, NOW),
    /chave de confiança desconhecida/i,
  );
});

test("recusa fonte sem HTTPS mesmo quando o manifesto está assinado", () => {
  const contents = manifest();
  contents.components[0].source.url = "http://downloads.example.test/aurora.zip";
  assert.throws(() => verify(contents), /deve usar HTTPS/i);
});

test("recusa caminho de instalação com traversal", () => {
  const contents = manifest();
  contents.components[0].archive.installPath = "../Aurora";
  assert.throws(() => verify(contents), /travessia|segmento inválido/i);
});

test("recusa redistribuição sem autorização explícita", () => {
  const contents = manifest();
  contents.components[0].license.redistributionApproved = false;
  assert.throws(() => verify(contents), /precisa ser explicitamente true/i);
});

test("recusa manifesto expirado", () => {
  const contents = manifest();
  contents.expiresAt = "2026-06-02T00:00:00.000Z";
  assert.throws(() => verify(contents), /manifesto confiável expirou/i);
});

test("recusa campos desconhecidos para evitar semântica inesperada", () => {
  const contents = manifest();
  contents.components[0].source.uncheckedMirror = "https://evil.example.test/file.zip";
  assert.throws(() => verify(contents), /campos desconhecidos/i);
});
