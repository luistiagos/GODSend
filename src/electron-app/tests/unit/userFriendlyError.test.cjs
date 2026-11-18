const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatErrorForUser,
  hasTechnicalErrorLeak,
} = require("../../infrastructure/userFriendlyError.js");

test("traduz erros de rede e backend local sem expor errno, portas ou URLs", () => {
  const err = new Error("ECONNREFUSED ao contatar o servidor local em http://127.0.0.1:8080/browse");
  const msg = formatErrorForUser(err, { area: "browse" });
  assert.equal(hasTechnicalErrorLeak(msg), false, msg);
  assert.match(msg, /Tentar de novo/i);

  const timeoutMsg = formatErrorForUser("ETIMEDOUT: o servidor local nao respondeu em 120s", { area: "queue" });
  assert.equal(hasTechnicalErrorLeak(timeoutMsg), false, timeoutMsg);
  assert.match(timeoutMsg, /Aguarde alguns segundos|tente novamente/i);
});

test("traduz erros de IP/FTP do Xbox 360 com instrucoes praticas para leigos", () => {
  const noIp = formatErrorForUser("No Xbox IP configured. Set it in Settings.", { area: "library" });
  assert.equal(hasTechnicalErrorLeak(noIp), false, noIp);
  assert.match(noIp, /Configurações/i);

  const ftpDown = formatErrorForUser("FTP connect: dial tcp 192.168.1.55:21: connectex: No connection could be made", { area: "ftp" });
  assert.equal(hasTechnicalErrorLeak(ftpDown), false, ftpDown);
  assert.match(ftpDown, /Aurora/i);

  const ftpAuth = formatErrorForUser("530 Login incorrect", { area: "ftp" });
  assert.equal(hasTechnicalErrorLeak(ftpAuth), false, ftpAuth);
  assert.match(ftpAuth, /usuário ou a senha/i);
});

test("traduz erros de espaco em disco, FAT32, permissoes e dispositivo desconectado", () => {
  const pcSpace = formatErrorForUser(
    "Não há espaço no disco do PC (C:) para extrair o jogo: são necessários 7.50 GB e há 1.20 GB livres.",
    { area: "queue" },
  );
  assert.equal(hasTechnicalErrorLeak(pcSpace), false, pcSpace);
  assert.match(pcSpace, /espaço/i);

  const fat32 = formatErrorForUser(
    "formato XEX possui arquivo de 5.10 GB (pack.pak) incompativel com pendrive FAT32 (limite 4 GB)",
    { area: "queue" },
  );
  assert.equal(hasTechnicalErrorLeak(fat32), false, fat32);
  assert.match(fat32, /GOD/i);

  const perm = formatErrorForUser("EACCES: permission denied, open 'E:\\Games\\x.xex'", { area: "local-files", driveRoot: "E:\\" });
  assert.equal(hasTechnicalErrorLeak(perm), false, perm);
  assert.match(perm, /antivírus/i);
  assert.match(perm, /\(E:\)/);
});

test("traduz erros de atualizacao, assets RXEA, ISO e login IA sem jargao", () => {
  const rxea = formatErrorForUser("RXEA multi-slot encoding failed — backend returned no data.", { area: "assets" });
  assert.equal(hasTechnicalErrorLeak(rxea), false, rxea);
  assert.match(rxea, /JPG ou PNG/i);

  const iso = formatErrorForUser("ISO2GOD failed: exit status 1", { area: "tools-iso" });
  assert.equal(hasTechnicalErrorLeak(iso), false, iso);
  assert.match(iso, /espaço livre|corrompido/i);

  const ia = formatErrorForUser("Invalid email or password (HTTP 401)", { area: "ia-login" });
  assert.equal(hasTechnicalErrorLeak(ia), false, ia);
  assert.match(ia, /E-mail ou senha/i);

  const updateHash = formatErrorForUser("Falha de integridade SHA-256. Esperado: abc...", { area: "update" });
  assert.equal(hasTechnicalErrorLeak(updateHash), false, updateHash);
  assert.match(updateHash, /baixar novamente/i);
});

test("nunca vaza mensagens tecnicas desconhecidas, JSON ou stack traces para a UI", () => {
  const rawSamples = [
    '{"state":"Error","message":"internal error"}',
    "TypeError: Cannot read properties of undefined (reading 'foo')",
    "spawn powershell.exe ENOENT",
    "HTTP 502: Bad Gateway at http://127.0.0.1:8080/saves/list",
    "GetLastError()=5 Access is denied",
  ];
  for (const sample of rawSamples) {
    const out = formatErrorForUser(sample, { area: "generic" });
    assert.equal(hasTechnicalErrorLeak(out), false, `vazou jargao em "${out}"`);
    assert.ok(out.length > 20);
  }
});

test("preserva mensagens amigaveis em portugues sem texto tecnico", () => {
  const friendly = "Este pendrive não tem espaço livre suficiente. Apague alguns jogos ou use um pendrive maior.";
  assert.equal(formatErrorForUser(friendly, { area: "queue" }), friendly);
});
