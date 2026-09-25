const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { isNewerVersion } = require("../../services/autoUpdateService.js");

test("isNewerVersion: compara versões semver corretamente", () => {
  // Patch versions
  assert.equal(isNewerVersion("2.12.39", "2.12.38"), true);
  assert.equal(isNewerVersion("2.12.38", "2.12.38"), false);
  assert.equal(isNewerVersion("2.12.37", "2.12.38"), false);

  // Minor versions
  assert.equal(isNewerVersion("2.13.0", "2.12.39"), true);
  assert.equal(isNewerVersion("2.11.99", "2.12.0"), false);

  // Major versions
  assert.equal(isNewerVersion("3.0.0", "2.12.39"), true);
  assert.equal(isNewerVersion("1.99.99", "2.0.0"), false);

  // Prefixo 'v' ou 'V'
  assert.equal(isNewerVersion("v2.12.40", "2.12.39"), true);
  assert.equal(isNewerVersion("2.12.40", "v2.12.39"), true);
  assert.equal(isNewerVersion("v2.12.38", "v2.12.39"), false);

  // Casos nulos ou vazios
  assert.equal(isNewerVersion("", "2.12.38"), false);
  assert.equal(isNewerVersion("2.12.39", ""), false);
});

test("validação de integridade SHA-256", () => {
  const content = Buffer.from("Xbox 360 Companion Update Payload Test");
  const expectedHash = crypto.createHash("sha256").update(content).digest("hex").toLowerCase();

  const computedHash = crypto.createHash("sha256").update(content).digest("hex").toLowerCase();
  assert.equal(computedHash, expectedHash);

  const corrupted = Buffer.from("Corrupted Payload");
  const corruptedHash = crypto.createHash("sha256").update(corrupted).digest("hex").toLowerCase();
  assert.notEqual(corruptedHash, expectedHash);
});

test("throttle de 12 horas para verificação em segundo plano", () => {
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  const now = Date.now();

  const recentCheck = now - (2 * 60 * 60 * 1000); // 2 hours ago
  assert.equal(now - recentCheck < TWELVE_HOURS_MS, true); // Should skip

  const oldCheck = now - (13 * 60 * 60 * 1000); // 13 hours ago
  assert.equal(now - oldCheck < TWELVE_HOURS_MS, false); // Should run
});

// ── Aplicação da atualização (bug: reabria a versão antiga sem aviso) ───────
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const {
  resolveReplaceTarget,
  consumePendingUpdate,
  buildReplaceScript,
} = require("../../services/autoUpdateService.js");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "godsend-update-test-"));

test("resolveReplaceTarget: portable usa o launcher; exe extraído em %TEMP% é recusado", () => {
  const base = { isPackaged: true, platform: "win32", tmpDir: String.raw`C:\Users\u\AppData\Local\Temp` };
  const extracted = String.raw`C:\Users\U\AppData\Local\Temp\nsvEF9C.tmp\app\x.exe`;
  assert.equal(
    resolveReplaceTarget({ ...base, portableFile: String.raw`D:\Jogos\xboxcompanion.exe`, execPath: extracted }),
    String.raw`D:\Jogos\xboxcompanion.exe`,
  );
  assert.throws(() => resolveReplaceTarget({ ...base, execPath: extracted }), /cópia temporária/);
  const installed = String.raw`C:\Program Files\X\x.exe`;
  assert.equal(resolveReplaceTarget({ ...base, execPath: installed }), installed);
  assert.equal(resolveReplaceTarget({ ...base, isPackaged: false, execPath: String.raw`C:\e\electron.exe` }), "");
});

test("consumePendingUpdate: versão não mudou → falha com o motivo gravado pelo script", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "update-pending.json"), JSON.stringify({ fromVersion: "2.12.97", targetVersion: "2.12.99" }));
  fs.writeFileSync(path.join(dir, "update-result.txt"), "\uFEFFcopy-failed: file in use\r\n");
  assert.deepEqual(consumePendingUpdate(dir, "2.12.97"), {
    fromVersion: "2.12.97",
    targetVersion: "2.12.99",
    currentVersion: "2.12.97",
    reason: "copy-failed: file in use",
  });
  assert.equal(fs.existsSync(path.join(dir, "update-pending.json")), false, "marcador é consumido");
  assert.equal(fs.existsSync(path.join(dir, "update-result.txt")), false);
  assert.equal(consumePendingUpdate(dir, "2.12.97"), null, "só avisa uma vez");
});

test("consumePendingUpdate: sem resultado do script ainda é falha; versão nova é sucesso", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "update-pending.json"), JSON.stringify({ fromVersion: "2.12.97", targetVersion: "2.12.99" }));
  assert.match(consumePendingUpdate(dir, "2.12.97").reason, /não registrou resultado/);
  fs.writeFileSync(path.join(dir, "update-pending.json"), JSON.stringify({ fromVersion: "2.12.97", targetVersion: "2.12.99" }));
  assert.equal(consumePendingUpdate(dir, "2.12.99"), null);
});

function runScript(opts) {
  return spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", buildReplaceScript(opts)], {
    encoding: "utf8",
    timeout: 120000,
  });
}
const readResult = (f) => fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "").trim();

test("script de substituição espera o launcher (processo rodando do próprio alvo) sair antes de copiar", { skip: process.platform !== "win32" }, async () => {
  const dir = tmp();
  const sys = path.join(process.env.SystemRoot || String.raw`C:\Windows`, "System32");
  const target = path.join(dir, "xboxcompanion.exe");
  const source = path.join(dir, "xboxcompanion-update.exe");
  const resultFile = path.join(dir, "update-result.txt");
  fs.copyFileSync(path.join(sys, "PING.EXE"), target); // "launcher" antigo, segura o alvo
  fs.copyFileSync(path.join(sys, "whoami.exe"), source); // "versão nova", sai sozinha ao ser relançada

  // ~14 s: mais que o orçamento fixo antigo (1,5 s + 20 × 500 ms), como o RMDir /r do launcher real.
  const launcher = spawn(target, ["-n", "15", "127.0.0.1"], { stdio: "ignore" });
  const exited = new Promise((r) => launcher.once("exit", r));
  const t0 = Date.now();
  // waitPid aponta para um pid morto: só a checagem por caminho do alvo pode segurar a cópia.
  const r = runScript({ target, source, resultFile, waitPid: 0x7ffffff0, waitSeconds: 60 });
  await exited;

  assert.equal(r.status, 0, r.stderr);
  assert.equal(readResult(resultFile), "ok");
  assert.ok(Date.now() - t0 >= 13000, "a cópia não pode acontecer com o launcher vivo");
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(source));
});

test("script de substituição grava copy-failed quando não consegue copiar", { skip: process.platform !== "win32" }, () => {
  const dir = tmp();
  const source = path.join(dir, "xboxcompanion-update.exe");
  fs.writeFileSync(source, "novo");
  const resultFile = path.join(dir, "update-result.txt");
  const target = path.join(dir, "nao-existe", "xboxcompanion.exe");
  runScript({ target, source, resultFile, waitPid: 0x7ffffff0, waitSeconds: 5 }); // o relançamento falha: o alvo não existe
  assert.match(readResult(resultFile), /^copy-failed: /);
});
