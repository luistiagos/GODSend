const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function main() {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-electron-smoke-"));
  const env = {
    ...process.env,
    NODE_ENV: "development",
    APPDATA: appData,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({
    executablePath: require("electron"),
    args: [path.resolve(__dirname, "../../main.js")],
    env,
  });
  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const state = await page.evaluate(() => ({
      title: document.title,
      hasApi: typeof window.godsendApi === "object",
      nodeRequireType: typeof window.require,
      processType: typeof window.process,
      hasPreviewCancel: typeof window.godsendApi?.toolsBadAvatarPreviewCancel === "function",
      hasFixedPreparation: typeof window.godsendApi?.toolsBadAvatarPrepare === "function",
      hasLegacyWriter: typeof window.godsendApi?.toolsBadAvatarCreate === "function",
    }));
    assert.equal(state.title, "GODsend");
    assert.equal(state.hasApi, true, "sandboxed preload must expose godsendApi");
    assert.equal(state.nodeRequireType, "undefined", "renderer must not expose require");
    assert.equal(state.processType, "undefined", "renderer must not expose process");
    assert.equal(state.hasPreviewCancel, true, "preload must expose preview cancellation");
    assert.equal(state.hasFixedPreparation, true, "preload must expose fixed transactional preparation");
    assert.equal(state.hasLegacyWriter, false, "preload must not expose the legacy physical writer");
    process.stdout.write(`${JSON.stringify(state)}\n`);
  } finally {
    await electronApp.close();
    fs.rmSync(appData, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
