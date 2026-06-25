const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { finished } = require("node:stream/promises");
const yazl = require("yazl");

const {
  extractTrustedZipToStaging,
} = require("../../infrastructure/secureZipExtractor.js");

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xbox360-zip-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return root;
}

async function createZip(filePath, entries) {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    if (entry.directory) zip.addEmptyDirectory(entry.name, entry.options || {});
    else zip.addBuffer(Buffer.from(entry.contents || ""), entry.name, entry.options || {});
  }
  const output = fs.createWriteStream(filePath);
  zip.outputStream.pipe(output);
  zip.end();
  await finished(output);
}

function componentFor(zipPath, archiveOverrides = {}) {
  const contents = fs.readFileSync(zipPath);
  return {
    id: "aurora",
    displayName: "Aurora",
    version: "test",
    required: true,
    source: {
      url: "https://downloads.example.test/aurora.zip",
      redirectHosts: [],
      fileName: "aurora.zip",
      sizeBytes: contents.length,
      sha256: crypto.createHash("sha256").update(contents).digest("hex"),
    },
    license: {
      spdx: "MIT",
      projectUrl: "https://example.test/aurora",
      redistributionApproved: true,
      attribution: "Fixture de teste.",
    },
    archive: {
      format: "zip",
      installPath: "Aurora",
      maxExtractedBytes: 1024 * 1024,
      maxEntries: 100,
      ...archiveOverrides,
    },
  };
}

function replaceAllBytes(buffer, from, to) {
  const source = Buffer.from(from);
  const target = Buffer.from(to);
  assert.equal(source.length, target.length, "fixture names must have equal byte lengths");
  let offset = 0;
  let replacements = 0;
  while ((offset = buffer.indexOf(source, offset)) >= 0) {
    target.copy(buffer, offset);
    offset += target.length;
    replacements++;
  }
  assert.ok(replacements >= 2, "ZIP should contain local and central file names");
}

test("extrai ZIP válido para staging novo e calcula hashes", async (t) => {
  const root = temp(t);
  const zipPath = path.join(root, "aurora.zip");
  await createZip(zipPath, [
    { name: "default.xex", contents: "xex" },
    { name: "Data/settings.json", contents: "{}" },
  ]);
  const outputRoot = path.join(root, "extracted");
  const result = await extractTrustedZipToStaging(zipPath, outputRoot, componentFor(zipPath));
  assert.equal(result.files.length, 2);
  assert.equal(result.totalBytes, 5);
  assert.equal(fs.readFileSync(path.join(result.outputPath, "default.xex"), "utf8"), "xex");
  assert.equal(result.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), true);
});

test("recusa path traversal antes de criar arquivos", async (t) => {
  const root = temp(t);
  const zipPath = path.join(root, "traversal.zip");
  await createZip(zipPath, [{ name: "aa/evil", contents: "evil" }]);
  const bytes = fs.readFileSync(zipPath);
  replaceAllBytes(bytes, "aa/evil", "../evil");
  fs.writeFileSync(zipPath, bytes);
  const outputRoot = path.join(root, "extracted");
  await assert.rejects(
    () => extractTrustedZipToStaging(zipPath, outputRoot, componentFor(zipPath)),
    /invalid relative path|segmento inseguro|caminho não permitido/i,
  );
  assert.equal(fs.existsSync(path.join(root, "evil")), false);
});

test("recusa destinos duplicados sem diferenciar maiúsculas", async (t) => {
  const root = temp(t);
  const zipPath = path.join(root, "duplicate.zip");
  await createZip(zipPath, [
    { name: "Data/File.bin", contents: "one" },
    { name: "data/file.BIN", contents: "two" },
  ]);
  await assert.rejects(
    () => extractTrustedZipToStaging(zipPath, path.join(root, "out"), componentFor(zipPath)),
    /caminho duplicado/i,
  );
});

test("recusa links simbólicos armazenados no ZIP", async (t) => {
  const root = temp(t);
  const zipPath = path.join(root, "symlink.zip");
  await createZip(zipPath, [
    { name: "link", contents: "target", options: { mode: 0o120777 } },
  ]);
  await assert.rejects(
    () => extractTrustedZipToStaging(zipPath, path.join(root, "out"), componentFor(zipPath)),
    /link simbólico|tipo especial/i,
  );
});

test("recusa expansão total acima do limite assinado", async (t) => {
  const root = temp(t);
  const zipPath = path.join(root, "bomb.zip");
  await createZip(zipPath, [{ name: "large.bin", contents: "A".repeat(20_000) }]);
  const component = componentFor(zipPath, { maxExtractedBytes: 1_000 });
  await assert.rejects(
    () => extractTrustedZipToStaging(zipPath, path.join(root, "out"), component),
    /limite total de expansão|limite de expansão/i,
  );
});

test("nunca sobrescreve uma extração anterior", async (t) => {
  const root = temp(t);
  const zipPath = path.join(root, "aurora.zip");
  await createZip(zipPath, [{ name: "default.xex", contents: "xex" }]);
  const outputRoot = path.join(root, "out");
  fs.mkdirSync(path.join(outputRoot, "aurora"), { recursive: true });
  await assert.rejects(
    () => extractTrustedZipToStaging(zipPath, outputRoot, componentFor(zipPath)),
    /nunca a sobrescreve/i,
  );
});
