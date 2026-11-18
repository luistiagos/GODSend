const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const readiness = require("../../infrastructure/backendReadiness.js");
const { createBeforeQuitHandler } = require("../../app/quitLifecycle.js");

function loadBackendClientHarness({
  exeExists = true,
  configuredPort = 8080,
  spawnImpl = null,
} = {}) {
  const spawned = [];
  const spawnCalls = [];
  const appEvents = [];
  let port = configuredPort;

  const defaultFakeChildFactory = () => {
    const proc = new EventEmitter();
    proc.pid = 2000 + spawned.length + 1;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = (sig) => {
      proc.killedWith = sig || "SIGTERM";
      proc.killed = true;
      return true;
    };
    spawned.push(proc);
    return proc;
  };

  const mocks = {
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    child_process: {
      spawn: (cmd, args, opts) => {
        spawnCalls.push({ cmd, args, opts });
        if (spawnImpl) return spawnImpl(cmd, args, opts, defaultFakeChildFactory);
        return defaultFakeChildFactory();
      },
    },
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
      appendAppEvent: (cat, msg) => appEvents.push({ cat, msg }),
      getPrimaryIPv4: () => "127.0.0.1",
      getAppVersion: () => "2.12.130",
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
  loaded.require = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id));
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return { client: loaded.exports, spawned, spawnCalls, appEvents };
}

test("before-quit aguarda stopAndWait antes de re-disparar app.quit quando backend esta rodando", async () => {
  let quitting = false;
  let backendAlive = true;
  let stopSyncCalls = 0;
  let stopAndWaitCalls = 0;
  let retriggerCalls = 0;
  const logs = [];
  let resolveStop;

  const handler = createBeforeQuitHandler({
    setIsQuitting: (v) => { quitting = v; },
    hasRunningBackend: () => backendAlive,
    stopSync: () => { stopSyncCalls++; },
    stopAndWait: () => {
      stopAndWaitCalls++;
      return new Promise((r) => { resolveStop = r; });
    },
    retriggerQuit: () => { retriggerCalls++; },
    logEvent: (cat, msg) => logs.push(`${cat}:${msg}`),
  });

  // First pass (Quit from tray): must prevent default and wait for backend stop.
  let prevented1 = false;
  handler({ preventDefault: () => { prevented1 = true; } });
  assert.equal(quitting, true);
  assert.equal(prevented1, true);
  assert.equal(stopAndWaitCalls, 1);
  assert.equal(retriggerCalls, 0);

  // Duplicate before-quit while still stopping: prevented, no duplicate stopAndWait.
  let preventedDup = false;
  handler({ preventDefault: () => { preventedDup = true; } });
  assert.equal(preventedDup, true);
  assert.equal(stopAndWaitCalls, 1);

  // Backend finishes stopping: retriggerQuit fires.
  backendAlive = false;
  resolveStop();
  await new Promise((r) => setImmediate(r));
  assert.equal(retriggerCalls, 1);

  // Second pass triggered by app.quit(): proceeds without preventDefault.
  let prevented2 = false;
  handler({ preventDefault: () => { prevented2 = true; } });
  assert.equal(prevented2, false);
  assert.equal(stopSyncCalls, 1);
  assert.ok(logs.some((l) => l.includes("waiting for backend stop")));
});

test("before-quit sai direto sem preventDefault quando nao ha backend ativo", () => {
  let stopSyncCalls = 0;
  let stopAndWaitCalls = 0;
  const handler = createBeforeQuitHandler({
    setIsQuitting: () => {},
    hasRunningBackend: () => false,
    stopSync: () => { stopSyncCalls++; },
    stopAndWait: async () => { stopAndWaitCalls++; },
    retriggerQuit: () => {},
    logEvent: () => {},
  });
  let prevented = false;
  handler({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(stopSyncCalls, 1);
  assert.equal(stopAndWaitCalls, 0);
});

test("stopGodsendAndWait aguarda fechamento do processo antes de resolver", { timeout: 5000 }, async (t) => {
  t.after(() => readiness.markBackendStopped());
  const { client, spawned } = loadBackendClientHarness();
  client.startGodsendSafely();
  assert.equal(spawned.length, 1);

  let resolved = false;
  const stopPromise = client.stopGodsendAndWait({ graceMs: 1000, killTimeoutMs: 1000 }).then(() => {
    resolved = true;
  });

  await new Promise((r) => setTimeout(r, 80));
  assert.equal(spawned[0].killed, true);
  assert.equal(resolved, false, "nao pode resolver enquanto o processo ainda nao fechou");

  spawned[0].emit("close", 0, "SIGTERM");
  await stopPromise;
  assert.equal(resolved, true);
  assert.equal(client.getProcess(), null);
});

test("stopGodsendAndWait força taskkill /F /T /PID quando processo ignora kill inicial", { timeout: 5000 }, async (t) => {
  t.after(() => readiness.markBackendStopped());
  let killerProc = null;
  const { client, spawned, spawnCalls } = loadBackendClientHarness({
    spawnImpl: (cmd, args, opts, makeFake) => {
      if (String(cmd).toLowerCase().includes("taskkill")) {
        killerProc = makeFake();
        setTimeout(() => {
          killerProc.emit("close", 0, null);
          spawned[0].emit("close", 1, null);
        }, 30);
        return killerProc;
      }
      return makeFake();
    },
  });

  client.startGodsendSafely();
  const targetPid = spawned[0].pid;

  await client.stopGodsendAndWait({ graceMs: 60, killTimeoutMs: 1000 });
  assert.equal(client.getProcess(), null);

  if (process.platform === "win32") {
    const taskkillCall = spawnCalls.find((c) => String(c.cmd).toLowerCase().includes("taskkill"));
    assert.ok(taskkillCall, "deve chamar taskkill no Windows quando o processo nao sai na graca");
    assert.deepEqual(taskkillCall.args, ["/F", "/T", "/PID", String(targetPid)]);
  } else {
    assert.equal(spawned[0].killedWith, "SIGKILL");
  }
});

test("stopGodsendAndWait mata processo real em execucao antes de retornar", { timeout: 5000 }, async (t) => {
  t.after(() => readiness.markBackendStopped());
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "godsend-stop-real-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const mocks = {
    electron: { BrowserWindow: { getAllWindows: () => [] } },
    "../infrastructure/fileSystem": {
      getGodsendExePath: () => process.execPath,
      prepareWritableRuntime: () => tmpDir,
    },
    "../infrastructure/serverLog": {
      appendBackendSessionStart: () => {},
      appendBackendSessionEnd: () => {},
      appendBackendStdout: () => {},
      appendBackendStderr: () => {},
      appendAppLine: () => {},
      appendAppEvent: () => {},
      getPrimaryIPv4: () => "127.0.0.1",
      getAppVersion: () => "2.12.130",
      getLogInfo: () => ({ logsDirectory: tmpDir }),
    },
    "./settingsService": {
      getConfiguredTransferFolder: () => "",
      getDefaultTransferFolder: () => tmpDir,
      getEffectiveTorrentTempPath: () => tmpDir,
      getConfiguredServerPort: () => 8080,
      writeConfig: () => {},
      buildGodsendEnv: () => ({ ...process.env }),
    },
    "./iaCookie": { normalizeIACookiePair: (k, v) => `${k}=${v}` },
    "../infrastructure/telemetry": { reportError: () => {} },
    "../infrastructure/backendReadiness": readiness,
    child_process: {
      spawn: (_exe, _args, opts) =>
        spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], opts),
    },
  };

  const filename = path.resolve(__dirname, "../../services/backendClient.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id));
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  const client = loaded.exports;

  client.startGodsendSafely();
  const proc = client.getProcess();
  assert.ok(proc && proc.pid);
  const pid = proc.pid;

  await client.stopGodsendAndWait({ graceMs: 500, killTimeoutMs: 2000 });
  assert.equal(client.getProcess(), null);
  assert.throws(() => process.kill(pid, 0), "processo antigo nao pode continuar vivo apos stopGodsendAndWait");
});

test("reabertura imediata retenta brevemente se GODSEND_HOME ainda estiver travado pelo backend saindo", { timeout: 8000 }, async (t) => {
  t.after(() => readiness.markBackendStopped());
  const { client, spawned } = loadBackendClientHarness();

  client.startGodsendSafely();
  assert.equal(spawned.length, 1);
  assert.equal(readiness.isBackendStarting(), true);

  // First attempt fails with home lock conflict from exiting previous backend.
  spawned[0].stdout.emit(
    "data",
    Buffer.from("[FATAL] Setup failed: data directory C:\\fake\\runtime is locked by another instance of godsend (pid 11072)\n")
  );
  spawned[0].emit("close", 1, null);

  // Readiness gate must remain closed while retry timer is pending.
  assert.equal(readiness.isBackendStarting(), true);

  // Wait for retry (~800 ms).
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(spawned.length, 2, "deve tentar subir o backend novamente apos liberacao do lock");
  assert.equal(readiness.isBackendStarting(), true);

  // Second attempt succeeds and opens the port.
  spawned[1].stdout.emit("data", Buffer.from("[INFO] GODSEND_LISTEN_PORT=8080\n"));
  assert.equal(readiness.isBackendStarting(), false);

  await client.stopGodsendAndWait({ graceMs: 100, killTimeoutMs: 100 });
});
