const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

// Exercise the real BrowsePage + QueueDialog in Chromium without bootstrapping the application.
// Run from any directory: node src/electron-app/tests/electron/browse-queue-dialog-smoke.cjs
const appDir = path.resolve(__dirname, "../..");
const harnessPath = "/__browse-queue-dialog-harness.jsx";
const harness = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import BrowsePage from "/renderer/components/BrowsePage.tsx";
  import "/renderer/index.css";

  let root;
  window.mountBrowseQueue = (scenario = {}) => {
    root?.unmount();
    const mock = window.browseQueueMock = {
      queuedRequests: [],
      navigateQueueCalls: 0,
    };
    window.godsendApi = {
      toolsBadAvatarListDrives: async () => ({
        ok: true,
        drives: scenario.localDrives || [{ rootPath: "F:/", label: "BADAVATAR", freeBytes: 16 * 1024 ** 3 }],
      }),
      getDefaultXboxDrive: async () => "Hdd1:",
      listXboxDrives: async () => ({ ok: true, drives: ["Hdd1:"] }),
      getXboxConnection: async () => ({ xboxIp: scenario.xboxIp || "192.168.1.50" }),
      browseGetInstalledGames: async () => ({ ok: true, games: [] }),
      browseGetReleaseGroups: async () => ({
        ok: true,
        releases: scenario.releases || [],
      }),
      browseFetchCover: async () => ({ ok: false }),
      browseGetDiscInfo: async () => ({ ok: true, recommendation: "god" }),
      browseGetGames: async () => ({
        ok: true,
        games: scenario.games || ["Call of Duty - Black Ops III (USA)"],
      }),
      browseQueueGame: async (payload) => {
        mock.queuedRequests.push(payload);
        return scenario.queueResponse || { ok: true, status: "triggered", source: "unified" };
      },
      reportError: async () => {},
    };
    root = createRoot(document.getElementById("root"));
    root.render(
      <BrowsePage
        onNavigateQueue={() => {
          mock.navigateQueueCalls += 1;
        }}
      />
    );
  };
`;

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-browse-queue-dialog-"));
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
        name: "browse-queue-dialog-test-harness",
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
    await page.waitForFunction(() => typeof window.mountBrowseQueue === "function");

    // 1. Single-disc USB queue flow
    await page.evaluate(() => window.mountBrowseQueue());
    await page.getByRole("button", { name: "Call of Duty - Black Ops III", exact: true }).click();
    await page.getByRole("button", { name: "Adicionar à fila", exact: true }).click();

    const statusBanner = page.getByRole("status");
    await statusBanner.waitFor({ state: "visible" });
    const singleUsbText = await statusBanner.innerText();
    assert.ok(singleUsbText.includes("Adicionado à fila!"), `unexpected status text: ${singleUsbText}`);
    assert.match(singleUsbText, /aba Fila até aparecer “Pronto” antes de desconectar o pendrive/i);
    assert.doesNotMatch(singleUsbText, /triggered|Status:/i);

    assert.equal(await page.getByRole("button", { name: "Concluído", exact: true }).count(), 0);
    const dismissBtn = page.getByRole("button", { name: "Entendi", exact: true });
    const goToQueueBtn = page.getByRole("button", { name: "Ir para a Fila", exact: true });
    assert.equal(await dismissBtn.isVisible(), true);
    assert.equal(await goToQueueBtn.isVisible(), true);

    await goToQueueBtn.click();
    assert.equal(await page.evaluate(() => window.browseQueueMock.navigateQueueCalls), 1);
    process.stdout.write("PASS: single-disc USB queue confirmation avoids triggered/Concluido and links to Queue tab\n");

    // 2. Multi-disc FTP queue flow
    await page.evaluate(() => window.mountBrowseQueue({
      games: ["Halo 4 (USA) (Disc 1)", "Halo 4 (USA) (Disc 2)"],
      releases: [{
        release_title: "Halo 4 (USA)",
        disc_count: 2,
        missing_discs: null,
        discs: [
          { name: "Halo 4 (USA) (Disc 1)", disc_number: 1, subtitle: "Play" },
          { name: "Halo 4 (USA) (Disc 2)", disc_number: 2, subtitle: "Install" },
        ],
      }],
    }));
    await page.getByRole("button", { name: /Halo 4/i }).click();
    await page.getByRole("button", { name: "Enviar via FTP", exact: true }).click();
    await page.getByRole("button", { name: "Baixar todos os 2 discos", exact: true }).click();

    await statusBanner.waitFor({ state: "visible" });
    const multiFtpText = await statusBanner.innerText();
    assert.ok(multiFtpText.includes("Todos os 2 discos foram adicionados à fila!"), `unexpected multi-disc text: ${multiFtpText}`);
    assert.match(multiFtpText, /envio para o console começaram em segundo plano/i);
    assert.match(multiFtpText, /aba Fila até aparecer “Pronto”/i);
    assert.doesNotMatch(multiFtpText, /triggered|Status:|pendrive/i);
    assert.equal(await page.getByRole("button", { name: "Concluído", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Entendi", exact: true }).click();
    process.stdout.write("PASS: multi-disc FTP queue confirmation guides user cleanly\n");

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
