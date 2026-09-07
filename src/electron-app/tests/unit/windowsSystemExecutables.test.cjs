const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { existsSync } = require("node:fs");

const {
  windowsSystemRoot,
  system32Exe,
  powerShellExe,
  POWERSHELL_EXE_PS_EXPRESSION,
  isExecutableNotFound,
  powerShellMissingMessage,
} = require("../../infrastructure/windowsSystemExecutables.js");

test("resolve o PowerShell por caminho absoluto, sem depender do PATH", (t) => {
  if (process.platform !== "win32") {
    t.skip("resolucao de System32 disponivel somente no Windows");
    return;
  }
  const resolved = powerShellExe();
  assert.ok(path.isAbsolute(resolved), `esperado caminho absoluto, veio ${resolved}`);
  assert.ok(existsSync(resolved), `PowerShell nao encontrado em ${resolved}`);
  assert.equal(
    resolved.toLowerCase(),
    path
      .join(windowsSystemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      .toLowerCase(),
  );
});

test("mantem o nome simples quando o arquivo nao existe em System32", () => {
  assert.equal(system32Exe("nao-existe-godsend.exe", "fallback.exe"), "fallback.exe");
});

test("expressao de elevacao preserva as barras do caminho do interpretador", () => {
  assert.ok(POWERSHELL_EXE_PS_EXPRESSION.includes("System32\\WindowsPowerShell\\v1.0\\powershell.exe"));
  assert.ok(!POWERSHELL_EXE_PS_EXPRESSION.includes("System32WindowsPowerShell"));
});

test("ENOENT vira mensagem explicativa em portugues", () => {
  const enoent = Object.assign(new Error("spawn powershell.exe ENOENT"), { code: "ENOENT" });
  assert.equal(isExecutableNotFound(enoent), true);
  assert.equal(isExecutableNotFound(Object.assign(new Error("x"), { code: "EACCES" })), false);
  assert.equal(isExecutableNotFound(null), false);

  const message = powerShellMissingMessage();
  assert.ok(message.includes("PowerShell"));
  assert.ok(message.includes("PATH"));
  assert.ok(!/ENOENT/.test(message));
});
