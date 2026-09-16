const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const serverLog = require("../../infrastructure/serverLog.js");

// A pasta de logs e opcional. Quando ela some no meio da execucao (Downloads
// redirecionado para um volume que caiu, sincronizacao em nuvem, limpeza de
// terceiros), o mkdirSync lanca ENOENT. Isso nunca pode derrubar o app: quem
// so quer saber ONDE ficam os logs (getLogInfo) nao pode fazer I/O, e quem
// grava tem que engolir a falha.
function withFailingMkdir(run) {
  const realMkdir  = fs.mkdirSync;
  const realAppend = fs.appendFileSync;
  const realError  = console.error;
  const boom = () => {
    const err = new Error("ENOENT: no such file or directory, mkdir 'Q:\\x\\logs'");
    err.code = "ENOENT";
    throw err;
  };
  fs.mkdirSync      = boom;
  fs.appendFileSync = boom;
  console.error     = () => {};
  try {
    return run();
  } finally {
    fs.mkdirSync      = realMkdir;
    fs.appendFileSync = realAppend;
    console.error     = realError;
  }
}

test("getLogInfo devolve os caminhos sem tocar no disco", () => {
  const info = withFailingMkdir(() => serverLog.getLogInfo());

  assert.ok(info.logsDirectory.length > 0);
  assert.ok(info.currentLogFile.startsWith(info.logsDirectory));
  assert.match(info.currentLogFile, /godsend-server-\d{4}-\d{2}-\d{2}\.log$/);
});

test("as funcoes de gravacao nao lancam quando a pasta de logs falha", () => {
  withFailingMkdir(() => {
    assert.doesNotThrow(() => serverLog.appendAppLine("linha de teste"));
    assert.doesNotThrow(() => serverLog.appendAppEvent("LIFECYCLE", "evento de teste"));
    assert.doesNotThrow(() => serverLog.appendBackendStdout("stdout de teste"));
    assert.doesNotThrow(() => serverLog.appendBackendStderr("stderr de teste"));
    assert.doesNotThrow(() => serverLog.appendBackendSessionStart({ appVersion: "0.0.0" }));
    assert.doesNotThrow(() => serverLog.appendBackendSessionEnd("test", 0, null));
  });
});

test("openLogsFolder reporta o erro em vez de lancar", () => {
  const res = withFailingMkdir(() => serverLog.openLogsFolder());

  assert.equal(res.ok, false);
  assert.match(res.error, /ENOENT/);
});
