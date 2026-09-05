const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  isForeignConsoleStatePath,
} = require("../../services/fixedBadAvatarPreparationService.js");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "assets", "badavatar-1.1.manifest.json"), "utf8"),
);

test("estado do console de origem nao e gravado no pendrive do usuario", () => {
  const excluded = manifest.files
    .map((file) => file.path)
    .filter((relativePath) => isForeignConsoleStatePath(relativePath));

  // Os crash dumps do pacote sao do console em que ele foi capturado; replica-los faz o
  // usuario receber o diagnostico de outra maquina como se fosse dele.
  assert.ok(excluded.includes("Aurora/Data/Logs/20251004165013.crash.log"));
  assert.ok(excluded.includes("Aurora/Data/Logs/20251004165013.crash.log.callstack"));
  assert.ok(excluded.includes("Aurora/Data/Logs/debug.log"));
  assert.ok(excluded.includes("apps/Aurora/Data/Logs/debug.log"));
  assert.ok(excluded.includes("apps/FreeStyle/Data/Logs/debug.log"));

  // content.db descreve 68 jogos num HD interno cujo serial nao existe no pendrive.
  assert.ok(excluded.includes("apps/FreeStyle/Data/Databases/content.db"));
  assert.ok(excluded.includes("apps/FreeStyle/Data/Databases/settings.db"));

  assert.equal(excluded.length, 26);
});

test("o exploit e a dashboard continuam sendo gravados", () => {
  for (const relativePath of [
    "Aurora/default.xex",
    "BadUpdatePayload/default.xex",
    "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B",
    "Aurora/User/Scripts/Content/Filters/HideBackups.lua",
    "Aurora/Media/Locales/PT-BR.xzp",
  ]) {
    assert.equal(isForeignConsoleStatePath(relativePath), false, relativePath);
  }

  // O perfil corrompido em Content/ e o vetor do BadAvatar, nao lixo de estado.
  const kept = manifest.files
    .map((file) => file.path)
    .filter((relativePath) => !isForeignConsoleStatePath(relativePath));
  assert.equal(kept.length, manifest.fileCount - 26);
});

test("a exclusao nao depende da caixa do caminho", () => {
  assert.equal(isForeignConsoleStatePath("AURORA/DATA/LOGS/debug.log"), true);
  assert.equal(isForeignConsoleStatePath("apps/freestyle/data/databases/content.db"), true);
});
