// O launcher do portátil (build/portable.nsi), compilado de verdade pelo
// scripts/build-portable.js sobre um app de mentira e executado com /S, que
// tira a janela e as caixas de aviso mas mantém as decisões. O template do
// electron-builder, que o gancho substitui, não tem nenhuma delas: sem espaço,
// com o pacote danificado ou com o app bloqueado ele simplesmente não abria.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { LAUNCHER_FAILURE_LOG } = require("../../services/portableLauncherReport.js");

const appDir = path.join(__dirname, "..", "..");
const appExeName = `${require(path.join(appDir, "package.json")).build.executableName}.exe`;
const windowsOnly = { skip: process.platform !== "win32" && "o launcher é um executável do Windows" };

const root = fs.mkdtempSync(path.join(os.tmpdir(), "xc-launcher-"));
test.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));

// Empacota `<root>/<name>-app` como o build de release empacota o app real.
const built = new Map();
function buildLauncher(name, writeAppExe) {
  if (built.has(name)) return built.get(name);
  const app = path.join(root, `${name}-app`);
  const out = path.join(root, `${name}-out`);
  fs.mkdirSync(path.join(app, "resources"), { recursive: true });
  writeAppExe(path.join(app, appExeName));
  // Aleatório para não comprimir: o .7z fica com um miolo que dá para danificar.
  fs.writeFileSync(path.join(app, "resources", "app.asar"), crypto.randomBytes(2 * 1024 * 1024));

  const r = spawnSync(
    process.execPath,
    [path.join(appDir, "scripts", "build-portable.js"), "--x64", "--", "--prepackaged", app, `-c.directories.output=${out}`],
    { cwd: appDir, encoding: "utf8", timeout: 300000 },
  );
  assert.equal(r.status, 0, `build do launcher falhou:\n${r.stdout}\n${r.stderr}`);
  const exe = fs.readdirSync(out).find((f) => /-x64\.exe$/.test(f));
  assert.ok(exe, `nenhum .exe em ${out}`);
  built.set(name, path.join(out, exe));
  return built.get(name);
}

// `cmd.exe /c exit N` faz as vezes do app: sai com o código pedido.
const cmdExe = path.join(process.env.SystemRoot || String.raw`C:\Windows`, "System32", "cmd.exe");
const workingLauncher = () => buildLauncher("ok", (exe) => fs.copyFileSync(cmdExe, exe));

// Roda uma cópia do launcher numa pasta só dele (o registro de falhas fica ao
// lado do .exe) e com o %TEMP% isolado.
function runLauncher(launcher, args, env = {}) {
  const dir = fs.mkdtempSync(path.join(root, "run-"));
  const exe = path.join(dir, "xboxcompanion.exe");
  const temp = path.join(dir, "temp");
  fs.copyFileSync(launcher, exe);
  fs.mkdirSync(temp);
  const r = spawnSync(exe, ["/S", ...args], {
    env: { ...process.env, TEMP: temp, TMP: temp, ...env },
    timeout: 120000,
    windowsHide: true,
  });
  const log = path.join(dir, "godsend-data", LAUNCHER_FAILURE_LOG);
  return {
    status: r.status,
    failures: fs.existsSync(log) ? fs.readFileSync(log, "latin1") : "",
    leftInTemp: fs.readdirSync(temp),
  };
}

test("launcher: abre o app, repassa argumentos e código de saída e não deixa nada no %TEMP%", windowsOnly, () => {
  const r = runLauncher(workingLauncher(), ["/c", "exit", "7"]);
  assert.equal(r.status, 7);
  assert.equal(r.failures, "");
  assert.deepEqual(r.leftInTemp, []);
});

test("launcher: sem espaço no disco do %TEMP%, recusa antes de extrair e registra quanto falta", windowsOnly, () => {
  const r = runLauncher(workingLauncher(), ["/c", "exit", "7"], { XBOX360COMPANION_LAUNCHER_EXTRA_MB: "99999999" });
  assert.equal(r.status, 2, "o app não pode ter sido iniciado");
  const m = /^\d{4}-\d+-\d+ \d+:\d+:\d+\t\d+\.\d+\.\d+\tsem-espaco disco=[A-Z]: livre_mb=(\d+) necessario_mb=(\d+)\r\n$/.exec(r.failures);
  assert.ok(m, `registro inesperado: ${JSON.stringify(r.failures)}`);
  assert.ok(Number(m[1]) < Number(m[2]));
  assert.deepEqual(r.leftInTemp, []);
});

test("launcher: pacote danificado não vira um app pela metade em execução", windowsOnly, () => {
  const damaged = path.join(root, "damaged.exe");
  const bytes = fs.readFileSync(workingLauncher());
  const sevenZip = bytes.indexOf(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
  assert.ok(sevenZip > 0, "pacote .7z não encontrado dentro do launcher");
  // 256 KB zerados no meio do pacote; o tamanho do arquivo não muda.
  const middle = sevenZip + Math.floor((bytes.length - sevenZip) / 2);
  bytes.fill(0, middle, middle + 256 * 1024);
  fs.writeFileSync(damaged, bytes);

  const r = runLauncher(damaged, ["/c", "exit", "7"]);
  assert.equal(r.status, 2, "o app não pode ter sido iniciado");
  assert.match(r.failures, /\textracao-incompleta extraido_kb=\d+ esperado_kb=\d+\r\n$/);
  assert.deepEqual(r.leftInTemp, []);
});

test("launcher: app que o Windows não consegue iniciar é registrado com o erro do sistema", windowsOnly, () => {
  const launcher = buildLauncher("not-an-exe", (exe) => fs.writeFileSync(exe, "isto não é um executável\r\n"));
  const r = runLauncher(launcher, []);
  assert.equal(r.status, 2);
  assert.match(r.failures, /\tnao-iniciou erro=\d+\r\n$/);
  assert.deepEqual(r.leftInTemp, []);
});
