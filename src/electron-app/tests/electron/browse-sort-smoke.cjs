const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

// Exercise BrowsePage catalog sorting in Chromium:
// default "Mais populares" -> coverless items move to the end -> toggle to "Ordem alfabética" and back.
const appDir = path.resolve(__dirname, "../..");
const harnessPath = "/__browse-sort-harness.jsx";
const FAKE_COVER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const harness = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import BrowsePage from "/renderer/components/BrowsePage.tsx";
  import "/renderer/index.css";

  let root;
  window.mountBrowseSort = (scenario = {}) => {
    root?.unmount();
    const coverless = new Set(scenario.coverless || []);
    window.godsendApi = {
      toolsBadAvatarListDrives: async () => ({ ok: true, drives: [] }),
      getDefaultXboxDrive: async () => "Hdd1:",
      listXboxDrives: async () => ({ ok: true, drives: ["Hdd1:"] }),
      browseGetInstalledGames: async () => ({ ok: true, games: [] }),
      browseGetReleaseGroups: async () => ({ ok: true, releases: [] }),
      browseGetCoverHints: async () => ({
        ok: true,
        hasCover: scenario.hintHasCover || [],
        noCover: scenario.hintNoCover || [],
        withHint: [],
      }),
      browseFetchCover: async (name) => {
        if (coverless.has(name)) return { ok: false };
        return { ok: true, dataUrl: ${JSON.stringify(FAKE_COVER)} };
      },
      browseGetGames: async () => ({
        ok: true,
        games: scenario.games || [
          "0-D Beat Drop (USA)",
          "Alan Wake (USA)",
          "Zumba Fitness (USA)",
          "Minecraft (USA)",
          "Grand Theft Auto V (USA)",
        ],
      }),
      reportError: async () => {},
    };
    root = createRoot(document.getElementById("root"));
    root.render(<BrowsePage />);
  };
`;

async function getCardTitles(page) {
  return page.locator(".grid > button > span:first-of-type").allInnerTexts();
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-browse-sort-"));
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
        name: "browse-sort-test-harness",
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
    await page.waitForFunction(() => typeof window.mountBrowseSort === "function");

    await page.evaluate(() => window.mountBrowseSort({
      coverless: ["0-D Beat Drop", "Alan Wake"],
    }));

    const popBtn = page.getByRole("button", { name: "Mais populares", exact: true });
    const alphaBtn = page.getByRole("button", { name: "Ordem alfabética", exact: true });
    assert.equal(await popBtn.getAttribute("aria-pressed"), "true");
    assert.equal(await alphaBtn.getAttribute("aria-pressed"), "false");

    // Wait for lazy cover fetches (150ms debounce) so coverless items move to the end
    await page.waitForFunction(() => {
      const spans = Array.from(document.querySelectorAll(".grid > button > span:first-of-type")).map((el) => el.textContent);
      return spans.length === 5 && spans[3] === "Alan Wake" && spans[4] === "0-D Beat Drop";
    });

    const popularTitles = await getCardTitles(page);
    assert.deepEqual(popularTitles, [
      "Grand Theft Auto V",
      "Minecraft",
      "Zumba Fitness",
      "Alan Wake",
      "0-D Beat Drop",
    ]);

    // Toggle to alphabetical order: coverless items must still remain at the end
    await alphaBtn.click();
    assert.equal(await alphaBtn.getAttribute("aria-pressed"), "true");
    assert.equal(await popBtn.getAttribute("aria-pressed"), "false");
    const alphaTitles = await getCardTitles(page);
    assert.deepEqual(alphaTitles, [
      "Grand Theft Auto V",
      "Minecraft",
      "Zumba Fitness",
      "0-D Beat Drop",
      "Alan Wake",
    ]);

    // Toggle back to popular order
    await popBtn.click();
    assert.equal(await popBtn.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await getCardTitles(page), popularTitles);

    assert.deepEqual(pageErrors, [], "no unhandled renderer errors");
    process.stdout.write("PASS: catalog defaults to popular, places coverless items last, and toggles with alphabetical order\n");
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
