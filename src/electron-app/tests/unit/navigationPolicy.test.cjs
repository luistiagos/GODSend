const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isAllowedApplicationNavigation,
} = require("../../infrastructure/navigationPolicy.js");

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

