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
