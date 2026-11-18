const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { _electron: electron } = require("playwright");

// End-to-end verification in real Electron + real Go backend for:
// 1) Readiness gate during stale Temp cleanup (no ECONNREFUSED on /browse)
// 2) Quit stops godsend-backend before Electron exits, so immediate reopen never hits .godsend.lock
// 3) applyUpdateAndRestart launches WMI-detached replace script and swaps the target binary after quit
// Run: node src/electron-app/tests/electron/backend-lifecycle-and-update-e2e.cjs

const appDir = path.resolve(__dirname, "../..");
const pkgVersion = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version;

async function freePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  return port;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readLogs(logsDir) {
  if (!fs.existsSync(logsDir)) return "";
  return fs
    .readdirSync(logsDir)
    .filter((f) => f.endsWith(".log"))
    .sort()
    .map((f) => fs.readFileSync(path.join(logsDir, f), "utf8"))
    .join("\n");
}

async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const val = await fn();
    if (val) return val;
    await new Promise((r) => setTimeout(r, 150));
  }
  return fn();
}

function isPidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function launchRealApp(tempDir, fakeTarget) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  env.PORTABLE_EXECUTABLE_DIR = tempDir;
  env.PORTABLE_EXECUTABLE_FILE = fakeTarget;
  env.PORTABLE_EXECUTABLE_APP_FILENAME = "xboxcompanion";

  const electronApp = await electron.launch({
    executablePath: require("electron"),
    args: [appDir],
    env,
  });
  const page = await electronApp.firstWindow();
  page.setDefaultTimeout(30_000);
  await page.waitForFunction(() => Boolean(window.godsendApi && window.godsendApi.browseGetGames));
  return { electronApp, page };
}

async function main() {
  if (process.platform !== "win32") {
    console.log("SKIP: Windows-only E2E test");
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-lifecycle-e2e-"));
  const userDataDir = path.join(tempDir, "godsend-data");
  const runtimeDir = path.join(tempDir, "runtime");
  const staleDir = path.join(runtimeDir, "Temp", "stale-e2e");
  const logsDir = path.join(userDataDir, "logs");
  const port = await freePort();

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(staleDir, { recursive: true });

  // Seed 6,000 small files so Go SetupPaths has real Temp cleanup work before Server bind.
  for (let i = 0; i < 6000; i++) {
    fs.writeFileSync(path.join(staleDir, `f_${i}.tmp`), "x");
  }

  const sys = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
  const fakeTarget = path.join(tempDir, "xboxcompanion.exe");
  const fakeSource = path.join(tempDir, "xboxcompanion-update.exe");
  fs.copyFileSync(path.join(sys, "PING.EXE"), fakeTarget);
  fs.copyFileSync(path.join(sys, "whoami.exe"), fakeSource);
  const expectedHash = sha256(fakeSource);

  fs.writeFileSync(
    path.join(userDataDir, "config.json"),
    JSON.stringify({
      storagePath: runtimeDir,
      serverPort: port,
      errorReporting: false,
      autoCheckUpdates: false,
    }),
    "utf8"
  );

  let activeApp = null;
  try {
    // ── 1) Readiness gate during Temp cleanup ──────────────────────────────────
    console.log("[E2E 1/3] Launching app with 6,000 stale Temp files...");
    const session1 = await launchRealApp(tempDir, fakeTarget);
    activeApp = session1.electronApp;

    // Immediately call browseGetGames while backend may still be cleaning Temp.
    const browseRes1 = await session1.page.evaluate(() =>
      window.godsendApi.browseGetGames({ platform: "xbox360", source: "local" })
    );
    assert.equal(browseRes1.ok, true, `browse failed during startup: ${JSON.stringify(browseRes1)}`);

    const logs1 = readLogs(logsDir);
    assert.match(logs1, /Cleaning stale processing data in/, "backend should log stale Temp cleanup");
    assert.match(logs1, /GODSEND_LISTEN_PORT=/, "backend should emit listen port");
    const browseConnRefused = logs1
      .split(/\r?\n/)
      .filter((line) => line.includes("ECONNREFUSED") && !line.includes("xbox:get-queue"));
    assert.deepEqual(browseConnRefused, [], `unexpected ECONNREFUSED outside xbox:get-queue poll:\n${browseConnRefused.join("\n")}`);

    const pidMatch = logs1.match(/APP_BACKEND\s+spawned pid=(\d+)/);
    const firstBackendPid = pidMatch ? parseInt(pidMatch[1], 10) : NaN;
    assert.ok(Number.isFinite(firstBackendPid) && firstBackendPid > 0, `invalid backend pid in log: ${logs1}`);
    assert.equal(isPidAlive(firstBackendPid), true, "backend should be alive while app is open");
    console.log(`[E2E 1/3] PASS (backend pid=${firstBackendPid}, no ECONNREFUSED)`);

    // ── 2) Quit stops backend before Electron exits, immediate reopen works ───
    console.log("[E2E 2/3] Triggering app.quit() and checking immediate reopen...");
    const exitPromise1 = new Promise((resolve) => session1.electronApp.process().once("exit", resolve));
    await session1.electronApp.evaluate(({ app }) => app.quit());
    await exitPromise1;
    activeApp = null;

    assert.equal(
      isPidAlive(firstBackendPid),
      false,
      `backend pid=${firstBackendPid} still alive right after Electron exited`
    );

    const session2 = await launchRealApp(tempDir, fakeTarget);
    activeApp = session2.electronApp;
    const browseRes2 = await session2.page.evaluate(() =>
      window.godsendApi.browseGetGames({ platform: "xbox360", source: "local" })
    );
    assert.equal(browseRes2.ok, true, `reopen browse failed: ${JSON.stringify(browseRes2)}`);

    const logs2 = readLogs(logsDir);
    assert.doesNotMatch(logs2, /is locked by another instance of godsend/, "reopen must not hit home lock conflict");
    console.log("[E2E 2/3] PASS (old backend dead at quit, immediate reopen succeeded)");

    // ── 3) applyUpdateAndRestart swaps executable after Electron quits ─────────
    console.log("[E2E 3/3] Invoking applyUpdateAndRestart from real Electron renderer...");
    const exitPromise2 = new Promise((resolve) => session2.electronApp.process().once("exit", resolve));
    const applyRes = await session2.page.evaluate(
      ({ src, ver }) => window.godsendApi.applyUpdateAndRestart(src, ver),
      { src: fakeSource, ver: pkgVersion }
    );
    assert.equal(applyRes.ok, true, `applyUpdateAndRestart failed: ${JSON.stringify(applyRes)}`);
    await exitPromise2;
    activeApp = null;

    const resultFile = path.join(userDataDir, "update-result.txt");
    const outcome = await waitFor(() => {
      try {
        const val = fs.readFileSync(resultFile, "utf8").replace(/^\uFEFF/, "").trim();
        return val === "ok" || val.startsWith("copy-failed:") ? val : "";
      } catch {
        return "";
      }
    }, 30_000);
    assert.equal(outcome, "ok", `unexpected update-result.txt outcome: "${outcome}"`);
    assert.equal(sha256(fakeTarget), expectedHash, "target executable was not swapped with update payload");
    console.log("[E2E 3/3] PASS (update-result.txt=ok and target binary replaced)");
  } finally {
    if (activeApp) {
      try {
        await activeApp.close();
      } catch {}
    }
    // Wait briefly for the relaunched dummy executable / powershell cwd handle to release.
    for (let i = 0; i < 15; i++) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
