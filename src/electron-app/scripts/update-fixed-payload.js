#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { collectFiles, generateManifest } = require("./generate-fixed-payload-manifest");

const DEFAULT_ASSETS_ROOT = path.resolve(__dirname, "..", "assets");
const INDEX_FILE_NAME = "badavatar-package.json";
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

function assertInside(root, candidate, label) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} precisa permanecer dentro de ${resolvedRoot}.`);
  }
  return resolvedCandidate;
}

function readCurrentIndex(assetsRoot) {
  const indexPath = path.join(assetsRoot, INDEX_FILE_NAME);
  if (!fs.existsSync(indexPath)) return null;
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if (
    index?.schemaVersion !== 1 ||
    !/^badavatar-[0-9A-Za-z._-]+$/.test(index?.directoryName || "") ||
    !/^badavatar-[0-9A-Za-z._-]+\.manifest\.json$/.test(index?.manifestFileName || "")
  ) {
    throw new Error("O arquivo da versão ativa existente é inválido.");
  }
  return index;
}

function validateSourceStructure(sourceRoot) {
  for (const directory of ["BadUpdatePayload", "Content", "games"]) {
    const candidate = path.join(sourceRoot, directory);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      throw new Error(`A nova versão não contém a pasta obrigatória ${directory}.`);
    }
  }
  for (const file of ["lhelper.xex", "UsbdSecPatch.xex"]) {
    const candidate = path.join(sourceRoot, file);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
      throw new Error(`A nova versão não contém o arquivo obrigatório ${file}.`);
    }
  }
  const auroraAtRoot = path.join(sourceRoot, "Aurora");
  const auroraInApps = path.join(sourceRoot, "apps", "Aurora");
  if (
    (!fs.existsSync(auroraAtRoot) || !fs.statSync(auroraAtRoot).isDirectory()) &&
    (!fs.existsSync(auroraInApps) || !fs.statSync(auroraInApps).isDirectory())
  ) {
    throw new Error("A nova versão não contém o Aurora.");
  }
  collectFiles(sourceRoot); // Também recusa links simbólicos antes da cópia.
}

function safeRemove(assetsRoot, targetPath) {
  const safeTarget = assertInside(assetsRoot, targetPath, "O caminho removido");
  fs.rmSync(safeTarget, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function activateExistingVersion({ version: versionInput, assetsRoot: assetsInput = DEFAULT_ASSETS_ROOT }) {
  const assetsRoot = path.resolve(assetsInput);
  const version = String(versionInput || "").trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new Error("A versão deve usar somente letras, números, ponto, hífen ou sublinhado.");
  }
  const directoryName = `badavatar-${version}`;
  const manifestFileName = `${directoryName}.manifest.json`;
  const payloadRoot = assertInside(assetsRoot, path.join(assetsRoot, directoryName), "O pacote ativado");
  const manifestPath = assertInside(assetsRoot, path.join(assetsRoot, manifestFileName), "O manifesto ativado");
  if (!fs.existsSync(payloadRoot) || !fs.statSync(payloadRoot).isDirectory() || !fs.existsSync(manifestPath)) {
    throw new Error(`A versão preservada ${version} não foi encontrada.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest?.manifestVersion !== 1 ||
    manifest?.manifestId !== "godsend.fixed.badavatar" ||
    !/^[a-f0-9]{64}$/.test(manifest?.bundleSha256 || "") ||
    !Array.isArray(manifest?.files) ||
    manifest.files.length !== manifest.fileCount
  ) {
    throw new Error(`O manifesto preservado da versão ${version} é inválido.`);
  }
  const nextIndex = {
    schemaVersion: 1,
    directoryName,
    manifestFileName,
    release: manifest.release,
    bundleSha256: manifest.bundleSha256,
  };
  const indexPath = path.join(assetsRoot, INDEX_FILE_NAME);
  const nextIndexPath = assertInside(assetsRoot, path.join(assetsRoot, `${INDEX_FILE_NAME}.next`), "O índice temporário");
  fs.writeFileSync(nextIndexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, "utf8");
  fs.copyFileSync(nextIndexPath, indexPath);
  fs.rmSync(nextIndexPath, { force: true });
  return nextIndex;
}

function updatePayload({
  sourceRoot: sourceInput,
  version: versionInput,
  assetsRoot: assetsInput = DEFAULT_ASSETS_ROOT,
  keepPrevious = false,
  createdAt = new Date().toISOString(),
}) {
  const sourceRoot = path.resolve(sourceInput || "");
  const assetsRoot = path.resolve(assetsInput);
  const version = String(versionInput || "").trim();
  if (!VERSION_PATTERN.test(version)) {
    throw new Error("A versão deve usar somente letras, números, ponto, hífen ou sublinhado.");
  }
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error("A pasta da nova versão não existe.");
  }
  fs.mkdirSync(assetsRoot, { recursive: true });
  validateSourceStructure(sourceRoot);

  const directoryName = `badavatar-${version}`;
  const manifestFileName = `${directoryName}.manifest.json`;
  const destinationRoot = assertInside(assetsRoot, path.join(assetsRoot, directoryName), "O novo pacote");
  const destinationManifest = assertInside(assetsRoot, path.join(assetsRoot, manifestFileName), "O novo manifesto");
  if (fs.existsSync(destinationRoot) || fs.existsSync(destinationManifest)) {
    throw new Error(`A versão ${version} já existe. Use outro identificador de versão.`);
  }

  const token = `${process.pid}-${Date.now()}`;
  const stagingRoot = assertInside(assetsRoot, path.join(assetsRoot, `.badavatar-update-${token}`), "O staging");
  const stagingManifest = assertInside(assetsRoot, path.join(assetsRoot, `.badavatar-update-${token}.manifest.json`), "O manifesto temporário");
  const indexPath = path.join(assetsRoot, INDEX_FILE_NAME);
  const nextIndexPath = assertInside(assetsRoot, path.join(assetsRoot, `${INDEX_FILE_NAME}.next`), "O índice temporário");
  const previous = readCurrentIndex(assetsRoot);

  let activated = false;
  try {
    fs.cpSync(sourceRoot, stagingRoot, { recursive: true, force: false, errorOnExist: true });
    const manifest = generateManifest(stagingRoot, stagingManifest, version, createdAt);
    fs.renameSync(stagingRoot, destinationRoot);
    fs.renameSync(stagingManifest, destinationManifest);

    const nextIndex = {
      schemaVersion: 1,
      directoryName,
      manifestFileName,
      release: manifest.release,
      bundleSha256: manifest.bundleSha256,
    };
    fs.writeFileSync(nextIndexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, "utf8");
    fs.copyFileSync(nextIndexPath, indexPath);
    fs.rmSync(nextIndexPath, { force: true });
    activated = true;

    let removedPrevious = false;
    let cleanupWarning = "";
    if (!keepPrevious && previous && previous.directoryName !== directoryName) {
      try {
        safeRemove(assetsRoot, path.join(assetsRoot, previous.directoryName));
        safeRemove(assetsRoot, path.join(assetsRoot, previous.manifestFileName));
        removedPrevious = true;
      } catch (cleanupError) {
        cleanupWarning = `A nova versão está ativa, mas a anterior não pôde ser removida: ${cleanupError.message}`;
      }
    }
    return { index: nextIndex, manifest, removedPrevious, cleanupWarning };
  } catch (error) {
    safeRemove(assetsRoot, stagingRoot);
    safeRemove(assetsRoot, stagingManifest);
    safeRemove(assetsRoot, nextIndexPath);
    if (!activated) {
      safeRemove(assetsRoot, destinationRoot);
      safeRemove(assetsRoot, destinationManifest);
    }
    throw error;
  }
}

if (require.main === module) {
  if (process.argv[2] === "--activate-existing") {
    const version = process.argv[3];
    if (!version) throw new Error("Uso: npm run payload:activate -- <versão-preservada>");
    const index = activateExistingVersion({ version });
    process.stdout.write(`Versão preservada ${index.release} ativada.\n`);
    process.exit(0);
  }
  const sourceRoot = process.argv[2];
  const version = process.argv[3];
  const keepPrevious = process.argv.includes("--keep-previous");
  if (!sourceRoot || !version) {
    throw new Error("Uso: npm run payload:update -- <pasta-da-nova-versão> <versão> [--keep-previous]");
  }
  process.stdout.write("Copiando e verificando a nova versão…\n");
  const result = updatePayload({ sourceRoot, version, keepPrevious });
  process.stdout.write(
    `Versão ${result.index.release} ativada: ${result.manifest.fileCount} arquivos, ${result.manifest.totalBytes} bytes.\n`,
  );
  if (result.cleanupWarning) process.stdout.write(`${result.cleanupWarning}\n`);
  if (keepPrevious) process.stdout.write("A versão anterior foi preservada e também entrará no próximo build.\n");
}

module.exports = {
  DEFAULT_ASSETS_ROOT,
  activateExistingVersion,
  readCurrentIndex,
  updatePayload,
  validateSourceStructure,
};
