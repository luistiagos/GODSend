const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  isForeignConsoleStatePath,
} = require("../../services/fixedBadAvatarPreparationService.js");

const packageIndex = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "assets", "badavatar-package.json"), "utf8"),
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "assets", packageIndex.manifestFileName), "utf8"),
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

  // Estado vinculado ao console doador dentro de Content/ e BadUpdatePayload/: ContentCache.pkg
  // (CON assinado com CDIs.bin do doador), cookies de avatar/telemetria/DRM/Kinect, save do
  // Netflix e MAC Ethernet do doador (~155 MiB que contaminavam o cache XAM do console destino).
  assert.ok(excluded.includes("Content/0000000000000000/FFFE07DF/00040000/ContentCache.pkg"));
  assert.ok(excluded.includes("Content/0000000000000000/584D07D1/00040000/asset_refresh_cookie"));
  assert.ok(excluded.includes("Content/0000000000000000/FFFE07DF/00040000/MicArrayCalibrate.mec"));
  assert.ok(excluded.includes("Content/0000000000000000/FFFE07DF/00040000/XlfsUploadCache.dat"));
  assert.ok(excluded.includes("Content/0000000000000000/FFFE07DF/000F0000/JanusDatastore.dat"));
  assert.ok(excluded.includes("Content/0000000000000000/394707D1/00000001/CONTENTFILE"));
  assert.ok(excluded.includes("BadUpdatePayload/OriginalMACAddress.bin"));

  // Tripwire proposital: se o pacote for trocado por `npm run payload:update`, esta
  // contagem muda e o teste falha. Confira o que entrou de novo antes de ajustar o
  // numero — o pacote anterior trouxe 536 KB + 155 MiB de estado alheio sem ninguem notar.
  assert.equal(excluded.length, 33);
});

test("o exploit e a dashboard continuam sendo gravados", () => {
  for (const relativePath of [
    "Aurora/default.xex",
    "BadUpdatePayload/default.xex",
    "BadUpdatePayload/BadUpdateExploit-Avatar-2ndStage.bin",
    "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B",
    "Content/0000000000000000/C0DE9999/00080000/C0DE99990F586558",
    "Aurora/User/Scripts/Content/Filters/HideBackups.lua",
    "Aurora/Media/Locales/PT-BR.xzp",
  ]) {
    assert.equal(isForeignConsoleStatePath(relativePath), false, relativePath);
  }

  // O perfil corrompido em Content/ e o vetor do BadAvatar, nao lixo de estado.
  const kept = manifest.files
    .map((file) => file.path)
    .filter((relativePath) => !isForeignConsoleStatePath(relativePath));
  assert.equal(kept.length, manifest.fileCount - 33);
});

test("a exclusao nao depende da caixa do caminho", () => {
  assert.equal(isForeignConsoleStatePath("AURORA/DATA/LOGS/debug.log"), true);
  assert.equal(isForeignConsoleStatePath("apps/freestyle/data/databases/content.db"), true);
  assert.equal(isForeignConsoleStatePath("CONTENT/0000000000000000/FFFE07DF/00040000/CONTENTCACHE.PKG"), true);
  assert.equal(isForeignConsoleStatePath("badupdatepayload/originalmacaddress.bin"), true);
});
