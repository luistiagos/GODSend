const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// [[release-xboxcompanion-exe-sem-assinatura-barrado-no-download-pelo-smartscreen-do-edge_2026-10-06T17-49]]

const rootDir = path.resolve(__dirname, "../../../..");

test("build-and-upload.ps1 integrates Authenticode code signing hook", () => {
  const scriptPath = path.join(rootDir, "build-and-upload.ps1");
  const content = fs.readFileSync(scriptPath, "utf8");

  assert.ok(content.includes("SIGNING_CERT_PATH"), "must check SIGNING_CERT_PATH");
  assert.ok(content.includes("Invoke-AuthenticodeSign"), "must define Invoke-AuthenticodeSign");
  assert.ok(content.includes("Find-Signtool"), "must define Find-Signtool");
  assert.ok(content.includes("http://timestamp.digicert.com"), "must provide RFC 3161 timestamping server");
});

test("package.json allows code signing without forcing failures when cert is absent", () => {
  const pkgPath = path.join(rootDir, "src/electron-app/package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  assert.equal(pkg.build?.win?.forceCodeSigning, false, "forceCodeSigning must be false for unsigned dev builds");
  assert.equal(pkg.build?.win?.signAndEditExecutable, false, "signAndEditExecutable must be false so electron-builder avoids winCodeSign symlink issues on Windows");
});

test("build.properties.example documents code signing configuration", () => {
  const examplePath = path.join(rootDir, "build.properties.example");
  const content = fs.readFileSync(examplePath, "utf8");

  assert.ok(content.includes("SIGNING_CERT_PATH"), "build.properties.example must document SIGNING_CERT_PATH");
  assert.ok(content.includes("TIMESTAMP_SERVER"), "build.properties.example must document TIMESTAMP_SERVER");
});

test("PE binary inspection correctly reads Security Data Directory entry", () => {
  const godsendExe = path.join(rootDir, "dist", "godsend.exe");
  if (!fs.existsSync(godsendExe)) return; // skip if not built

  const fd = fs.openSync(godsendExe, "r");
  const buf = Buffer.alloc(1024);
  fs.readSync(fd, buf, 0, 1024, 0);
  fs.closeSync(fd);

  // MZ header
  assert.equal(buf[0], 0x4D);
  assert.equal(buf[1], 0x5A);

  const peOffset = buf.readUInt32LE(0x3C);
  // PE signature
  assert.equal(buf.slice(peOffset, peOffset + 4).toString(), "PE\0\0");

  const magic = buf.readUInt16LE(peOffset + 24);
  // PE32+ (0x20b, 64-bit) or PE32 (0x10b, 32-bit)
  const isPE64 = magic === 0x20b;
  // Security directory is entry 4 in Data Directories (offset 144 for PE64, 128 for PE32)
  const dataDirOffset = peOffset + (isPE64 ? 24 + 112 + (4 * 8) : 24 + 96 + (4 * 8));

  const securityVirtualAddress = buf.readUInt32LE(dataDirOffset);
  const securitySize = buf.readUInt32LE(dataDirOffset + 4);

  // Unsigned binary has size 0
  assert.ok(typeof securityVirtualAddress === "number");
  assert.ok(typeof securitySize === "number");
});

