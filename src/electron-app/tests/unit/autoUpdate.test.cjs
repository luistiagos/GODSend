const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { isNewerVersion, selectManifestBuild } = require("../../services/autoUpdateService.js");

// ── Arquitetura (bug: cópia 32 bits se atualizaria para o x64) ──────────────
const X64_URL = "https://versions.digitalstoregames.com/XBOX360Companion/xboxcompanion.exe?v=2.12.109";
const IA32_URL = "https://versions.digitalstoregames.com/XBOX360Companion/xboxcompanion32.exe?v=2.12.109";
const manifestX64Only = {
  version: "2.12.109",
  downloadUrl: X64_URL,
  portableUrl: X64_URL,
  sha256: "aa",
  size: 10,
};

test("selectManifestBuild: cópia 32 bits usa só o bloco ia32", () => {
  const manifest = {
    ...manifestX64Only,
    ia32: { version: "2.12.109", downloadUrl: IA32_URL, sha256: "bb", size: 9 },
  };
  const build = selectManifestBuild(manifest, "ia32");
  assert.equal(build.downloadUrl, IA32_URL);
  assert.equal(build.sha256, "bb");
  assert.equal(build.size, 9);
});

test("selectManifestBuild: cópia 32 bits sem bloco ia32 não atualiza, nunca recebe o x64", () => {
  assert.equal(selectManifestBuild(manifestX64Only, "ia32"), null);
  assert.equal(selectManifestBuild({ ...manifestX64Only, ia32: { version: "2.12.109" } }, "ia32"), null);
});

test("selectManifestBuild: x64 continua nos campos de topo e ignora o bloco ia32", () => {
  const manifest = {
    ...manifestX64Only,
    ia32: { version: "2.12.200", downloadUrl: IA32_URL, sha256: "bb", size: 9 },
  };
  const build = selectManifestBuild(manifest, "x64");
  assert.equal(build.version, "2.12.109");
  assert.equal(build.downloadUrl, X64_URL);
  assert.equal(build.sha256, "aa");
  // Manifesto antigo só com portableUrl continua servindo o x64.
  const legacy = { version: "2.12.107", portableUrl: X64_URL };
  assert.equal(selectManifestBuild(legacy, "x64").downloadUrl, X64_URL);
});

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
  assert.match(consumePendingUpdate(dir, "2.12.97").reason, /não chegou a rodar/);
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

// ── Disparo da troca (bug: script de substituição não registrava resultado) ──
const { buildReplaceLaunch } = require("../../services/autoUpdateService.js");
const SVC = path.join(__dirname, "..", "..", "services", "autoUpdateService.js");
const tryResult = (f) => {
  try {
    return readResult(f);
  } catch {
    return "";
  }
};
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fn();
}
function fakeUpdate() {
  // Acento, espaço e parênteses como no campo (report 8839: "Downloads\xboxcompanion (2).exe").
  const dir = path.join(tmp(), "Downloads João");
  fs.mkdirSync(dir);
  const sys = path.join(process.env.SystemRoot || String.raw`C:\Windows`, "System32");
  const target = path.join(dir, "xboxcompanion (2).exe");
  const source = path.join(dir, "xboxcompanion-update.exe");
  fs.copyFileSync(path.join(sys, "PING.EXE"), target);
  fs.copyFileSync(path.join(sys, "whoami.exe"), source);
  return { dir, sys, target, source, resultFile: path.join(dir, "update-result.txt") };
}

test("buildReplaceLaunch: cmd destacado faz start do PowerShell com -File; nunca -Command", () => {
  const ps1 = String.raw`C:\Users\João\godsend-data\update-replace.ps1`;
  const { file, args, options } = buildReplaceLaunch(ps1);
  assert.match(path.win32.basename(file), /^cmd\.exe$/i);
  assert.deepEqual(args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(args.length, 4);
  const line = args[3];
  assert.ok(line.startsWith('"start "" /min "'), line);
  assert.ok(line.endsWith(`-File "${ps1}""`), line);
  assert.match(line, /powershell\.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File /i);
  assert.doesNotMatch(line, /-Command/);
  assert.equal(options.detached, true);
  assert.equal(options.stdio, "ignore");
  assert.equal(options.windowsVerbatimArguments, true);
  assert.equal(options.cwd, path.dirname(ps1), "fora da pasta extraída que o launcher apaga");
});

test("consumePendingUpdate: 'started' sem desfecho = script interrompido; o .ps1 da troca é apagado", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "update-pending.json"), JSON.stringify({ fromVersion: "2.12.103", targetVersion: "2.12.104" }));
  fs.writeFileSync(path.join(dir, "update-result.txt"), "\uFEFFstarted\r\n");
  fs.writeFileSync(path.join(dir, "update-replace.ps1"), "x");
  assert.match(consumePendingUpdate(dir, "2.12.103").reason, /começou mas não terminou/);
  assert.equal(fs.existsSync(path.join(dir, "update-replace.ps1")), false);
});

test("script de substituição grava 'started' antes de esperar o processo", { skip: process.platform !== "win32" }, async () => {
  const { sys, target, source, resultFile } = fakeUpdate();
  const holder = spawn(path.join(sys, "PING.EXE"), ["-n", "6", "127.0.0.1"], { stdio: "ignore" }); // ~5 s
  let holderAlive = true;
  holder.once("exit", () => (holderAlive = false));
  const script = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", buildReplaceScript({ target, source, resultFile, waitPid: holder.pid, waitSeconds: 30 })], { stdio: "ignore" });
  const scriptExit = new Promise((r) => script.once("exit", r));

  const first = await waitFor(() => tryResult(resultFile), 15000);
  assert.equal(first, "started");
  assert.equal(holderAlive, true, "o carimbo tem de existir durante a espera");
  assert.equal(await scriptExit, 0);
  assert.equal(readResult(resultFile), "ok");
});

test("disparo da troca sobrevive ao processo que o lançou saindo na hora", { skip: process.platform !== "win32" }, async () => {
  const { dir, target, source, resultFile } = fakeUpdate();
  // O filho faz o que applyUpdateAndRestart faz: startReplaceScript e sai no "spawn" (app.quit()).
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const svc = require(process.env.SVC);
       const o = JSON.parse(process.env.REPLACE_OPTS);
       svc.startReplaceScript(o.scriptFile, svc.buildReplaceScript({ ...o, waitPid: process.pid }))
         .then(() => process.exit(0), (e) => { console.error(e && e.stack || e); process.exit(1); });`,
    ],
    {
      env: {
        ...process.env,
        SVC,
        REPLACE_OPTS: JSON.stringify({ target, source, resultFile, waitSeconds: 60, scriptFile: path.join(dir, "update-replace.ps1") }),
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  assert.equal(await new Promise((r) => child.once("exit", r)), 0, stderr);

  assert.equal(await waitFor(() => tryResult(resultFile) === "ok", 30000), true, `resultado: "${tryResult(resultFile)}"`);
  assert.deepEqual(fs.readFileSync(target), fs.readFileSync(source));
});
