const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  ensureDirectory,
  copyFileIfMissing,
  copyDirectoryContentsIfMissing,
} = require("../../infrastructure/fileSystem.js");

test("ensureDirectory cria diretórios recursivamente sem falhas", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-ensure-test-"));
  try {
    const nested = path.join(tmp, "a", "b", "c");
    assert.equal(fs.existsSync(nested), false);
    ensureDirectory(nested);
    assert.equal(fs.existsSync(nested), true);

    // Chamada idempotente subsequente não lança erro
    assert.doesNotThrow(() => ensureDirectory(nested));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("copyFileIfMissing copia arquivo inexistente e ignora se ja existir", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-copy-test-"));
  try {
    const src = path.join(tmp, "source.json");
    const dst = path.join(tmp, "target", "nested", "dest.json");
    fs.writeFileSync(src, JSON.stringify({ name: "Halo 3" }), "utf8");

    // 1. Copia quando destino não existe
    copyFileIfMissing(src, dst);
    assert.equal(fs.existsSync(dst), true);
    assert.equal(fs.readFileSync(dst, "utf8"), JSON.stringify({ name: "Halo 3" }));

    // 2. Modifica o destino; nova cópia deve preservar o destino existente
    fs.writeFileSync(dst, JSON.stringify({ name: "Halo 3 Modified" }), "utf8");
    copyFileIfMissing(src, dst);
    assert.equal(fs.readFileSync(dst, "utf8"), JSON.stringify({ name: "Halo 3 Modified" }));

    // 3. Origem inexistente é tratada sem lançar exceção
    const nonExistent = path.join(tmp, "ghost.json");
    const ghostDst = path.join(tmp, "ghost-target.json");
    assert.doesNotThrow(() => copyFileIfMissing(nonExistent, ghostDst));
    assert.equal(fs.existsSync(ghostDst), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("copyFileIfMissing trata erros de arquivo bloqueado (EBUSY/EPERM) defensivamente sem crash", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-lock-test-"));
  try {
    const src = path.join(tmp, "digital.json");
    const dst = path.join(tmp, "locked.json");
    fs.writeFileSync(src, "{}", "utf8");

    // Simula erro de cópia sobrescrevendo temporariamente fs.copyFileSync
    const originalCopyFileSync = fs.copyFileSync;
    let attempts = 0;
    fs.copyFileSync = (source, dest) => {
      attempts++;
      const err = new Error("resource busy or locked");
      err.code = "EBUSY";
      throw err;
    };

    try {
      // Não deve lançar erro mesmo com EBUSY persistente
      assert.doesNotThrow(() => copyFileIfMissing(src, dst));
      assert.equal(attempts, 3, "deve tentar com retentativas antes de falhar de forma não fatal");
    } finally {
      fs.copyFileSync = originalCopyFileSync;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("copyDirectoryContentsIfMissing copia estrutura recursiva de pastas e arquivos", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-dir-test-"));
  try {
    const srcDir = path.join(tmp, "bundled-cache");
    const dstDir = path.join(tmp, "runtime-cache");

    ensureDirectory(path.join(srcDir, "sub"));
    fs.writeFileSync(path.join(srcDir, "digital.json"), '{"items":1}', "utf8");
    fs.writeFileSync(path.join(srcDir, "xbox360.json"), '{"items":2}', "utf8");
    fs.writeFileSync(path.join(srcDir, "sub", "roms.json"), '{"items":3}', "utf8");

    copyDirectoryContentsIfMissing(srcDir, dstDir);

    assert.equal(fs.existsSync(path.join(dstDir, "digital.json")), true);
    assert.equal(fs.existsSync(path.join(dstDir, "xbox360.json")), true);
    assert.equal(fs.existsSync(path.join(dstDir, "sub", "roms.json")), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
