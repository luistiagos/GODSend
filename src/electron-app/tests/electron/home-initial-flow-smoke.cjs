const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

// Exercise the HomePage initial flow choice in Chromium:
// 1. Starts on the detailed 2-option welcome screen ("Catálogo de Jogos" / "Preparar Pendrive / HD"),
//    even when a prepared USB drive is already connected.
// 2. Clicking "Catálogo de Jogos" navigates directly to the catalog.
// 3. Clicking "Preparar Pendrive / HD" enters the existing USB/unlock preparation flow.
const appDir = path.resolve(__dirname, "../..");
const harnessPath = "/__home-initial-flow-harness.jsx";
const harness = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import HomePage from "/renderer/components/HomePage.tsx";
  import "/renderer/index.css";

  let root;
  window.mountHome = (scenario = {}) => {
    root?.unmount();
    const mock = window.homeMock = {
      browseCalls: 0,
      queueCalls: 0,
    };
    window.godsendApi = {
      getXboxConnection: async () => ({ xboxIp: "" }),
      toolsBadAvatarListDrives: async () => ({
        ok: true,
        drives: scenario.drives || [],
      }),
      getAutoCheckUpdates: async () => ({ ok: true, enabled: true }),
      browseGetInstalledGames: async () => ({ ok: true, games: scenario.installedGames || [] }),
    };
    root = createRoot(document.getElementById("root"));
    root.render(
      <HomePage
        outputLines={[]}
        logInfo={null}
        ftpStatus="disconnected"
        onNavigateSettings={() => {}}
        onNavigateQueue={() => { mock.queueCalls += 1; }}
        onNavigateBrowse={() => { mock.browseCalls += 1; }}
        onNavigateIso2God={() => {}}
        onNavigateIso2Xex={() => {}}
        onNavigateFtpManager={() => {}}
        onNavigateBadAvatarUsb={() => {}}
        onNavigateUsbGames={() => {}}
        onNavigateHome={() => {}}
        onLibraryToggle={() => {}}
        onReconnect={() => {}}
        libraryLoading={false}
        onAppendLine={() => {}}
        queueJobs={scenario.queueJobs || []}
        simpleMode={true}
      />
    );
  };
`;

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-home-initial-flow-"));
  let server;
  let electronApp;
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
        name: "home-initial-flow-test-harness",
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
    const page = await electronApp.firstWindow();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => typeof window.mountHome === "function");

    // 1. Even with a prepared USB connected, start on the initial 2-option choice screen
    await page.evaluate(() => window.mountHome({
      drives: [{ rootPath: "F:/", label: "XBOX", preparedState: "preparado-bloqueado-lt" }],
      installedGames: [{ name: "Halo 3" }],
    }));

    const welcomeHeading = page.getByRole("heading", { name: "O que você deseja fazer agora?", exact: true });
    await welcomeHeading.waitFor({ state: "visible" });
    const catalogBtn = page.getByRole("button", { name: /Catálogo de Jogos/i });
    const prepareBtn = page.getByRole("button", { name: /Preparar Pendrive \/ HD/i });
    assert.equal(await catalogBtn.isVisible(), true);
    assert.equal(await prepareBtn.isVisible(), true);

    await catalogBtn.click();
    assert.equal(await page.evaluate(() => window.homeMock.browseCalls), 1);
    process.stdout.write("PASS: initial choice displays both flows and Catálogo de Jogos opens catalog directly\n");

    // 2. Selecting "Preparar Pendrive / HD" with prepared USB enters the normal prepared-detected flow
    await prepareBtn.click();
    await page.getByRole("heading", { name: "Pendrive com o desbloqueio BadAvatar detectado!", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: /Voltar para a tela inicial/i }).click();
    await welcomeHeading.waitFor({ state: "visible" });
    process.stdout.write("PASS: Preparar Pendrive / HD enters normal preparation flow and returns cleanly\n");

    // 3. Selecting "Preparar Pendrive / HD" without USB enters unlock selection flow
    await page.evaluate(() => window.mountHome({ drives: [] }));
    await welcomeHeading.waitFor({ state: "visible" });
    await page.getByRole("button", { name: /Preparar Pendrive \/ HD/i }).click();
    await page.getByRole("heading", { name: "Modo de Instalação", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    await welcomeHeading.waitFor({ state: "visible" });
    process.stdout.write("PASS: Preparar Pendrive / HD without USB enters unlock flow and allows going back\n");

    assert.deepEqual(pageErrors, [], "no unhandled renderer errors");
  } finally {
    await electronApp?.close();
    await server?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
