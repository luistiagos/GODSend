const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const appData = fs.mkdtempSync(path.join(os.tmpdir(), "physical-flash-verifier-appdata-"));
process.env.APPDATA = appData;

const test = require("node:test");
test.after(() => fs.rmSync(appData, { recursive: true, force: true }));
const assert = require("node:assert/strict");

const {
  collectCriticalAttributePaths,
  formatPhysicalReadbackFailureSummary,
  selectCriticalBootFiles,
  verifyCriticalFilesPhysicalReadback,
} = require("../../infrastructure/physicalFlashVerifier.js");
const {
  verifyWrittenBootFilesOnPhysicalFlash,
} = require("../../services/fixedBadAvatarPreparationService.js");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function makeTempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "physical-flash-verify-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));
  return root;
}

function writeFile(root, relPath, buf) {
  const full = path.join(root, ...relPath.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return {
    full,
    entry: {
      relativePath: relPath,
      sizeBytes: buf.length,
      sha256: sha256(buf),
    },
  };
}

test("selectCriticalBootFiles seleciona perfil do exploit, BadUpdatePayload, launch.ini e Aurora/default.xex", () => {
  const entries = [
    { relativePath: "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B", sizeBytes: 335872, sha256: "a".repeat(64) },
    { relativePath: "BadUpdatePayload/BadUpdateExploit-Avatar-2ndStage.bin", sizeBytes: 100, sha256: "b".repeat(64) },
    { relativePath: "BadUpdatePayload/default.xex", sizeBytes: 200, sha256: "c".repeat(64) },
    { relativePath: "launch.ini", sizeBytes: 50, sha256: "d".repeat(64) },
    { relativePath: "Aurora/default.xex", sizeBytes: 300, sha256: "e".repeat(64) },
    { relativePath: "Aurora/Media/Locales/PT-BR.xzp", sizeBytes: 400, sha256: "f".repeat(64) },
    { relativePath: "Content/0000000000000000/C0DE9999/00080000/C0DE99990F586558", sizeBytes: 500, sha256: "1".repeat(64) },
  ];
  const selected = selectCriticalBootFiles(entries).map((e) => e.relativePath);
  assert.deepEqual(selected, [
    "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B",
    "BadUpdatePayload/BadUpdateExploit-Avatar-2ndStage.bin",
    "BadUpdatePayload/default.xex",
    "launch.ini",
    "Aurora/default.xex",
  ]);
});

test("collectCriticalAttributePaths inclui todos os diretorios ancestrais sem duplicar", () => {
  const root = path.resolve("X:\\");
  const paths = collectCriticalAttributePaths(root, [
    { relativePath: "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B", sizeBytes: 1, sha256: "a".repeat(64) },
    { relativePath: "BadUpdatePayload/default.xex", sizeBytes: 1, sha256: "b".repeat(64) },
    { relativePath: "BadUpdatePayload/stage2.bin", sizeBytes: 1, sha256: "c".repeat(64) },
  ]);
  assert.equal(paths.filter((p) => p.endsWith("BadUpdatePayload")).length, 1);
  assert.ok(paths.includes(path.join(root, "Content")));
  assert.ok(paths.includes(path.join(root, "Content", "E0002FF78DFBDE7B")));
  assert.ok(paths.includes(path.join(root, "Content", "E0002FF78DFBDE7B", "FFFE07D1", "00010000", "E0002FF78DFBDE7B")));
});

test("verifyCriticalFilesPhysicalReadback le sem cache (FILE_FLAG_NO_BUFFERING), limpa atributos +H/+S/+R e detecta corrupcao fisica", async (t) => {
  if (process.platform !== "win32") {
    t.skip("verificacao FILE_FLAG_NO_BUFFERING nativa disponivel somente no Windows");
    return;
  }
  const root = makeTempRoot(t);
  const profileBytes = Buffer.alloc(335_872);
  for (let i = 0; i < profileBytes.length; i += 4096) {
    profileBytes.writeUInt32BE(i ^ 0x5a3c96e1, i);
  }
  const launchBytes = Buffer.from("[Paths]\r\nDefault = Usb:\\Aurora\\default.xex\r\n", "utf8"); // tamanho nao multiplo de setor
  const emptyBytes = Buffer.alloc(0);

  const profile = writeFile(root, "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B", profileBytes);
  const launch = writeFile(root, "launch.ini", launchBytes);
  const empty = writeFile(root, "BadUpdatePayload/empty.marker", emptyBytes);

  // Marca pasta Content e arquivo de perfil como Hidden + System + ReadOnly (caso de pendrive preexistente).
  const contentDir = path.join(root, "Content");
  assert.equal(spawnSync("attrib.exe", ["+H", "+S", "+R", contentDir], { encoding: "utf8" }).status, 0);
  assert.equal(spawnSync("attrib.exe", ["+H", "+S", "+R", profile.full], { encoding: "utf8" }).status, 0);

  const okResult = await verifyCriticalFilesPhysicalReadback(root, [profile.entry, launch.entry, empty.entry]);
  assert.equal(okResult.ok, true, JSON.stringify(okResult));
  assert.equal(okResult.bypassedCache, true, "no Windows precisa ler com FILE_FLAG_NO_BUFFERING");
  assert.equal(okResult.checkedCount, 3);
  assert.ok(okResult.clearedAttributeCount >= 2, `esperava limpar atributos de pasta e arquivo, limpou ${okResult.clearedAttributeCount}`);
  assert.deepEqual(okResult.failures, []);

  // Confirma que os atributos Hidden/System/ReadOnly foram realmente limpos no sistema de arquivos.
  const attrDir = spawnSync("attrib.exe", [contentDir], { encoding: "utf8" }).stdout.slice(0, 12);
  const attrFile = spawnSync("attrib.exe", [profile.full], { encoding: "utf8" }).stdout.slice(0, 12);
  assert.ok(!/[HSR]/.test(attrDir), `atributos ainda presentes na pasta Content: '${attrDir}'`);
  assert.ok(!/[HSR]/.test(attrFile), `atributos ainda presentes no perfil: '${attrFile}'`);

  // Corrupcao silenciosa de 1 byte no meio do perfil (simula wrap-around / celula defeituosa).
  const corrupted = Buffer.from(profileBytes);
  corrupted[131_072] ^= 0xff;
  fs.writeFileSync(profile.full, corrupted);
  const hashFail = await verifyCriticalFilesPhysicalReadback(root, [profile.entry, launch.entry]);
  assert.equal(hashFail.ok, false);
  assert.equal(hashFail.bypassedCache, true);
  assert.equal(hashFail.failures.length, 1);
  assert.equal(hashFail.failures[0].reason, "hash-mismatch");
  assert.equal(hashFail.failures[0].path, profile.entry.relativePath);

  // Truncamento de arquivo.
  fs.writeFileSync(profile.full, profileBytes);
  fs.writeFileSync(launch.full, launchBytes.subarray(0, 10));
  const sizeFail = await verifyCriticalFilesPhysicalReadback(root, [profile.entry, launch.entry]);
  assert.equal(sizeFail.ok, false);
  assert.equal(sizeFail.failures[0].reason, "size-mismatch");
  assert.equal(sizeFail.failures[0].actualSize, 10);

  // Arquivo ausente.
  fs.rmSync(profile.full);
  const missingFail = await verifyCriticalFilesPhysicalReadback(root, [profile.entry]);
  assert.equal(missingFail.ok, false);
  assert.equal(missingFail.failures[0].reason, "missing");
});

test("verifyWrittenBootFilesOnPhysicalFlash falha o preparo com mensagem traduzivel quando a releitura diverge", async () => {
  const entries = [
    { relativePath: "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B", sizeBytes: 335872, sha256: "a".repeat(64) },
    { relativePath: "Aurora/Media/Locales/PT-BR.xzp", sizeBytes: 400, sha256: "f".repeat(64) },
  ];

  const received = [];
  await assert.rejects(
    verifyWrittenBootFilesOnPhysicalFlash("E:\\", entries, {
      verify: async (_root, files) => {
        received.push(...files.map((f) => f.relativePath));
        return {
          ok: false,
          bypassedCache: true,
          checkedCount: 0,
          clearedAttributeCount: 0,
          failures: [{ path: entries[0].relativePath, reason: "hash-mismatch" }],
        };
      },
    }),
    /Falha na verificação física pós-gravação:.*E0002FF78DFBDE7B \(hash físico divergente\)/,
  );
  assert.deepEqual(received, [entries[0].relativePath]);

  const summary = formatPhysicalReadbackFailureSummary([
    { path: "launch.ini", reason: "open-failed", win32Error: 5 },
  ]);
  assert.match(summary, /launch\.ini \(abertura física falhou, Win32=5\)/);
});
