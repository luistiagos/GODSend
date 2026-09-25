const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canSkipPreparation,
  nextStepAfterPreparedUsbScan,
  readPreparedUsbDetection,
  strongestPreparedDeviceState,
} = require("../../services/preparedUsbDetection.js");

test("le o estado mais preparado entre os dispositivos enumerados", () => {
  assert.equal(
    readPreparedUsbDetection({
      ok: true,
      drives: [{ preparedState: "jogos-apenas" }, { preparedState: "preparado-bloqueado-lt" }],
    }),
    "preparado-bloqueado-lt",
  );
  assert.equal(
    readPreparedUsbDetection({ ok: true, drives: [{ preparedState: "sem-preparo" }] }),
    "sem-preparo",
  );
  assert.equal(readPreparedUsbDetection({ ok: false, drives: [] }), null);
  // Versao antiga do campo, ou campo ausente: nunca vira "preparado".
  assert.equal(
    readPreparedUsbDetection({ ok: true, drives: [{ alreadyPrepared: true }, {}] }),
    "sem-preparo",
  );
  assert.equal(strongestPreparedDeviceState(["preparado-rgh", "jogos-apenas"]), "preparado-rgh");
});

test("pular a preparacao exige o perfil do exploit, ou o console RGH declarado", () => {
  assert.equal(canSkipPreparation("preparado-bloqueado-lt"), true);
  // O bug: pendrive so com os jogos baixados, e pendrive preparado em modo RGH num console
  // travado ou LT. Os dois davam "ja preparado" e ofereciam pular a unica etapa que faz o
  // produto funcionar.
  assert.equal(canSkipPreparation("jogos-apenas"), false);
  assert.equal(canSkipPreparation("preparado-rgh"), false);
  assert.equal(canSkipPreparation("preparado-rgh", false), false);
  assert.equal(canSkipPreparation("preparado-rgh", true), true);
  assert.equal(canSkipPreparation("jogos-apenas", true), false);
  assert.equal(canSkipPreparation(undefined), false);
});

test("reconexao leva o assistente aberto para o dispositivo com o desbloqueio", () => {
  assert.equal(
    nextStepAfterPreparedUsbScan("checking-prepared", "preparado-bloqueado-lt", false),
    "prepared-detected",
  );
  assert.equal(
    nextStepAfterPreparedUsbScan("unlock", "preparado-bloqueado-lt", false),
    "prepared-detected",
  );
  assert.equal(nextStepAfterPreparedUsbScan("unlock", "sem-preparo", false), "unlock");
});

test("sem o perfil do exploit o assistente abre na pergunta do modo do console", () => {
  assert.equal(nextStepAfterPreparedUsbScan("checking-prepared", "jogos-apenas", false), "unlock");
  assert.equal(nextStepAfterPreparedUsbScan("checking-prepared", "preparado-rgh", false), "unlock");
  assert.equal(nextStepAfterPreparedUsbScan("unlock", "jogos-apenas", false), "unlock");
  assert.equal(nextStepAfterPreparedUsbScan("unlock", "preparado-rgh", false), "unlock");
});

test("escolha explicita de preparar outro dispositivo nao e interrompida", () => {
  assert.equal(nextStepAfterPreparedUsbScan("unlock", "preparado-bloqueado-lt", true), "unlock");
  assert.equal(nextStepAfterPreparedUsbScan("method", "preparado-bloqueado-lt", false), "method");
});
