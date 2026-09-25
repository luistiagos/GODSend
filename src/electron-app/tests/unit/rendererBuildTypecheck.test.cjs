const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("renderer:typecheck está configurado e integrado a test:safety e renderer:build", () => {
  const pkgPath = path.resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

  assert.ok(pkg.scripts, "scripts deve existir no package.json");
  assert.ok(
    pkg.scripts["renderer:typecheck"],
    "deve declarar o script renderer:typecheck"
  );
  assert.match(
    pkg.scripts["renderer:typecheck"],
    /tsc\s+--noEmit\s+-p\s+renderer\/tsconfig\.json/,
    "renderer:typecheck deve rodar tsc --noEmit com renderer/tsconfig.json"
  );

  assert.ok(
    pkg.scripts["renderer:build"],
    "deve declarar o script renderer:build"
  );
  assert.match(
    pkg.scripts["renderer:build"],
    /renderer:typecheck/,
    "renderer:build deve executar a checagem de tipos antes do vite build"
  );

  assert.ok(
    pkg.scripts["test:safety"],
    "deve declarar o script test:safety"
  );
  assert.match(
    pkg.scripts["test:safety"],
    /renderer:typecheck/,
    "test:safety deve executar a checagem de tipos do renderer"
  );
});
