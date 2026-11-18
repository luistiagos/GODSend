const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

// End-to-end test in real Electron + Chromium:
// mounts the real BadAvatarUsbPage.tsx, dispatches through the real preload.ts
// contextBridge -> ipcMain -> compiled ipc/badAvatarHandlers.js, and mocks only
// the physical USB enumeration/writer and telemetry sinks.
const appDir = path.resolve(__dirname, "../..");
const harnessPath = "/__badavatar-prepare-e2e-harness.jsx";
const harness = `
  import React from "react";
  import { createRoot } from "react-dom/client";
  import BadAvatarUsbPage from "/renderer/components/BadAvatarUsbPage.tsx";
  import "/renderer/index.css";

  let root;
  window.mountBadAvatarPage = () => {
    root?.unmount();
    root = createRoot(document.getElementById("root"));
    root.render(<BadAvatarUsbPage />);
  };
`;

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-badavatar-e2e-"));
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
        name: "badavatar-prepare-e2e-harness",
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
    const mainScript = path.join(tempDir, "main.cjs");
    const preloadFile = path.join(appDir, "preload.js");
    const handlersFile = path.join(appDir, "ipc", "badAvatarHandlers.js");

    fs.writeFileSync(mainScript, `
      const fs = require("node:fs");
      const Module = require("node:module");
      const { app, BrowserWindow, ipcMain, session } = require("electron");
      app.setPath("userData", ${JSON.stringify(path.join(tempDir, "profile"))});

      const state = global.__e2eState = {
        driveQueue: [],
        prepareImpl: null,
        listCalls: [],
        prepareCalls: [],
        events: [],
        reports: [],
      };

      const mocks = {
        "../infrastructure/fat32Format": { resolveFat32FormatExe: () => "C:\\\\tools\\\\fat32format.exe" },
        "../services/badAvatarUsbService": {
          formatRequiresElevation: () => true,
          isBadAvatarPreparationEnabled: () => true,
          isRunningAsAdmin: async () => false,
          listFat32UsbDrives: async (fresh) => {
            state.listCalls.push({ fresh: fresh === true });
            const next = state.driveQueue.length > 1 ? state.driveQueue.shift() : state.driveQueue[0];
            return typeof next === "function" ? next() : next;
          },
          setUsbPreparationActive: () => {},
        },
        "../app/window": {
          getWebContentsForPush: () => BrowserWindow.getAllWindows()[0]?.webContents ?? null,
        },
        "../services/preparationReadinessService": {
          inspectTrustedManifestReadiness: () => ({ ready: true }),
        },
        "../services/preparationPreviewService": {
          runTrustedPreparationPreview: async () => ({}),
        },
        "../services/fixedBadAvatarPreparationService": {
          inspectFixedPayloadReadiness: () => ({ ready: true, release: "badavatar-1.3" }),
          prepareFixedBadAvatarDevice: async (request, onProgress) => {
            state.prepareCalls.push(request);
            return state.prepareImpl(request, onProgress);
          },
        },
        "../infrastructure/serverLog": {
          appendAppEvent: (...args) => state.events.push(args),
        },
        "../infrastructure/telemetry": {
          reportError: (...args) => state.reports.push(args),
        },
        "../infrastructure/windowsSystemExecutables": {
          describeWindowsExecutableEnvironment: () => "mock-env",
        },
      };

      const filename = ${JSON.stringify(handlersFile)};
      const loaded = new Module(filename, module);
      loaded.filename = filename;
      loaded.paths = Module._nodeModulePaths(require("node:path").dirname(filename));
      const realRequire = loaded.require.bind(loaded);
      loaded.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id);
      loaded._compile(fs.readFileSync(filename, "utf8"), filename);
      loaded.exports.register(ipcMain);

      app.whenReady().then(() => {
        session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
          callback({ cancel: new URL(details.url).origin !== ${JSON.stringify(url)} });
        });
        const win = new BrowserWindow({
          show: false,
          width: 1200,
          height: 850,
          webPreferences: {
            preload: ${JSON.stringify(preloadFile)},
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        win.loadURL(${JSON.stringify(url)});
      });
    `);

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    electronApp = await electron.launch({
      executablePath: require("electron"),
      args: [mainScript],
      env,
    });
    const page = await electronApp.firstWindow();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(() => typeof window.mountBadAvatarPage === "function");

    const baseSeagateExfat = {
      rootPath: "D:\\",
      label: "NOVO_VOL",
      fileSystem: "exFAT",
      sizeBytes: 500_105_740_288,
      freeBytes: 500_000_000_000,
      fingerprint: "a".repeat(64),
      diskNumber: 1,
      diskUniqueId: "{11111111-2222-3333-4444-555555555555}",
      serialNumber: "SEAGATE-500GB-XYZ",
      volumeGuid: "\\\\?\\Volume{aaaaaaaa-0000-0000-0000-000000000001}\\",
      friendlyName: "ST500LM0 00-1EJ162",
      manufacturer: "Seagate",
      safety: { allowed: true, codes: [], reasons: [] },
    };
    const sameSeagateFat32 = {
      ...baseSeagateExfat,
      label: "BADAVATAR",
      fileSystem: "FAT32",
      fingerprint: "b".repeat(64),
      volumeGuid: "\\\\?\\Volume{bbbbbbbb-0000-0000-0000-000000000002}\\",
    };
    const swappedToshiba = {
      rootPath: "D:\\",
      label: "FOTOS_PESSOAIS",
      fileSystem: "NTFS",
      sizeBytes: 1_000_204_886_016,
      freeBytes: 400_000_000_000,
      fingerprint: "c".repeat(64),
      diskNumber: 1,
      diskUniqueId: "{99999999-8888-7777-6666-555555555555}",
      serialNumber: "TOSHIBA-1TB-OTHER",
      volumeGuid: "\\\\?\\Volume{cccccccc-0000-0000-0000-000000000003}\\",
      friendlyName: "TOSHIBA MQ01ABD100",
      manufacturer: "Toshiba",
      safety: { allowed: true, codes: [], reasons: [] },
    };

    const rawEnoent =
      "ENOENT: no such file or directory, open 'D:\\.xbox-downloader\\staging\\88096c0a-3075-5bd8-a705-de05de397b80\\apps\\Aurora\\nxeart.partial'";

    // Scenario 1: same HD was reformatted (exFAT -> FAT32), click Prepare once,
    // backend throws raw ENOENT; UI must auto-refresh before prepare, send fresh
    // fingerprint, show pendrive/HD message (no raw ENOENT/staging path), update
    // card to FAT32, and still preserve raw message in log + telemetry.
    await electronApp.evaluate(({ }, payload) => {
      const s = global.__e2eState;
      s.listCalls = [];
      s.prepareCalls = [];
      s.events = [];
      s.reports = [];
      s.driveQueue = [
        [payload.before],
        [payload.after],
        [payload.after],
      ];
      s.prepareImpl = async (_req, onProgress) => {
        onProgress({ status: "Copiando apps/Aurora/nxeart", percent: 31, detail: "55/621" });
        const err = new Error(payload.rawEnoent);
        err.code = "ENOENT";
        err.path = "D:\\.xbox-downloader\\staging\\88096c0a-3075-5bd8-a705-de05de397b80\\apps\\Aurora\\nxeart.partial";
        throw err;
      };
    }, { before: baseSeagateExfat, after: sameSeagateFat32, rawEnoent });

    await page.evaluate(() => {
      window.confirm = () => true;
      window.mountBadAvatarPage();
    });
    await page.getByRole("button", { name: "Xbox Bloqueado ou LT", exact: true }).click();
    await page.getByRole("button", { name: "Avançar", exact: true }).click();
    await page.getByText("exFAT", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("checkbox").nth(1).click();

    const prepareBtn = page.getByRole("button", { name: "Preparar pendrive/HD", exact: true });
    await prepareBtn.click();

    await page.getByText(/Não foi possível gravar no seu pendrive ou HD \(D:\)/).waitFor({ state: "visible" });
    await page.locator("span").filter({ hasText: /^FAT32$/ }).waitFor({ state: "visible" });

    const s1 = await electronApp.evaluate(() => global.__e2eState);
    assert.equal(s1.prepareCalls.length, 1);
    assert.equal(
      s1.prepareCalls[0].expectedDeviceFingerprint,
      sameSeagateFat32.fingerprint,
      "Preparo deve receber o fingerprint atualizado após o refresh automático no botão",
    );
    assert.ok(
      s1.listCalls.some((c) => c.fresh === true),
      "Clique em Preparar deve disparar listagem fresh=true",
    );
    assert.equal(s1.reports.length, 1);
    assert.equal(s1.reports[0][3], rawEnoent, "Telemetria deve manter a mensagem técnica bruta");
    assert.ok(s1.events.some((e) => e[0] === "BADAVATAR" && e[1].includes(rawEnoent)), "Log deve manter a mensagem técnica bruta");
    const pageText1 = await page.locator("main").innerText();
    assert.ok(!pageText1.includes(".xbox-downloader"), "UI não pode vazar .xbox-downloader");
    assert.ok(!pageText1.includes("ENOENT:"), "UI não pode vazar ENOENT cru");

    // Scenario 2: user swaps D:\ to another physical drive (Toshiba 1TB) before clicking Prepare.
    await electronApp.evaluate(({ }, payload) => {
      const s = global.__e2eState;
      s.prepareCalls = [];
      s.driveQueue = [
        [payload.seagate],
        [payload.toshiba],
      ];
    }, { seagate: sameSeagateFat32, toshiba: swappedToshiba });

    await page.evaluate(() => window.mountBadAvatarPage());
    await page.getByRole("button", { name: "Xbox Bloqueado ou LT", exact: true }).click();
    await page.getByRole("button", { name: "Avançar", exact: true }).click();
    await page.locator("span").filter({ hasText: /ST500LM0/ }).waitFor({ state: "visible" });
    await page.getByRole("checkbox").nth(1).click();
    await page.getByRole("button", { name: "Preparar pendrive/HD", exact: true }).click();

    await page.getByText(/mudou desde a seleção anterior/i).waitFor({ state: "visible" });
    await page.locator("span").filter({ hasText: /TOSHIBA MQ01ABD100/ }).waitFor({ state: "visible" });
    const s2 = await electronApp.evaluate(() => global.__e2eState);
    assert.equal(s2.prepareCalls.length, 0, "Troca de dispositivo físico deve bloquear antes de chamar prepare");

    // Scenario 3: user cancels format confirm -> button re-enables cleanly without invoking prepare.
    await electronApp.evaluate(({ }, payload) => {
      const s = global.__e2eState;
      s.prepareCalls = [];
      s.driveQueue = [[payload.seagate], [payload.seagate]];
    }, { seagate: baseSeagateExfat });

    await page.evaluate(() => {
      window.confirm = () => false;
      window.mountBadAvatarPage();
    });
    await page.getByRole("button", { name: "Xbox Bloqueado ou LT", exact: true }).click();
    await page.getByRole("button", { name: "Avançar", exact: true }).click();
    await page.getByText("exFAT", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("checkbox").nth(0).click();
    await page.getByRole("checkbox").nth(1).click();
    await page.getByRole("button", { name: "Preparar pendrive/HD", exact: true }).click();

    const btn3 = page.getByRole("button", { name: "Preparar pendrive/HD", exact: true });
    await btn3.waitFor({ state: "visible" });
    assert.equal(await btn3.isDisabled(), false);
    const s3 = await electronApp.evaluate(() => global.__e2eState);
    assert.equal(s3.prepareCalls.length, 0);

    // Scenario 4: Wesley-style raw PowerShell/fat32format/Set-Partition/diskpart trace ->
    // UI must show simple layman message (no DiskPart/Set-Partition/clusters/ps1 path)
    // while log and telemetry keep the full technical trace.
    const rawPsFormatError =
      "clusters 1919060 Free Clusters Formatting drive D:... Done fat32format.exe realizado com sucesso. " +
      "Particao marcada com tipo 4, nao FAT32; Set-Partition recusou; tentando pelo diskpart... " +
      "A formatacao terminou, mas o Xbox 360 nao vai ler o disco: particao com tipo 4, nao FAT32 (11 ou 12). " +
      "No C:\\Users\\WESLEY\\AppData\\Local\\Temp\\godsend_fat32_1794875583529.ps1:449 caractere:7 + CategoryInfo : OperationStopped";

    await electronApp.evaluate(({ }, payload) => {
      const s = global.__e2eState;
      s.prepareCalls = [];
      s.events = [];
      s.reports = [];
      s.driveQueue = [[payload.seagate], [payload.seagate], [payload.seagate]];
      s.prepareImpl = async () => {
        throw new Error(payload.rawPsFormatError);
      };
    }, { seagate: baseSeagateExfat, rawPsFormatError });

    await page.evaluate(() => {
      window.confirm = () => true;
      window.mountBadAvatarPage();
    });
    await page.getByRole("button", { name: "Xbox Bloqueado ou LT", exact: true }).click();
    await page.getByRole("button", { name: "Avançar", exact: true }).click();
    await page.getByText("exFAT", { exact: true }).waitFor({ state: "visible" });
    await page.getByRole("checkbox").nth(1).click();
    await page.getByRole("button", { name: "Preparar pendrive/HD", exact: true }).click();

    await page.getByText(/Este pendrive ou HD \(D:\) não ficou em um formato que o Xbox 360 consiga ler/i).waitFor({ state: "visible" });
    const pageText4 = await page.locator("main").innerText();
    assert.ok(!/DiskPart|Set-Partition|godsend_fat32|CategoryInfo|tipo 4/i.test(pageText4));
    const s4 = await electronApp.evaluate(() => global.__e2eState);
    assert.equal(s4.reports[0][3], rawPsFormatError);
    assert.ok(s4.events.some((e) => e[0] === "BADAVATAR" && e[1].includes(rawPsFormatError)));

    assert.deepEqual(pageErrors, []);
    process.stdout.write("E2E BadAvatar prepare flow verified across all 4 scenarios.\n");
  } finally {
    if (electronApp) await electronApp.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
