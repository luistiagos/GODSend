const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSqlJs,
  sqlQuery,
  sqlRows,
  filetimeToDateStr,
} = require("../../infrastructure/sqlHelper.js");

test("getSqlJs inicializa o sql.js com suporte a WASM e caching", async () => {
  const SQL1 = await getSqlJs();
  assert.ok(SQL1, "instância sql.js deve ser carregada");
  assert.ok(typeof SQL1.Database === "function", "construtor Database deve existir");

  // Re-invocação retorna instância em cache
  const SQL2 = await getSqlJs();
  assert.equal(SQL1, SQL2, "deve retornar a mesma instância em cache");
});

test("sqlQuery executa comandos DDL, DML e consultas parametrizadas", async () => {
  const SQL = await getSqlJs();
  const db = new SQL.Database();

  db.run("CREATE TABLE games (id INTEGER PRIMARY KEY, title TEXT, plays INTEGER);");
  db.run("INSERT INTO games (id, title, plays) VALUES (?, ?, ?);", [1, "Halo 3", 42]);
  db.run("INSERT INTO games (id, title, plays) VALUES (?, ?, ?);", [2, "Gears of War", 15]);

  const allGames = sqlQuery(db, "SELECT id, title, plays FROM games ORDER BY id ASC");
  assert.equal(allGames.length, 2);
  assert.deepEqual(allGames[0], { id: 1, title: "Halo 3", plays: 42 });
  assert.deepEqual(allGames[1], { id: 2, title: "Gears of War", plays: 15 });

  const filtered = sqlQuery(db, "SELECT title FROM games WHERE id = ?", [2]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, "Gears of War");

  db.close();
});

test("sqlRows converte resultado bruto de db.exec em array de objetos", async () => {
  const SQL = await getSqlJs();
  const db = new SQL.Database();

  db.run("CREATE TABLE items (key TEXT, val INT);");
  db.run("INSERT INTO items VALUES ('alpha', 10), ('beta', 20);");

  const rawExecResult = db.exec("SELECT key, val FROM items ORDER BY key");
  const objects = sqlRows(rawExecResult);

  assert.equal(objects.length, 2);
  assert.deepEqual(objects[0], { key: "alpha", val: 10 });
  assert.deepEqual(objects[1], { key: "beta", val: 20 });

  assert.deepEqual(sqlRows([]), []);
  assert.deepEqual(sqlRows(null), []);

  db.close();
});

test("filetimeToDateStr converte FILETIME do Windows para string YYYY-MM-DD", () => {
  // 132486048000000000 -> 2020-11-01 approx
  // 116444736000000000 -> 1970-01-01 00:00:00 UTC (Unix Epoch)
  assert.equal(filetimeToDateStr(116444736000000000n), "1970-01-01");
  assert.equal(filetimeToDateStr(116444736000000000), "1970-01-01");

  // Zero e valores inválidos retornam null
  assert.equal(filetimeToDateStr(0), null);
  assert.equal(filetimeToDateStr(0n), null);
  assert.equal(filetimeToDateStr(null), null);
  assert.equal(filetimeToDateStr(undefined), null);
});
