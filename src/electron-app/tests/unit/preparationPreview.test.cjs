const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { finished } = require("node:stream/promises");
const yazl = require("yazl");

const {
  assessConsolePreparationPrerequisites,
  createPreparationPreview,
} = require("../../infrastructure/preparationPreview.js");

function temp(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));
  return root;
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function createZip(filePath, entries) {
  const zip = new yazl.ZipFile();
  for (const entry of entries) zip.addBuffer(Buffer.from(entry.contents), entry.name);
  const output = fs.createWriteStream(filePath);
  zip.outputStream.pipe(output);
  zip.end();
  await finished(output);
}

function componentFromArchive(zipPath, id, role, installPath) {
  const bytes = fs.readFileSync(zipPath);
  return {
    id,
    role,
    displayName: id,
    version: "test-1",
    required: true,
    source: {
      url: `https://downloads.example.test/${id}.zip`,
      redirectHosts: [],
      fileName: `${id}.zip`,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    },
    license: {
      spdx: "MIT",
      projectUrl: `https://example.test/${id}`,
      redistributionApproved: true,
      attribution: "Fixture de teste.",
    },
    archive: {
      format: "zip",
      installPath,
      maxExtractedBytes: 1024 * 1024,
      maxEntries: 100,
    },
  };
}

function readyConsole(overrides = {}) {
  return {
    dashboardVersion: "17559",
    avatarDataInstalledConfirmed: true,
    networkDisconnectedConfirmed: true,
    nonPersistentExploitAcknowledged: true,
    exploitProfileSafetyAcknowledged: true,
    ...overrides,
  };
}

function targetStorage(overrides = {}) {
  return {
    fileSystem: "FAT32",
    totalBytes: 8 * 1024 ** 3,
    freeBytes: 4 * 1024 ** 3,
    allocationUnitBytes: 32 * 1024,
    ...overrides,
  };
}

async function fixture(t) {
  const root = temp(t, "xbox360-preview-");
  const archivesRoot = path.join(root, "archives");
  const workspaceRoot = path.join(root, "workspace");
  const targetRoot = path.join(root, "target");
  fs.mkdirSync(archivesRoot);
  fs.mkdirSync(workspaceRoot);
  fs.mkdirSync(targetRoot);
  fs.writeFileSync(path.join(targetRoot, "existing-user-file.txt"), "do-not-touch");

  const badavatarPath = path.join(archivesRoot, "abadavatar.zip");
  const xeunshacklePath = path.join(archivesRoot, "xeunshackle.zip");
  const auroraPath = path.join(archivesRoot, "aurora.zip");
  await createZip(badavatarPath, [
    { name: "Content/0000000000000000/profile", contents: "exploit-profile" },
  ]);
  await createZip(xeunshacklePath, [
    { name: "default.xex", contents: "xeunshackle" },
  ]);
  await createZip(auroraPath, [
    { name: "default.xex", contents: "aurora" },
    { name: "Data/settings.db", contents: "settings" },
  ]);

  const badavatar = componentFromArchive(badavatarPath, "abadavatar", "badavatar-entry", ".");
  const xeunshackle = componentFromArchive(xeunshacklePath, "xeunshackle", "xeunshackle-autostart", "BadUpdatePayload");
  const aurora = componentFromArchive(auroraPath, "aurora", "dashboard-aurora", "Aurora");
  const manifest = {
    schemaVersion: 1,
    manifestId: "xbox360-preview.test",
    release: "0.1.0",
    createdAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2027-06-01T00:00:00.000Z",
    components: [badavatar, xeunshackle, aurora],
  };
  return {
    root,
    workspaceRoot,
    targetRoot,
    manifest,
    archivePaths: {
      abadavatar: badavatarPath,
      xeunshackle: xeunshacklePath,
      aurora: auroraPath,
    },
  };
}

function previewInput(data, overrides = {}) {
  return {
    trustedManifest: data.manifest,
    componentArchivePaths: data.archivePaths,
    workspaceRoot: data.workspaceRoot,
    targetRoot: data.targetRoot,
    targetStorage: targetStorage(),
    deviceFingerprint: "f".repeat(64),
    console: readyConsole(),
    now: new Date("2026-06-22T12:00:00.000Z"),
    ...overrides,
  };
}

function snapshotTree(root) {
  const result = [];
  function visit(current, relative) {
    for (const name of fs.readdirSync(current).sort()) {
      const absolute = path.join(current, name);
      const childRelative = relative ? `${relative}/${name}` : name;
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) visit(absolute, childRelative);
      else result.push({ path: childRelative, bytes: fs.readFileSync(absolute).toString("hex") });
    }
  }
  visit(root, "");
  return result;
}

test("aceita as confirmações explícitas para o dashboard 17559", () => {
  const result = assessConsolePreparationPrerequisites(readyConsole({ dashboardVersion: "2.0.17559.0" }));
  assert.equal(result.allowed, true);
  assert.equal(result.normalizedDashboardVersion, "2.0.17559.0");
  assert.equal(result.blockers.length, 0);
  assert.ok(result.warnings.length >= 4);
});

test("bloqueia dashboard, Avatar, rede, persistência e perfil sem confirmação", () => {
  const result = assessConsolePreparationPrerequisites({
    dashboardVersion: "17489",
    avatarDataInstalledConfirmed: false,
    networkDisconnectedConfirmed: false,
    nonPersistentExploitAcknowledged: false,
    exploitProfileSafetyAcknowledged: false,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.blockers.length, 5);
  assert.match(result.blockers.join(" "), /17559/i);
  assert.match(result.blockers.join(" "), /Avatar/i);
  assert.match(result.blockers.join(" "), /Wi-Fi/i);
  assert.match(result.blockers.join(" "), /não persiste/i);
  assert.match(result.blockers.join(" "), /perfil do exploit/i);
});

test("ensaia extração, imagem, plano e capacidade sem alterar o destino", async (t) => {
  const data = await fixture(t);
  const before = snapshotTree(data.targetRoot);
  const result = await createPreparationPreview(previewInput(data));
  const after = snapshotTree(data.targetRoot);

  assert.equal(result.mode, "read-only-preview");
  assert.equal(result.ready, true);
  assert.equal(result.targetWritesPerformed, false);
  assert.equal(result.components.length, 3);
  assert.ok(result.image.fileCount >= 7);
  assert.match(result.plan.planHash, /^[a-f0-9]{64}$/);
  assert.equal(result.capacity.allowed, true);
  assert.deepEqual(after, before);
  assert.equal(fs.existsSync(path.join(result.image.root, "Aurora", "default.xex")), true);
  assert.equal(fs.existsSync(path.join(result.image.root, "BadUpdatePayload", "default.xex")), true);
});

test("mantém a prévia bloqueada quando falta espaço com reserva", async (t) => {
  const data = await fixture(t);
  const result = await createPreparationPreview(previewInput(data, {
    targetStorage: targetStorage({ freeBytes: 16 * 1024 ** 2 }),
  }));
  assert.equal(result.ready, false);
  assert.equal(result.capacity.allowed, false);
  assert.ok(result.capacity.shortfallBytes > 0);
  assert.match(result.blockers.join(" "), /espaço livre insuficiente/i);
});

test("verifica e inclui componente raw somente pelo staging do PC", async (t) => {
  const data = await fixture(t);
  const rawPath = path.join(data.root, "archives", "xexmenu.xex");
  fs.writeFileSync(rawPath, "xexmenu");
  const rawBytes = fs.readFileSync(rawPath);
  data.manifest.components.push({
    id: "xexmenu",
    role: "xexmenu",
    displayName: "XeXMenu",
    version: "test-1",
    required: true,
    source: {
      url: "https://downloads.example.test/xexmenu.xex",
      redirectHosts: [],
      fileName: "default.xex",
      sizeBytes: rawBytes.length,
      sha256: sha256(rawBytes),
    },
    license: {
      spdx: "MIT",
      projectUrl: "https://example.test/xexmenu",
      redistributionApproved: true,
      attribution: "Fixture de teste.",
    },
    archive: {
      format: "raw",
      installPath: "Content/0000000000000000/CODE9999/00080000",
      maxExtractedBytes: rawBytes.length,
      maxEntries: 1,
    },
  });
  data.archivePaths.xexmenu = rawPath;

  const result = await createPreparationPreview(previewInput(data));
  const summary = result.components.find((component) => component.id === "xexmenu");
  assert.equal(summary.archiveFormat, "raw");
  assert.equal(summary.extractedFiles, 1);
  assert.equal(
    fs.readFileSync(path.join(result.image.root, "Content", "0000000000000000", "CODE9999", "00080000", "default.xex"), "utf8"),
    "xexmenu",
  );
});

test("recusa componente obrigatório ausente antes de criar a sessão", async (t) => {
  const data = await fixture(t);
  const archivePaths = { ...data.archivePaths };
  delete archivePaths.aurora;
  await assert.rejects(
    () => createPreparationPreview(previewInput(data, { componentArchivePaths: archivePaths })),
    /componente obrigatório ausente.*aurora/i,
  );
  assert.deepEqual(fs.readdirSync(data.workspaceRoot), []);
});
