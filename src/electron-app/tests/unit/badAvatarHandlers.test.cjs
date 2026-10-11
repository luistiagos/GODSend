const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

// [[electron-main-falha-no-preparo-do-pendrive-nao-chega-a-telemetria_2026-10-04T23-28]]
function createBadAvatarHandlers(prepare) {
  const handlers = new Map();
  const events = [];
  const reports = [];
  const active = [];
  const pushed = [];
  const mocks = {
    electron: { app: { getPath: () => "" } },
    "../infrastructure/fat32Format": { resolveFat32FormatExe: () => null },
    "../services/badAvatarUsbService": {
      setUsbPreparationActive: (value) => active.push(value),
    },
    "../app/window": {
      getWebContentsForPush: () => ({ isDestroyed: () => false, send: (...args) => pushed.push(args) }),
    },
    "../services/preparationReadinessService": {},
    "../services/preparationPreviewService": {},
    "../services/fixedBadAvatarPreparationService": { prepareFixedBadAvatarDevice: prepare },
    "../infrastructure/serverLog": { appendAppEvent: (...args) => events.push(args) },
    "../infrastructure/telemetry": { reportError: (...args) => reports.push(args) },
    "../infrastructure/windowsSystemExecutables": {},
  };
  const filename = path.resolve(__dirname, "../../ipc/badAvatarHandlers.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id);
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  loaded.exports.register({ handle: (name, handler) => handlers.set(name, handler) });
  return {
    prepare: (request) => handlers.get("tools:badavatar-prepare")(null, request),
    events,
    reports,
    active,
    pushed,
  };
}

const baseRequest = {
  driveRoot: "D:\\",
  expectedDeviceFingerprint: "a".repeat(64),
  formatDrive: true,
  requirementsAccepted: true,
};

test("tools:badavatar-prepare reports a failure with mode, drive and last progress phase", async () => {
  const error = new Error("UNKNOWN: unknown error, mkdir 'D:/.xbox-downloader/transactions'");
  const h = createBadAvatarHandlers(async (_request, onProgress) => {
    onProgress({ status: "Gravando…", percent: 40, detail: "3/10" });
    throw error;
  });
  const result = await h.prepare(baseRequest);
  assert.deepEqual(result, { ok: false, error: error.message });
  assert.equal(h.pushed.length, 1);
  assert.equal(h.reports.length, 1);
  const [component, file, method, message, extra, logs, terminal] = h.reports[0];
  assert.equal(component, "electron-main");
  assert.equal(file, "badAvatarHandlers.ts");
  assert.equal(method, "tools:badavatar-prepare");
  assert.equal(message, error.message);
  assert.equal(extra, "");
  assert.equal(terminal, false);
  assert.match(logs[0], /modo=badavatar; formatar=true; unidade=D:\\; fase=Gravando… \(40%, 3\/10\)/);
  assert.ok(logs.includes(error.stack));
  assert.ok(!logs.join("\n").includes(baseRequest.expectedDeviceFingerprint));
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], "BADAVATAR");
  assert.ok(h.events[0][1].startsWith("falha no preparo: "));
  assert.ok(h.events[0][1].includes(logs[0]));
  assert.ok(h.events[0][1].includes(error.message));
  assert.deepEqual(h.active, [true, false]);
});

test("tools:badavatar-prepare reports RGH failures before any progress", async () => {
  const h = createBadAvatarHandlers(async () => {
    throw new Error("Atualize a lista e selecione novamente o pendrive ou HD.");
  });
  const result = await h.prepare({ ...baseRequest, isRghOnly: true, formatDrive: false });
  assert.equal(result.ok, false);
  assert.equal(h.reports.length, 1);
  assert.match(h.reports[0][5][0], /modo=rgh; formatar=false; unidade=D:\\; fase=antes do primeiro progresso/);
});

test("tools:badavatar-prepare does not report the 'already in progress' refusal", async () => {
  let finish;
  const h = createBadAvatarHandlers(() => new Promise((resolve) => { finish = resolve; }));
  const first = h.prepare(baseRequest);
  const second = await h.prepare(baseRequest);
  assert.deepEqual(second, { ok: false, error: "Já existe uma preparação em andamento." });
  assert.equal(h.reports.length, 0);
  assert.equal(h.events.length, 0);
  finish({ done: true });
  assert.deepEqual(await first, { ok: true, result: { done: true } });
  assert.deepEqual(h.active, [true, false]);
});

test("tools:badavatar-prepare does not report a successful preparation", async () => {
  const h = createBadAvatarHandlers(async (_request, onProgress) => {
    onProgress({ status: "Concluído", percent: 100 });
    return { ok: true };
  });
  assert.deepEqual(await h.prepare(baseRequest), { ok: true, result: { ok: true } });
  assert.equal(h.reports.length, 0);
  assert.equal(h.events.length, 0);
  assert.deepEqual(h.active, [true, false]);
});
