const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { focusMainWindow, setMainWindowRef } = require("../../app/window.js");

test("focusMainWindow restaura, exibe e foca janela minimizada ou oculta", () => {
  let restored = false;
  let shown = false;
  let focused = false;
  let minimized = true;
  let visible = false;

  const mockWindow = {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    isVisible: () => visible,
    restore: () => {
      restored = true;
      minimized = false;
    },
    show: () => {
      shown = true;
      visible = true;
    },
    focus: () => {
      focused = true;
    },
  };

  // Inject mock window using setMainWindowForTesting
  const { setMainWindowForTesting } = require("../../app/window.js");
  setMainWindowForTesting(mockWindow);

  focusMainWindow();

  assert.equal(restored, true, "deve restaurar janela se minimizada");
  assert.equal(shown, true, "deve exibir janela se oculta na bandeja");
  assert.equal(focused, true, "deve dar foco na janela");

  // Clean up
  setMainWindowForTesting(null);
});

test("focusMainWindow ignora chamada com janela nula ou destruída", () => {
  const { setMainWindowForTesting } = require("../../app/window.js");
  setMainWindowForTesting(null);
  assert.doesNotThrow(() => focusMainWindow());

  setMainWindowForTesting({
    isDestroyed: () => true,
    restore: () => { throw new Error("não deve chamar restore em destruída"); },
    show: () => { throw new Error("não deve chamar show em destruída"); },
    focus: () => { throw new Error("não deve chamar focus em destruída"); },
  });
  assert.doesNotThrow(() => focusMainWindow());
  setMainWindowForTesting(null);
});

test("configuração portátil usa unpackDirName: true para isolar cada execução", () => {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  assert.equal(
    pkg.build?.portable?.unpackDirName,
    true,
    "unpackDirName deve ser true para que o electron-builder não defina pasta fixa em %TEMP% que apaga binários de outras instâncias",
  );
});

test("main.ts invoca requestSingleInstanceLock antes de registrar esquemas ou subir UI", () => {
  const mainPath = path.resolve(__dirname, "../../main.ts");
  const mainSrc = fs.readFileSync(mainPath, "utf8");

  assert.match(
    mainSrc,
    /app\.requestSingleInstanceLock\(\)/,
    "main.ts deve chamar app.requestSingleInstanceLock()",
  );
  assert.match(
    mainSrc,
    /if\s*\(!gotSingleInstanceLock\)[\s\S]*?app\.quit\(\);/,
    "segunda instância deve chamar app.quit() imediatamente",
  );
});
