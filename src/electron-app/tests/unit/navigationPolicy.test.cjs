const test = require("node:test");
const assert = require("node:assert/strict");

const {
  XBOX360_SYSTEM_UPDATE_USB_URL,
  isAllowedApplicationNavigation,
  isAllowedExternalLink,
} = require("../../infrastructure/navigationPolicy.js");

test("link externo: só a atualização 17559 oficial, pela URL exata", () => {
  assert.equal(XBOX360_SYSTEM_UPDATE_USB_URL, "https://www.xbox.com/system-update-usb");
  assert.equal(isAllowedExternalLink(XBOX360_SYSTEM_UPDATE_USB_URL), true);
  for (const target of [
    "http://www.xbox.com/system-update-usb",
    "https://www.xbox.com/system-update-cd",
    "https://www.xbox.com/system-update-usb/../evil",
    "https://www.xbox.com/",
    "https://www.xbox.com.evil.test/system-update-usb",
    "https://example.test/",
    "javascript:alert(1)",
    "file:///C:/Windows/System32/cmd.exe",
    "",
  ]) {
    assert.equal(isAllowedExternalLink(target), false, target);
  }
});

test("produção aceita somente o mesmo arquivo local", () => {
  const current = "file:///C:/Program%20Files/App/renderer-dist/index.html?nocache=1";
  assert.equal(
    isAllowedApplicationNavigation(
      "file:///C:/Program%20Files/App/renderer-dist/index.html?nocache=2",
      current,
    ),
    true,
  );
  assert.equal(
    isAllowedApplicationNavigation("file:///C:/Windows/System32/drivers/etc/hosts", current),
    false,
  );
});

test("bloqueia javascript, data e páginas web externas", () => {
  const current = "file:///C:/App/index.html";
  for (const target of [
    "javascript:alert(1)",
    "data:text/html,evil",
    "https://example.test/",
    "http://127.0.0.1:8080/",
  ]) {
    assert.equal(isAllowedApplicationNavigation(target, current), false);
  }
});

test("desenvolvimento aceita apenas a origem configurada", () => {
  const developmentServer = "http://127.0.0.1:5173";
  assert.equal(
    isAllowedApplicationNavigation(
      "http://127.0.0.1:5173/settings",
      "http://127.0.0.1:5173/",
      developmentServer,
    ),
    true,
  );
  assert.equal(
    isAllowedApplicationNavigation(
      "http://localhost:5173/settings",
      "http://127.0.0.1:5173/",
      developmentServer,
    ),
    false,
  );
});

