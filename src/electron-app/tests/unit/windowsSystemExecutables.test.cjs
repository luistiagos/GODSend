const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { existsSync, mkdtempSync, writeFileSync, rmSync } = require("node:fs");

const {
  windowsSystemRoot,
  system32Exe,
  powerShellExe,
  isResolvedSystemExe,
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

test("ignora um powershell.exe plantado no PATH e usa o de System32", (t) => {
  if (process.platform !== "win32") {
    t.skip("resolucao de System32 disponivel somente no Windows");
    return;
  }
  // Qualquer pasta gravavel pelo usuario que esteja no PATH serve de vetor:
  // o binario plantado seria lancado, e em fat32Format.ts com direitos de
  // administrador, sob o UAC que o usuario aprova achando ser a formatacao.
  const plantado = mkdtempSync(path.join(os.tmpdir(), "godsend-path-"));
  try {
    writeFileSync(path.join(plantado, "powershell.exe"), "nao sou o PowerShell");
    const resolvido = withEnv({ PATH: plantado, Path: plantado }, () => powerShellExe());
    assert.equal(
      resolvido.toLowerCase(),
      path
        .join(windowsSystemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        .toLowerCase(),
      `resolucao caiu no binario plantado: ${resolvido}`,
    );
    // Mesmo vetor para as outras ferramentas de System32 que o app dispara.
    writeFileSync(path.join(plantado, "net.exe"), "nao sou o net");
    const net = withEnv({ PATH: plantado, Path: plantado }, () => system32Exe("net.exe", "net"));
    assert.equal(
      net.toLowerCase(),
      path.join(windowsSystemRoot(), "System32", "net.exe").toLowerCase(),
      `resolucao caiu no binario plantado: ${net}`,
    );
  } finally {
    rmSync(plantado, { recursive: true, force: true });
  }
});

test("so aceita elevar um caminho absoluto verificado", (t) => {
  if (process.platform !== "win32") {
    t.skip("resolucao de System32 disponivel somente no Windows");
    return;
  }
  // O guarda de runPs1Elevated: nome simples volta a depender do %PATH% dentro
  // do processo elevado, que e exatamente onde o binario plantado ganharia
  // administrador.
  assert.equal(isResolvedSystemExe("powershell.exe"), false);
  assert.equal(isResolvedSystemExe(path.join(windowsSystemRoot(), "System32", "nao-existe.exe")), false);
  assert.equal(isResolvedSystemExe(powerShellExe()), true);
});

test("resolve em System32 mesmo com o PATH quebrado", (t) => {
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
  // A saida acionavel agora e restaurar o arquivo: mandar consertar o PATH
  // deixou de resolver, porque a resolucao nao olha mais para o PATH.
  assert.ok(message.includes("System32"));
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
