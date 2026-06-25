#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function collectFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Link simbólico não permitido: ${fullPath}`);
    if (entry.isDirectory()) collectFiles(fullPath, files);
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function generateManifest(sourceInput, outputInput, releaseInput, createdAt = new Date().toISOString()) {
  const sourceRoot = path.resolve(sourceInput || "");
  const outputPath = path.resolve(outputInput || "");
  const release = String(releaseInput || "").trim();

  if (!sourceInput || !outputInput || !fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error("A pasta de origem do pacote é inválida.");
  }
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(release)) {
    throw new Error("A versão deve usar somente letras, números, ponto, hífen ou sublinhado.");
  }
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("A data do manifesto é inválida.");

  const files = collectFiles(sourceRoot)
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      return {
        path: path.relative(sourceRoot, filePath).split(path.sep).join("/"),
        sizeBytes: stat.size,
        sha256: hashFile(filePath),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en", { sensitivity: "base" }));
  if (files.length === 0) throw new Error("O pacote não contém arquivos.");

  const bundleHash = crypto.createHash("sha256");
  for (const file of files) {
    bundleHash.update(`${file.path.toLowerCase()}\n${file.sizeBytes}\n${file.sha256}\n`, "utf8");
  }

  const manifest = {
    manifestVersion: 1,
    manifestId: "godsend.fixed.badavatar",
    release,
    createdAt: new Date(createdAt).toISOString(),
    bundleSha256: bundleHash.digest("hex"),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    files,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (require.main === module) {
  const sourceRoot = process.argv[2];
  const outputPath = process.argv[3];
  const release = process.argv[4];
  if (!sourceRoot || !outputPath || !release) {
    throw new Error("Uso: node generate-fixed-payload-manifest.js <pasta> <manifesto.json> <versão>");
  }
  const manifest = generateManifest(sourceRoot, outputPath, release);
  process.stdout.write(`Manifesto criado: ${manifest.fileCount} arquivos, ${manifest.totalBytes} bytes.\n`);
}

module.exports = { collectFiles, generateManifest, hashFile };
