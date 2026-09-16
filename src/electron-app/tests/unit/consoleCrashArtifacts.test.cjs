const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  collectConsoleCrashArtifacts,
  describeConsoleCrashArtifacts,
} = require("../../infrastructure/consoleCrashArtifacts.js");

const LOG_DIR = "Aurora/Data/Logs";
const hash = (contents) => crypto.createHash("sha256").update(contents).digest("hex");
const bundled = (name, contents) => ({
  path: name,
  sizeBytes: Buffer.byteLength(contents),
  sha256: hash(contents),
});

/** Prova de que este aplicativo preparou o dispositivo; sem ela nada é lido. */
function markPrepared(root, version = 4) {
  const directory = path.join(root, ".xbox-downloader");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `ready-to-play-v${version}.marker`), "x");
  return root;
}

function fixture(t, prepared = true) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, "companion-console-crash-"));
  if (prepared) markPrepared(root);
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(resolved).startsWith("companion-console-crash-"));
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 });
  });
  return root;
}

function write(root, relativePath, contents, modifiedAtMs) {
  const target = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  if (modifiedAtMs) {
    const seconds = modifiedAtMs / 1000;
    fs.utimesSync(target, seconds, seconds);
  }
  return target;
}

test("entrega os dois vestigios pedidos pelo bug: o dump do DashLaunch e o do Aurora", async (t) => {
  const root = fixture(t);
  write(root, "crashlog.txt", "0xC0000005 em 0x80086134", 1_700_000_300_000);
  write(root, `${LOG_DIR}/20260905010203.crash.log`, "ScnProfileDVD state change", 1_700_000_200_000);
  write(root, `${LOG_DIR}/20260905010203.crash.log.callstack`, "48 quadros", 1_700_000_100_000);

  const collection = await collectConsoleCrashArtifacts(root);

  assert.deepEqual(collection.artifacts.map((artifact) => artifact.path), [
    "crashlog.txt",
    `${LOG_DIR}/20260905010203.crash.log`,
    `${LOG_DIR}/20260905010203.crash.log.callstack`,
  ]);
  assert.equal(collection.artifacts[0].content, "0xC0000005 em 0x80086134");
  assert.equal(collection.artifacts[0].truncated, false);
  assert.equal(collection.bundledCopiesSkipped, 0);
  assert.deepEqual(collection.unreadable, []);
  assert.match(describeConsoleCrashArtifacts(collection), /^crashlog\.txt \(24 bytes, /);
});

test("nao relata como reproducao do usuario a copia do pacote ainda identica ao manifesto", async (t) => {
  const root = fixture(t);
  const foreign = "01:40:45  ScnProfileDVD   An error has occurred";
  const dump = `${LOG_DIR}/20250916014053.crash.log`;
  write(root, dump, foreign);

  const collection = await collectConsoleCrashArtifacts(root, [bundled(dump, foreign)]);

  assert.deepEqual(collection.artifacts, []);
  assert.equal(collection.bundledCopiesSkipped, 1);
});

test("o debug.log que o console alterou volta como artefato, porque deixa de conferir", async (t) => {
  const root = fixture(t);
  const original = "linhas que vieram no pacote\n";
  const onDevice = `${original}Xbox 360 Companion: caminhos recadastrados sem reiniciar\n`;
  write(root, `${LOG_DIR}/debug.log`, onDevice);

  const collection = await collectConsoleCrashArtifacts(root, [
    bundled(`${LOG_DIR}/debug.log`, original),
  ]);

  assert.equal(collection.bundledCopiesSkipped, 0);
  assert.equal(collection.artifacts.length, 1);
  assert.match(collection.artifacts[0].content, /caminhos recadastrados sem reiniciar/);
});

test("um arquivo do mesmo tamanho com outro conteudo nao passa por copia do pacote", async (t) => {
  const root = fixture(t);
  const dump = `${LOG_DIR}/20250916014053.crash.log`;
  write(root, dump, "BBBBBBBB");

  const collection = await collectConsoleCrashArtifacts(root, [bundled(dump, "AAAAAAAA")]);

  assert.equal(collection.bundledCopiesSkipped, 0);
  assert.equal(collection.artifacts.length, 1);
});

test("corta o debug.log pelo fim e o crash dump pelo comeco", async (t) => {
  const root = fixture(t);
  const filler = "x".repeat(100 * 1024);
  write(root, `${LOG_DIR}/debug.log`, `INICIO${filler}FIM`, 1_700_000_200_000);
  write(root, `${LOG_DIR}/20260905010203.crash.log`, `INICIO${filler}FIM`, 1_700_000_100_000);

  const collection = await collectConsoleCrashArtifacts(root);
  const [debugLog, crashLog] = collection.artifacts;

  assert.equal(debugLog.path, `${LOG_DIR}/debug.log`);
  assert.equal(debugLog.truncated, true);
  assert.ok(debugLog.content.endsWith("FIM"));
  assert.equal(crashLog.truncated, true);
  assert.ok(crashLog.content.startsWith("INICIO"));
  for (const artifact of collection.artifacts) {
    assert.ok(Buffer.byteLength(artifact.content) <= 64 * 1024);
  }
});

test("um pendrive que nunca chegou ao console nao produz artefato nem erro", async (t) => {
  const root = fixture(t);

  const collection = await collectConsoleCrashArtifacts(root, [bundled("crashlog.txt", "x")]);

  assert.deepEqual(collection.artifacts, []);
  assert.deepEqual(collection.unreadable, []);
  assert.equal(collection.bundledCopiesSkipped, 0);
});

test("mantem so os registros mais recentes quando a pasta acumulou muitos dumps", async (t) => {
  const root = fixture(t);
  for (let index = 0; index < 20; index++) {
    write(root, `${LOG_DIR}/2026090501${String(index).padStart(4, "0")}.crash.log`, `dump ${index}`,
      1_700_000_000_000 + index * 1000);
  }

  const collection = await collectConsoleCrashArtifacts(root);

  assert.equal(collection.artifacts.length, 12);
  assert.equal(collection.artifacts[0].content, "dump 19");
  assert.equal(collection.artifacts[11].content, "dump 8");
});

test("a leitura exige a raiz absoluta do dispositivo", async () => {
  await assert.rejects(() => collectConsoleCrashArtifacts("relativo"), /raiz absoluta/);
});

test("nao le nada de um dispositivo que este aplicativo nao preparou", async (t) => {
  const root = fixture(t, false);
  write(root, "crashlog.txt", "log de outra origem, nao nosso");
  write(root, `${LOG_DIR}/20260905010203.crash.log`, "dump de outra origem");

  const collection = await collectConsoleCrashArtifacts(root);

  assert.deepEqual(collection.artifacts, []);
  assert.deepEqual(collection.unreadable, []);
});

test("aceita o marcador deixado por uma preparacao anterior, que e quem tem o dump", async (t) => {
  const root = fixture(t, false);
  markPrepared(root, 3);
  write(root, "crashlog.txt", "0xC0000005");

  const collection = await collectConsoleCrashArtifacts(root);

  assert.deepEqual(collection.artifacts.map((artifact) => artifact.path), ["crashlog.txt"]);
});

test("recusa a pasta de logs redirecionada por junction para fora do dispositivo", async (t) => {
  const root = fixture(t);
  const outside = path.join(root, "fora-do-dispositivo");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "segredo.crash.log"), "conteudo do disco local");
  fs.mkdirSync(path.join(root, "Aurora", "Data"), { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(root, "Aurora", "Data", "Logs"), "junction");
  } catch {
    t.skip("o ambiente não permite criar junction");
    return;
  }

  const collection = await collectConsoleCrashArtifacts(root);

  assert.deepEqual(collection.artifacts, []);
});

test("recusa o marcador quando a propria pasta .xbox-downloader e uma junction", async (t) => {
  const root = fixture(t, false);
  const outside = path.join(root, "fora");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "ready-to-play-v4.marker"), "x");
  try {
    fs.symlinkSync(outside, path.join(root, ".xbox-downloader"), "junction");
  } catch {
    t.skip("o ambiente não permite criar junction");
    return;
  }
  write(root, "crashlog.txt", "0xC0000005");

  const collection = await collectConsoleCrashArtifacts(root);

  assert.deepEqual(collection.artifacts, []);
});
