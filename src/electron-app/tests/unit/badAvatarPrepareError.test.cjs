const test = require("node:test");
const assert = require("node:assert/strict");

const {
  formatBadAvatarListErrorForUser,
  formatBadAvatarPrepareErrorForUser,
} = require("../../infrastructure/badAvatarPrepareError.js");
const {
  isSamePhysicalUsbSelection,
} = require("../../infrastructure/usbSelectionIdentity.js");

test("traduz ENOENT no staging do pendrive/HD sem expor caminho interno nem jargao tecnico", () => {
  const err = Object.assign(
    new Error(
      "ENOENT: no such file or directory, open 'D:\\.xbox-downloader\\staging\\88096c0a-3075-5bd8-a705-de05de397b80\\apps\\Aurora\\nxeart.partial'",
    ),
    { code: "ENOENT", path: "D:\\.xbox-downloader\\staging\\88096c0a-3075-5bd8-a705-de05de397b80\\apps\\Aurora\\nxeart.partial" },
  );
  const msg = formatBadAvatarPrepareErrorForUser(err, "D:\\");
  assert.match(msg, /pendrive ou HD \(D:\)/);
  assert.match(msg, /desconectou|falhou/i);
  assert.ok(!msg.includes("ENOENT"));
  assert.ok(!msg.includes(".xbox-downloader"));
  assert.ok(!msg.includes("nxeart.partial"));
});

test("traduz UNKNOWN/ETIMEDOUT/ENOSPC/EPERM/EROFS de forma simples mencionando pendrive ou HD", () => {
  const unknownRead = formatBadAvatarPrepareErrorForUser(new Error("UNKNOWN: unknown error, read"), "E:\\");
  assert.match(unknownRead, /pendrive ou HD \(E:\)/);
  assert.ok(!unknownRead.includes("UNKNOWN:"));

  const timedOut = formatBadAvatarPrepareErrorForUser(
    new Error("ETIMEDOUT: connection timed out, open 'D:\\.xbox-downloader\\transactions\\abc.next.json'"),
    "D:\\",
  );
  assert.match(timedOut, /pendrive ou HD \(D:\)/);
  assert.ok(!timedOut.includes("ETIMEDOUT"));

  const ro = formatBadAvatarPrepareErrorForUser(Object.assign(new Error("EROFS: read-only file system"), { code: "EROFS" }), "F:\\");
  assert.match(ro, /pendrive ou HD \(F:\)/);
  assert.match(ro, /travado contra gravação/i);

  const perm = formatBadAvatarPrepareErrorForUser(Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }), "D:\\");
  assert.match(perm, /pendrive ou HD \(D:\)/);
  assert.match(perm, /bloqueou o acesso/i);

  const nospc = formatBadAvatarPrepareErrorForUser(Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }), "D:\\");
  assert.match(nospc, /pendrive ou HD \(D:\)/);
  assert.match(nospc, /espaço livre suficiente/i);
});

test("nao culpa o pendrive/HD quando o erro bruto ocorreu no disco local do computador", () => {
  const err = Object.assign(
    new Error("ENOENT: no such file or directory, open 'C:\\Users\\cliente\\AppData\\Local\\Temp\\badavatar.tmp'"),
    { code: "ENOENT", path: "C:\\Users\\cliente\\AppData\\Local\\Temp\\badavatar.tmp" },
  );
  const msg = formatBadAvatarPrepareErrorForUser(err, "D:\\");
  assert.match(msg, /computador não conseguiu preparar os arquivos/i);
  assert.ok(!msg.includes("C:\\Users"));
});

test("traduz dump do PowerShell/fat32format/Set-Partition/diskpart (caso tipo 4 / Wesley) para orientacao simples", () => {
  const wesleyDump = [
    "clusters 1919060 Free Clusters Formatting drive D:... Done fat32format.exe realizado com sucesso.",
    "Particao marcada com tipo 4, nao FAT32; corrigindo para 12 (FAT32 LBA)... Set-Partition recusou a troca",
    "Microsoft DiskPart versão 10.0.19041.3636 Nenhuma partição foi selecionada.",
    "A formatacao terminou, mas o Xbox 360 nao vai ler o disco: particao com tipo 4, nao FAT32 (11 ou 12). O Windows recusou corrigir o tipo da particao neste dispositivo; use outro pendrive ou HD.",
    "No C:\\Users\\WESLEY\\AppData\\Local\\Temp\\godsend_fat32_1794875583529.ps1:449 caractere:7",
    "+ CategoryInfo : OperationStopped ... RuntimeException + FullyQualifiedErrorId : A formatacao...",
  ].join("\n");
  const msg = formatBadAvatarPrepareErrorForUser(new Error(wesleyDump), "D:\\");
  assert.match(msg, /pendrive ou HD \(D:\)/);
  assert.match(msg, /teste com outro pendrive ou HD/i);
  assert.ok(!/DiskPart|Set-Partition|FAT32|tipo 4|godsend_fat32|CategoryInfo|Clusters/i.test(msg));
});

test("traduz trace do PowerShell em uso (GetLastError=32) e acesso negado (GetLastError=5) sem jargao", () => {
  const inUseTrace = [
    "System.Management.Automation.RemoteException",
    "GetLastError()=32: O arquivo já está sendo usado por outro processo.",
    "No C:\\Users\\cliente\\AppData\\Local\\Temp\\godsend_fat32_123.ps1:393 caractere:7",
    "+ CategoryInfo : OperationStopped",
  ].join("\n");
  const msgInUse = formatBadAvatarPrepareErrorForUser(new Error(inUseTrace), "D:\\");
  assert.match(msgInUse, /pendrive ou HD \(D:\)/);
  assert.match(msgInUse, /Outro programa ou pasta aberta/i);
  assert.ok(!/RemoteException|godsend_fat32_|GetLastError/i.test(msgInUse));

  const deniedTrace = "GetLastError()=5: Acesso negado. C:\\Users\\x\\Temp\\godsend_fat32_1.ps1";
  const msgDenied = formatBadAvatarPrepareErrorForUser(new Error(deniedTrace), "D:\\");
  assert.match(msgDenied, /Windows ou o antivírus bloqueou/i);
  assert.ok(!/GetLastError|godsend_fat32_/i.test(msgDenied));
});

test("traduz erros de layout, FAT32/exFAT, espaco, elevacao e container legado sem termos tecnicos", () => {
  const exfatMsg = formatBadAvatarPrepareErrorForUser(new Error("O destino precisa estar em FAT32; detectado: exFAT."), "D:\\");
  assert.match(exfatMsg, /Formatar antes/i);
  assert.ok(!/FAT32|exFAT/i.test(exfatMsg));

  const badLayout = formatBadAvatarPrepareErrorForUser(
    new Error("Este dispositivo não funciona no Xbox 360. O disco usa setores de 4096 bytes, e o Xbox 360 só lê setores de 512 bytes. Use outro pendrive ou HD."),
    "D:\\",
  );
  assert.match(badLayout, /use outro pendrive ou HD/i);
  assert.ok(!/4096|512|setores/i.test(badLayout));

  const bytesMsg = formatBadAvatarPrepareErrorForUser(
    new Error("Espaço livre insuficiente; faltam 4829102 bytes incluindo a margem de segurança."),
    "D:\\",
  );
  assert.match(bytesMsg, /não tem espaço livre suficiente/i);
  assert.ok(!/4829102|bytes|margem/i.test(bytesMsg));

  const uacMsg = formatBadAvatarPrepareErrorForUser(
    new Error("Formatação cancelada (a elevação de Administrador foi negada)."),
    "D:\\",
  );
  assert.match(uacMsg, /permissão do Windows/i);
  assert.ok(!/elevação de Administrador/i.test(uacMsg));

  const blockedMsg = formatBadAvatarPrepareErrorForUser(
    new Error("Operação bloqueada: Este dispositivo tem 2 partições montadas."),
    "D:\\",
  );
  assert.match(blockedMsg, /pendrive ou HD \(D:\)/);
  assert.ok(!/partições montadas|Operação bloqueada/i.test(blockedMsg));

  const unknownTechMsg = formatBadAvatarPrepareErrorForUser(
    new Error("TypeError: Cannot read properties of undefined (reading 'foo')"),
    "D:\\",
  );
  assert.match(unknownTechMsg, /pendrive ou HD \(D:\)/);
  assert.ok(!/TypeError|undefined/i.test(unknownTechMsg));

  const legacyXbox = formatBadAvatarPrepareErrorForUser(
    new Error("O dispositivo contém a pasta oculta de sistema “Xbox360” (formato antigo de armazenamento do console)..."),
    "D:\\",
  );
  assert.match(legacyXbox, /Formatar antes/i);
  assert.ok(!/exploit|Content|FAT32/i.test(legacyXbox));
});

test("traduz falha de verificacao na copia como problema no pendrive/HD sem citar hash/SHA", () => {
  const msg = formatBadAvatarPrepareErrorForUser(
    new Error("Falha de verificação ao copiar Content/0000000000000000/C0DE9999/00080000/C0DE99990F586558."),
    "E:\\",
  );
  assert.match(msg, /pendrive ou HD \(E:\)/);
  assert.match(msg, /mau contato ou defeito/i);
});

test("traduz falha de verificacao fisica pos-gravacao (pendrive falso/defeituoso) sem jargao tecnico", () => {
  const msg = formatBadAvatarPrepareErrorForUser(
    new Error(
      "Falha na verificação física pós-gravação: Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B (hash físico divergente)",
    ),
    "E:\\",
  );
  assert.match(msg, /pendrive ou HD \(E:\)/);
  assert.match(msg, /capacidade falsificada|defeito/i);
  assert.match(msg, /Testar Capacidade|outro pendrive/i);
  assert.ok(!/SHA|hash|Win32|FILE_FLAG_NO_BUFFERING|E0002FF78DFBDE7B/i.test(msg));
});

test("traduz erro interno de transicao de transacao sem vazar staging -> completed na UI", () => {
  const msg = formatBadAvatarPrepareErrorForUser(
    new Error("Transição de transação inválida: staging -> completed."),
    "E:\\",
  );
  assert.match(msg, /pendrive ou HD \(E:\)/);
  assert.match(msg, /Formatar antes/i);
  assert.ok(!/staging|completed|Transição de transação/i.test(msg));
});

test("simplifica aviso de volume danificado removendo Detalhe/ENOENT/EINVAL mas preservando gatilho Reparar (CHKDSK)", () => {
  const chkdskMsg =
    "O sistema de arquivos do pendrive está danificado e gravar por cima pode falhar ou piorar o dano. " +
    "Em “Jogos Instalados”, use “Reparar (CHKDSK)”, que tenta preservar perfis e saves, e prepare de novo. " +
    "Detalhe: entradas ilegíveis: D:\\.xbox-downloader\\staging\\abc\\Content (ENOENT); D:\\System Volume Information (EINVAL).";
  const out = formatBadAvatarPrepareErrorForUser(new Error(chkdskMsg), "D:\\");
  assert.ok(out.includes("Reparar (CHKDSK)"), "precisa manter o gatilho do botão na UI");
  assert.ok(!out.includes("ENOENT"));
  assert.ok(!out.includes("EINVAL"));
  assert.ok(!out.includes("System Volume Information"));
  assert.ok(!out.includes(".xbox-downloader"));
});

test("formatBadAvatarListErrorForUser preserva mensagens simples e oculta erros crus do PowerShell", () => {
  const slowMsg = "O Windows ainda está reconhecendo seu pendrive ou HD. Aguarde alguns instantes e clique no botão 'Atualizar'.";
  assert.equal(formatBadAvatarListErrorForUser(new Error(slowMsg)), slowMsg);

  const psErr = formatBadAvatarListErrorForUser(new Error("Get-Disk : Invalid class Win32_DiskDrive"));
  assert.match(psErr, /Atualizar/i);
  assert.ok(!psErr.includes("Get-Disk"));
  assert.ok(!psErr.includes("Win32_DiskDrive"));
});

test("isSamePhysicalUsbSelection aceita o mesmo HD fisico reformatado (exFAT -> FAT32) e barra troca de dispositivo", () => {
  const beforeFormat = {
    rootPath: "D:\\",
    fingerprint: "1".repeat(64),
    diskNumber: 1,
    diskUniqueId: "{11111111-2222-3333-4444-555555555555}",
    serialNumber: "SEAGATE-500GB-XYZ",
    volumeGuid: "\\\\?\\Volume{aaaaaaaa-0000-0000-0000-000000000001}\\",
    friendlyName: "ST500LM0 00-1EJ162",
    sizeBytes: 500_105_740_288,
  };
  const afterFormat = {
    ...beforeFormat,
    fingerprint: "2".repeat(64),
    volumeGuid: "\\\\?\\Volume{bbbbbbbb-0000-0000-0000-000000000002}\\",
  };
  assert.equal(isSamePhysicalUsbSelection(beforeFormat, afterFormat), true);

  const swappedDisk = {
    rootPath: "D:\\",
    fingerprint: "3".repeat(64),
    diskNumber: 1,
    diskUniqueId: "{99999999-8888-7777-6666-555555555555}",
    serialNumber: "TOSHIBA-1TB-OTHER",
    volumeGuid: "\\\\?\\Volume{cccccccc-0000-0000-0000-000000000003}\\",
    friendlyName: "TOSHIBA MQ01ABD100",
    sizeBytes: 1_000_204_886_016,
  };
  assert.equal(isSamePhysicalUsbSelection(beforeFormat, swappedDisk), false);

  const otherLetter = { ...beforeFormat, rootPath: "E:\\" };
  assert.equal(isSamePhysicalUsbSelection(beforeFormat, otherLetter), false);
});

test("isSamePhysicalUsbSelection aceita troca nativo <-> fisico para o mesmo volumeGuid e barra outro volume", () => {
  const vol = "\\\\?\\Volume{12345678-1234-1234-1234-1234567890ab}\\";
  const nativeStick = {
    rootPath: "E:\\",
    fingerprint: "a".repeat(64),
    diskNumber: -1,
    volumeGuid: vol,
    friendlyName: "Dispositivo USB removivel",
    sizeBytes: 31_000_000_000,
  };
  const physicalStick = {
    rootPath: "E:\\",
    fingerprint: "b".repeat(64),
    diskNumber: 2,
    diskUniqueId: "{abcd}",
    serialNumber: "SANDISK-01",
    volumeGuid: vol,
    friendlyName: "SanDisk Cruzer Blade",
    sizeBytes: 31_004_000_000,
  };
  assert.equal(isSamePhysicalUsbSelection(nativeStick, physicalStick), true);

  const differentStick = {
    ...physicalStick,
    volumeGuid: "\\\\?\\Volume{ffffffff-1234-1234-1234-1234567890ab}\\",
  };
  assert.equal(isSamePhysicalUsbSelection(nativeStick, differentStick), false);
});
