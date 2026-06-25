const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildTransactionalWritePlan,
  verifyTransactionalWritePlan,
} = require("../../infrastructure/transactionalWritePlan.js");

const DEVICE_FINGERPRINT = "a".repeat(64);
const TRANSACTION_ID = "11111111-1111-4111-8111-111111111111";

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function staging(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-plan-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return root;
}

function write(root, relative, contents) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  return {
    sourcePath: file,
    relativePath: relative.replaceAll(path.sep, "/"),
    sizeBytes: Buffer.byteLength(contents),
    sha256: sha256(contents),
  };
}

async function plan(root, entries) {
  return buildTransactionalWritePlan(
    {
      sourceRoot: root,
      deviceFingerprint: DEVICE_FINGERPRINT,
      manifestId: "test.production",
      manifestRelease: "0.1.0",
      entries,
    },
    new Date("2026-06-22T12:00:00.000Z"),
    TRANSACTION_ID,
  );
}

test("cria plano imutável, ordenado e verificável", async (t) => {
  const root = staging(t);
  const launch = write(root, "input-launch.ini", "launch");
  launch.relativePath = "launch.ini";
  const aurora = write(root, "input-aurora.xex", "aurora");
  aurora.relativePath = "Aurora/default.xex";
  const result = await plan(root, [launch, aurora]);
  assert.deepEqual(result.entries.map((entry) => entry.relativePath), ["Aurora/default.xex", "launch.ini"]);
  assert.equal(result.totalBytes, 12);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.entries), true);
  assert.doesNotThrow(() => verifyTransactionalWritePlan(result));
});

test("detecta plano adulterado depois da criação", async (t) => {
  const root = staging(t);
  const entry = write(root, "source.xex", "aurora");
  entry.relativePath = "Aurora/default.xex";
  const original = await plan(root, [entry]);
  const tampered = JSON.parse(JSON.stringify(original));
  tampered.entries[0].relativePath = "Content/alterado";
  assert.throws(() => verifyTransactionalWritePlan(tampered), /alterado depois de sua criação/i);
});

test("recusa origem fora do staging confiável", async (t) => {
  const root = staging(t);
  const outside = path.join(path.dirname(root), `outside-${crypto.randomUUID()}.bin`);
  fs.writeFileSync(outside, "outside");
  t.after(() => fs.rmSync(outside, { force: true }));
  await assert.rejects(
    () => plan(root, [{
      sourcePath: outside,
      relativePath: "Aurora/default.xex",
      sizeBytes: 7,
      sha256: sha256("outside"),
    }]),
    /fora do staging confiável/i,
  );
});

test("recusa arquivo modificado depois do staging", async (t) => {
  const root = staging(t);
  const entry = write(root, "source.xex", "aurora");
  entry.relativePath = "Aurora/default.xex";
  fs.writeFileSync(entry.sourcePath, "AURORA");
  await assert.rejects(() => plan(root, [entry]), /mudou de conteúdo/i);
});

test("recusa traversal, barra invertida e destinos fora da estrutura permitida", async (t) => {
  const root = staging(t);
  const entry = write(root, "source.xex", "aurora");
  for (const relativePath of ["../escape.bin", "Aurora\\default.xex", "Other/default.xex"]) {
    await assert.rejects(
      () => plan(root, [{ ...entry, relativePath }]),
      /caminho de destino|segmento inseguro|fora da estrutura/i,
    );
  }
});

test("recusa nomes reservados do Windows", async (t) => {
  const root = staging(t);
  const entry = write(root, "source.xex", "aurora");
  await assert.rejects(
    () => plan(root, [{ ...entry, relativePath: "Aurora/CON.txt" }]),
    /segmento inseguro/i,
  );
});

test("recusa destinos duplicados sem diferenciar maiúsculas", async (t) => {
  const root = staging(t);
  const first = write(root, "one.xex", "one");
  const second = write(root, "two.xex", "two");
  first.relativePath = "Aurora/default.xex";
  second.relativePath = "aurora/DEFAULT.XEX";
  await assert.rejects(() => plan(root, [first, second]), /destino duplicado/i);
});
