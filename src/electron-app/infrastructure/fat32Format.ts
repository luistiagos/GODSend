/**
 * Cross-platform FAT32 formatting (including drives > 32 GB).
 *
 * - Windows: Ridgecrop fat32format.exe (bundled next to the app)
 * - macOS:   diskutil + newfs_msdos
 * - Linux:   umount + mkfs.vfat
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { getBundledRoot, getRepoRoot } from "./fileSystem";

export interface FormatProgress {
  status: string;
  percent: number;
}

export type FormatProgressCallback = (p: FormatProgress) => void;

function runCommand(
  command: string,
  args: string[],
  opts: { stdin?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    if (opts.stdin != null) {
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    }
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function readLogTail(logPath: string, limit = 1500): string {
  try {
    const data = fs.readFileSync(logPath, "utf8").trim();
    const lines = data.split("\n").map((l) => l.trimEnd()).filter((l) => l);
    const text = lines.join("\n");
    return text.length > limit ? text.slice(-limit) : text;
  } catch {
    return "";
  }
}

/** Runs a .ps1 file elevated (UAC). Returns exit code and whether UAC was cancelled. */
async function runPs1Elevated(
  ps1Path: string,
): Promise<{ code: number; stdout: string; stderr: string; cancelled: boolean }> {
  const escaped = ps1Path.replace(/'/g, "''");
  const outerScript = (
    `try { $p = Start-Process powershell -Verb RunAs -PassThru -Wait -WindowStyle Hidden ` +
    `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${escaped}'; ` +
    `Write-Output $p.ExitCode } catch { Write-Output 'CANCELLED' }`
  );
  const result = await runCommand("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", outerScript,
  ]);
  const out = result.stdout.trim();
  const cancelled = out.includes("CANCELLED");
  let code = result.code;
  if (!cancelled) {
    for (const token of out.split(/\s+/)) {
      if (/^-?\d+$/.test(token)) { code = parseInt(token, 10); break; }
    }
  }
  return { ...result, code, cancelled };
}

function driveLetterFromRoot(driveRoot: string): string {
  const m = driveRoot.trim().match(/^([A-Za-z]):/);
  if (!m) throw new Error(`Invalid Windows drive path: ${driveRoot}`);
  return m[1].toUpperCase();
}

export function resolveFat32FormatExe(): string | null {
  if (process.platform !== "win32") return null;

  const candidates = [
    path.join(getBundledRoot(), "fat32format.exe"),
    path.join(getRepoRoot(), "dist", "tools", "fat32format.exe"),
    path.join(getRepoRoot(), "tools", "fat32format", "fat32format.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function formatWindowsFat32(
  driveRoot: string,
  label: string,
  onProgress: FormatProgressCallback,
): Promise<void> {
  const letter = driveLetterFromRoot(driveRoot);
  const exe = resolveFat32FormatExe();
  const ts = Date.now();
  const ps1Path = path.join(os.tmpdir(), `godsend_fat32_${ts}.ps1`);
  const logPath = `${ps1Path}.log`;

  onProgress({ status: "Preparando dispositivo…", percent: 4 });

  try {
    if (exe) {
      onProgress({ status: "Formatting to FAT32 (large-volume tool)…", percent: 8 });
      const escapedExe = exe.replace(/'/g, "''");
      const escapedLog = logPath.replace(/'/g, "''");
      // diskpart clean+create operates at physical-disk level, bypassing Explorer's
      // volume-level lock (ERROR_SHARING_VIOLATION / GetLastError()=32).
      // After clean, fat32format.exe gets exclusive access to the fresh raw partition.
      // Output is written to a log file because Start-Process -Verb RunAs cannot redirect I/O.
      const innerScript =
`$ErrorActionPreference = 'Continue'
$log = '${escapedLog}'
'=== fat32format ${letter}: ===' | Out-File -FilePath $log -Encoding utf8
try {
  $diskNo = (Get-Partition -DriveLetter '${letter}' -ErrorAction Stop).DiskNumber
  "Disk number: $diskNo" | Out-File -FilePath $log -Append -Encoding utf8
} catch {
  ($_ | Out-String) | Out-File -FilePath $log -Append -Encoding utf8
  exit 1
}
$dp = @"
select disk $diskNo
attributes disk clear readonly
clean
create partition primary
assign letter=${letter}
exit
"@
($dp | diskpart 2>&1 | Out-String) | Out-File -FilePath $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Start-Sleep -Seconds 2
$out = "Y" | & '${escapedExe}' '${letter}:' 2>&1
$ec = $LASTEXITCODE
$out | Out-File -FilePath $log -Append -Encoding utf8
exit $ec`;
      fs.writeFileSync(ps1Path, innerScript, "utf8");
    } else {
      onProgress({ status: "Formatting to FAT32…", percent: 8 });
      const escapedLog = logPath.replace(/'/g, "''");
      const escapedLabel = label.replace(/'/g, "''");
      const innerScript = [
        `$ErrorActionPreference = 'Continue'`,
        `$log = '${escapedLog}'`,
        `'=== Format-Volume FAT32 ${letter}: ===' | Out-File -FilePath $log -Encoding utf8`,
        `try {`,
        `  $v = Get-Volume -DriveLetter '${letter}' -ErrorAction Stop`,
        `  $v | Format-Volume -FileSystem FAT32 -NewFileSystemLabel '${escapedLabel}' -Force -Confirm:$false -ErrorAction Stop | Out-Null`,
        `  'OK' | Out-File -FilePath $log -Append -Encoding utf8`,
        `  exit 0`,
        `} catch {`,
        `  ($_ | Out-String) | Out-File -FilePath $log -Append -Encoding utf8`,
        `  exit 1`,
        `}`,
      ].join("\r\n");
      fs.writeFileSync(ps1Path, innerScript, "utf8");
    }

    const { code, cancelled } = await runPs1Elevated(ps1Path);
    const detail = readLogTail(logPath);

    if (cancelled) {
      throw new Error("Formatação cancelada (a elevação de Administrador foi negada).");
    }
    if (code !== 0) {
      if (!exe && /32\s*GB|34359738368/i.test(detail)) {
        throw new Error(
          `${detail}\n\nRun "node scripts/download-fat32format.js" and rebuild, or place fat32format.exe next to GODsend.`,
        );
      }
      throw new Error(
        detail || "A formatação falhou. Feche outros programas usando o dispositivo e tente novamente.",
      );
    }
  } finally {
    for (const p of [ps1Path, logPath]) {
      try { fs.unlinkSync(p); } catch { /* best-effort cleanup */ }
    }
  }

  onProgress({ status: "Remounting drive…", percent: 12 });
  await runCommand("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Get-Volume -DriveLetter '${letter}' -ErrorAction SilentlyContinue | Out-Null;`,
  ]);
}

async function macPartitionDevice(mountPoint: string): Promise<string> {
  const { code, stdout } = await runCommand("diskutil", ["info", "-plist", mountPoint]);
  if (code !== 0) throw new Error("Could not read drive info for formatting.");

  const devMatch = stdout.match(/DeviceIdentifier<\/key>\s*<string>(disk\d+s\d+)<\/string>/);
  if (devMatch?.[1]) return devMatch[1];

  const devNode = await runCommand("diskutil", ["info", mountPoint]);
  const line = devNode.stdout.match(/Device Node:\s+(\S+)/);
  if (line?.[1]) return line[1].replace("/dev/", "");

  throw new Error("Could not determine partition device for formatting.");
}

async function formatDarwinFat32(
  driveRoot: string,
  label: string,
  onProgress: FormatProgressCallback,
): Promise<void> {
  const mountPoint = driveRoot.replace(/\/$/, "");
  const dev = await macPartitionDevice(mountPoint);
  const rawDev = dev.startsWith("/dev/") ? dev : `/dev/r${dev}`;

  onProgress({ status: "Unmounting drive…", percent: 5 });
  await runCommand("diskutil", ["unmount", mountPoint]);

  onProgress({ status: "Formatting to FAT32…", percent: 8 });
  // newfs_msdos supports large FAT32 volumes (FAT32B / -F 32).
  let result = await runCommand("newfs_msdos", ["-F", "32", "-v", label, rawDev]);
  if (result.code !== 0) {
    result = await runCommand("diskutil", ["eraseVolume", "MS-DOS FAT32", label, dev]);
  }
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || "Format failed.");
  }

  onProgress({ status: "Remounting drive…", percent: 12 });
  await runCommand("diskutil", ["mount", dev]);
}

async function linuxBlockDevice(mountPoint: string): Promise<string> {
  const r = await runCommand("findmnt", ["-n", "-o", "SOURCE", "--target", mountPoint]);
  if (r.code === 0 && r.stdout.trim()) {
    return r.stdout.trim();
  }

  const mounts = fs.readFileSync("/proc/mounts", "utf8");
  const norm = mountPoint.replace(/\/$/, "");
  for (const line of mounts.split("\n")) {
    const parts = line.split(" ");
    if (parts.length >= 2 && parts[1] === norm) {
      return parts[0];
    }
  }
  throw new Error("Could not determine block device for formatting.");
}

async function formatLinuxFat32(
  driveRoot: string,
  label: string,
  onProgress: FormatProgressCallback,
): Promise<void> {
  const mountPoint = driveRoot.replace(/\/$/, "");
  const dev = await linuxBlockDevice(mountPoint);

  onProgress({ status: "Unmounting drive…", percent: 5 });
  const umount = await runCommand("umount", [mountPoint]);
  if (umount.code !== 0) {
    const umountLazy = await runCommand("umount", ["-l", mountPoint]);
    if (umountLazy.code !== 0) {
      throw new Error(
        (umount.stderr || umount.stdout).trim() ||
          "Could not unmount drive. Close files using the USB and try again (may require root).",
      );
    }
  }

  onProgress({ status: "Formatting to FAT32…", percent: 8 });
  const mkfsCandidates: [string, string[]][] = [
    ["mkfs.vfat", ["-F", "32", "-n", label, dev]],
    ["mkfs.fat", ["-F", "32", "-n", label, dev]],
  ];

  let lastErr = "";
  for (const [cmd, args] of mkfsCandidates) {
    const result = await runCommand(cmd, args).catch(() => ({
      code: 1,
      stdout: "",
      stderr: `${cmd} not found`,
    }));
    if (result.code === 0) {
      onProgress({ status: "Remounting drive…", percent: 12 });
      await runCommand("mount", [dev, mountPoint]).catch(() => ({ code: 0, stdout: "", stderr: "" }));
      return;
    }
    lastErr = (result.stderr || result.stdout).trim();
  }

  throw new Error(
    lastErr ||
      "mkfs.vfat failed. Install dosfstools (mkfs.vfat) and run GODsend as root for formatting.",
  );
}

/** Format a mounted USB volume as FAT32 (any capacity supported on each OS). */
export async function formatVolumeFat32(
  driveRoot: string,
  onProgress: FormatProgressCallback,
  label = "BADAVATAR",
): Promise<void> {
  onProgress({ status: "Formatting drive to FAT32…", percent: 3 });

  if (process.platform === "win32") {
    await formatWindowsFat32(driveRoot, label, onProgress);
    return;
  }
  if (process.platform === "darwin") {
    await formatDarwinFat32(driveRoot, label, onProgress);
    return;
  }
  if (process.platform === "linux") {
    await formatLinuxFat32(driveRoot, label, onProgress);
    return;
  }

  throw new Error(`FAT32 formatting is not supported on ${process.platform}.`);
}

export function formatToolAvailable(): boolean {
  if (process.platform === "win32") {
    return resolveFat32FormatExe() != null || true; // PowerShell fallback
  }
  return process.platform === "darwin" || process.platform === "linux";
}
