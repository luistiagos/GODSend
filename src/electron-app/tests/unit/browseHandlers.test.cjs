const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function createBrowseHandler(backendReply, port = 8097) {
  const handlers = new Map();
  const calls = [];
  const events = [];
  const reports = [];
  const mocks = {
    "../services/settingsService": {
      getConfiguredServerPort: () => port,
      getConfiguredProviderPriority: () => ["huggingface", "ia", "minerva"],
    },
    "../infrastructure/backendHttp": {
      backendGetWithStatus: async (url) => {
        calls.push(url);
        return backendReply();
      },
      backendGet: () => { throw new Error("A listagem precisa conferir o status HTTP"); },
    },
    "../infrastructure/serverLog": { appendAppEvent: (...args) => events.push(args) },
    "../infrastructure/telemetry": { reportError: (...args) => reports.push(args) },
    "../services/coverArtService": {},
    "../services/localGameScannerService": {},
    "../infrastructure/httpHelper": {},
  };
  const filename = path.resolve(__dirname, "../../ipc/browseHandlers.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id);
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  loaded.exports.register({ handle: (name, handler) => handlers.set(name, handler) });
  return {
    browse: (request = { platform: "xbox360", source: "ia" }) => handlers.get("browse:get-games")(null, request),
    calls,
    events,
    reports,
  };
}

test("browse:get-games preserves connection detail and reports context plus original stack", async () => {
  const error = new Error("connect ECONNREFUSED 127.0.0.1:8097");
  const h = createBrowseHandler(() => { throw error; });
  const result = await h.browse();
  assert.equal(result.ok, false);
  assert.deepEqual(result.games, []);
  assert.match(result.error, /ECONNREFUSED/);
  assert.match(result.error, /127\.0\.0\.1:8097\/browse/);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], "BROWSE");
  assert.match(h.events[0][1], /platform=xbox360; source=ia/);
  assert.ok(h.events[0][1].includes(result.error));
  assert.equal(h.reports.length, 1);
  const [component, file, method, message, , logs, terminal] = h.reports[0];
  assert.equal(component, "electron-main");
  assert.equal(file, "browseHandlers.ts");
  assert.equal(method, "browse:get-games");
  assert.equal(message, result.error);
  assert.ok(logs.includes(error.stack));
  assert.match(logs.join("\n"), /platform=xbox360; source=ia; endpoint=http:\/\/127\.0\.0\.1:8097\/browse/);
  assert.equal(terminal, false);
});

test("browse:get-games rejects HTTP errors instead of showing their body as game names", async () => {
  const cases = [
    { status: 400, body: '{"state":"Error","message":"Unknown ROM system: invalid"}', detail: /Unknown ROM system/ },
    { status: 503, body: "servico indisponivel", detail: /servico indisponivel/ },
    { status: 500, body: "", detail: /sem detalhes/ },
    { status: 404, body: "__IA_LOADING__:0/1", detail: /HTTP 404/ },
  ];
  for (const { status, body, detail } of cases) {
    const h = createBrowseHandler(() => ({ status, body }));
    const result = await h.browse();
    assert.equal(result.ok, false);
    assert.deepEqual(result.games, []);
    assert.match(result.error, new RegExp(`HTTP ${status}`));
    assert.match(result.error, detail);
    assert.equal(h.events.length, 1);
    assert.equal(h.reports.length, 1);
  }
});

test("browse:get-games reports JSON error replies even with HTTP 200", async () => {
  for (const body of [
    '{"ok":false,"error":"catalog unavailable"}',
    '{"state":"Error","message":"catalog unavailable"}',
    '{"status":"catalog_unavailable","message":"catalog unavailable"}',
  ]) {
    const h = createBrowseHandler(() => ({ status: 200, body }));
    const result = await h.browse();
    assert.equal(result.ok, false);
    assert.match(result.error, /catalog unavailable/);
    assert.deepEqual(result.games, []);
    assert.equal(h.reports.length, 1);
  }
});

test("browse:get-games preserves lists, empty local catalogs and loading without reporting failures", async () => {
  const cases = [
    ["Halo 3 | Gears of War||", { ok: true, loading: false, games: ["Halo 3", "Gears of War"] }],
    ["", { ok: true, loading: false, games: [] }],
    [" \r\n ", { ok: true, loading: false, games: [] }],
    ["__IA_LOADING__:2/7", { ok: true, loading: true, loaded: "2", total: "7", games: [] }],
  ];
  for (const [body, expected] of cases) {
    const h = createBrowseHandler(() => ({ status: 200, body }));
    assert.deepEqual(await h.browse({ platform: "local" }), expected);
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.reports, []);
    assert.equal(h.calls[0], "/browse?platform=local&priority=huggingface%2Cia%2Cminerva");
  }
});

test("browse:get-games keeps query escaping and succeeds after a failed retry", async () => {
  let failed = true;
  const h = createBrowseHandler(() => {
    if (failed) throw { code: "ETIMEDOUT" };
    return { status: 200, body: "Halo 3" };
  });
  const request = { platform: "rom_mega drive", source: "ia&minerva" };
  const result = await h.browse(request);
  assert.match(result.error, /ETIMEDOUT/);
  failed = false;
  assert.deepEqual(await h.browse(request), { ok: true, loading: false, games: ["Halo 3"] });
  assert.equal(h.calls[1], "/browse?platform=rom_mega%20drive&source=ia%26minerva&priority=huggingface%2Cia%2Cminerva");
  assert.equal(h.reports.length, 1);
});

test("browse:get-games supplies nonempty diagnostics for message-less rejections", async () => {
  for (const thrown of [undefined, null, {}, "", new Error("")]) {
    const h = createBrowseHandler(() => { throw thrown; });
    const result = await h.browse({ platform: "xbox360" });
    assert.equal(result.ok, false);
    assert.ok(result.error.trim().length > 0);
    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0][5][0], /source=unified/);
  }
});
