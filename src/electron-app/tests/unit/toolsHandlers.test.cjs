const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// [[electron-main-ferramentas-iso-mostram-sucesso-quando-o-backend-responde-erro_2026-10-11T13-55]]
// [[electron-main-gerenciador-ftp-descarta-o-motivo-do-backend-ao-listar-enviar-e-mover-jogo_2026-10-12T19-00]]
function createToolsHandlers(backendReply, xboxIp = "192.168.1.100") {
  const handlers = new Map();
  const outputLines = [];
  const mocks = {
    electron: { dialog: {}, BrowserWindow: {}, shell: {} },
    "../services/settingsService": { getConfiguredXboxIP: () => xboxIp },
    "../services/backendClient": { addOutputLine: (line) => outputLines.push(line) },
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
  const invoke = (channel, arg) => handlers.get(channel)(null, arg);
  invoke.outputLines = outputLines;
  return invoke;
}

const channels = [
  ["tools:probe-iso", "C:\\isos\\Z.iso", { titleId: "4D5307E6", displayName: "Halo 3", discNumber: 1 }, "titleId"],
  ["tools:iso2god", { isoPath: "C:\\isos\\Z.iso", outDir: "C:\\out" }, { ok: true, titleId: "4D5307E6", displayName: "Halo 3", outputDir: "C:\\out\\4D5307E6" }, "outputDir"],
  ["tools:iso2xex", { isoPath: "C:\\isos\\Z.iso", outDir: "C:\\out" }, { ok: true, titleId: "4D5307E6", displayName: "Halo 3", outputDir: "C:\\out\\Halo 3" }, "outputDir"],
  ["tools:ftp-list", "/", { ok: true, entries: [{ name: "Hdd1", type: "dir" }], cwd: "/" }, "cwd"],
  ["tools:ftp-upload", { localPaths: ["C:\\test.xex"], remotePath: "/Hdd1" }, { ok: true, jobs: [{ id: 1, name: "test.xex" }] }, "jobs"],
];

for (const [channel, arg, success, keptField] of channels) {
  test(`${channel} treats backend jsonError as failure, logs raw reason and returns layman message`, async () => {
    const invoke = createToolsHandlers(() => ({ state: "Error", message: "Backend operation failed: reason X" }));
    const r = await invoke(channel, arg);
    assert.equal(r.ok, false);
    assert.ok(r.error.length > 0);
    assert.ok(!r.error.includes("Backend operation failed"), `raw English leaked to UI: ${r.error}`);
    assert.ok(invoke.outputLines.some((l) => l.includes("reason X")), "technical reason must stay in logs");
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
    if (keptField) {
      assert.deepEqual(r[keptField], success[keptField]);
    }
  });

  test(`${channel} logs network rejection and returns layman-friendly error`, async () => {
    const invoke = createToolsHandlers(() => { throw new Error("ECONNREFUSED"); });
    const r = await invoke(channel, arg);
    assert.equal(r.ok, false);
    assert.ok(!r.error.includes("ECONNREFUSED"), `technical code leaked to UI: ${r.error}`);
    assert.match(r.error, /tente novamente|Aguarde/i);
    assert.ok(invoke.outputLines.some((l) => l.includes("ECONNREFUSED")), "technical code must stay in logs");
  });
}

test("xbox:move-game normalizes backend jsonError and returns layman-friendly Portuguese message", async () => {
  const invoke = createToolsHandlers(() => ({ state: "Error", message: "source and destination drive are the same" }));
  const r = await invoke("xbox:move-game", {
    game: { name: "Halo 3", sourceDrive: "Hdd1", directory: "Content/0000000000000000/4D5307E6" },
    targetDrive: "Usb0",
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /unidade de origem e a unidade de destino são a mesma/i);
  assert.ok(invoke.outputLines.some((l) => l.includes("source and destination drive are the same")));
});

test("xbox:move-game preserves successful response and jobId", async () => {
  const invoke = createToolsHandlers(() => ({ ok: true, id: 99, message: "Queued move of Halo 3 to Usb0" }));
  const r = await invoke("xbox:move-game", {
    game: { name: "Halo 3", sourceDrive: "Hdd1", directory: "Content/0000000000000000/4D5307E6" },
    targetDrive: "Usb0",
  });
  assert.equal(r.ok, true);
  assert.equal(r.jobId, 99);
  assert.match(r.message, /Queued move/);
});
