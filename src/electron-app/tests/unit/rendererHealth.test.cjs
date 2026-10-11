const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { watchRendererHealth } = require("../../app/window.js");

function setup({ quitting = false, destroyed = false } = {}) {
  const wc = new EventEmitter();
  wc.reloads = 0;
  wc.reload = () => { wc.reloads++; };
  const win = { webContents: wc, isDestroyed: () => destroyed };
  const logs = [];
  const reports = [];
  const clock = { t: 1_000_000 };
  watchRendererHealth(win, {
    log: (cat, msg) => logs.push(`${cat} ${msg}`),
    report: (component, file, method, message) => reports.push({ component, file, method, message }),
    now: () => clock.t,
    isQuitting: () => quitting,
  });
  return { wc, logs, reports, clock };
}

const crash = (wc, reason = "crashed", exitCode = -1073741819) =>
  wc.emit("render-process-gone", {}, { reason, exitCode });

test("render-process-gone loga, reporta e recarrega a janela", () => {
  const { wc, logs, reports } = setup();
  crash(wc);
  assert.deepEqual(logs, [
    "RENDERER render-process-gone reason=crashed exitCode=-1073741819",
    "RENDERER reloading after render-process-gone",
  ]);
  assert.deepEqual(reports, [{
    component: "electron-main",
    file: "window.ts",
    method: "render-process-gone",
    message: "renderer gone: reason=crashed exitCode=-1073741819",
  }]);
  assert.equal(wc.reloads, 1);
});

test("render-process-gone clean-exit ou durante o Quit loga mas nao reporta nem recarrega", () => {
  const clean = setup();
  crash(clean.wc, "clean-exit", 0);
  assert.deepEqual(clean.logs, ["RENDERER render-process-gone reason=clean-exit exitCode=0"]);
  assert.equal(clean.reports.length, 0);
  assert.equal(clean.wc.reloads, 0);

  const quitting = setup({ quitting: true });
  crash(quitting.wc);
  assert.equal(quitting.reports.length, 0);
  assert.equal(quitting.wc.reloads, 0);
});

test("render-process-gone com janela destruida reporta mas nao recarrega", () => {
  const { wc, reports } = setup({ destroyed: true });
  crash(wc);
  assert.equal(reports.length, 1);
  assert.equal(wc.reloads, 0);
});

test("trava contra laco: no maximo uma recarga a cada 60 s", () => {
  const { wc, logs, clock } = setup();
  crash(wc);
  assert.equal(wc.reloads, 1);

  clock.t += 59_000;
  crash(wc);
  assert.equal(wc.reloads, 1, "segundo crash em menos de 60 s nao recarrega");
  assert.equal(logs.at(-1), "RENDERER not reloading: crash loop");

  clock.t += 61_000;
  crash(wc);
  assert.equal(wc.reloads, 2, "passados 60 s da ultima recarga, recarrega de novo");
});

test("reload que lanca nao escapa do handler", () => {
  const { wc, logs } = setup();
  wc.reload = () => { throw new Error("boom"); };
  assert.doesNotThrow(() => crash(wc));
  assert.equal(logs.at(-1), "RENDERER reload failed: boom");
});

test("unresponsive loga e reporta; responsive loga a duracao", () => {
  const { wc, logs, reports, clock } = setup();
  wc.emit("unresponsive");
  clock.t += 40_000;
  wc.emit("responsive");
  assert.deepEqual(logs, ["RENDERER unresponsive", "RENDERER responsive after 40000 ms"]);
  assert.deepEqual(reports.map((r) => r.message), ["renderer unresponsive"]);
});

test("did-fail-load loga so o frame principal e ignora ERR_ABORTED", () => {
  const { wc, logs } = setup();
  wc.emit("did-fail-load", {}, -3, "ERR_ABORTED", "file:///a", true);
  wc.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "file:///iframe", false);
  wc.emit("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "file:///index.html", true);
  assert.deepEqual(logs, ["RENDERER did-fail-load code=-6 desc=ERR_FILE_NOT_FOUND url=file:///index.html"]);
});

test("console-message loga so nivel error, truncado e com teto por sessao", () => {
  const { wc, logs } = setup();
  const msg = (level, message) => wc.emit("console-message", { level, message, sourceId: "app.js", lineNumber: 7 });

  msg("warning", "aviso");
  msg("info", "info");
  assert.equal(logs.length, 0);

  msg("error", "x".repeat(1000));
  assert.equal(logs[0], `RENDERER console error ${`app.js:7 ${"x".repeat(1000)}`.slice(0, 500)}`);

  for (let i = 0; i < 60; i++) msg("error", `erro ${i}`);
  assert.equal(logs.length, 50, "teto de 50 linhas de console error por sessao");
  assert.equal(logs.at(-1), "RENDERER console error app.js:7 erro 48");
});
