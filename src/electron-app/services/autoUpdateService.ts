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
import { reportError } from "../infrastructure/telemetry";
import { powerShellExe } from "../infrastructure/windowsSystemExecutables";

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

const PENDING_UPDATE_FILE = "update-pending.json";
const UPDATE_RESULT_FILE = "update-result.txt";

export interface PendingUpdate {
  fromVersion: string;
  targetVersion: string;
  target: string;
  source: string;
}

export interface UpdateApplyFailure {
  fromVersion: string;
  targetVersion: string;
  currentVersion: string;
  reason: string;
}

let lastApplyFailure: UpdateApplyFailure | null = null;

/** Where downloadUpdate() leaves the verified package. */
export function getDownloadedUpdateFile(): string {
  return lastDownloadedUpdatePath || path.join(os.tmpdir(), "godsend-update", "xboxcompanion-update.exe");
}

/**
 * Picks the .exe the update overwrites. "" means there is none to overwrite
 * (dev build / not Windows). Throws when the only candidate is the portable's
 * extracted copy under %TEMP%: overwriting it updates nothing the user opens,
 * and the launcher deletes that folder on exit anyway.
 */
export function resolveReplaceTarget(opts: {
  portableFile?: string;
  isPackaged: boolean;
  platform: string;
  execPath: string;
  tmpDir: string;
}): string {
  if (opts.portableFile) return opts.portableFile;
  if (!(opts.isPackaged && opts.platform === "win32")) return "";
  const rel = path.win32.relative(opts.tmpDir.toLowerCase(), opts.execPath.toLowerCase());
  if (rel && !rel.startsWith("..") && !path.win32.isAbsolute(rel)) {
    throw new Error(
      `Este Xbox Companion foi aberto a partir de uma cópia temporária (${opts.execPath}), e não do xboxcompanion.exe. ` +
        "Não é possível atualizar automaticamente."
    );
  }
  return opts.execPath;
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * PowerShell that swaps the .exe once nothing holds it, writes the outcome to
 * `resultFile` and relaunches `target`.
 *
 * The wait is on processes, not on a clock: the portable launcher IS `target`
 * (portable.nsi: `PORTABLE_EXECUTABLE_FILE = $EXEPATH`) and only exits after
 * `ExecWait` on Electron returns AND its `RMDir /r` of the ~1.3 GB extracted
 * app finishes. A fixed ~11 s budget lost that race on every machine in the
 * field. `target` is relaunched even when the copy fails — it is the old
 * version then, and it reads `resultFile` at boot to tell the user.
 */
export function buildReplaceScript(opts: {
  target: string;
  source: string;
  resultFile: string;
  waitPid: number;
  waitSeconds?: number;
}): string {
  return `
      $target = ${psQuote(opts.target)}
      $source = ${psQuote(opts.source)}
      $resultFile = ${psQuote(opts.resultFile)}
      $deadline = (Get-Date).AddSeconds(${opts.waitSeconds ?? 180})
      while ((Get-Date) -lt $deadline) {
        $busy = @(Get-Process -Id ${opts.waitPid} -ErrorAction SilentlyContinue) + @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $target })
        if ($busy.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
      }
      $copied = $false
      $lastError = ''
      for ($i = 0; $i -lt 20 -and -not $copied; $i++) {
        try {
          Copy-Item -LiteralPath $source -Destination $target -Force -ErrorAction Stop
          $copied = $true
        } catch {
          $lastError = $_.Exception.Message
          Start-Sleep -Milliseconds 500
        }
      }
      if ($copied) { $outcome = 'ok' } else { $outcome = 'copy-failed: ' + $lastError }
      try { Set-Content -LiteralPath $resultFile -Value $outcome -Encoding UTF8 } catch {}
      Start-Process -FilePath $target
    `;
}

/**
 * Reads and deletes the marker left by applyUpdateAndRestart(). Returns the
 * failure when the app came back on a version older than the one applied.
 */
export function consumePendingUpdate(dir: string, currentVersion: string): UpdateApplyFailure | null {
  const markerFile = path.join(dir, PENDING_UPDATE_FILE);
  const resultFile = path.join(dir, UPDATE_RESULT_FILE);
  if (!fs.existsSync(markerFile)) return null;

  let marker: PendingUpdate | null = null;
  let outcome = "";
  try {
    marker = JSON.parse(fs.readFileSync(markerFile, "utf8"));
  } catch {}
  try {
    outcome = fs.readFileSync(resultFile, "utf8").replace(/^﻿/, "").trim();
  } catch {}
  for (const f of [markerFile, resultFile]) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }

  if (!marker?.targetVersion || !isNewerVersion(marker.targetVersion, currentVersion)) return null;
  return {
    fromVersion: marker.fromVersion,
    targetVersion: marker.targetVersion,
    currentVersion,
    reason: outcome || "o script de substituição não registrou resultado (não rodou ou foi interrompido)",
  };
}

/** Boot hook: logs and reports an update that did not take. */
export function checkPendingUpdateResult(): void {
  const failure = consumePendingUpdate(app.getPath("userData"), app.getVersion());
  if (!failure) return;
  lastApplyFailure = failure;
  const msg =
    `update aplicado mas a versão não mudou: ${failure.fromVersion} -> ${failure.targetVersion}, ` +
    `abriu ${failure.currentVersion}; ${failure.reason}`;
  appendAppEvent("UPDATE", msg);
  reportError("electron-main", "autoUpdateService.ts", "applyUpdateAndRestart", msg);
}

/** Hands the boot-time failure to the renderer once. */
export function takeLastApplyFailure(): UpdateApplyFailure | null {
  const f = lastApplyFailure;
  lastApplyFailure = null;
  return f;
}

/**
 * Applies the downloaded update and restarts the app.
 */
export async function applyUpdateAndRestart(downloadedFilePath?: string, targetVersion?: string): Promise<boolean> {
  const updateFile = downloadedFilePath || lastDownloadedUpdatePath;
  if (!updateFile || !fs.existsSync(updateFile)) {
    throw new Error("Arquivo de atualização não encontrado para instalação.");
  }

  appendAppEvent("UPDATE", `Applying update from ${updateFile}...`);

  const targetExecutable = resolveReplaceTarget({
    portableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    isPackaged: app.isPackaged,
    platform: process.platform,
    execPath: process.execPath,
    tmpDir: os.tmpdir(),
  });

  if (process.platform === "win32" && targetExecutable) {
    const dir = app.getPath("userData");
    const markerFile = path.join(dir, PENDING_UPDATE_FILE);
    const resultFile = path.join(dir, UPDATE_RESULT_FILE);
    try {
      fs.unlinkSync(resultFile);
    } catch {}
    const marker: PendingUpdate = {
      fromVersion: app.getVersion(),
      targetVersion: targetVersion || "",
      target: targetExecutable,
      source: updateFile,
    };
    fs.writeFileSync(markerFile, JSON.stringify(marker));

    const psScript = buildReplaceScript({ target: targetExecutable, source: updateFile, resultFile, waitPid: process.pid });
    try {
      const child = spawn(powerShellExe(), ["-NoProfile", "-WindowStyle", "Hidden", "-Command", psScript], {
        detached: true,
        stdio: "ignore",
      });
      // Quit only once the script is really running; a blocked PowerShell
      // (spawn EPERM) must surface as an error, not as a dead app.
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
    } catch (err) {
      try {
        fs.unlinkSync(markerFile);
      } catch {}
      throw err;
    }

    appendAppEvent("UPDATE", `Replace script started: ${targetExecutable} -> v${marker.targetVersion}`);
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
