const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const Module = require("node:module");
const net = require("node:net");
const path = require("node:path");
const settings = require("../../services/settingsService.js");
const readiness = require("../../infrastructure/backendReadiness.js");
const { backendGet, backendGetWithStatus, backendPost } = require("../../infrastructure/backendHttp.js");

// A port nobody listens on yet: bind, read it, release it.
async function freePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function listenOn(t, port) {
  const server = http.createServer((req, res) => res.end(req.method === "POST" ? '{"ok":true}' : "Jogo A|Jogo B"));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
}

test("sem backend iniciando a espera resolve na hora", { timeout: 2000 }, async () => {
  readiness.markBackendStopped();
  const started = Date.now();
  await readiness.waitForBackendListening(60000);
  assert.ok(Date.now() - started < 100);
});

test("controle: sem o gate, a porta ainda fechada recusa a conexão", { timeout: 5000 }, async (t) => {
  readiness.markBackendStopped();
  const port = await freePort();
  t.mock.method(settings, "getConfiguredServerPort", () => port);
  await assert.rejects(backendGetWithStatus("/browse?platform=xbox360"), (err) => err.code === "ECONNREFUSED");
});

test("backend iniciando: GET e POST esperam a porta abrir e chegam ao servidor", { timeout: 5000 }, async (t) => {
  const port = await freePort();
  t.mock.method(settings, "getConfiguredServerPort", () => port);
  readiness.markBackendStarting();
  t.after(() => readiness.markBackendStopped());

  const get = backendGetWithStatus("/browse?platform=xbox360");
  const post = backendPost("/queue/retry", { name: "Jogo" });
  // The backend opens the port only after the requests were issued.
  await new Promise((resolve) => setTimeout(resolve, 200));
  await listenOn(t, port);
  readiness.markBackendListening();

  assert.deepEqual(await get, { status: 200, body: "Jogo A|Jogo B" });
  assert.deepEqual(await post, { ok: true });
});

test("a porta lida é a de depois da espera (linha GODSEND_LISTEN_PORT pode trocá-la)", { timeout: 5000 }, async (t) => {
  const requested = await freePort();
  const effective = await freePort();
  let port = requested;
  t.mock.method(settings, "getConfiguredServerPort", () => port);
  readiness.markBackendStarting();
  t.after(() => readiness.markBackendStopped());

  const get = backendGetWithStatus("/browse");
  await listenOn(t, effective);
  port = effective;
  readiness.markBackendListening();
  assert.equal((await get).status, 200);
});

test("processo encerrado libera quem espera, com o erro real", { timeout: 5000 }, async (t) => {
  const port = await freePort();
  t.mock.method(settings, "getConfiguredServerPort", () => port);
  readiness.markBackendStarting();
  const get = backendGetWithStatus("/browse");
  readiness.markBackendStopped();
  await assert.rejects(get, (err) => err.code === "ECONNREFUSED");
});

test("prazo vencido libera a espera sem rejeitar", { timeout: 2000 }, async (t) => {
  readiness.markBackendStarting();
  t.after(() => readiness.markBackendStopped());
  const started = Date.now();
  await readiness.waitForBackendListening(150);
  assert.ok(Date.now() - started >= 140);
});

test("chamadas concorrentes a /browse e /browse/releases esperam juntas pelo bind HTTP", { timeout: 5000 }, async (t) => {
  const port = await freePort();
  t.mock.method(settings, "getConfiguredServerPort", () => port);
  readiness.markBackendStarting();
  t.after(() => readiness.markBackendStopped());

  const browse = backendGetWithStatus("/browse?platform=xbox360&priority=huggingface%2Cia%2Cminerva");
  const releases = backendGet("/browse/releases?platform=xbox360");

  await new Promise((resolve) => setTimeout(resolve, 120));
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/browse/releases")) {
      res.end('{"releases":[{"release_title":"Halo 3","discs":[]}]}');
      return;
    }
    res.end("Halo 3|Gears of War");
  });
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  readiness.markBackendListening();

  assert.deepEqual(await browse, { status: 200, body: "Halo 3|Gears of War" });
  assert.deepEqual(JSON.parse(await releases), { releases: [{ release_title: "Halo 3", discs: [] }] });
});

test("ECONNREFUSED enquanto o backend esta reiniciando reespera a porta abrir", { timeout: 5000 }, async (t) => {
  const closedPort = await freePort();
  const nextPort = await freePort();
  let port = closedPort;
  t.mock.method(settings, "getConfiguredServerPort", () => port);
  readiness.markBackendStopped();
  t.after(() => readiness.markBackendStopped());

  const realGet = http.get;
  let firstAttempt = true;
  t.mock.method(http, "get", (...args) => {
    const req = realGet.apply(http, args);
    if (firstAttempt) {
      firstAttempt = false;
      // Simulate restart starting just as the request fails with ECONNREFUSED.
      readiness.markBackendStarting();
      setTimeout(async () => {
        await listenOn(t, nextPort);
        port = nextPort;
        readiness.markBackendListening();
      }, 80);
    }
    return req;
  });

  const res = await backendGetWithStatus("/browse?platform=xbox360");
  assert.deepEqual(res, { status: 200, body: "Jogo A|Jogo B" });
});

function loadBackendClientHarness({ exeExists = true, configuredPort = 8080 } = {}) {
  const spawned = [];
  let port = configuredPort;
  const fakeChildFactory = () => {
    const proc = new EventEmitter();
    proc.pid = 1000 + spawned.length + 1;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {
      proc.killed = true;
      return true;
    };
    spawned.push(proc);
    return proc;
  };
  const mocks = {
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    child_process: { spawn: () => fakeChildFactory() },
    fs: {
      existsSync: () => exeExists,
    },
    "../infrastructure/fileSystem": {
      getGodsendExePath: () => "C:\\fake\\godsend-backend.exe",
      prepareWritableRuntime: () => "C:\\fake\\runtime",
    },
    "../infrastructure/serverLog": {
      appendBackendSessionStart: () => {},
      appendBackendSessionEnd: () => {},
      appendBackendStdout: () => {},
      appendBackendStderr: () => {},
      appendAppLine: () => {},
      appendAppEvent: () => {},
      getPrimaryIPv4: () => "127.0.0.1",
      getAppVersion: () => "2.12.129",
      getLogInfo: () => ({ logsDirectory: "C:\\fake\\logs" }),
    },
    "./settingsService": {
      getConfiguredTransferFolder: () => "",
      getDefaultTransferFolder: () => "C:\\fake\\Transfer",
      getEffectiveTorrentTempPath: () => "C:\\fake\\Temp\\torrent-dl",
      getConfiguredServerPort: () => port,
      writeConfig: (partial) => {
        if (partial && partial.serverPort) port = partial.serverPort;
      },
      buildGodsendEnv: () => ({}),
    },
    "./iaCookie": { normalizeIACookiePair: (k, v) => `${k}=${v}` },
    "../infrastructure/telemetry": { reportError: () => {} },
    "../infrastructure/backendReadiness": readiness,
  };
  const filename = path.resolve(__dirname, "../../services/backendClient.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id);
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return { client: loaded.exports, spawned, getPort: () => port };
}

test("restartGodsendIfRunning mantem gate fechado durante encerramento lento e reinicia apos close", { timeout: 5000 }, async (t) => {
  const port = await freePort();
  t.mock.method(settings, "getConfiguredServerPort", () => port);
  t.after(() => readiness.markBackendStopped());

  const { client, spawned } = loadBackendClientHarness({ configuredPort: port });
  client.startGodsendSafely();
  assert.equal(spawned.length, 1);
  assert.equal(readiness.isBackendStarting(), true);

  spawned[0].stdout.emit("data", Buffer.from(`[INFO] GODSEND_LISTEN_PORT=${port}\n`));
  assert.equal(readiness.isBackendStarting(), false);

  client.restartGodsendIfRunning();
  assert.equal(spawned[0].killed, true);
  assert.equal(readiness.isBackendStarting(), true);

  const browse = backendGetWithStatus("/browse?platform=xbox360");
  const releases = backendGet("/browse/releases?platform=xbox360");

  // Simulate slow process exit (> 400 ms) — old timer-based restart used to drop the respawn here.
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(spawned.length, 1);
  assert.equal(readiness.isBackendStarting(), true);

  spawned[0].emit("close", 0, "SIGTERM");
  assert.equal(spawned.length, 2, "novo processo sobe imediatamente apos close do antigo");
  assert.equal(readiness.isBackendStarting(), true);

  await listenOn(t, port);
  // Split GODSEND_LISTEN_PORT across chunks to verify line buffering.
  spawned[1].stdout.emit("data", Buffer.from("[INFO] GODSEND_LISTEN_"));
  assert.equal(readiness.isBackendStarting(), true);
  spawned[1].stdout.emit("data", Buffer.from(`PORT=${port}\n`));
  assert.equal(readiness.isBackendStarting(), false);

  assert.deepEqual(await browse, { status: 200, body: "Jogo A|Jogo B" });
  assert.equal(await releases, "Jogo A|Jogo B");

  // Explicit stop cancels restart and releases gate on close.
  client.stopGodsend();
  spawned[1].emit("close", 0, "SIGTERM");
  assert.equal(spawned.length, 2);
  assert.equal(readiness.isBackendStarting(), false);
});

test("binario ausente libera o gate em vez de prender quem espera", { timeout: 2000 }, async () => {
  readiness.markBackendStarting();
  const { client, spawned } = loadBackendClientHarness({ exeExists: false });
  client.startGodsendSafely();
  assert.equal(spawned.length, 0);
  assert.equal(readiness.isBackendStarting(), false);
});
