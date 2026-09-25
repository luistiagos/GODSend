const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

// Exercise the real page in Chromium without bootstrapping the application:
// every API is mocked, including telemetry, disk enumeration and cover lookup.
// Run from any directory: node src/electron-app/tests/electron/browse-errors-smoke.cjs
const appDir = path.resolve(__dirname, "../..");
const harnessPath = "/__browse-errors-harness.jsx";
const harness = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import BrowsePage from "/renderer/components/BrowsePage.tsx";
  import "/renderer/index.css";

  let root;
  window.mountBrowse = (scenario = {}) => {
    root?.unmount();
    const mock = window.browseMock = {
      calls: [], reports: [], pending: {},
      online: [...(scenario.online || [])],
      local: [...(scenario.local || [])],
    };
    window.godsendApi = {
      toolsBadAvatarListDrives: async () => ({ ok: true, drives: [] }),
      getDefaultXboxDrive: async () => "",
      listXboxDrives: async () => ({ ok: true, drives: [] }),
      browseGetInstalledGames: async () => ({ ok: true, games: scenario.installed || [] }),
      browseGetReleaseGroups: async () => ({ ok: true, releases: [] }),
      browseFetchCover: async () => ({ ok: false }),
      browseGetGames: async (params) => {
        mock.calls.push(params);
        const reply = (params.source === "local" ? mock.local : mock.online).shift();
        if (reply?.reject) throw new Error(reply.reject);
        if (reply?.defer) return new Promise((resolve) => { mock.pending[reply.defer] = resolve; });
        return reply?.value ?? { ok: true, games: [] };
      },
      reportError: async (...args) => {
        mock.reports.push(args);
        if (scenario.telemetryRejects) throw new Error("Telemetry is unavailable");
      },
    };
    root = createRoot(document.getElementById("root"));
    root.render(<BrowsePage />);
  };
`;

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-browse-errors-"));
  let server;
  let electronApp;
  let page;
  const pageErrors = [];
  try {
    const { createServer } = await import("vite");
    server = await createServer({
      configFile: false,
      root: appDir,
      cacheDir: path.join(tempDir, "vite-cache"),
      logLevel: "error",
      server: { host: "127.0.0.1", port: 0, hmr: false },
      esbuild: { jsx: "automatic" },
      css: {
        postcss: {
          plugins: [
            require("tailwindcss")({
              ...require("../../tailwind.config.js"),
              content: [path.join(appDir, "renderer/**/*.{js,jsx,ts,tsx}")],
            }),
            require("autoprefixer")(),
          ],
        },
      },
      plugins: [{
        name: "browse-errors-test-harness",
        resolveId(id) { if (id === harnessPath) return id; },
        load(id) { if (id === harnessPath) return harness; },
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="' + harnessPath + '"></script></body></html>');
          });
        },
      }],
    });
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    const shellPath = path.join(tempDir, "main.cjs");
    fs.writeFileSync(shellPath, `
      const { app, BrowserWindow, session } = require("electron");
      app.setPath("userData", ${JSON.stringify(path.join(tempDir, "profile"))});
      app.whenReady().then(() => {
        // Block external requests before the first navigation, including fonts.
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
          callback({ cancel: new URL(details.url).origin !== ${JSON.stringify(url)} });
        });
        const window = new BrowserWindow({
          show: false, width: 1100, height: 750,
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
        });
        window.loadURL(${JSON.stringify(url)});
      });
    `);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({ executablePath: require("electron"), args: [shellPath], env });
    page = await electronApp.firstWindow();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => typeof window.mountBrowse === "function");

    const mount = async (scenario) => {
      await page.evaluate((value) => window.mountBrowse(value), scenario);
      await page.waitForFunction(() => window.browseMock.calls.length > 0);
    };
    const retry = () => page.getByRole("button", { name: "Tentar de novo", exact: true });
    const assertError = async (detail) => {
      const alert = page.getByRole("alert");
      await alert.waitFor({ state: "visible" });
      assert.ok((await alert.innerText()).includes(detail));
      assert.equal(await retry().isVisible(), true);
      assert.equal(await page.getByText("Carregando a lista de jogos…", { exact: true }).count(), 0);
      assert.equal(await page.getByText("Lendo a pasta Transfer…", { exact: true }).count(), 0);
    };
    const assertNoReports = async () => assert.deepEqual(await page.evaluate(() => window.browseMock.reports), []);
    const resolve = (id, value) => page.evaluate(({ id, value }) => window.browseMock.pending[id](value), { id, value });

    const refused = "connect ECONNREFUSED 127.0.0.1:8080";
    await mount({ online: [{ value: { ok: false, error: refused } }, { defer: "retry" }] });
    await assertError(refused);
    await assertNoReports(); // Main already reports the backend failure.
    if (process.env.GODSEND_TEST_SCREENSHOT) {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const screenshot = await electronApp.evaluate(async ({ BrowserWindow }) => {
        const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        return image.toPNG().toString("base64");
      });
      fs.writeFileSync(process.env.GODSEND_TEST_SCREENSHOT, Buffer.from(screenshot, "base64"));
    }
    await retry().click();
    await page.getByText("Carregando a lista de jogos…", { exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0, "retry clears the old error while loading");
    await resolve("retry", { ok: true, games: ["Halo 3 (USA)"] });
    await page.getByRole("button", { name: "Halo 3", exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    assert.equal(await page.evaluate(() => window.browseMock.calls.length), 2);
    process.stdout.write("PASS: backend detail, loading and successful retry\n");

    await mount({ online: [{ reject: "IPC channel disconnected" }], telemetryRejects: true });
    await assertError("IPC channel disconnected");
    const reports = await page.evaluate(() => window.browseMock.reports);
    assert.equal(reports.length, 1, "unexpected IPC rejection is reported exactly once");
    assert.deepEqual(reports[0].slice(0, 3), ["electron-renderer", "BrowsePage.tsx", "loadGames"]);
    assert.ok(reports[0][3].includes("IPC channel disconnected"));
    assert.ok(reports[0][5].some((line) => line.includes("platform=xbox360") && line.includes("source=unified")));
    await retry().click();
    await page.getByText("Nenhum jogo encontrado.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0, "even unavailable telemetry must allow retry");
    process.stdout.write("PASS: IPC rejection ends spinner and reports; telemetry failure preserves retry\n");

    await mount({ local: [{ value: { ok: false, error: "Transfer indisponível: EACCES" } }] });
    await page.getByText("Nenhum jogo encontrado.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Biblioteca Local", exact: true }).click();
    await assertError("Transfer indisponível: EACCES");
    assert.equal(await page.getByText("Nenhum jogo encontrado no pendrive ou na pasta Transfer.", { exact: true }).count(), 0);
    await assertNoReports();
    process.stdout.write("PASS: local backend failure is an error, not an empty library\n");

    await mount({ local: [{ reject: "IPC local disconnected" }] });
    await page.getByText("Nenhum jogo encontrado.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Biblioteca Local", exact: true }).click();
    await assertError("IPC local disconnected");
    const localReports = await page.evaluate(() => window.browseMock.reports);
    assert.equal(localReports.length, 1);
    assert.ok(localReports[0][5].some((line) => line.includes("platform=local") && line.includes("source=local")));
    process.stdout.write("PASS: local IPC rejection ends spinner and reports local context\n");

    await mount({ online: [{ value: { ok: true, loading: true, loaded: 2, total: 7 } }] });
    await page.getByText("Montando o cache…", { exact: true }).waitFor();
    assert.equal(await page.getByText("2 / 7 obtidos", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("alert").count(), 0);
    await retry().click();
    await page.getByText("Nenhum jogo encontrado.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Biblioteca Local", exact: true }).click();
    await page.getByText("Nenhum jogo encontrado no pendrive ou na pasta Transfer.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    await assertNoReports();
    process.stdout.write("PASS: cache-building and valid empty online/local responses remain normal\n");

    assert.deepEqual(pageErrors, [], "no unhandled renderer errors");
  } catch (error) {
    if (page) console.error("Screen:", await page.locator("body").innerText().catch(() => "unavailable"));
    if (pageErrors.length) console.error("Renderer errors:", pageErrors);
    throw error;
  } finally {
    if (electronApp) await electronApp.close();
    if (server) await server.close();
    // Only remove the dedicated directory this test created under the OS temp root.
    assert.equal(path.dirname(path.resolve(tempDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tempDir).startsWith("xbox360-browse-errors-"));
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
