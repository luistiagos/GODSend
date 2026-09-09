const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  normalizeDriveLetter,
  scanGamesDirectory,
  scanContentDirectory,
  scanIsoDirectory,
} = require("../../services/localGameScannerService.js");

test("normalizeDriveLetter: normaliza caminhos de unidades para maiusculo", () => {
  assert.equal(normalizeDriveLetter("f:\\"), "F:");
  assert.equal(normalizeDriveLetter("F:/"), "F:");
  assert.equal(normalizeDriveLetter("e:"), "E:");
  assert.equal(normalizeDriveLetter("/media/usb"), "/media/usb");
});

test("scanGamesDirectory: detecta jogos GOD no formato Nome - TitleID", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-test-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    const halo3Dir = path.join(gamesDir, "Halo 3 - 4D5307E6");
    fs.mkdirSync(path.join(halo3Dir, "00007000"), { recursive: true });

    const results = scanGamesDirectory(gamesDir, "F: (USB)");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Halo 3");
    assert.equal(results[0].titleId, "4D5307E6");
    assert.equal(results[0].format, "god");
    assert.equal(results[0].drive, "F: (USB)");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanGamesDirectory: detecta jogos XEX com default.xex", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-test-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    const gowDir = path.join(gamesDir, "Gears of War");
    fs.mkdirSync(gowDir, { recursive: true });
    fs.writeFileSync(path.join(gowDir, "default.xex"), "fake-xex-binary");

    const results = scanGamesDirectory(gamesDir, "F:");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Gears of War");
    assert.equal(results[0].format, "xex");
    assert.equal(results[0].drive, "F:");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanGamesDirectory: le manifesto godsend.ini quando presente", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-test-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    const customDir = path.join(gamesDir, "CustomTitleFolder");
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(
      path.join(customDir, "godsend.ini"),
      "[TestGame]\ntype=god\ntitleid=545408A7\ntitlename=Grand Theft Auto V\n"
    );

    const results = scanGamesDirectory(gamesDir, "F:");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Grand Theft Auto V");
    assert.equal(results[0].titleId, "545408A7");
    assert.equal(results[0].format, "god");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanContentDirectory: detecta jogos na pasta Content/0000000000000000", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-test-"));
  try {
    const contentDir = path.join(tmp, "Content", "0000000000000000");
    const gameTidDir = path.join(contentDir, "4D530805");
    fs.mkdirSync(path.join(gameTidDir, "00007000"), { recursive: true });

    const nameMap = new Map([["4D530805", "Alan Wake"]]);
    const results = scanContentDirectory(contentDir, "E:", nameMap);
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Alan Wake");
    assert.equal(results[0].titleId, "4D530805");
    assert.equal(results[0].format, "god");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanIsoDirectory: detecta arquivos .iso", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-test-"));
  try {
    const transferDir = path.join(tmp, "Transfer");
    fs.mkdirSync(transferDir, { recursive: true });
    fs.writeFileSync(path.join(transferDir, "Red Dead Redemption.iso"), "fake-iso");
    fs.writeFileSync(path.join(transferDir, "not-a-game.txt"), "text");

    const results = scanIsoDirectory(transferDir, "Transfer");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Red Dead Redemption");
    assert.equal(results[0].format, "iso");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanGamesDirectory: calcula sizeBytes e detecta TitleID em subpastas", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-test-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    const sfDir = path.join(gamesDir, "Street Fighter II");
    const subTidDir = path.join(sfDir, "584107F4", "000D0000");
    fs.mkdirSync(subTidDir, { recursive: true });
    fs.writeFileSync(path.join(subTidDir, "asset.bin"), Buffer.alloc(1024 * 1024));

    const results = scanGamesDirectory(gamesDir, "E:");
    assert.equal(results.length, 1);
    assert.equal(results[0].titleId, "584107F4");
    assert.ok(results[0].sizeBytes >= 1024 * 1024);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("isCorruptedFolderName & scanGamesDirectory: ignora pastas corrompidas ou sem assinatura de jogo", () => {
  const { isCorruptedFolderName } = require("../../services/localGameScannerService.js");

  assert.equal(isCorruptedFolderName(""), true);
  assert.equal(isCorruptedFolderName("   "), true);
  assert.equal(isCorruptedFolderName("s\x7Fτqv"), true);
  assert.equal(isCorruptedFolderName("!\x0B¿y╥5╡k.è¢d"), true);
  assert.equal(isCorruptedFolderName("Normal Game Name"), false);
  assert.equal(isCorruptedFolderName("Halo 3 - 4D5307E6"), false);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-corrupt-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    fs.mkdirSync(gamesDir, { recursive: true });

    // 1. Pasta aleatória vazia sem assinatura de jogo
    fs.mkdirSync(path.join(gamesDir, "PastaAleatoriaSemJogo"));

    // 2. Pasta com caracteres de controle (simulando corrupção de FAT)
    const corruptName = "s\x1Ftest";
    try {
      fs.mkdirSync(path.join(gamesDir, corruptName));
    } catch {}

    // 3. Jogo real válido
    const validGameDir = path.join(gamesDir, "Gears of War 2 - 4D53082D");
    fs.mkdirSync(path.join(validGameDir, "00007000"), { recursive: true });
    fs.writeFileSync(path.join(validGameDir, "00007000", "data.bin"), Buffer.alloc(1024));

    const results = scanGamesDirectory(gamesDir, "E:");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Gears of War 2");
    assert.equal(results[0].titleId, "4D53082D");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});



/** Monta um container STFS sintetico (magic + TitleID em 0x360), como os pacotes que acompanham jogos. */
function makeStfsPackage(titleId) {
  const buf = Buffer.alloc(0x400);
  buf.write("PIRS", 0, "ascii");
  buf.write(titleId, 0x360, "hex");
  return buf;
}

test("scanGamesDirectory: nao descarta jogo que carrega pacotes Kinect assinados como FFFE07DF", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-kinect-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    const gameDir = path.join(gamesDir, "Forza.Horizon.2.Presents.Fast.&.Furious.USA.X360-ZTM");
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, "default.xex"), "fake-xex-binary");
    // Pacotes de fala/Kinect que a Microsoft assina sob o TitleID de sistema.
    fs.writeFileSync(path.join(gameDir, "Database.xmplr"), makeStfsPackage("FFFE07DF"));
    fs.writeFileSync(path.join(gameDir, "NuiIdentity.bin.be"), makeStfsPackage("FFFE07DF"));

    const results = scanGamesDirectory(gamesDir, "E:");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Forza Horizon 2 Presents Fast & Furious");
    assert.equal(results[0].format, "xex");
    assert.notEqual(results[0].titleId, "FFFE07DF");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanGamesDirectory: prefere o TitleID do jogo ao de um pacote de sistema na mesma pasta", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-tid-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    const gameDir = path.join(gamesDir, "Jogo Com Kinect");
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, "default.xex"), "fake-xex-binary");
    fs.writeFileSync(path.join(gameDir, "AAA_pacote_sistema"), makeStfsPackage("FFFE07DF"));
    fs.writeFileSync(path.join(gameDir, "nxeart"), makeStfsPackage("4D530AA4"));

    const results = scanGamesDirectory(gamesDir, "E:");
    assert.equal(results.length, 1);
    assert.equal(results[0].titleId, "4D530AA4");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanGamesDirectory: soma arquivos aninhados alem de tres niveis no tamanho do jogo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-size-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    const gameDir = path.join(gamesDir, "Jogo Profundo");
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, "default.xex"), Buffer.alloc(1024));

    // media/tracks/<track>/<asset>/ — quatro niveis abaixo da raiz do jogo.
    const deepDir = path.join(gameDir, "media", "tracks", "circuito", "assets");
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(deepDir, "dados.bin"), Buffer.alloc(500000));

    const results = scanGamesDirectory(gamesDir, "E:");
    assert.equal(results.length, 1);
    assert.equal(results[0].sizeBytes, 1024 + 500000);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanGamesDirectory: lista jogo cujos unicos containers sao pacotes de sistema", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-sysonly-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    const gameDir = path.join(gamesDir, "Jogo So Com Kinect");
    fs.mkdirSync(gameDir, { recursive: true });
    fs.writeFileSync(path.join(gameDir, "default.xex"), "fake-xex-binary");
    // Nenhum container do proprio jogo — so pacotes assinados sob o titulo de sistema.
    fs.writeFileSync(path.join(gameDir, "Database.xmplr"), makeStfsPackage("FFFE07DF"));

    const results = scanGamesDirectory(gamesDir, "E:");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "Jogo So Com Kinect");
    assert.equal(results[0].titleId, undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("scanGamesDirectory: continua descartando dados de atualizacao do sistema", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-scan-sysdata-"));
  try {
    const gamesDir = path.join(tmp, "Games");
    // Dados de dashboard: containers de sistema com companheiro .data e nenhum executavel.
    const sysDir = path.join(gamesDir, "AtualizacaoDoPainel");
    fs.mkdirSync(path.join(sysDir, "pacote.data"), { recursive: true });
    fs.writeFileSync(path.join(sysDir, "pacote"), makeStfsPackage("FFFE07DF"));

    const results = scanGamesDirectory(gamesDir, "E:");
    assert.equal(results.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
