const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

// Mock appendAppEvent before loading modules that might import serverLog
require.cache[require.resolve("../../infrastructure/serverLog.js")] = {
  exports: { appendAppEvent: () => {} },
};

const {
  isValidStfsFile,
  discoverUserProfilesAndSaves,
  backupUsbUserProfilesAndSaves,
  restoreUsbUserProfilesAndSaves,
} = require("../../infrastructure/usbUserContentBackup.js");

function createStfsBuffer(magic = "CON ", size = 0x1000) {
  const buf = Buffer.alloc(size);
  buf.write(magic, 0, 4, "utf8");
  return buf;
}

test("isValidStfsFile valida cabeçalho STFS (CON / LIVE / PIRS) e tamanho mínimo", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stfs-val-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const validCon = path.join(tmpDir, "save_con.bin");
  fs.writeFileSync(validCon, createStfsBuffer("CON ", 0x1000));
  assert.equal(await isValidStfsFile(validCon), true);

  const validLive = path.join(tmpDir, "profile_live.bin");
  fs.writeFileSync(validLive, createStfsBuffer("LIVE", 0x800));
  assert.equal(await isValidStfsFile(validLive), true);

  const validPirs = path.join(tmpDir, "item_pirs.bin");
  fs.writeFileSync(validPirs, createStfsBuffer("PIRS", 0x370));
  assert.equal(await isValidStfsFile(validPirs), true);

  const tooSmall = path.join(tmpDir, "small.bin");
  fs.writeFileSync(tooSmall, createStfsBuffer("CON ", 0x100));
  assert.equal(await isValidStfsFile(tooSmall), false);

  const invalidMagic = path.join(tmpDir, "invalid_magic.bin");
  fs.writeFileSync(invalidMagic, Buffer.alloc(0x1000, 0x00));
  assert.equal(await isValidStfsFile(invalidMagic), false);

  assert.equal(await isValidStfsFile(path.join(tmpDir, "non_existent.bin")), false);
});

test("discoverUserProfilesAndSaves descobre perfil pessoal e saves, ignorando exploit e DLCs", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usb-discovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const userProfileId = "EE6287EC0E5C58B3";
  const exploitProfileId = "E0000194CD332392";

  // Perfil pessoal do usuário e seus saves
  const userAccDir = path.join(root, "Content", userProfileId, "FFFE07D1", "00010000");
  const userSaveDir = path.join(root, "Content", userProfileId, "545408A7", "00000001");
  fs.mkdirSync(userAccDir, { recursive: true });
  fs.mkdirSync(userSaveDir, { recursive: true });
  fs.writeFileSync(path.join(userAccDir, userProfileId), createStfsBuffer("CON ", 0x2000));
  fs.writeFileSync(path.join(userSaveDir, "gta_save.dat"), createStfsBuffer("CON ", 0x1000));

  // Perfil do exploit BadAvatar (deve ser ignorado)
  const exploitDir = path.join(root, "Content", exploitProfileId, "FFFE07D1", "00010000");
  fs.mkdirSync(exploitDir, { recursive: true });
  fs.writeFileSync(path.join(exploitDir, exploitProfileId), createStfsBuffer("CON ", 0x2000));

  // Pasta compartilhada 0000000000000000: save em 00000001 deve ser descoberto; DLC em 00000002 e GOD em 00007000 ignorados
  const sharedSaveDir = path.join(root, "Content", "0000000000000000", "415607E7", "00000001");
  const sharedDlcDir = path.join(root, "Content", "0000000000000000", "545408A7", "00000002");
  const sharedGodDir = path.join(root, "Content", "0000000000000000", "545408A7", "00007000");
  fs.mkdirSync(sharedSaveDir, { recursive: true });
  fs.mkdirSync(sharedDlcDir, { recursive: true });
  fs.mkdirSync(sharedGodDir, { recursive: true });
  fs.writeFileSync(path.join(sharedSaveDir, "shared_save.bin"), createStfsBuffer("CON ", 0x1000));
  fs.writeFileSync(path.join(sharedDlcDir, "dlc_pack.bin"), createStfsBuffer("LIVE", 0x5000));
  fs.writeFileSync(path.join(sharedGodDir, "god_game.bin"), createStfsBuffer("LIVE", 0x5000));

  // Arquivo corrompido em save pessoal (truncado com zeros)
  fs.writeFileSync(path.join(userSaveDir, "corrupted_save.dat"), Buffer.alloc(12, 0));

  const exploitFiles = [
    { path: `Content/${exploitProfileId}/FFFE07D1/00010000/${exploitProfileId}` },
  ];

  const { validFiles, skippedUnreadable } = await discoverUserProfilesAndSaves(root, exploitFiles);

  const rels = validFiles.map((f) => f.relativePath);
  assert.ok(rels.includes(`Content/${userProfileId}/FFFE07D1/00010000/${userProfileId}`));
  assert.ok(rels.includes(`Content/${userProfileId}/545408A7/00000001/gta_save.dat`));
  assert.ok(rels.includes("Content/0000000000000000/415607E7/00000001/shared_save.bin"));

  // Não deve conter exploit, DLC ou GOD
  assert.ok(!rels.some((r) => r.includes(exploitProfileId)));
  assert.ok(!rels.some((r) => r.includes("00000002")));
  assert.ok(!rels.some((r) => r.includes("00007000")));

  // O arquivo truncado deve ter sido colocado em skippedUnreadable
  assert.ok(skippedUnreadable.some((s) => s.includes("corrupted_save.dat")));
  assert.equal(validFiles.length, 3);
});

test("backupUsbUserProfilesAndSaves e restoreUsbUserProfilesAndSaves realizam ciclo completo com integridade", async (t) => {
  const usbRoot = fs.mkdtempSync(path.join(os.tmpdir(), "usb-backup-src-"));
  const backupStorage = fs.mkdtempSync(path.join(os.tmpdir(), "usb-backup-dst-"));
  const formattedUsb = fs.mkdtempSync(path.join(os.tmpdir(), "usb-formatted-"));
  t.after(() => {
    fs.rmSync(usbRoot, { recursive: true, force: true });
    fs.rmSync(backupStorage, { recursive: true, force: true });
    fs.rmSync(formattedUsb, { recursive: true, force: true });
  });

  const profileId = "EE6287EC0E5C58B3";
  const userAccDir = path.join(usbRoot, "Content", profileId, "FFFE07D1", "00010000");
  const userSaveDir = path.join(usbRoot, "Content", profileId, "545408A7", "00000001");
  fs.mkdirSync(userAccDir, { recursive: true });
  fs.mkdirSync(userSaveDir, { recursive: true });

  const profileContent = createStfsBuffer("CON ", 0x2000);
  const saveContent = createStfsBuffer("CON ", 0x1000);
  fs.writeFileSync(path.join(userAccDir, profileId), profileContent);
  fs.writeFileSync(path.join(userSaveDir, "gta_save.dat"), saveContent);

  // Executa o backup
  const backup = await backupUsbUserProfilesAndSaves(usbRoot, {
    backupBaseDir: backupStorage,
    exploitFiles: [],
  });

  assert.equal(backup.totalFiles, 2);
  assert.ok(fs.existsSync(backup.backupDir));
  assert.ok(fs.existsSync(path.join(backup.backupDir, "recovery-manifest.json")));

  // Simula o pendrive formatado e restaura os perfis/saves de volta
  const restore = await restoreUsbUserProfilesAndSaves(backup.backupDir, formattedUsb);

  assert.equal(restore.restoredFiles, 2);
  assert.equal(restore.errors.length, 0);

  const restoredProfile = path.join(formattedUsb, "Content", profileId, "FFFE07D1", "00010000", profileId);
  const restoredSave = path.join(formattedUsb, "Content", profileId, "545408A7", "00000001", "gta_save.dat");

  assert.ok(fs.existsSync(restoredProfile));
  assert.ok(fs.existsSync(restoredSave));
  assert.deepEqual(fs.readFileSync(restoredProfile), profileContent);
  assert.deepEqual(fs.readFileSync(restoredSave), saveContent);
});

test("discoverUserProfilesAndSaves sem exploitFiles explícito carrega o manifesto ativo e ignora o perfil do exploit", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "usb-auto-exploit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const { exploitProfileFiles } = require("../../services/fixedBadAvatarPreparationService.js");
  const activeExploitFiles = exploitProfileFiles();
  assert.ok(activeExploitFiles.length > 0);

  // Grava o perfil do exploit real do manifesto ativo na unidade simulada
  for (const ef of activeExploitFiles) {
    const full = path.join(root, ...ef.path.split("/"));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, createStfsBuffer("CON ", 0x2000));
  }

  // Grava também um perfil pessoal do jogador
  const userProfileId = "EE6287EC0E5C58B3";
  const userAccFile = path.join(root, "Content", userProfileId, "FFFE07D1", "00010000", userProfileId);
  fs.mkdirSync(path.dirname(userAccFile), { recursive: true });
  fs.writeFileSync(userAccFile, createStfsBuffer("CON ", 0x2000));

  // Chama sem passar exploitFiles (como faz repairDrive antes do CHKDSK)
  const { validFiles } = await discoverUserProfilesAndSaves(root);
  assert.equal(validFiles.length, 1);
  assert.equal(validFiles[0].relativePath, `Content/${userProfileId}/FFFE07D1/00010000/${userProfileId}`);
});

