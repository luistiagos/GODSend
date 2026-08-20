const test = require("node:test");
const assert = require("node:assert/strict");
const { getSqlJs } = require("../../infrastructure/sqlHelper.js");
const { buildAuroraGamesFromDbBuffers } = require("../../services/auroraLibraryService.js");

test("buildAuroraGamesFromDbBuffers processa buffers SQLite do Aurora corretamente", async () => {
  const SQL = await getSqlJs();

  // 1. Criar banco de dados content.db simulado
  const contentDb = new SQL.Database();
  contentDb.run(`
    CREATE TABLE ContentItems (
      Id INTEGER PRIMARY KEY,
      TitleId INTEGER,
      MediaId INTEGER,
      TitleName TEXT,
      Description TEXT,
      Publisher TEXT,
      Developer TEXT,
      LiveRating REAL,
      LiveRaters INTEGER,
      ReleaseDate TEXT,
      Directory TEXT,
      ScanPathId INTEGER,
      DiscNum INTEGER,
      DiscsInSet INTEGER,
      FileType INTEGER,
      ContentType INTEGER
    );
  `);

  // Inserir 3 jogos:
  // Jogo 1: Halo 3 (TitleId: 0x4D5307E6 = 1297287142)
  contentDb.run(`
    INSERT INTO ContentItems VALUES (
      1, 1297287142, 100, 'Halo 3', 'Master Chief returns', 'Microsoft', 'Bungie', 4.8, 150000,
      '2007-09-25', 'Hdd1:\\Games\\Halo 3', 1, 1, 1, 1, 1
    );
  `);

  // Jogo 2: Gears of War (TitleId: 0x4D5307D5 = 1297287125)
  contentDb.run(`
    INSERT INTO ContentItems VALUES (
      2, 1297287125, 200, 'Gears of War', 'Epic shooter', 'Microsoft', 'Epic Games', 4.7, 95000,
      '2006-11-07', 'Hdd1:\\Games\\Gears of War', 1, 1, 1, 1, 1
    );
  `);

  // Jogo 3: Jogo Oculto (TitleId: 0x58410888)
  contentDb.run(`
    INSERT INTO ContentItems VALUES (
      3, 1480657032, 300, 'Hidden Game', 'Should not appear', 'Anon', 'Anon', 1.0, 10,
      '2010-01-01', 'Hdd1:\\Games\\Hidden', 1, 1, 1, 1, 1
    );
  `);

  const contentBuf = Buffer.from(contentDb.export());
  contentDb.close();

  // 2. Criar banco de dados settings.db simulado
  const settingsDb = new SQL.Database();
  settingsDb.run(`
    CREATE TABLE UserHidden (ContentId INTEGER);
    CREATE TABLE UserFavorites (ContentId INTEGER);
    CREATE TABLE UserRecentGames (ContentId INTEGER, DateTime INTEGER);
  `);

  // Jogo 3 está oculto
  settingsDb.run("INSERT INTO UserHidden VALUES (3);");
  // Jogo 1 é favorito
  settingsDb.run("INSERT INTO UserFavorites VALUES (1);");
  // Jogo 1 jogado 2 vezes (FILETIME para Unix Epoch 1970-01-01 = 116444736000000000)
  settingsDb.run("INSERT INTO UserRecentGames VALUES (1, 116444736000000000);");
  settingsDb.run("INSERT INTO UserRecentGames VALUES (1, 116444736000000000);");

  const settingsBuf = Buffer.from(settingsDb.export());
  settingsDb.close();

  // 3. Executar o parser
  const scanDriveMap = new Map([[1, "Hdd1:\\"]]);
  const games = await buildAuroraGamesFromDbBuffers(contentBuf, settingsBuf, scanDriveMap);

  // Validações
  assert.equal(games.length, 2, "deve retornar exatamente 2 jogos (excluindo o oculto)");

  const halo = games.find((g) => g.titleId === "4D5307E6");
  assert.ok(halo, "Halo 3 deve estar presente");
  assert.equal(halo.name, "Halo 3");
  assert.equal(halo.publisher, "Microsoft");
  assert.equal(halo.developer, "Bungie");
  assert.equal(halo.isFavorite, true);
  assert.equal(halo.timesPlayed, 2);
  assert.equal(halo.lastPlayed, "1970-01-01");
  assert.equal(halo.sourceDrive, "Hdd1:\\");
  assert.equal(halo.gameDataDir, "4D5307E6_00000001");

  const gears = games.find((g) => g.titleId === "4D5307D5");
  assert.ok(gears, "Gears of War deve estar presente");
  assert.equal(gears.name, "Gears of War");
  assert.equal(gears.isFavorite, false);
  assert.equal(gears.timesPlayed, 0);
  assert.equal(gears.lastPlayed, null);
});
