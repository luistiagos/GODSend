const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { quarantineForeignConsoleState, isForeignConsoleStatePath } = require("../../infrastructure/foreignConsoleState.js");
const { buildTransactionalWritePlan } = require("../../infrastructure/transactionalWritePlan.js");
const { executeTransactionalWriteSimulation, SIMULATION_MARKER_FILE, SIMULATION_MARKER_CONTENT } = require("../../infrastructure/simulatedTransactionalWriter.js");
const { generateReadyToPlayLaunchIni } = require("../../infrastructure/readyToPlayConfiguration.js");

const dump = "Aurora/Data/Logs/20250916014053.crash.log";
const database = "apps/FreeStyle/Data/Databases/settings.db";
const hash = (contents) => crypto.createHash("sha256").update(contents).digest("hex");
const entry = (name, contents = "bundled state") => ({ path: name, sizeBytes: Buffer.byteLength(contents), sha256: hash(contents) });
const revalidate = async () => {};

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "companion-state-migration-"));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(resolved).startsWith("companion-state-migration-"));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 });
  });
  return root;
}

function write(root, name, contents = "bundled state") {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

test("atualiza plano antigo sem formatar, preserva jogos e retira somente o estado conhecido", async (t) => {
  const root = fixture(t);
  const sourceRoot = path.join(root, "source");
  const target = path.join(root, "target");
  write(target, SIMULATION_MARKER_FILE, SIMULATION_MARKER_CONTENT);
  write(target, "games/MyGame/default.xex", "user game");
  const files = [entry(dump), entry(database), entry("Aurora/default.xex", "aurora")];
  const oldEntries = files.map((file) => ({
    sourcePath: write(sourceRoot, file.path, file.path.endsWith("default.xex") ? "aurora" : "bundled state"),
    relativePath: file.path, sizeBytes: file.sizeBytes, sha256: file.sha256,
  }));
  const makePlan = (entries) => buildTransactionalWritePlan({
    sourceRoot, deviceFingerprint: "c".repeat(64), manifestId: "test.production", manifestRelease: "1.1", entries,
  });
  await executeTransactionalWriteSimulation(await makePlan(oldEntries), target, { revalidateTarget: revalidate });
  const luaIni = generateReadyToPlayLaunchIni();
  const newEntries = oldEntries.filter((file) => !isForeignConsoleStatePath(file.relativePath));
  newEntries.push({ sourcePath: write(sourceRoot, "launch.ini", luaIni), relativePath: "launch.ini", sizeBytes: Buffer.byteLength(luaIni), sha256: hash(luaIni) });
  const plan = await makePlan(newEntries);
  // A versão 2.12.68 já pode ter concluído o plano novo, deixando os arquivos antigos.
  await executeTransactionalWriteSimulation(plan, target, { revalidateTarget: revalidate });
  const moved = await quarantineForeignConsoleState(target, files, revalidate);
  const result = await executeTransactionalWriteSimulation(plan, target, { revalidateTarget: revalidate });
  assert.equal(result.journal.state, "completed");
  assert.equal(result.resumed, true);
  assert.equal(moved.length, 2);
  for (const name of [dump, database]) assert.equal(fs.existsSync(path.join(target, name)), false);
  for (const name of moved) assert.equal(fs.readFileSync(path.join(target, name), "utf8"), "bundled state");
  assert.equal(fs.readFileSync(path.join(target, "games/MyGame/default.xex"), "utf8"), "user game");
  assert.equal(fs.readFileSync(path.join(target, "launch.ini"), "utf8"), luaIni);
  assert.deepEqual(await quarantineForeignConsoleState(target, files, revalidate), []);
});

test("preserva logs e bancos alterados mesmo com o mesmo tamanho, e ignora arquivos fora do escopo", async (t) => {
  const root = fixture(t);
  for (const name of [dump, database]) write(root, name, "console state");
  write(root, "Aurora/Data/Logs/new.crash.log", "new crash");
  write(root, "Content/E0002FF78DFBDE7B/profile", "exploit");
  assert.deepEqual(await quarantineForeignConsoleState(root, [entry(dump), entry(database), entry("Content/E0002FF78DFBDE7B/profile", "exploit")], revalidate), []);
  for (const name of [dump, database]) assert.equal(fs.readFileSync(path.join(root, name), "utf8"), "console state");
  assert.equal(fs.readFileSync(path.join(root, "Aurora/Data/Logs/new.crash.log"), "utf8"), "new crash");
  assert.equal(fs.existsSync(path.join(root, ".xbox-downloader")), false);
});

test("retoma após interrupção entre arquivos sem perder a quarentena anterior", async (t) => {
  const root = fixture(t);
  write(root, dump);
  write(root, database);
  const files = [entry(dump), entry(database)];
  await assert.rejects(quarantineForeignConsoleState(root, files, async () => {
    if (!fs.existsSync(path.join(root, dump))) throw new Error("USB desconectado");
  }), /USB desconectado/);
  assert.equal(fs.existsSync(path.join(root, database)), true);
  const moved = await quarantineForeignConsoleState(root, files, revalidate);
  assert.equal(moved.length, 1);
  assert.equal(fs.existsSync(path.join(root, database)), false);
  const archives = fs.readdirSync(path.join(root, ".xbox-downloader/quarantine"));
  assert.equal(archives.length, 2);
  assert.ok(archives.some((dir) => fs.existsSync(path.join(root, ".xbox-downloader/quarantine", dir, dump))));
});

test("não sobrescreve uma quarentena quando o arquivo original reaparece", async (t) => {
  const root = fixture(t);
  write(root, dump);
  const first = await quarantineForeignConsoleState(root, [entry(dump)], revalidate);
  write(root, dump);
  const second = await quarantineForeignConsoleState(root, [entry(dump)], revalidate);
  assert.notEqual(first[0], second[0]);
  for (const name of [...first, ...second]) assert.equal(fs.readFileSync(path.join(root, name), "utf8"), "bundled state");
});

test("recusa revalidação falha antes de mover e preserva alterações durante a revalidação", async (t) => {
  const root = fixture(t);
  write(root, dump);
  await assert.rejects(quarantineForeignConsoleState(root, [entry(dump)], async () => { throw new Error("dispositivo diferente"); }), /dispositivo diferente/);
  assert.equal(fs.readFileSync(path.join(root, dump), "utf8"), "bundled state");
  let calls = 0;
  const moved = await quarantineForeignConsoleState(root, [entry(dump)], async () => {
    if (++calls === 3) write(root, dump, "console state");
  });
  assert.deepEqual(moved, []);
  assert.equal(fs.readFileSync(path.join(root, dump), "utf8"), "console state");
});

test("recusa traversal e junctions nos caminhos de origem e de quarentena", async (t) => {
  const root = fixture(t);
  await assert.rejects(quarantineForeignConsoleState(root, [entry("Aurora/Data/Logs/../../escape")], revalidate), /inseguro/);
  const outside = fixture(t);
  write(outside, "20250916014053.crash.log");
  fs.mkdirSync(path.join(root, "Aurora/Data"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, "Aurora/Data/Logs"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(quarantineForeignConsoleState(root, [entry(dump)], revalidate), /diretório real/);
  const other = fixture(t);
  write(other, dump);
  fs.symlinkSync(outside, path.join(other, ".xbox-downloader"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(quarantineForeignConsoleState(other, [entry(dump)], revalidate), /diretório real/);
  assert.equal(fs.existsSync(path.join(other, dump)), true);
  assert.equal(fs.readFileSync(path.join(outside, "20250916014053.crash.log"), "utf8"), "bundled state");
});
