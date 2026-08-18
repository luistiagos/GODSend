import { app } from "electron";
import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import {
  getConfiguredAutoCheckUpdates,
  getLastUpdateCheck,
  setLastUpdateCheck,
  getSkippedUpdateVersion,
  setSkippedUpdateVersion,
} from "./settingsService";
import { appendAppEvent } from "../infrastructure/serverLog";

export interface VersionManifest {
  version: string;
  versionCode?: number | string;
  releaseDate?: string;
  channel?: string;
  downloadUrl: string;
  sha256?: string;
  size?: number;
  notes?: string;
  portableUrl?: string;
  hfUrl?: string;
}

export interface UpdateCheckResult {
  ok: boolean;
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseDate?: string;
  notes?: string;
  downloadUrl?: string;
  sha256?: string;
  size?: number;
  skipped?: boolean;
  error?: string;
}

export interface UpdateProgress {
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  speedBytesPerSec: number;
}

const UPDATE_ENDPOINTS = [
  "https://versions.digitalstoregames.com/XBOX360Companion/version.json",
  "https://versions.digitalstoregames.com/version.json",
];

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

let currentDownloadAbortController: AbortController | null = null;
let lastDownloadedUpdatePath: string | null = null;
let lastDownloadedSha256: string | null = null;

/**
 * Compare two semver strings: returns true if remote > current.
 */
export function isNewerVersion(remote: string, current: string): boolean {
  if (!remote || !current) return false;

  const clean = (v: string) => v.trim().replace(/^v/i, "");
  const rParts = clean(remote).split(".").map((n) => parseInt(n, 10) || 0);
  const cParts = clean(current).split(".").map((n) => parseInt(n, 10) || 0);

  const maxLen = Math.max(rParts.length, cParts.length);
  for (let i = 0; i < maxLen; i++) {
    const r = rParts[i] ?? 0;
    const c = cParts[i] ?? 0;
    if (r > c) return true;
    if (r < c) return false;
  }
  return false;
}

/**
 * Fetches JSON content with HTTPS/HTTP supporting redirects and timeout.
 */
function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "http:" ? http : https;

    const req = lib.get(
      url,
      {
        headers: {
          "User-Agent": `Xbox360Companion/${app.getVersion() || "2.12.39"}`,
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).href;
          return fetchJson<T>(redirectUrl, timeoutMs).then(resolve, reject);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }

        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed as T);
          } catch (e: any) {
            reject(new Error(`Invalid JSON from ${url}: ${e.message}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
    });
  });
}

/**
 * Checks for updates against remote version.json.
 */
export async function checkForUpdates(force = false): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion() || "2.12.39";

  if (!force) {
    if (!getConfiguredAutoCheckUpdates()) {
      return {
        ok: true,
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
      };
    }

    const lastCheck = getLastUpdateCheck();
    if (Date.now() - lastCheck < TWELVE_HOURS_MS) {
      return {
        ok: true,
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
      };
    }
  }

  setLastUpdateCheck(Date.now());

  let manifest: VersionManifest | null = null;
  let lastErr: Error | null = null;

  for (const endpoint of UPDATE_ENDPOINTS) {
    try {
      const cacheBustUrl = `${endpoint}?t=${Date.now()}`;
      manifest = await fetchJson<VersionManifest>(cacheBustUrl, 10000);
      if (manifest && manifest.version) {
        break;
      }
    } catch (err: any) {
      lastErr = err;
    }
  }

  if (!manifest || !manifest.version) {
    const errorMsg = lastErr?.message || "Failed to reach update servers";
    appendAppEvent("UPDATE", `Check failed: ${errorMsg}`);
    return {
      ok: false,
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      error: errorMsg,
    };
  }

  const latestVersion = manifest.version;
  const updateAvailable = isNewerVersion(latestVersion, currentVersion);

  if (!force && updateAvailable && getSkippedUpdateVersion() === latestVersion) {
    return {
      ok: true,
      updateAvailable: false,
      currentVersion,
      latestVersion,
      skipped: true,
      releaseDate: manifest.releaseDate,
      notes: manifest.notes,
      downloadUrl: manifest.downloadUrl,
      sha256: manifest.sha256,
      size: manifest.size,
    };
  }

  appendAppEvent(
    "UPDATE",
    `Check result: current=${currentVersion}, latest=${latestVersion}, updateAvailable=${updateAvailable}`
  );

  return {
    ok: true,
    updateAvailable,
    currentVersion,
    latestVersion,
    releaseDate: manifest.releaseDate,
    notes: manifest.notes,
    downloadUrl: manifest.downloadUrl || manifest.portableUrl,
    sha256: manifest.sha256,
    size: manifest.size,
  };
}

/**
 * Downloads update binary with progress and verifies SHA-256 hash.
 */
export async function downloadUpdate(
  downloadUrl: string,
  expectedSha256?: string,
  expectedSize?: number,
  onProgress?: (p: UpdateProgress) => void
): Promise<string> {
  if (currentDownloadAbortController) {
    currentDownloadAbortController.abort();
    currentDownloadAbortController = null;
  }

  const abortController = new AbortController();
  currentDownloadAbortController = abortController;

  const tempDir = path.join(os.tmpdir(), "godsend-update");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const targetTempFile = path.join(tempDir, "xboxcompanion-update.exe");
  const partFile = `${targetTempFile}.part`;

  if (fs.existsSync(partFile)) {
    try {
      fs.unlinkSync(partFile);
    } catch {}
  }

  return new Promise<string>((resolve, reject) => {
    let bytesDownloaded = 0;
    let totalBytes = expectedSize || 0;
    let lastTime = Date.now();
    let lastBytes = 0;
    let speedBytesPerSec = 0;

    const hash = crypto.createHash("sha256");
    const fileStream = fs.createWriteStream(partFile, { flags: "w" });

    function cleanup() {
      currentDownloadAbortController = null;
      if (fileStream && !fileStream.destroyed) {
        fileStream.destroy();
      }
    }

    abortController.signal.addEventListener("abort", () => {
      cleanup();
      try {
        if (fs.existsSync(partFile)) fs.unlinkSync(partFile);
      } catch {}
      reject(new Error("Download cancelado pelo usuario"));
    });

    function makeRequest(currentUrl: string) {
      const u = new URL(currentUrl);
      const lib = u.protocol === "http:" ? http : https;

      const req = lib.get(
        currentUrl,
        {
          headers: {
            "User-Agent": `Xbox360Companion/${app.getVersion() || "2.12.39"}`,
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, currentUrl).href;
            return makeRequest(redirectUrl);
          }

          if (res.statusCode !== 200) {
            cleanup();
            return reject(new Error(`Falha no download (HTTP ${res.statusCode}: ${res.statusMessage})`));
          }

          const contentLength = res.headers["content-length"];
          if (contentLength) {
            totalBytes = parseInt(contentLength, 10);
          }

          res.on("data", (chunk: Buffer) => {
            if (abortController.signal.aborted) return;
            bytesDownloaded += chunk.length;
            hash.update(chunk);

            const now = Date.now();
            if (now - lastTime >= 500) {
              const deltaBytes = bytesDownloaded - lastBytes;
              const deltaTime = (now - lastTime) / 1000;
              speedBytesPerSec = Math.round(deltaBytes / deltaTime);
              lastBytes = bytesDownloaded;
              lastTime = now;

              const percent = totalBytes > 0 ? Math.min(100, Math.round((bytesDownloaded / totalBytes) * 100)) : 0;
              if (onProgress) {
                onProgress({
                  percent,
                  bytesDownloaded,
                  totalBytes,
                  speedBytesPerSec,
                });
              }
            }
          });

          res.pipe(fileStream);

          fileStream.on("finish", () => {
            cleanup();
            fileStream.close(async () => {
              try {
                const calculatedSha256 = hash.digest("hex").toLowerCase();

                if (expectedSha256 && calculatedSha256 !== expectedSha256.toLowerCase()) {
                  if (fs.existsSync(partFile)) fs.unlinkSync(partFile);
                  return reject(
                    new Error(
                      `Falha de integridade SHA-256. Esperado: ${expectedSha256.slice(0, 12)}..., Calculado: ${calculatedSha256.slice(0, 12)}...`
                    )
                  );
                }

                if (fs.existsSync(targetTempFile)) {
                  fs.unlinkSync(targetTempFile);
                }
                fs.renameSync(partFile, targetTempFile);

                lastDownloadedUpdatePath = targetTempFile;
                lastDownloadedSha256 = calculatedSha256;

                if (onProgress) {
                  onProgress({
                    percent: 100,
                    bytesDownloaded,
                    totalBytes: bytesDownloaded,
                    speedBytesPerSec: 0,
                  });
                }

                appendAppEvent("UPDATE", `Download complete & verified: ${targetTempFile} (${calculatedSha256})`);
                resolve(targetTempFile);
              } catch (e: any) {
                reject(e);
              }
            });
          });

          fileStream.on("error", (err) => {
            cleanup();
            reject(err);
          });
        }
      );

      req.on("error", (err) => {
        cleanup();
        reject(err);
      });
    }

    makeRequest(downloadUrl);
  });
}

/**
 * Cancels any active update download.
 */
export function cancelUpdateDownload(): void {
  if (currentDownloadAbortController) {
    currentDownloadAbortController.abort();
    currentDownloadAbortController = null;
  }
}

/**
 * Applies the downloaded update and restarts the app.
 */
export function applyUpdateAndRestart(downloadedFilePath?: string): boolean {
  const updateFile = downloadedFilePath || lastDownloadedUpdatePath;
  if (!updateFile || !fs.existsSync(updateFile)) {
    throw new Error("Arquivo de atualização não encontrado para instalação.");
  }

  appendAppEvent("UPDATE", `Applying update from ${updateFile}...`);

  // Identify target executable to replace
  let targetExecutable = process.env.PORTABLE_EXECUTABLE_FILE || "";
  if (!targetExecutable) {
    if (app.isPackaged && process.platform === "win32") {
      targetExecutable = process.execPath;
    }
  }

  if (process.platform === "win32" && targetExecutable) {
    const pid = process.pid;
    // Detached PowerShell command that waits for our process to exit, replaces target executable, and relaunches
    const psScript = `
      Start-Sleep -Milliseconds 1500
      $target = '${targetExecutable.replace(/'/g, "''")}'
      $source = '${updateFile.replace(/'/g, "''")}'
      $attempts = 0
      while ($attempts -lt 20) {
        try {
          Copy-Item -LiteralPath $source -Destination $target -Force
          break
        } catch {
          Start-Sleep -Milliseconds 500
          $attempts++
        }
      }
      Start-Process -FilePath $target
    `;

    const child = spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psScript], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    app.quit();
    return true;
  } else {
    // Non-windows or unpackaged dev mode
    const child = spawn(updateFile, [], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    app.quit();
    return true;
  }
}

/**
 * Dismisses a version so the user won't be prompted again until a newer release.
 */
export function dismissVersion(version: string): void {
  setSkippedUpdateVersion(version);
}
