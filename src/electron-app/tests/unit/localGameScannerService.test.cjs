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


