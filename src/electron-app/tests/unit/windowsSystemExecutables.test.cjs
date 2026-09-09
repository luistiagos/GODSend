const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { existsSync } = require("node:fs");

const {
  windowsSystemRoot,
  system32Exe,
  powerShellExe,
  isExecutableNotFound,
  powerShellMissingMessage,
  describeWindowsExecutableEnvironment,
} = require("../../infrastructure/windowsSystemExecutables.js");

/** Runs `fn` with PATH/USERPROFILE swapped, restoring them afterwards. */
function withEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) saved[key] = process.env[key];
  Object.assign(process.env, overrides);
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("prefere o PowerShell do PATH quando o PATH tem um", (t) => {
  if (process.platform !== "win32") {
    t.skip("resolucao de System32 disponivel somente no Windows");
    return;
  }
  // Uma pasta que existe e nao contem powershell.exe, seguida da que contem:
  // a resolucao tem de pular a primeira e devolver a segunda, nao a primeira.
  const real = path.join(windowsSystemRoot(), "System32", "WindowsPowerShell", "v1.0");
  const resolved = withEnv({ PATH: `${windowsSystemRoot()};${real}`, Path: `${windowsSystemRoot()};${real}` }, () =>
    powerShellExe(),
  );
  assert.equal(resolved.toLowerCase(), path.join(real, "powershell.exe").toLowerCase());
  assert.ok(existsSync(resolved), `PowerShell nao encontrado em ${resolved}`);
});

test("cai para System32 quando o PATH nao resolve", (t) => {
  if (process.platform !== "win32") {
    t.skip("resolucao de System32 disponivel somente no Windows");
    return;
  }
  const resolved = withEnv({ PATH: "C:\\NaoExiste", Path: "C:\\NaoExiste" }, () => powerShellExe());
  assert.ok(path.isAbsolute(resolved), `esperado caminho absoluto, veio ${resolved}`);
  assert.ok(existsSync(resolved), `PowerShell nao encontrado em ${resolved}`);
  assert.equal(
    resolved.toLowerCase(),
    path
      .join(windowsSystemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      .toLowerCase(),
  );
});

test("mantem o nome simples quando nao ha PATH nem arquivo em System32", () => {
  const resolved = withEnv({ PATH: "C:\\NaoExiste", Path: "C:\\NaoExiste" }, () =>
    system32Exe("nao-existe-godsend.exe", "fallback.exe"),
  );
  assert.equal(resolved, "fallback.exe");
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

test("diagnostico separa PATH quebrado de arquivo ausente", (t) => {
  if (process.platform !== "win32") {
    t.skip("diagnostico de PATH disponivel somente no Windows");
    return;
  }
  // O PATH da maquina de desenvolvimento: PowerShell no disco e na lista.
  const saudavel = describeWindowsExecutableEnvironment();
  assert.match(saudavel, /powershellNoDisco=true/);
  assert.match(saudavel, /pathTemSystem32=true/);
  assert.match(saudavel, /pathTemWindowsPowerShell=true/);

  // O caso do print: o arquivo continua no disco, o PATH e que perdeu a pasta.
  const quebrado = withEnv({ PATH: "C:\\NaoExiste", Path: "C:\\NaoExiste" }, () =>
    describeWindowsExecutableEnvironment(),
  );
  assert.match(quebrado, /powershellNoDisco=true/);
  assert.match(quebrado, /pathTemSystem32=false/);
  assert.match(quebrado, /pathTemWindowsPowerShell=false/);
  assert.match(quebrado, /pathEntradas=1/);
});

test("diagnostico mascara a pasta do perfil antes de sair da maquina", (t) => {
  if (process.platform !== "win32") {
    t.skip("diagnostico de PATH disponivel somente no Windows");
    return;
  }
  const perfil = "C:\\Users\\Fulano De Tal";
  const linha = withEnv(
    {
      USERPROFILE: perfil,
      PATH: `${perfil}\\AppData\\Local\\Programs\\algo;C:\\Windows\\System32`,
      Path: `${perfil}\\AppData\\Local\\Programs\\algo;C:\\Windows\\System32`,
    },
    () => describeWindowsExecutableEnvironment(),
  );
  assert.ok(!linha.includes("Fulano"), `nome do usuario vazou: ${linha}`);
  assert.match(linha, /%USERPROFILE%\\AppData/);
  assert.match(linha, /pathTemSystem32=true/);
});
