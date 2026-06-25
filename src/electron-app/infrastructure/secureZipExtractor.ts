import { createHash, randomUUID } from "crypto";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { verifyComponentFile } from "./secureComponentStaging";
import type { TrustedComponent } from "./trustedComponentManifest";

const MAX_COMPRESSION_RATIO = 2_000;
const WINDOWS_RESERVED_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface ExtractedFileDescriptor {
  sourcePath: string;
  archivePath: string;
  sizeBytes: number;
  sha256: string;
}

interface InspectedZipEntry {
  entry: Entry;
  archivePath: string;
  isDirectory: boolean;
}

export interface SecureZipExtractionResult {
  outputPath: string;
  files: ExtractedFileDescriptor[];
  totalBytes: number;
  entryCount: number;
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      {
        autoClose: false,
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zipFile) => {
        if (error) reject(error);
        else resolve(zipFile);
      },
    );
  });
}

function unixFileType(entry: Entry): number {
  const creatorPlatform = (entry.versionMadeBy >>> 8) & 0xff;
  if (creatorPlatform !== 3) return 0;
  return ((entry.externalFileAttributes >>> 16) & 0xffff) & 0o170000;
}

function normalizeArchivePath(fileName: string): { archivePath: string; isDirectory: boolean } {
  if (!fileName || fileName.length > 240 || fileName.normalize("NFC") !== fileName) {
    throw new Error("O ZIP contém nome vazio, longo demais ou Unicode não normalizado.");
  }
  if (
    fileName.startsWith("/") ||
    fileName.startsWith("\\") ||
    fileName.includes("\\") ||
    /^[a-z]:/i.test(fileName) ||
    /[\x00-\x1f:*?"<>|]/.test(fileName)
  ) {
    throw new Error(`O ZIP contém caminho não permitido: ${fileName}.`);
  }
  const isDirectory = fileName.endsWith("/");
  const withoutTrailingSlash = isDirectory ? fileName.slice(0, -1) : fileName;
  const segments = withoutTrailingSlash.split("/");
  if (segments.length > 64) throw new Error(`O ZIP contém caminho profundo demais: ${fileName}.`);
  for (const segment of segments) {
    if (
      !segment ||
      segment === "." ||
      segment === ".." ||
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      WINDOWS_RESERVED_NAMES.test(segment)
    ) {
      throw new Error(`O ZIP contém segmento inseguro: ${fileName}.`);
    }
  }
  return { archivePath: segments.join("/"), isDirectory };
}

function inspectEntry(entry: Entry, component: TrustedComponent): InspectedZipEntry {
  if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw new Error(`O ZIP contém entrada criptografada: ${entry.fileName}.`);
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new Error(`Método de compressão não permitido em ${entry.fileName}.`);
  }
  if (
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 0 ||
    !Number.isSafeInteger(entry.compressedSize) ||
    entry.compressedSize < 0
  ) {
    throw new Error(`Tamanho inválido no ZIP: ${entry.fileName}.`);
  }
  const normalized = normalizeArchivePath(entry.fileName);
  const fileType = unixFileType(entry);
  const unixDirectory = fileType === 0o040000;
  const unixRegular = fileType === 0 || fileType === 0o100000;
  if (fileType === 0o120000) throw new Error(`Link simbólico não permitido no ZIP: ${entry.fileName}.`);
  if (!unixRegular && !unixDirectory) {
    throw new Error(`Tipo especial de arquivo não permitido no ZIP: ${entry.fileName}.`);
  }
  if (unixDirectory !== normalized.isDirectory && fileType !== 0) {
    throw new Error(`Tipo de diretório inconsistente no ZIP: ${entry.fileName}.`);
  }
  if (!normalized.isDirectory && entry.uncompressedSize > component.archive.maxExtractedBytes) {
    throw new Error(`Entrada excede o limite de expansão: ${entry.fileName}.`);
  }
  if (
    !normalized.isDirectory &&
    entry.uncompressedSize > 0 &&
    (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)
  ) {
    throw new Error(`Taxa de compressão suspeita no ZIP: ${entry.fileName}.`);
  }
  return { entry, ...normalized };
}

async function inspectZip(zipFile: ZipFile, component: TrustedComponent): Promise<InspectedZipEntry[]> {
  if (zipFile.entryCount < 1 || zipFile.entryCount > component.archive.maxEntries) {
    throw new Error("O ZIP excede a quantidade de entradas permitida pelo manifesto.");
  }
  return new Promise((resolve, reject) => {
    const inspected: InspectedZipEntry[] = [];
    const names = new Set<string>();
    let declaredTotal = 0;
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onEntry = (entry: Entry) => {
      try {
        const item = inspectEntry(entry, component);
        const key = item.archivePath.toLowerCase();
        if (names.has(key)) throw new Error(`Caminho duplicado no ZIP: ${item.archivePath}.`);
        names.add(key);
        if (!item.isDirectory) {
          declaredTotal += entry.uncompressedSize;
          if (!Number.isSafeInteger(declaredTotal) || declaredTotal > component.archive.maxExtractedBytes) {
            throw new Error("O ZIP excede o limite total de expansão assinado.");
          }
        }
        inspected.push(item);
        zipFile.readEntry();
      } catch (error: any) {
        fail(error);
      }
    };
    const onEnd = () => {
      try {
        const files = new Set(
          inspected.filter((item) => !item.isDirectory).map((item) => item.archivePath.toLowerCase()),
        );
        for (const item of inspected) {
          const segments = item.archivePath.toLowerCase().split("/");
          for (let index = 1; index < segments.length; index++) {
            if (files.has(segments.slice(0, index).join("/"))) {
              throw new Error(`Arquivo e diretório colidem no ZIP: ${item.archivePath}.`);
            }
          }
        }
        cleanup();
        resolve(inspected);
      } catch (error: any) {
        fail(error);
      }
    };
    const cleanup = () => {
      zipFile.off("entry", onEntry);
      zipFile.off("end", onEnd);
      zipFile.off("error", fail);
    };
    zipFile.on("entry", onEntry);
    zipFile.once("end", onEnd);
    zipFile.once("error", fail);
    zipFile.readEntry();
  });
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolve(stream);
    });
  });
}

function safeOutputPath(root: string, archivePath: string): string {
  const output = path.resolve(root, ...archivePath.split("/"));
  const relative = path.relative(root, output);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`A entrada escaparia da pasta de extração: ${archivePath}.`);
  }
  return output;
}

async function extractFile(
  zipFile: ZipFile,
  item: InspectedZipEntry,
  temporaryRoot: string,
  remainingBytes: { value: number },
): Promise<ExtractedFileDescriptor> {
  const destination = safeOutputPath(temporaryRoot, item.archivePath);
  await fsPromises.mkdir(path.dirname(destination), { recursive: true });
  const source = await openEntryStream(zipFile, item.entry);
  const hash = createHash("sha256");
  let actualBytes = 0;
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      actualBytes += chunk.length;
      remainingBytes.value += chunk.length;
      if (actualBytes > item.entry.uncompressedSize) {
        callback(new Error(`A entrada expandiu além do tamanho declarado: ${item.archivePath}.`));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    source,
    verifier,
    fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  if (actualBytes !== item.entry.uncompressedSize) {
    throw new Error(`Tamanho extraído divergente em ${item.archivePath}.`);
  }
  const handle = await fsPromises.open(destination, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  return {
    sourcePath: destination,
    archivePath: item.archivePath,
    sizeBytes: actualBytes,
    sha256: hash.digest("hex"),
  };
}

export async function extractTrustedZipToStaging(
  zipPath: string,
  extractionRoot: string,
  component: TrustedComponent,
): Promise<SecureZipExtractionResult> {
  if (component.archive.format !== "zip") throw new Error("O componente não foi declarado como ZIP.");
  const zipStat = await fsPromises.lstat(zipPath);
  if (!zipStat.isFile() || zipStat.isSymbolicLink()) {
    throw new Error("O caminho do ZIP precisa ser um arquivo regular, sem link simbólico.");
  }
  const archiveVerification = await verifyComponentFile(zipPath, component.source);
  if (!archiveVerification.valid) {
    throw new Error(`O ZIP não corresponde ao manifesto: ${archiveVerification.reason}`);
  }
  if (!path.isAbsolute(extractionRoot)) throw new Error("A raiz de extração precisa ser absoluta.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(component.id)) {
    throw new Error("Identificador de componente inválido para extração.");
  }
  const root = path.resolve(extractionRoot);
  await fsPromises.mkdir(root, { recursive: true });
  const rootStat = await fsPromises.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("A raiz de extração não é um diretório real.");
  }
  const realRoot = await fsPromises.realpath(root);
  if (
    (process.platform === "win32" ? realRoot.toLowerCase() : realRoot) !==
    (process.platform === "win32" ? root.toLowerCase() : root)
  ) {
    throw new Error("A raiz de extração atravessa link ou redirecionamento de diretório.");
  }
  const finalRoot = path.join(root, component.id);
  try {
    await fsPromises.lstat(finalRoot);
    throw new Error("A pasta final do componente já existe; uma extração nunca a sobrescreve.");
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporaryRoot = path.join(root, `.${component.id}.${randomUUID()}.partial`);
  await fsPromises.mkdir(temporaryRoot, { recursive: false });

  let zipFile: ZipFile | undefined;
  try {
    zipFile = await openZip(zipPath);
    const entries = await inspectZip(zipFile, component);
    const files: ExtractedFileDescriptor[] = [];
    const actualTotal = { value: 0 };
    for (const item of entries) {
      const destination = safeOutputPath(temporaryRoot, item.archivePath);
      if (item.isDirectory) {
        await fsPromises.mkdir(destination, { recursive: true });
      } else {
        files.push(await extractFile(zipFile, item, temporaryRoot, actualTotal));
      }
      if (actualTotal.value > component.archive.maxExtractedBytes) {
        throw new Error("A extração excedeu o limite total assinado.");
      }
    }
    if (files.length === 0) throw new Error("O ZIP não contém arquivos regulares.");
    await fsPromises.rename(temporaryRoot, finalRoot);
    files.sort((a, b) => a.archivePath.localeCompare(b.archivePath, "en", { sensitivity: "base" }));
    return {
      outputPath: finalRoot,
      files: files.map((file) => ({
        ...file,
        sourcePath: path.join(finalRoot, path.relative(temporaryRoot, file.sourcePath)),
      })),
      totalBytes: actualTotal.value,
      entryCount: entries.length,
    };
  } catch (error) {
    await fsPromises.rm(temporaryRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  } finally {
    zipFile?.close();
  }
}
