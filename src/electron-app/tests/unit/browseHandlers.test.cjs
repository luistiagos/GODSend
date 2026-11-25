const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function createBrowseHandler(backendReply, port = 8097, releasesReply = null) {
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
      backendGet: async (url) => {
        if (!releasesReply) throw new Error("A listagem precisa conferir o status HTTP");
        calls.push(url);
        return releasesReply();
      },
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
    releaseGroups: (platform = "xbox360") => handlers.get("browse:get-release-groups")(null, { platform }),
    calls,
    events,
    reports,
  };
}

test("browse:get-games sends friendly message to UI while preserving connection detail in logs and telemetry", async () => {
  const error = new Error("connect ECONNREFUSED 127.0.0.1:8097");
  const h = createBrowseHandler(() => { throw error; });
  const result = await h.browse();
  assert.equal(result.ok, false);
  assert.deepEqual(result.games, []);
  assert.ok(!result.error.includes("ECONNREFUSED"), `technical code leaked to UI: ${result.error}`);
  assert.ok(!result.error.includes("127.0.0.1"), `internal host leaked to UI: ${result.error}`);
  assert.match(result.error, /Tentar de novo/i);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], "BROWSE");
  assert.match(h.events[0][1], /platform=xbox360; source=ia/);
  assert.match(h.events[0][1], /ECONNREFUSED/);
  assert.match(h.events[0][1], /127\.0\.0\.1:8097\/browse/);
  assert.equal(h.reports.length, 1);
  const [component, file, method, message, , logs, terminal] = h.reports[0];
  assert.equal(component, "electron-main");
  assert.equal(file, "browseHandlers.ts");
  assert.equal(method, "browse:get-games");
  assert.match(message, /ECONNREFUSED/);
  assert.match(message, /127\.0\.0\.1:8097\/browse/);
  assert.ok(logs.includes(error.stack));
  assert.match(logs.join("\n"), /platform=xbox360; source=ia; endpoint=http:\/\/127\.0\.0\.1:8097\/browse/);
  assert.equal(terminal, false);
});

test("browse:get-games rejects HTTP errors with friendly UI error while logging/reporting technical detail", async () => {
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
    assert.ok(!/HTTP \d{3}/.test(result.error), `HTTP status leaked to UI: ${result.error}`);
    assert.match(result.error, /Tentar de novo/i);
    assert.equal(h.events.length, 1);
    assert.match(h.events[0][1], new RegExp(`HTTP ${status}`));
    assert.match(h.events[0][1], detail);
    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0][3], new RegExp(`HTTP ${status}`));
    assert.match(h.reports[0][3], detail);
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
    assert.ok(result.error.length > 0);
    assert.match(result.error, /Tentar de novo/i);
    assert.deepEqual(result.games, []);
    assert.equal(h.reports.length, 1);
    assert.match(h.reports[0][3], /catalog unavailable/);
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
  assert.ok(!result.error.includes("ETIMEDOUT"), `technical code leaked to UI: ${result.error}`);
  assert.match(result.error, /Tentar de novo/i);
  failed = false;
  assert.deepEqual(await h.browse(request), { ok: true, loading: false, games: ["Halo 3"] });
  assert.equal(h.calls[1], "/browse?platform=rom_mega%20drive&source=ia%26minerva&priority=huggingface%2Cia%2Cminerva");
  assert.equal(h.reports.length, 1);
  assert.match(h.reports[0][3], /ETIMEDOUT/);
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

// The queue dialog keeps every download button disabled until the disc grouping arrives, so a
// failure of this call blocks the whole catalog. It used to reach only the local log.
test("browse:get-release-groups reports technical failure to telemetry while giving friendly UI message", async () => {
  const error = new Error("ETIMEDOUT: o servidor local nao respondeu em 120s");
  const failing = createBrowseHandler(() => { throw new Error("unused"); }, 8097, () => { throw error; });
  const result = await failing.releaseGroups();
  assert.equal(result.ok, false);
  assert.deepEqual(result.releases, []);
  assert.ok(!result.error.includes("ETIMEDOUT"), `technical code leaked to UI: ${result.error}`);
  assert.match(result.error, /Aguarde alguns segundos|Tentar de novo|reinicie/i);
  assert.equal(failing.events.length, 1);
  assert.equal(failing.reports.length, 1);
  const [component, file, method, message, , logs, terminal] = failing.reports[0];
  assert.equal(component, "electron-main");
  assert.equal(file, "browseHandlers.ts");
  assert.equal(method, "browse:get-release-groups");
  assert.equal(message, error.message);
  assert.deepEqual(logs, ["platform=xbox360", error.stack]);
  assert.equal(terminal, false);

  const ok = createBrowseHandler(() => { throw new Error("unused"); }, 8097,
    () => JSON.stringify({ releases: [{ release_title: "Halo", discs: [] }] }));
  assert.deepEqual(await ok.releaseGroups(), { ok: true, releases: [{ release_title: "Halo", discs: [] }] });
  assert.equal(ok.calls[0], "/browse/releases?platform=xbox360");
  assert.deepEqual(ok.reports, []);
});

function createCoverHandlers({ custom = [], covers = {} } = {}) {
  const handlers = new Map();
  const lookups = [];
  const mocks = {
    "../services/settingsService": {},
    "../infrastructure/backendHttp": {},
    "../infrastructure/serverLog": { appendAppEvent: () => {} },
    "../infrastructure/telemetry": { reportError: () => {} },
    "../services/coverArtService": {
      browseCoverCache: new Map(),
      baseTitleForCover: (s) => s,
      hasCustomCover: (name) => custom.includes(name),
      // Every lookup key reaches the disk cache first; serving from it keeps the test offline.
      getCachedCoverFromDisk: (key) => {
        lookups.push(key);
        return covers[key] || null;
      },
      fetchCustomCover: async () => null,
      generateSearchCandidateEntries: () => [],
      fetchXboxUnityCoverWithMeta: async () => null,
      tryXboxCdnFromMicrosoftStoreSearch: async () => null,
      fetchWikipediaCover: async () => null,
      getCoverStatusHints: (names) => ({
        hasCover: names.filter((n) => n === "Halo 3"),
        noCover: names.filter((n) => n === "No Cover Game"),
        withHint: names.filter((n) => n === "GTA 5"),
      }),
      saveCoverToDisk: () => {},
    },
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
    installedCover: (game) => handlers.get("browse:fetch-installed-cover")(null, game),
    coverHints: (names) => handlers.get("browse:get-cover-hints")(null, names),
    lookups,
  };
}

test("browse:fetch-installed-cover shows a mod's own cover instead of its base game's TitleID cover", async () => {
  const h = createCoverHandlers({
    custom: ["EA FC 26 Legacy Edition"],
    covers: { "EA FC 26 Legacy Edition": "data:image/jpeg;base64,MOD", "454109F4": "data:image/jpeg;base64,FIFA17" },
  });
  const r = await h.installedCover({ name: "EA FC 26 Legacy Edition", titleId: "454109F4" });
  assert.equal(r.dataUrl, "data:image/jpeg;base64,MOD");
  assert.deepEqual(h.lookups, ["EA FC 26 Legacy Edition"]);
});

test("browse:fetch-installed-cover keeps the TitleID as the exact key for a game without a dedicated cover", async () => {
  const h = createCoverHandlers({
    covers: { "4D5307E6": "data:image/jpeg;base64,HALO3", "Halo 3": "data:image/jpeg;base64,BYNAME" },
  });
  const r = await h.installedCover({ name: "Halo 3", titleId: "4D5307E6" });
  assert.equal(r.dataUrl, "data:image/jpeg;base64,HALO3");
  assert.deepEqual(h.lookups, ["4D5307E6"]);
});

test("browse:fetch-installed-cover falls back to the name when the TitleID has no cover", async () => {
  const h = createCoverHandlers({ covers: { "Homebrew X": "data:image/png;base64,HB" } });
  const r = await h.installedCover({ name: "Homebrew X", titleId: "ABCDEF01" });
  assert.equal(r.dataUrl, "data:image/png;base64,HB");
  assert.deepEqual(h.lookups, ["ABCDEF01", "Homebrew X"]);
});

test("browse:get-cover-hints returns sanitized cover hints from coverArtService", async () => {
  const h = createCoverHandlers({});
  const r = await h.coverHints(["Halo 3", "", null, "No Cover Game", "GTA 5"]);
  assert.deepEqual(r, {
    ok: true,
    hasCover: ["Halo 3"],
    noCover: ["No Cover Game"],
    withHint: ["GTA 5"],
  });
});

function createFolderAndQueueHandlers({ dialogReply, backendReply } = {}) {
  const handlers = new Map();
  const calls = [];
  const mocks = {
    electron: {
      dialog: { showOpenDialog: async () => dialogReply() },
      BrowserWindow: { getFocusedWindow: () => null },
    },
    "../app/window": { getMainWindow: () => null },
    "../services/settingsService": {
      getConfiguredXboxIP: () => "",
      getConfiguredServerPort: () => 8097,
      getConfiguredProviderPriority: () => ["huggingface", "ia", "minerva"],
    },
    "../infrastructure/backendHttp": {
      backendGetWithStatus: async (url) => {
        calls.push(url);
        return backendReply(url);
      },
      backendGet: async () => "",
    },
    "../infrastructure/serverLog": { appendAppEvent: () => {} },
    "../infrastructure/telemetry": { reportError: () => {} },
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
    chooseFolder: () => handlers.get("browse:choose-folder")(null),
    queueGame: (payload) => handlers.get("browse:queue-game")(null, payload),
    calls,
  };
}

test("browse:choose-folder retorna pasta selecionada, cancelamento ou erro amigavel", async () => {
  const picked = createFolderAndQueueHandlers({
    dialogReply: () => ({ canceled: false, filePaths: ["D:\\JogosXbox"] }),
  });
  assert.deepEqual(await picked.chooseFolder(), { ok: true, folder: "D:\\JogosXbox" });

  const canceled = createFolderAndQueueHandlers({
    dialogReply: () => ({ canceled: true, filePaths: [] }),
  });
  assert.deepEqual(await canceled.chooseFolder(), { ok: false, canceled: true });

  const failed = createFolderAndQueueHandlers({
    dialogReply: () => { throw new Error("EACCES: permission denied"); },
  });
  const errRes = await failed.chooseFolder();
  assert.equal(errRes.ok, false);
  assert.match(errRes.error, /Windows não permitiu gravar na pasta escolhida/i);
});

test("browse:queue-game aceita pasta no PC via localRoot sem exigir IP do Xbox nem pendrive", async () => {
  const h = createFolderAndQueueHandlers({
    backendReply: (url) => {
      if (url.startsWith("/register")) return { status: 200, body: '{"status":"registered"}' };
      return { status: 200, body: '{"status":"triggered"}' };
    },
  });
  const r = await h.queueGame({
    game: "Halo 3 (USA)",
    games: ["Halo 3 (USA)"],
    platform: "xbox360",
    source: "unified",
    installType: "god",
    destinationType: "local",
    destinationKind: "folder",
    localRoot: "D:\\JogosXbox",
  });
  assert.deepEqual(r, { ok: true, status: "triggered", queuedCount: 1 });
  assert.match(h.calls[0], /^\/register\?.*mode=local.*local_root=D%3A%5CJogosXbox/);
  assert.match(h.calls[1], /^\/trigger\?game=Halo%203%20\(USA\)/);

  const denied = createFolderAndQueueHandlers({
    backendReply: () => ({ status: 409, body: '{"state":"Error","message":"O dispositivo local nao esta pronto ou foi desconectado: Access is denied"}' }),
  });
  const errRes = await denied.queueGame({
    game: "Halo 3 (USA)",
    platform: "xbox360",
    destinationType: "local",
    destinationKind: "folder",
    localRoot: "C:\\Program Files\\Xbox",
  });
  assert.equal(errRes.ok, false);
  assert.doesNotMatch(errRes.error, /pendrive/i);
  assert.match(errRes.error, /pasta escolhida/i);
});
