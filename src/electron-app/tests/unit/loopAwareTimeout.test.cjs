const assert = require("node:assert/strict");
const test = require("node:test");
const { spawn } = require("node:child_process");

const { setLoopAwareTimeout } = require("../../infrastructure/windowsUsbDeviceService.js");

function blockEventLoop(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy: o mesmo efeito da varredura com fs.*Sync */ }
}

/** A mesma corrida de runPowerShell: o prazo rejeita, o "close" do filho resolve. */
function raceChild(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { windowsHide: true });
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      cancel();
      resolve(outcome);
    };
    const cancel = setLoopAwareTimeout(timeoutMs, () => {
      child.kill();
      finish("timeout");
    });
    child.on("close", () => finish("close"));
  });
}

test("setLoopAwareTimeout: filho que ja terminou vence o prazo vencido com o loop bloqueado", async () => {
  const outcome = raceChild(["-e", ""], 300);
  blockEventLoop(2_500);
  assert.equal(await outcome, "close");
});

test("setLoopAwareTimeout: filho travado continua expirando no prazo", async () => {
  const started = Date.now();
  const outcome = await raceChild(["-e", "setTimeout(() => {}, 10000)"], 300);
  assert.equal(outcome, "timeout");
  assert.ok(Date.now() - started < 2_000, "sem loop bloqueado nao ha folga");
});

test("setLoopAwareTimeout: filho travado com loop bloqueado expira apos uma unica folga", async () => {
  const started = Date.now();
  const outcome = raceChild(["-e", "setTimeout(() => {}, 10000)"], 300);
  blockEventLoop(2_500);
  assert.equal(await outcome, "timeout");
  assert.ok(Date.now() - started < 5_000);
});
