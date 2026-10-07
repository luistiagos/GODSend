const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  LAUNCHER_FAILURE_LOG,
  consumeLauncherFailures,
  launcherFailureReason,
} = require("../../services/portableLauncherReport.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "godsend-launcher-report-"));

// Linhas no formato que o build/portable.nsi grava (launcherFailed).
const NO_SPACE = "2026-10-06 22:27:31\t2.12.107\tsem-espaco disco=C: livre_mb=782 necessario_mb=1893";
const NOT_STARTED = "2026-10-06 22:44:40\t2.12.107\tnao-iniciou erro=5";

test("consumeLauncherFailures: devolve as tentativas na ordem e consome o registro", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, LAUNCHER_FAILURE_LOG);
  fs.writeFileSync(file, `${NO_SPACE}\r\n${NOT_STARTED}\r\n`);

  assert.deepEqual(consumeLauncherFailures(dir), [NO_SPACE, NOT_STARTED]);
  assert.equal(fs.existsSync(file), false, "o registro é apagado ao ser lido");
  assert.deepEqual(consumeLauncherFailures(dir), [], "a mesma falha não é reportada em todo boot");
});

test("consumeLauncherFailures: sem registro, ou só com linhas em branco, não há o que reportar", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(consumeLauncherFailures(dir), []);
  assert.deepEqual(consumeLauncherFailures(path.join(dir, "pasta-que-nao-existe")), []);

  fs.writeFileSync(path.join(dir, LAUNCHER_FAILURE_LOG), "\r\n  \r\n");
  assert.deepEqual(consumeLauncherFailures(dir), []);
});

test("launcherFailureReason: o motivo é a primeira palavra do terceiro campo", () => {
  assert.equal(launcherFailureReason(NO_SPACE), "sem-espaco");
  assert.equal(launcherFailureReason(NOT_STARTED), "nao-iniciou");
  assert.equal(launcherFailureReason("2026-10-06 22:27:31\t2.12.107\tpacote-nao-gravado"), "pacote-nao-gravado");
  assert.equal(launcherFailureReason("linha fora do formato"), "desconhecido");
});
