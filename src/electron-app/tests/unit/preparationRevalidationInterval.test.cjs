const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");

const usbDevices = require("../../infrastructure/windowsUsbDeviceService.js");
const {
  createThrottledUsbTargetRevalidator,
  revalidationIntervalFor,
} = require("../../services/fixedBadAvatarPreparationService.js");

// Bug electron-main-preparo-em-pc-lento-para-a-copia-a-cada-revalidacao-usb-e-a-fisica-de-hd-entra-
// em-toda-revalidacao: a copia espera cada revalidacao completa, e com intervalo fixo de 10 s num PC
// em que ela leva ~7 s, ~40% do preparo era espera por PowerShell.
test("revalidationIntervalFor: 10 s em PC rapido, 4 x a ultima validacao em PC lento, teto de 30 s", () => {
  assert.equal(revalidationIntervalFor(0), 10_000);
  assert.equal(revalidationIntervalFor(500), 10_000);
  assert.equal(revalidationIntervalFor(7_000), 28_000);
  assert.equal(revalidationIntervalFor(20_000), 30_000);
});

/** Relogio e validacao completa falsos; cada validacao "leva" `validationMs` do relogio. */
function harness(t, validationMs) {
  const state = { clock: 1_000_000, validations: 0, accessible: true };
  t.mock.method(Date, "now", () => state.clock);
  t.mock.method(fs.promises, "access", async () => {
    if (!state.accessible) throw Object.assign(new Error("no such drive"), { code: "ENOENT" });
  });
  t.mock.method(usbDevices, "requireSafeWindowsUsbTarget", async () => {
    state.validations++;
    await new Promise((resolve) => setImmediate(resolve));
    state.clock += validationMs;
    return {};
  });
  return state;
}

test("revalidador: validacao de 7 s espaca a proxima para 28 s depois do fim", async (t) => {
  const state = harness(t, 7_000);
  const revalidate = createThrottledUsbTargetRevalidator("E:\\", "a".repeat(64));

  await revalidate();
  assert.equal(state.validations, 1);
  const endedAt = state.clock;

  state.clock = endedAt + 20_000;
  await revalidate();
  assert.equal(state.validations, 1, "aos 20 s a copia nao deve parar por outra validacao");

  state.clock = endedAt + 29_000;
  await revalidate();
  assert.equal(state.validations, 2);
});

test("revalidador: validacao rapida continua a cada 10 s, e chamadas simultaneas dividem uma so", async (t) => {
  const state = harness(t, 500);
  const revalidate = createThrottledUsbTargetRevalidator("E:\\", "a".repeat(64));

  await Promise.all([revalidate(), revalidate()]);
  assert.equal(state.validations, 1);
  const endedAt = state.clock;

  state.clock = endedAt + 9_000;
  await revalidate();
  assert.equal(state.validations, 1);

  state.clock = endedAt + 10_000;
  await revalidate();
  assert.equal(state.validations, 2);
});

test("revalidador: pendrive inacessivel lanca a cada chamada e zera o intervalo", async (t) => {
  const state = harness(t, 7_000);
  const revalidate = createThrottledUsbTargetRevalidator("E:\\", "a".repeat(64));

  await revalidate();
  assert.equal(state.validations, 1);

  state.accessible = false;
  await assert.rejects(revalidate(), /não está acessível/);
  assert.equal(state.validations, 1);

  // Voltou: a validacao completa roda de novo na hora, sem esperar o intervalo.
  state.accessible = true;
  await revalidate();
  assert.equal(state.validations, 2);
});
