const test = require("node:test");
const { mock } = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");
const { EventEmitter } = require("events");

// repairDrive logs through appendAppEvent; the real serverLog would write to the
// owner's %APPDATA% log under plain `node --test`. Stub it before the service loads.
const logEvents = [];
require.cache[require.resolve("../../infrastructure/serverLog.js")] = {
  exports: { appendAppEvent: (_category, message) => logEvents.push(message) },
};

const {
  extractDriveLetter,
} = require("../../services/driveRepairService.js");

test("extractDriveLetter extrai corretamente a letra da unidade em vários formatos", () => {
  assert.equal(extractDriveLetter("E:\\"), "E");
  assert.equal(extractDriveLetter("e:\\"), "E");
  assert.equal(extractDriveLetter("F:"), "F");
  assert.equal(extractDriveLetter("d"), "D");
  assert.equal(extractDriveLetter("  G:\\Games  "), "G");
});

const { summarizeChkdskExit } = require("../../services/driveRepairService.js");

test("summarizeChkdskExit: processo morto por sinal (code null) é falha, nunca código 0", () => {
  const r = summarizeChkdskExit(null, "Nenhuma ação necessária.");
  assert.equal(r.ok, false);
  assert.equal(r.repaired, false);
  assert.equal(r.exitCode, -1);
  assert.match(r.summary, /interrompido/);
});

test("summarizeChkdskExit: códigos reais do chkdsk", () => {
  assert.deepEqual(
    [summarizeChkdskExit(0, "Não há problemas").ok, summarizeChkdskExit(0, "Não há problemas").summary],
    [true, "Nenhum erro encontrado. O sistema de arquivos está íntegro."],
  );
  const fixed = summarizeChkdskExit(1, "O Windows corrigiu o sistema de arquivos.");
  assert.equal(fixed.ok, true);
  assert.equal(fixed.repaired, true);
  const failed = summarizeChkdskExit(3, "Não foi possível verificar.");
  assert.equal(failed.ok, false);
  assert.match(failed.summary, /código 3/);
});

// [[electron-main-reparo-chkdsk-acusa-tempo-limite-de-5-min-mas-o-chkdsk-continua-rodando_2026-10-09T22-50]]
// A 5-minute setTimeout used to kill cmd.exe and resolve "excedeu o tempo limite" while chkdsk kept running.
test("repairDrive: sem prazo; resolve só no close, com a duração e o código real no log", async (t) => {
  const { repairDrive } = require("../../services/driveRepairService.js");
  const { windowsAnsiCodePage } = require("../../infrastructure/windowsAnsiCodePage.js");

  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  if (process.platform !== "win32") Object.defineProperty(process, "platform", { value: "win32" });
  const originalSpawn = childProcess.spawn;
  let child = null;
  childProcess.spawn = () => {
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    return child;
  };
  t.after(() => {
    childProcess.spawn = originalSpawn;
    Object.defineProperty(process, "platform", originalPlatform);
    mock.timers.reset();
  });

  // Warm the code-page cache with real timers: reg.exe's execFile timeout must not hit the fake clock.
  await windowsAnsiCodePage();
  mock.timers.enable({ apis: ["setTimeout", "Date"] });

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const run = async () => {
    child = null;
    logEvents.length = 0;
    const lines = [];
    let settled = null;
    repairDrive("E:\\", (line) => lines.push(line)).then((r) => { settled = r; });
    while (!child) await flush();
    mock.timers.tick(6 * 60 * 1000);
    await flush();
    assert.equal(settled, null, "repairDrive resolveu antes do close (prazo de volta?)");
    return { lines, result: () => settled };
  };

  const ok = await run();
  child.stdout.emit("data", Buffer.from("Nenhuma acao necessaria.\r\n"));
  assert.deepEqual(ok.lines, ["Nenhuma acao necessaria."]);
  child.emit("close", 0);
  await flush();
  assert.equal(ok.result().ok, true);
  assert.equal(ok.result().exitCode, 0);
  assert.equal(ok.result().summary, "Nenhum erro encontrado. O sistema de arquivos está íntegro.");
  assert.ok(logEvents.some((m) => m.includes("finalizado em 6m 0s (código 0")), logEvents.join("\n"));

  const killed = await run();
  child.emit("close", null);
  await flush();
  assert.equal(killed.result().ok, false);
  assert.equal(killed.result().exitCode, -1);
  assert.ok(logEvents.some((m) => m.includes("(código nenhum")), logEvents.join("\n"));
});

const fs = require("fs");
const os = require("os");
const path = require("path");
const { findBrokenEntries } = require("../../services/driveRepairService.js");

test("findBrokenEntries: pasta íntegra não acusa nada", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "broken-entries-"));
  try {
    fs.mkdirSync(path.join(root, "Content", "0000000000000000"), { recursive: true });
    fs.writeFileSync(path.join(root, "Content", "0000000000000000", "save.bin"), "x");
    fs.writeFileSync(path.join(root, "launch.ini"), "x");
    assert.deepEqual(await findBrokenEntries(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("findBrokenEntries: entrada listada que não abre é dano; erro de acesso não é", async (t) => {
  const tree = {
    "E:\\": ["Content", "lixo\u0001", "System Volume Information"],
    "E:\\Content": ["perfil"],
    "E:\\Content\\perfil": [],
  };
  const fail = (code) => Object.assign(new Error(code), { code });
  t.mock.method(fs.promises, "readdir", async (dir) => {
    if (dir === "E:\\System Volume Information") throw fail("EPERM");
    return tree[dir];
  });
  t.mock.method(fs.promises, "lstat", async (p) => {
    if (p === "E:\\lixo\u0001") throw fail("ENOENT");
    return { isDirectory: () => true };
  });
  assert.deepEqual(await findBrokenEntries("E:\\"), ["E:\\lixo\u0001 (ENOENT)"]);
});

test("findBrokenEntries: entrada que falha uma vez e abre na reconferência não bloqueia", async (t) => {
  t.mock.method(fs.promises, "readdir", async (dir) => (dir === "E:\\" ? ["face.rx3"] : []));
  let calls = 0;
  t.mock.method(fs.promises, "lstat", async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("x"), { code: "ENOENT" });
    return { isDirectory: () => false };
  });
  assert.deepEqual(await findBrokenEntries("E:\\"), []);
  assert.equal(calls, 2);
});

test("findBrokenEntries: para no limite", async (t) => {
  t.mock.method(fs.promises, "readdir", async () => ["a", "b", "c"]);
  t.mock.method(fs.promises, "lstat", async () => { throw Object.assign(new Error("x"), { code: "UNKNOWN" }); });
  assert.equal((await findBrokenEntries("E:\\", 2)).length, 2);
});
