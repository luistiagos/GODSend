import { createHash, randomUUID } from "crypto";
import fs from "fs";
import { promises as fsPromises } from "fs";
import https from "https";
import type { IncomingMessage } from "http";
import path from "path";
import { Transform } from "stream";
import { pipeline } from "stream/promises";
import type { TrustedComponent, TrustedComponentSource } from "./trustedComponentManifest";

const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;

export interface ComponentFileVerification {
  valid: boolean;
  actualSizeBytes: number;
  actualSha256: string;
  reason?: string;
}

export interface StagedComponentResult {
  filePath: string;
  reused: boolean;
  sizeBytes: number;
  sha256: string;
}

export type StagingProgressCallback = (progress: {
  componentId: string;
  receivedBytes: number;
  totalBytes: number;
}) => void;

export interface StagingOptions {
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("Operação cancelada.");
  error.name = "AbortError";
  throw error;
}

function normalizedSha256(value: string): string {
  return value.trim().toLowerCase();
}

export async function hashFileSha256(filePath: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const hash = createHash("sha256");
  if (signal) await pipeline(fs.createReadStream(filePath), hash, { signal });
  else await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest("hex");
}

export async function verifyComponentFile(
  filePath: string,
  source: TrustedComponentSource,
  signal?: AbortSignal,
): Promise<ComponentFileVerification> {
  throwIfAborted(signal);
  let stat;
  try {
    stat = await fsPromises.lstat(filePath);
  } catch (error: any) {
    return {
      valid: false,
      actualSizeBytes: 0,
      actualSha256: "",
      reason: error?.code === "ENOENT" ? "Arquivo ausente." : "Não foi possível ler o arquivo.",
    };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return { valid: false, actualSizeBytes: stat.size, actualSha256: "", reason: "O caminho não é um arquivo regular." };
  }
  if (stat.size !== source.sizeBytes) {
    return {
      valid: false,
      actualSizeBytes: stat.size,
      actualSha256: "",
      reason: `Tamanho divergente: esperado ${source.sizeBytes}, recebido ${stat.size}.`,
    };
  }
  const actualSha256 = await hashFileSha256(filePath, signal);
  if (actualSha256 !== normalizedSha256(source.sha256)) {
    return {
      valid: false,
      actualSizeBytes: stat.size,
      actualSha256,
      reason: "SHA-256 divergente.",
    };
  }
  return { valid: true, actualSizeBytes: stat.size, actualSha256 };
}

function allowedHostsFor(source: TrustedComponentSource): Set<string> {
  const initialHost = new URL(source.url).hostname.toLowerCase();
  return new Set([initialHost, ...source.redirectHosts.map((host) => host.toLowerCase())]);
}

function validateDownloadUrl(url: URL, allowedHosts: ReadonlySet<string>): void {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("O download ou redirecionamento tentou sair de HTTPS.");
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error(`Redirecionamento para host não autorizado: ${url.hostname}.`);
  }
}

export function assertTrustedComponentDownloadUrl(
  url: string,
  source: TrustedComponentSource,
): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("O download contém uma URL inválida.");
  }
  validateDownloadUrl(parsed, allowedHostsFor(source));
}

function requestResponse(
  url: URL,
  allowedHosts: ReadonlySet<string>,
  redirects = 0,
  signal?: AbortSignal,
): Promise<IncomingMessage> {
  throwIfAborted(signal);
  validateDownloadUrl(url, allowedHosts);
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "User-Agent": "Downloader-XBOX360/manifest-v1",
          "Accept-Encoding": "identity",
        },
        signal,
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) {
          const location = response.headers.location;
          response.resume();
          if (!location) {
            reject(new Error(`Redirecionamento HTTP ${status} sem destino.`));
            return;
          }
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error("O download excedeu o limite de redirecionamentos."));
            return;
          }
          let next: URL;
          try {
            next = new URL(location, url);
            validateDownloadUrl(next, allowedHosts);
          } catch (error) {
            reject(error);
            return;
          }
          requestResponse(next, allowedHosts, redirects + 1, signal).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`Download recusado pelo servidor: HTTP ${status}.`));
          return;
        }
        resolve(response);
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error("Tempo limite ao conectar ao servidor do componente."));
    });
    request.on("error", reject);
  });
}

async function downloadVerifiedLength(
  component: TrustedComponent,
  partialPath: string,
  onProgress?: StagingProgressCallback,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const allowedHosts = allowedHostsFor(component.source);
  const response = await requestResponse(new URL(component.source.url), allowedHosts, 0, signal);
  const advertisedLength = response.headers["content-length"];
  if (advertisedLength != null) {
    const parsedLength = Number(advertisedLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength !== component.source.sizeBytes) {
      response.destroy();
      throw new Error(
        `O servidor anunciou tamanho diferente do manifesto para ${component.displayName}.`,
      );
    }
  }

  let receivedBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > component.source.sizeBytes) {
        callback(new Error(`O download de ${component.displayName} excedeu o tamanho assinado.`));
        return;
      }
      onProgress?.({
        componentId: component.id,
        receivedBytes,
        totalBytes: component.source.sizeBytes,
      });
      callback(null, chunk);
    },
  });

  const destination = fs.createWriteStream(partialPath, { flags: "wx" });
  if (signal) await pipeline(response, limiter, destination, { signal });
  else await pipeline(response, limiter, destination);
  if (receivedBytes !== component.source.sizeBytes) {
    throw new Error(
      `Download incompleto de ${component.displayName}: esperado ${component.source.sizeBytes}, recebido ${receivedBytes}.`,
    );
  }
  const handle = await fsPromises.open(partialPath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function safeComponentDirectory(stagingRoot: string, componentId: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(componentId)) {
    throw new Error("Identificador de componente não validado.");
  }
  const root = path.resolve(stagingRoot);
  const target = path.resolve(root, componentId);
  if (path.dirname(target) !== root) throw new Error("O componente escaparia da área de staging.");
  return target;
}

async function prepareSafeComponentDirectory(stagingRoot: string, componentId: string): Promise<string> {
  if (!path.isAbsolute(stagingRoot)) throw new Error("A raiz de staging precisa ser absoluta.");
  const root = path.resolve(stagingRoot);
  await fsPromises.mkdir(root, { recursive: true });
  const rootStat = await fsPromises.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("A raiz de staging precisa ser um diretório real.");
  }
  const realRoot = await fsPromises.realpath(root);
  if ((process.platform === "win32" ? realRoot.toLowerCase() : realRoot) !==
      (process.platform === "win32" ? root.toLowerCase() : root)) {
    throw new Error("A raiz de staging atravessa link ou redirecionamento.");
  }

  const componentDir = safeComponentDirectory(root, componentId);
  try {
    const stat = await fsPromises.lstat(componentDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("A pasta de staging do componente não é um diretório real.");
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    await fsPromises.mkdir(componentDir, { recursive: false });
  }
  const realComponentDir = await fsPromises.realpath(componentDir);
  const realParent = path.dirname(realComponentDir);
  if ((process.platform === "win32" ? realParent.toLowerCase() : realParent) !==
      (process.platform === "win32" ? realRoot.toLowerCase() : realRoot)) {
    throw new Error("A pasta do componente escapou da raiz de staging.");
  }
  return componentDir;
}

export async function stageTrustedComponent(
  component: TrustedComponent,
  stagingRoot: string,
  onProgress?: StagingProgressCallback,
  options: StagingOptions = {},
): Promise<StagedComponentResult> {
  throwIfAborted(options.signal);
  const componentDir = await prepareSafeComponentDirectory(stagingRoot, component.id);
  const finalPath = path.join(componentDir, component.source.fileName);

  const cached = await verifyComponentFile(finalPath, component.source, options.signal);
  if (cached.valid) {
    return {
      filePath: finalPath,
      reused: true,
      sizeBytes: cached.actualSizeBytes,
      sha256: cached.actualSha256,
    };
  }
  await fsPromises.rm(finalPath, { force: true });

  const partialPath = path.join(componentDir, `.${component.source.fileName}.${randomUUID()}.partial`);
  try {
    await downloadVerifiedLength(component, partialPath, onProgress, options.signal);
    const verification = await verifyComponentFile(partialPath, component.source, options.signal);
    if (!verification.valid) {
      throw new Error(
        `Falha de integridade em ${component.displayName}: ${verification.reason || "arquivo inválido"}`,
      );
    }
    throwIfAborted(options.signal);
    await fsPromises.rename(partialPath, finalPath);
    return {
      filePath: finalPath,
      reused: false,
      sizeBytes: verification.actualSizeBytes,
      sha256: verification.actualSha256,
    };
  } catch (error) {
    await fsPromises.rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }
}
