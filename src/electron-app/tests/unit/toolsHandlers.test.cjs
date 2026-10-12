const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// [[electron-main-ferramentas-iso-mostram-sucesso-quando-o-backend-responde-erro_2026-10-11T13-55]]
function createToolsHandlers(backendReply) {
  const handlers = new Map();
  const mocks = {
    electron: { dialog: {}, BrowserWindow: {}, shell: {} },
    "../services/settingsService": { getConfiguredXboxIP: () => "" },
    "../services/backendClient": { addOutputLine: () => {} },
    "../infrastructure/backendHttp": {
      backendPost: async () => backendReply(),
      backendGet: async () => ({}),
    },
    "../app/window": { getMainWindow: () => null },
    "../services/autoSyncService": { doAuroraLibrarySync: async () => {} },
  };
  const filename = path.resolve(__dirname, "../../ipc/toolsHandlers.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id);
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  loaded.exports.register({ handle: (name, handler) => handlers.set(name, handler) });
  return (channel, arg) => handlers.get(channel)(null, arg);
}

const channels = [
  ["tools:probe-iso", "C:\\isos\\Z.iso", { titleId: "4D5307E6", displayName: "Halo 3", discNumber: 1 }, "titleId"],
  ["tools:iso2god", { isoPath: "C:\\isos\\Z.iso", outDir: "C:\\out" }, { ok: true, titleId: "4D5307E6", displayName: "Halo 3", outputDir: "C:\\out\\4D5307E6" }, "outputDir"],
  ["tools:iso2xex", { isoPath: "C:\\isos\\Z.iso", outDir: "C:\\out" }, { ok: true, titleId: "4D5307E6", displayName: "Halo 3", outputDir: "C:\\out\\Halo 3" }, "outputDir"],
];

for (const [channel, arg, success, keptField] of channels) {
  test(`${channel} treats the backend jsonError body as failure with its message`, async () => {
    const invoke = createToolsHandlers(() => ({ state: "Error", message: "Probe failed: X" }));
    const r = await invoke(channel, arg);
    assert.equal(r.ok, false);
    assert.match(r.error, /Probe failed: X/);
  });

  test(`${channel} treats an empty non-JSON body as failure with a non-empty reason`, async () => {
    const invoke = createToolsHandlers(() => ({ error: "" }));
    const r = await invoke(channel, arg);
    assert.equal(r.ok, false);
    assert.ok(r.error.length > 0);
  });

  test(`${channel} keeps real success and its fields`, async () => {
    const invoke = createToolsHandlers(() => success);
    const r = await invoke(channel, arg);
    assert.equal(r.ok, true);
    assert.equal(r[keptField], success[keptField]);
  });

  test(`${channel} reports a network rejection`, async () => {
    const invoke = createToolsHandlers(() => { throw new Error("ECONNREFUSED"); });
    const r = await invoke(channel, arg);
    assert.equal(r.ok, false);
    assert.match(r.error, /ECONNREFUSED/);
  });
}
