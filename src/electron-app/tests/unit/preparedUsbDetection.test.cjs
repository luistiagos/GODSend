const assert = require("node:assert/strict");
const test = require("node:test");

const {
  nextStepAfterPreparedUsbScan,
  readPreparedUsbDetection,
} = require("../../services/preparedUsbDetection.js");

test("identifica um pendrive preparado na resposta da enumeracao", () => {
  assert.equal(readPreparedUsbDetection({ ok: true, drives: [{ alreadyPrepared: false }, { alreadyPrepared: true }] }), true);
  assert.equal(readPreparedUsbDetection({ ok: true, drives: [{ alreadyPrepared: false }] }), false);
  assert.equal(readPreparedUsbDetection({ ok: false, drives: [] }), null);
});

test("reconexao leva o assistente aberto para o dispositivo preparado", () => {
  assert.equal(nextStepAfterPreparedUsbScan("checking-prepared", true, false), "prepared-detected");
  assert.equal(nextStepAfterPreparedUsbScan("unlock", true, false), "prepared-detected");
  assert.equal(nextStepAfterPreparedUsbScan("unlock", false, false), "unlock");
});

test("escolha explicita de preparar outro dispositivo nao e interrompida", () => {
  assert.equal(nextStepAfterPreparedUsbScan("unlock", true, true), "unlock");
  assert.equal(nextStepAfterPreparedUsbScan("method", true, false), "method");
});
