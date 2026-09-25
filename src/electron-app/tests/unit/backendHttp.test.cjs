const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter, once } = require("node:events");
const settings = require("../../services/settingsService.js");
const { backendGet, backendGetWithStatus, backendPost } = require("../../infrastructure/backendHttp.js");

async function listen(t, handler) {
  const server = http.createServer(handler);
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  t.mock.method(settings, "getConfiguredServerPort", () => port);
  return { server, port };
}

test("GET e POST alcançam o listener IPv4 e preservam os contratos das respostas", { timeout: 5000 }, async (t) => {
  const requests = [];
  const { port } = await listen(t, (req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      requests.push({ host: req.headers.host, path: req.url, method: req.method, body });
      if (req.method === "POST") {
        res.end('{"ok":true}');
      } else {
        res.writeHead(503);
        res.end('{"state":"Error","message":"catalogo indisponivel"}');
      }
    });
  });
  const body = '{"state":"Error","message":"catalogo indisponivel"}';
  assert.deepEqual(await backendGetWithStatus("/browse?platform=xbox360"), { status: 503, body });
  assert.equal(await backendGet("/status"), body);
  assert.deepEqual(await backendPost("/queue/retry", { name: "Jogo" }), { ok: true });
  assert.deepEqual(requests, [
    { host: `127.0.0.1:${port}`, path: "/browse?platform=xbox360", method: "GET", body: "" },
    { host: `127.0.0.1:${port}`, path: "/status", method: "GET", body: "" },
    { host: `127.0.0.1:${port}`, path: "/queue/retry", method: "POST", body: '{"name":"Jogo"}' },
  ]);
});

test("recusa de conexão mantém código, endereço e porta no diagnóstico de GET e POST", { timeout: 5000 }, async (t) => {
  const { server, port } = await listen(t, (_req, res) => res.end());
  await new Promise((resolve) => server.close(resolve));
  for (const request of [() => backendGetWithStatus("/browse"), () => backendPost("/queue/retry", {})]) {
    await assert.rejects(request(), (err) => {
      assert.equal(err.code, "ECONNREFUSED");
      assert.equal(err.address, "127.0.0.1");
      assert.equal(err.port, port);
      assert.equal(err.cause.code, "ECONNREFUSED");
      assert.match(err.message, /ECONNREFUSED/);
      assert.ok(err.message.includes(`127.0.0.1:${port}`));
      return true;
    });
  }
});

for (const [method, request, timeoutMs] of [
  ["get", () => backendGetWithStatus("/browse"), 120000],
  ["request", () => backendPost("/queue/retry", {}, 2500), 2500],
]) {
  test(`${method}: timeout mantém o motivo mesmo quando destroy emite ECONNRESET`, async (t) => {
    t.mock.method(settings, "getConfiguredServerPort", () => 18080);
    let destroyed = false;
    t.mock.method(http, method, () => {
      const req = new EventEmitter();
      req.setTimeout = (duration, callback) => {
        assert.equal(duration, timeoutMs);
        queueMicrotask(callback);
        return req;
      };
      req.destroy = () => {
        destroyed = true;
        req.emit("error", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
      };
      req.write = () => {};
      req.end = () => {};
      return req;
    });
    await assert.rejects(request(), (err) => {
      assert.equal(err.code, "ETIMEDOUT");
      assert.equal(err.address, "127.0.0.1");
      assert.equal(err.port, 18080);
      assert.equal(err.timeoutMs, timeoutMs);
      assert.ok(err.message.includes(`${timeoutMs / 1000}s`));
      assert.match(err.message, /127\.0\.0\.1:18080/);
      return true;
    });
    assert.equal(destroyed, true);
  });

  test(`${method}: resposta interrompida rejeita com diagnóstico em vez de deixar a consulta pendente`, { timeout: 5000 }, async (t) => {
    const { port } = await listen(t, (_req, res) => {
      res.writeHead(200, { "Content-Length": "1000" });
      res.write('{"ok":');
      setTimeout(() => res.destroy(), 20);
    });
    await assert.rejects(request(), (err) => {
      assert.equal(err.code, "ECONNRESET");
      assert.ok(err.message.includes(`127.0.0.1:${port}`));
      return true;
    });
  });
}
