const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function main() {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-preview-ui-"));
  const screenshotPath = process.env.GODSEND_TEST_SCREENSHOT || path.join(appData, "badavatar-preview.png");
  const packagedExecutable = process.env.GODSEND_TEST_EXECUTABLE;

  // Pre-configure the app to start in advanced mode (simpleMode: false)
  // We write to all candidate productName subdirectories to be bulletproof
  const dirs = [
    "Electron",
    "electron",
    "Xbox 360 Companion",
    "xbox-360-companion",
    "xbox-360-companion-electron",
    "godsend",
    "godsend-electron",
    "godsend-360"
  ];
  for (const dir of dirs) {
    const p = path.join(appData, dir);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "config.json"), JSON.stringify({ simpleMode: false }));
  }

  const env = { ...process.env, NODE_ENV: "development", APPDATA: appData };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({
    executablePath: packagedExecutable || require("electron"),
    args: packagedExecutable ? [] : [path.resolve(__dirname, "../../main.js")],
    env,
  });
  try {
    const page = await electronApp.firstWindow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForLoadState("domcontentloaded");

    // Click "Mais opções" and select "Preparar dispositivo" to navigate to badavatarusb page
    const toolboxBtn = page.getByRole("button", { name: "Mais opções", exact: true });
    await toolboxBtn.waitFor({ state: "visible" });
    await toolboxBtn.click();
    await page.getByText("Preparar dispositivo", { exact: true }).click();

    // Handle step wizard navigation to reach the final preparation page
    const detectHeading = page.getByRole("heading", { name: "Dispositivo Xbox 360 detectado!", exact: true });
    if (await detectHeading.count() > 0) {
      await page.getByRole("button", { name: "Preparar pendrive/HD", exact: true }).click();
    }

    const modeButton = page.getByRole("button", { name: "Xbox Bloqueado ou LT", exact: true });
    await modeButton.waitFor({ state: "visible" });
    await modeButton.click();
    await page.getByRole("button", { name: "Avançar", exact: true }).click();

    const heading = page.getByRole("heading", { name: "Prepare seu pendrive ou HD", exact: true });
    await heading.waitFor({ state: "visible" });

    assert.equal(await page.getByText("BadAvatar + Aurora", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Formatar antes", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("checkbox").count(), 2, "simple mode exposes only two choices");
    assert.equal(await page.getByRole("button", { name: "Adicionar jogos", exact: true }).count(), 0);

    const otherFunctions = page.getByRole("button", { name: "Outras funções", exact: true });
    assert.equal(await otherFunctions.count(), 1, "advanced functions are collapsed into one entry");
    await otherFunctions.click();
    const jog = page.getByText("Jogos e downloads", { exact: true });
    assert.ok(await jog.count() >= 1);
    assert.ok(await page.getByText("Configurações", { exact: true }).count() >= 1);

    const writeButton = page.getByRole("button", { name: "Preparar pendrive/HD", exact: true });
    assert.equal(await writeButton.count(), 1);
    assert.equal(await writeButton.isDisabled(), true, "a USB device and acknowledgement are still required");
    const unavailable = page.getByText(
      "A preparação automática ainda não está disponível nesta versão.",
      { exact: true },
    );
    await unavailable.waitFor({ state: "hidden" });
    assert.equal(await unavailable.count(), 0);

    await page.screenshot({ path: screenshotPath, fullPage: false });
    assert.ok(fs.statSync(screenshotPath).size > 10_000, "UI screenshot should contain a rendered page");
    process.stdout.write("Simple device preparation screen rendered; fixed payload is ready.\n");
  } catch (error) {
    console.error(error);
    try {
      const listDirs = (d) => {
        if (!fs.existsSync(d)) return;
        console.log("Contents of:", d, fs.readdirSync(d));
        for (const f of fs.readdirSync(d)) {
          const p = path.join(d, f);
          if (fs.statSync(p).isDirectory()) {
            listDirs(p);
          }
        }
      };
      listDirs(appData);
    } catch (e) {
      console.error("Failed to list dirs:", e);
    }
    throw error;
  } finally {
    await electronApp.close();
    fs.rmSync(appData, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 });
  }
}

main().catch((error) => {
  process.exit(1);
});
