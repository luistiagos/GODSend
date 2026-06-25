const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function main() {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-preview-ui-"));
  const screenshotPath = process.env.GODSEND_TEST_SCREENSHOT || path.join(appData, "badavatar-preview.png");
  const packagedExecutable = process.env.GODSEND_TEST_EXECUTABLE;
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

    const heading = page.getByRole("heading", { name: "Prepare seu pendrive ou HD", exact: true });
    await heading.waitFor({ state: "visible" });

    assert.equal(await page.getByText("BadAvatar + Aurora", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Formatar antes", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("checkbox").count(), 2, "simple mode exposes only two choices");
    assert.equal(await page.getByRole("button", { name: "Adicionar jogos", exact: true }).count(), 0);

    const otherFunctions = page.getByRole("button", { name: "Outras funções", exact: true });
    assert.equal(await otherFunctions.count(), 1, "advanced functions are collapsed into one entry");
    await otherFunctions.click();
    assert.equal(await page.getByText("Jogos e downloads", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Configurações", { exact: true }).count(), 1);

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
  } finally {
    await electronApp.close();
    fs.rmSync(appData, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
