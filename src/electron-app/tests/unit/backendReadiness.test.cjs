const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const { once } = require("node:events");
const settings = require("../../services/settingsService.js");
const readiness = require("../../infrastructure/backendReadiness.js");
const { backendGetWithStatus, backendPost } = require("../../infrastructure/backendHttp.js");

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
