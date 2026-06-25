const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  assessWriteCapacity,
} = require("../../infrastructure/writeCapacityPolicy.js");
const {
  buildTransactionalWritePlan,
} = require("../../infrastructure/transactionalWritePlan.js");

function temp(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));
  return root;
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function fixture(t, contents = "aurora") {
  const sourceRoot = temp(t, "xbox360-capacity-source-");
  const targetRoot = temp(t, "xbox360-capacity-target-");
  const sourcePath = path.join(sourceRoot, "default.xex");
  fs.writeFileSync(sourcePath, contents);
  const plan = await buildTransactionalWritePlan({
    sourceRoot,
    deviceFingerprint: "e".repeat(64),
    manifestId: "test.production",
    manifestRelease: "0.1.0",
    entries: [{
      sourcePath,
      relativePath: "Aurora/default.xex",
      sizeBytes: Buffer.byteLength(contents),
      sha256: sha256(contents),
    }],
  });
  return { targetRoot, plan };
}

function storage(overrides = {}) {
  return {
    fileSystem: "FAT32",
    totalBytes: 1024 ** 3,
    freeBytes: 512 * 1024 ** 2,
    allocationUnitBytes: 32 * 1024,
    ...overrides,
  };
}

test("aprova quando staging, metadados e reserva cabem", async (t) => {
  const { targetRoot, plan } = await fixture(t);
  const result = await assessWriteCapacity(plan, targetRoot, storage());
  assert.equal(result.allowed, true);
  assert.equal(result.filesToWrite, 1);
  assert.equal(result.filesReused, 0);
  assert.equal(result.allocatedBytesAtPeak, 32 * 1024);
  assert.ok(result.safetyReserveBytes >= 128 * 1024 ** 2);
});

test("recusa antes da escrita quando não resta a margem mínima", async (t) => {
  const { targetRoot, plan } = await fixture(t);
  const result = await assessWriteCapacity(
    plan,
    targetRoot,
    storage({ freeBytes: 100 * 1024 ** 2 }),
  );
  assert.equal(result.allowed, false);
  assert.ok(result.shortfallBytes > 0);
  assert.match(result.blockers.join(" "), /espaço livre insuficiente/i);
});

test("arquivo idêntico é reutilizado e não reserva nova cópia", async (t) => {
  const { targetRoot, plan } = await fixture(t);
  const targetPath = path.join(targetRoot, "Aurora", "default.xex");
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, "aurora");
  const result = await assessWriteCapacity(plan, targetRoot, storage());
  assert.equal(result.filesReused, 1);
  assert.equal(result.payloadBytesToStage, 0);
  assert.equal(result.allocatedBytesAtPeak, 0);
});

test("arquivo diferente exige espaço para a nova cópia no pico", async (t) => {
  const { targetRoot, plan } = await fixture(t);
  const targetPath = path.join(targetRoot, "Aurora", "default.xex");
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, "antigo");
  const result = await assessWriteCapacity(plan, targetRoot, storage());
  assert.equal(result.inventory[0].state, "different");
  assert.equal(result.allocatedBytesAtPeak, 32 * 1024);
});

test("recusa filesystem diferente de FAT32 e cluster desconhecido", async (t) => {
  const { targetRoot, plan } = await fixture(t);
  const result = await assessWriteCapacity(
    plan,
    targetRoot,
    storage({ fileSystem: "exFAT", allocationUnitBytes: 0 }),
  );
  assert.equal(result.allowed, false);
  assert.match(result.blockers.join(" "), /FAT32/i);
  assert.match(result.blockers.join(" "), /unidade de alocação/i);
});

test("recusa quando o caminho final já é diretório", async (t) => {
  const { targetRoot, plan } = await fixture(t);
  fs.mkdirSync(path.join(targetRoot, "Aurora", "default.xex"), { recursive: true });
  await assert.rejects(
    () => assessWriteCapacity(plan, targetRoot, storage()),
    /não é arquivo regular/i,
  );
});

