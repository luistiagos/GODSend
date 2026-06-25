const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  activateExistingVersion,
  updatePayload,
} = require("../../scripts/update-fixed-payload.js");

function temp(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));
  return root;
}

function write(root, relativePath, contents = relativePath) {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createPayload(t) {
  const root = temp(t, "badavatar-update-source-");
  write(root, "BadUpdatePayload/default.xex", "payload");
  write(root, "Content/0000000000000000/content.bin", "content");
  write(root, "games/Trigger/game.bin", "trigger");
  write(root, "Aurora/default.xex", "aurora");
  write(root, "lhelper.xex", "helper");
  write(root, "UsbdSecPatch.xex", "patch");
  return root;
}

function createOldVersion(assets) {
  fs.mkdirSync(path.join(assets, "badavatar-old"), { recursive: true });
  write(assets, "badavatar-old/old.bin", "old");
  write(assets, "badavatar-old.manifest.json", "{}");
  write(assets, "badavatar-package.json", JSON.stringify({
    schemaVersion: 1,
    directoryName: "badavatar-old",
    manifestFileName: "badavatar-old.manifest.json",
    release: "old",
    bundleSha256: "0".repeat(64),
  }));
}

test("importa, cataloga e ativa manualmente uma nova versão", (t) => {
  const source = createPayload(t);
  const assets = temp(t, "badavatar-update-assets-");
  createOldVersion(assets);

  const result = updatePayload({
    sourceRoot: source,
    version: "2.0-test",
    assetsRoot: assets,
    createdAt: "2026-06-24T12:00:00.000Z",
  });

  const active = JSON.parse(fs.readFileSync(path.join(assets, "badavatar-package.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(assets, active.manifestFileName), "utf8"));
  assert.equal(active.directoryName, "badavatar-2.0-test");
  assert.equal(active.release, "2.0-test");
  assert.equal(active.bundleSha256, manifest.bundleSha256);
  assert.equal(manifest.fileCount, 6);
  assert.equal(result.removedPrevious, true);
  assert.equal(fs.existsSync(path.join(assets, "badavatar-old")), false);
  assert.equal(fs.readFileSync(path.join(assets, active.directoryName, "Aurora", "default.xex"), "utf8"), "aurora");
});

test("mantém a versão ativa quando a nova pasta é incompleta", (t) => {
  const source = temp(t, "badavatar-update-invalid-");
  write(source, "BadUpdatePayload/default.xex", "incomplete");
  const assets = temp(t, "badavatar-update-assets-");
  createOldVersion(assets);
  const before = fs.readFileSync(path.join(assets, "badavatar-package.json"), "utf8");

  assert.throws(
    () => updatePayload({ sourceRoot: source, version: "broken", assetsRoot: assets }),
    /pasta obrigatória Content/i,
  );
  assert.equal(fs.readFileSync(path.join(assets, "badavatar-package.json"), "utf8"), before);
  assert.equal(fs.existsSync(path.join(assets, "badavatar-old")), true);
});

test("permite reativar uma versão preservada manualmente", (t) => {
  const source = createPayload(t);
  const assets = temp(t, "badavatar-update-assets-");
  updatePayload({
    sourceRoot: source,
    version: "1.0",
    assetsRoot: assets,
    createdAt: "2026-06-24T12:00:00.000Z",
  });
  write(source, "Aurora/default.xex", "aurora-new");
  updatePayload({
    sourceRoot: source,
    version: "2.0",
    assetsRoot: assets,
    keepPrevious: true,
    createdAt: "2026-06-24T13:00:00.000Z",
  });

  const active = activateExistingVersion({ version: "1.0", assetsRoot: assets });
  assert.equal(active.directoryName, "badavatar-1.0");
  assert.equal(fs.existsSync(path.join(assets, "badavatar-2.0")), true);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(assets, "badavatar-package.json"), "utf8")).directoryName,
    "badavatar-1.0",
  );
});
