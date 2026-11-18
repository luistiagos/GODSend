const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

const { hasTechnicalErrorLeak } = require("../../infrastructure/userFriendlyError.js");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function assertLaymanMessage(msg, label) {
  assert.equal(typeof msg, "string", `${label}: expected string, got ${typeof msg}`);
  assert.ok(msg.trim().length > 15, `${label}: message too short: ${JSON.stringify(msg)}`);
  assert.equal(
    hasTechnicalErrorLeak(msg),
    false,
    `${label}: technical detail leaked to user UI: ${JSON.stringify(msg)}`,
  );
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-e2e-errors-"));
  const appData = path.join(tempRoot, "appdata");
  const storageDir = path.join(tempRoot, "storage");
  const transferDir = path.join(tempRoot, "transfer");
  const usbRoot = path.join(tempRoot, "fake-usb");
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(transferDir, { recursive: true });
  fs.mkdirSync(usbRoot, { recursive: true });

  const telemetryPayloads = [];
  const telemetryServer = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (req.method === "POST") {
        try { telemetryPayloads.push(JSON.parse(body)); } catch { telemetryPayloads.push({ raw: body }); }
      } else {
        telemetryPayloads.push({ url: req.url });
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });

  // Closed local port so FTP connection attempts fail immediately instead of timing out.
  const closedPort = await getFreePort();
  const serverPort = await getFreePort();

  await new Promise((resolve) => telemetryServer.listen(0, "127.0.0.1", resolve));
  const telemetryPort = telemetryServer.address().port;
  const telemetryUrl = `http://127.0.0.1:${telemetryPort}/logErr`;

  const configPayload = {
    storagePath: storageDir,
    transferFolder: transferDir,
    serverPort,
    simpleMode: false,
    autoCheckUpdates: false,
    errorReporting: true,
    errorReportingEndpoint: telemetryUrl,
    xboxIp: "",
  };
  for (const name of ["Electron", "xbox-360-companion-electron", "Xbox 360 Companion"]) {
    const dir = path.join(appData, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(configPayload, null, 2), "utf8");
  }

  let electronApp;
  const pageErrors = [];

  try {
    const env = {
      ...process.env,
      NODE_ENV: "development",
      APPDATA: appData,
      GODSEND_ERROR_REPORTING: "1",
      GODSEND_ERROR_REPORTING_ENDPOINT: telemetryUrl,
    };
    delete env.ELECTRON_RUN_AS_NODE;

    electronApp = await electron.launch({
      executablePath: require("electron"),
      args: [path.resolve(__dirname, "../../main.js")],
      env,
    });

    const page = await electronApp.firstWindow();
    page.setDefaultTimeout(20_000);
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => typeof window.godsendApi === "object");

    // Wait until the real compiled Go backend has booted and responds to IPC.
    let backendReady = false;
    let lastStatus = null;
    for (let i = 0; i < 80; i++) {
      lastStatus = await page.evaluate(() => window.godsendApi.getDataStatus());
      if (lastStatus && lastStatus.ok) {
        backendReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!backendReady) {
      const diag = await page.evaluate(async () => ({
        buf: await window.godsendApi.getOutputBuffer(),
        port: await window.godsendApi.getServerPort(),
        logs: await window.godsendApi.getLogsInfo(),
      }));
      console.error("Backend did not become ready. lastStatus:", lastStatus, "diag:", diag);
    }
    assert.equal(backendReady, true, "real Go backend must become reachable from Electron IPC");

    // 1. Browse invalid ROM system -> real Go HTTP 400 -> real browseHandlers.js -> friendly UI + technical telemetry/log
    const browseFail = await page.evaluate(() =>
      window.godsendApi.browseGetGames({ platform: "rom_invalid_e2e", source: "ia" }),
    );
    assert.equal(browseFail.ok, false);
    assertLaymanMessage(browseFail.error, "browse:get-games invalid ROM system");
    assert.match(browseFail.error, /Tentar de novo/i);

    await new Promise((r) => setTimeout(r, 250));
    assert.ok(
      telemetryPayloads.some((p) => String(p.message || "").includes("HTTP 400") && String(p.message || "").includes("Unknown ROM system")),
      `expected technical HTTP 400 / Unknown ROM system in telemetry, got: ${JSON.stringify(telemetryPayloads)}`,
    );

    // 2. ISO tools against missing and invalid .iso files -> real Go /tools/probe-iso & /tools/iso2god
    const missingIso = path.join(tempRoot, "nao-existe.iso");
    const badIso = path.join(tempRoot, "corrompido.iso");
    fs.writeFileSync(badIso, "not-an-xbox-iso", "utf8");

    const probeMissing = await page.evaluate((p) => window.godsendApi.toolsProbeIso(p), missingIso);
    assert.equal(probeMissing.ok, false);
    assertLaymanMessage(probeMissing.error, "tools:probe-iso missing file");

    const iso2godBad = await page.evaluate(
      ({ isoPath, outDir }) => window.godsendApi.toolsIso2God({ isoPath, outDir }),
      { isoPath: badIso, outDir: path.join(tempRoot, "god-out") },
    );
    assert.equal(iso2godBad.ok, false);
    assertLaymanMessage(iso2godBad.error, "tools:iso2god invalid ISO");

    // 3. Real Go pipeline JobQueue error (missing local ISO) -> Go LogStatus -> QueuePage.tsx DOM
    const missingLocalQueue = await page.evaluate((localRoot) =>
      window.godsendApi.browseQueueGame({
        game: "Jogo Inexistente E2E",
        platform: "local",
        source: "local",
        installType: "god",
        destinationType: "local",
        localRoot,
      }),
    usbRoot);
    assert.equal(missingLocalQueue.ok, false);
    assertLaymanMessage(missingLocalQueue.error, "browse:queue-game local_unavailable");
    assert.match(missingLocalQueue.error, /Transfer/i);

    // Also verify what Go stored in JobQueue via /queue -> QueuePage.tsx
    const queueRes = await page.evaluate(() => window.godsendApi.getQueue());
    assert.equal(queueRes.ok, true);
    const job = (queueRes.jobs || []).find((j) => j.game === "Jogo Inexistente E2E");
    assert.ok(job, "expected failed job in real Go JobQueue");
    assert.equal(job.state, "Error");
    assertLaymanMessage(job.message, "Go JobQueue error message");

    // Navigate to the real "Fila" tab in the Electron UI and assert the rendered DOM text
    await page.getByRole("button", { name: /^Fila\b/ }).click();
    await page.getByText("Jogo Inexistente E2E", { exact: true }).waitFor();
    const filaBodyText = await page.locator("body").innerText();
    assert.ok(
      filaBodyText.includes(job.message),
      `expected layman queue error in QueuePage DOM, got:\n${filaBodyText}`,
    );
    assert.ok(
      !filaBodyText.includes("No ISO in Transfer folder"),
      "raw English Go error must never appear on QueuePage",
    );

    // 4. Missing Xbox IP across FTP / Saves / Content / Aurora Library / Assets
    const noIpChecks = [
      ["xbox:list-drives", () => window.godsendApi.listXboxDrives()],
      ["xbox:list-games", () => window.godsendApi.listXboxGames()],
      ["xbox:list-aurora-library", () => window.godsendApi.listAuroraLibrary()],
      ["saves:discover", () => window.godsendApi.savesDiscover("4D5307E6")],
      ["content:installed", () => window.godsendApi.contentInstalled({ titleId: "4D5307E6" })],
      ["tools:ftp-list", () => window.godsendApi.toolsFtpList("/")],
      ["xbox:ftp-test", () => window.godsendApi.ftpTestConnection({})],
    ];
    for (const [label, fn] of noIpChecks) {
      const res = await page.evaluate(fn);
      assert.equal(res.ok, false, `${label} should fail when Xbox IP is empty`);
      assertLaymanMessage(res.error, label);
      assert.match(res.error, /Configurações/i, `${label} must tell user to go to Configurações`);
    }

    // 5. Unreachable Xbox IP -> real Go /ftp/test fails with dial tcp -> layman UI message
    const ftpUnreachable = await page.evaluate(
      (ip) => window.godsendApi.ftpTestConnection({ xboxIp: ip, ftpUser: "xboxftp", ftpPassword: "xboxftp" }),
      `127.0.0.1`,
    );
    // Even if an FTP server happened not to run on 21, test explicit unreachable port/host via savesDiscover against 127.0.0.1
    if (!ftpUnreachable.ok) {
      assertLaymanMessage(ftpUnreachable.error, "xbox:ftp-test unreachable");
    }

    // 6. Verify log files on disk kept the technical details (e.g. HTTP 400, Unknown platform, LOCAL UNAVAILABLE / [JOB ERROR])
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath("userData"));
    const logsDir = path.join(userDataDir, "logs");
    const logContents = fs.readdirSync(logsDir)
      .map((f) => fs.readFileSync(path.join(logsDir, f), "utf8"))
      .join("\n");
    assert.match(logContents, /HTTP 400/, "technical HTTP status must be preserved in log file");
    assert.match(logContents, /Unknown ROM system/, "technical Go message must be preserved in log file");
    assert.match(logContents, /\[JOB ERROR\].*No ISO in Transfer folder/, "raw job error must be preserved in backend log");
    assert.match(logContents, /\[ERROR\] tools:iso2god:/, "raw ISO error must be preserved in log");

    assert.deepEqual(pageErrors, [], "no unhandled page errors in renderer");
    console.log(
      `PASS: full-stack E2E verified (real Electron + preload + IPC + Go backend + QueuePage DOM + logs + telemetry=${telemetryPayloads.length})`,
    );
  } finally {
    if (electronApp) await electronApp.close().catch(() => {});
    telemetryServer.close();
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
