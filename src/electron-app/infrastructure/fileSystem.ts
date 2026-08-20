import { app, nativeImage } from "electron";
import path from "path";
import fs from "fs";
import { getConfiguredStoragePath } from "../services/settingsService";
import { appendAppEvent } from "./serverLog";

/**
 * Monorepo root (directory containing `cache/`, `dist/`, `tools/`).
 */
export function getRepoRoot(): string {
  return path.resolve(__dirname, "../../..");
}

/** Install root: next to the .exe on Windows (extraFiles land here, not under resources). */
export function getBundledRoot(): string {
  return app.isPackaged
    ? path.dirname(process.execPath)
    : getRepoRoot();
}

/**
 * Resource root for bundled data files (cache, assets, aurora-scripts).
 * On packaged macOS this is `Contents/Resources/`; on Windows/Linux it's
 * `<install>/resources/`. Code-signing on macOS forbids non-Mach-O files
 * inside `Contents/MacOS/`, so data must live under Resources.
 */
export function getBundledResourcesRoot(): string {
  return app.isPackaged ? process.resourcesPath : getRepoRoot();
}

/** Go binary: packaged next to the app executable; name varies by OS. */
export function getGodsendExePath(): string {
  const isWin   = process.platform === "win32";
  const isArm64 = process.arch === "arm64";
  const isIa32  = process.arch === "ia32";
  if (app.isPackaged) {
    const name = isWin ? "godsend-backend.exe" : "godsend-backend";
    return path.join(path.dirname(process.execPath), name);
  }
  const repo = getRepoRoot();
  const devCandidates = isWin
    ? isIa32
      ? ["dist/godsend-windows-ia32.exe", "dist/godsend.exe", "dist/godsend-windows-x64.exe"]
      : ["dist/godsend-windows-x64.exe", "dist/godsend.exe", "dist/godsend-windows-ia32.exe"]
    : process.platform === "darwin"
    ? ["dist/godsend-mac"]
    : isArm64
    ? ["dist/godsend-linux-arm64", "dist/godsend-linux-x64"]
    : ["dist/godsend-linux-x64", "dist/godsend-linux-arm64"];
  for (const rel of devCandidates) {
    const p = path.join(repo, rel);
    if (fs.existsSync(p)) return p;
  }
  return path.join(repo, devCandidates[0]);
}

export function getDefaultWritableRuntimeRoot(): string {
  return app.isPackaged
    ? path.join(app.getPath("userData"), "runtime")
    : getBundledRoot();
}

export function getWritableRuntimeRoot(): string {
  const custom = getConfiguredStoragePath();
  return custom ? path.resolve(custom) : getDefaultWritableRuntimeRoot();
}

export function ensureDirectory(dirPath: string): void {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (err: any) {
    if (err?.code !== "EEXIST") {
      appendAppEvent("RUNTIME", `ensureDirectory failed for ${dirPath}: ${err?.message || err}`);
    }
  }
}

export function copyFileIfMissing(sourcePath: string, targetPath: string): void {
  try {
    if (!fs.existsSync(sourcePath)) return;
    if (fs.existsSync(targetPath)) return;
    ensureDirectory(path.dirname(targetPath));

    let copied = false;
    let lastError: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (fs.existsSync(targetPath)) {
          copied = true;
          break;
        }
        fs.copyFileSync(sourcePath, targetPath);
        copied = true;
        break;
      } catch (err: any) {
        lastError = err;
        if (err?.code === "EEXIST" || fs.existsSync(targetPath)) {
          copied = true;
          break;
        }
        if (attempt < 2) {
          const waitUntil = Date.now() + 50;
          while (Date.now() < waitUntil) { /* spin */ }
        }
      }
    }
    if (!copied && lastError) {
      appendAppEvent(
        "RUNTIME",
        `copyFileIfMissing non-fatal warning (${sourcePath} -> ${targetPath}): ${lastError.message || lastError}`
      );
    }
  } catch (err: any) {
    appendAppEvent(
      "RUNTIME",
      `copyFileIfMissing unexpected error (${sourcePath} -> ${targetPath}): ${err?.message || err}`
    );
  }
}

export function copyDirectoryContentsIfMissing(sourceDir: string, targetDir: string): void {
  try {
    if (!fs.existsSync(sourceDir)) return;
    ensureDirectory(targetDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const src = path.join(sourceDir, entry.name);
      const dst = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        copyDirectoryContentsIfMissing(src, dst);
      } else {
        copyFileIfMissing(src, dst);
      }
    }
  } catch (err: any) {
    appendAppEvent(
      "RUNTIME",
      `copyDirectoryContentsIfMissing warning for ${sourceDir}: ${err?.message || err}`
    );
  }
}

export function prepareWritableRuntime(): string {
  const bundledRoot = getBundledResourcesRoot();
  const writableRoot = getWritableRuntimeRoot();

  ensureDirectory(writableRoot);
  ensureDirectory(path.join(writableRoot, "cache"));
  ensureDirectory(path.join(writableRoot, "Temp"));
  ensureDirectory(path.join(writableRoot, "Temp", "torrent-dl"));
  ensureDirectory(path.join(writableRoot, "Transfer"));
  ensureDirectory(path.join(writableRoot, "Ready"));

  copyDirectoryContentsIfMissing(
    path.join(bundledRoot, "cache"),
    path.join(writableRoot, "cache")
  );

  if (!app.isPackaged) {
    const legacyCache = path.join(getRepoRoot(), "src", "cache");
    copyDirectoryContentsIfMissing(
      legacyCache,
      path.join(writableRoot, "cache")
    );
  }

  return writableRoot;
}

/** Aurora scripts bundled with the installer (extraFiles → aurora-scripts/). */
export function getAuroraScriptsPath(): string {
  return path.join(getBundledResourcesRoot(), "aurora-scripts");
}

export function getIconCandidates(): string[] {
  const bundledRoot = getBundledResourcesRoot();
  const assetsDev = path.join(__dirname, "..", "assets");
  return [
    path.join(bundledRoot, "assets", "icon.ico"),
    path.join(bundledRoot, "assets", "icon.png"),
    path.join(assetsDev, "icon.ico"),
    path.join(assetsDev, "icon.png"),
    path.join(bundledRoot, "assets", "tray.ico"),
    path.join(bundledRoot, "assets", "tray.png"),
    path.join(assetsDev, "tray.ico"),
    path.join(assetsDev, "tray.png"),
  ];
}

export function getFirstValidIconPath(): string | null {
  for (const iconPath of getIconCandidates()) {
    if (!fs.existsSync(iconPath)) continue;
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) return iconPath;
  }
  return null;
}
