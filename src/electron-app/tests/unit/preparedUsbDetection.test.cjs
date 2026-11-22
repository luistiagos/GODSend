const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DECLARED_RGH_STORAGE_KEY,
  canSkipPreparation,
  nextStepAfterPreparedUsbScan,
  readPersistedRghDeclaration,
  readPreparedUsbDetection,
  strongestPreparedDeviceState,
  writePersistedRghDeclaration,
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

test("reabertura com declaracao RGH persistida leva direto a tela de pendrive preparado", () => {
  assert.equal(
    nextStepAfterPreparedUsbScan("checking-prepared", "preparado-rgh", false, true),
    "prepared-detected",
  );
  assert.equal(
    nextStepAfterPreparedUsbScan("unlock", "preparado-rgh", false, true),
    "prepared-detected",
  );
  // Descartar para preparar outro pendrive continua respeitado mesmo com RGH declarado.
  assert.equal(
    nextStepAfterPreparedUsbScan("unlock", "preparado-rgh", true, true),
    "unlock",
  );
  // Sem preparacao, declarar RGH nunca autoriza pular.
  assert.equal(
    nextStepAfterPreparedUsbScan("checking-prepared", "jogos-apenas", false, true),
    "unlock",
  );
  // Sem declaracao RGH, pendrive RGH nunca pula automaticamente (protege Bloqueado/LT).
  assert.equal(
    nextStepAfterPreparedUsbScan("checking-prepared", "preparado-rgh", false, false),
    "unlock",
  );
});

test("leitura e gravacao da declaracao RGH persistida toleram armazenamento ausente ou com erro", () => {
  const backing = new Map();
  const storage = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
  };

  assert.equal(readPersistedRghDeclaration(storage), false);
  writePersistedRghDeclaration(true, storage);
  assert.equal(backing.get(DECLARED_RGH_STORAGE_KEY), "1");
  assert.equal(readPersistedRghDeclaration(storage), true);

  writePersistedRghDeclaration(false, storage);
  assert.equal(backing.has(DECLARED_RGH_STORAGE_KEY), false);
  assert.equal(readPersistedRghDeclaration(storage), false);

  assert.equal(readPersistedRghDeclaration(null), false);
  const brokenStorage = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
    removeItem() { throw new Error("SecurityError"); },
  };
  assert.equal(readPersistedRghDeclaration(brokenStorage), false);
  assert.doesNotThrow(() => writePersistedRghDeclaration(true, brokenStorage));
  assert.doesNotThrow(() => writePersistedRghDeclaration(false, brokenStorage));
});
