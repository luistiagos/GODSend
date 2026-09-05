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

export interface WindowsFormatGuard {
  expectedVolumeGuid: string;
  expectedVolumeBytes: number;
}

export function validateWindowsFormatGuard(guard?: WindowsFormatGuard): WindowsFormatGuard {
  const expectedVolumeGuid = String(guard?.expectedVolumeGuid || "").trim();
  const expectedVolumeBytes = Number(guard?.expectedVolumeBytes || 0);
  if (!/^\\\\\?\\Volume\{[0-9a-f-]+\}\\?$/i.test(expectedVolumeGuid)) {
    throw new Error(
      "A identidade estável do volume não está disponível. Atualize a lista antes de formatar.",
    );
  }
  if (!Number.isSafeInteger(expectedVolumeBytes) || expectedVolumeBytes < 1024 ** 3) {
    throw new Error("A capacidade esperada do volume é inválida; a formatação foi bloqueada.");
  }
  return { expectedVolumeGuid, expectedVolumeBytes };
}

export function buildGuardedWindowsFat32Script(
  driveLetter: string,
  executablePath: string,
  logPath: string,
  guard: WindowsFormatGuard,
  label = "BADAVATAR",
): string {
  const letter = driveLetterFromRoot(`${driveLetter}:`);
  const { expectedVolumeGuid, expectedVolumeBytes } = validateWindowsFormatGuard(guard);
  const escapedExe = executablePath.replace(/'/g, "''");
  const escapedLog = logPath.replace(/'/g, "''");
  const escapedExpectedVolumeGuid = expectedVolumeGuid.replace(/'/g, "''");
  const escapedLabel = label.replace(/'/g, "''");
  return String.raw`$ErrorActionPreference = 'Continue'
$log = '${escapedLog}'
$expectedVolumeGuid = '${escapedExpectedVolumeGuid}'
$expectedVolumeBytes = [int64]${expectedVolumeBytes}
$targetLabel = '${escapedLabel}'
$limit32GB = [int64]34359738368
$exePath = '${escapedExe}'
'=== fat32format ${letter}: ===' | Out-File -FilePath $log -Encoding utf8

function Normalize-VolumeGuid([string]$value) {
  if (-not $value) { return '' }
  return $value.Trim().TrimEnd('\').ToLowerInvariant()
}

function Close-ExplorerWindows([string]$drvLetter) {
  try {
    $pfx = $drvLetter + ':'
    $enc = $drvLetter + '%3A'
    $shell = New-Object -ComObject Shell.Application
    foreach ($win in $shell.Windows()) {
      $loc = [string]$win.LocationURL
      $name = [string]$win.LocationName
      if ($loc -like "*$pfx*" -or $loc -like "*$enc*" -or $name -like "$pfx*") {
        $win.Quit()
      }
    }
  } catch {}
}

function Invoke-DiskpartScript([string[]]$commands) {
  $dpScript = [System.IO.Path]::GetTempFileName()
  try {
    $commands | Out-File -FilePath $dpScript -Encoding ascii
    $dpExe = Join-Path $env:SystemRoot 'System32\diskpart.exe'
    $dpOut = & $dpExe /s $dpScript 2>&1
    $dpCode = $LASTEXITCODE
    ($dpOut | Out-String).Trim() | Out-File -FilePath $log -Append -Encoding utf8
    return ($dpCode -eq 0)
  } finally {
    Remove-Item -Path $dpScript -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Fat32FormatTool([string]$drvLetter, [string]$fatExe) {
  if (-not $fatExe -or -not (Test-Path $fatExe)) {
    return $false
  }
  for ($attempt = 1; $attempt -le 5; $attempt++) {
    Close-ExplorerWindows $drvLetter
    Start-Sleep -Milliseconds (400 * $attempt)
    $out = "Y" | & $fatExe "$($drvLetter):" 2>&1
    $ec = $LASTEXITCODE
    $outStr = ($out | Out-String).Trim()
    $outStr | Out-File -FilePath $log -Append -Encoding utf8
    if ($ec -eq 0 -and $outStr -notmatch 'Failed to open device|GetLastError\(\)=32') {
      return $true
    }
    "fat32format tentativa $attempt falhou (codigo $ec). Fechando bloqueios e aguardando liberacao da unidade..." | Out-File -FilePath $log -Append -Encoding utf8
  }
  return $false
}

try {
  Close-ExplorerWindows '${letter}'
  $mountvol = Join-Path $env:SystemRoot 'System32\mountvol.exe'
  $currentVolumeGuid = ((& $mountvol '${letter}:\' '/L' 2>$null) -join '').Trim()
  if ((Normalize-VolumeGuid $currentVolumeGuid) -ne (Normalize-VolumeGuid $expectedVolumeGuid)) {
    throw "A unidade ${letter}: mudou antes da formatação. Esperado: $expectedVolumeGuid; atual: $currentVolumeGuid"
  }
  $partition = Get-Partition -DriveLetter '${letter}' -ErrorAction Stop
  $diskNo = [int]$partition.DiskNumber
  $disk = Get-Disk -Number $diskNo -ErrorAction Stop
  $mountedCount = @(
    Get-Partition -DiskNumber $diskNo -ErrorAction Stop | Where-Object { $_.DriveLetter }
  ).Count
  if ($diskNo -eq 0 -or $disk.BusType -ne 'USB' -or $disk.IsBoot -or $disk.IsSystem) {
    throw "O destino não é um disco USB externo seguro (disco=$diskNo, barramento=$($disk.BusType))."
  }
  if ($disk.IsOffline -or $disk.IsReadOnly -or $mountedCount -ne 1) {
    throw "O disco USB está offline, somente leitura ou possui mais de uma partição montada."
  }
  $tolerance = [Math]::Max([double]16777216, [Math]::Floor([double]$expectedVolumeBytes * 0.01))
  if ([Math]::Abs([double]$partition.Size - [double]$expectedVolumeBytes) -gt $tolerance) {
    throw "A capacidade da partição mudou antes da formatação."
  }
  "Volume GUID validado: $currentVolumeGuid" | Out-File -FilePath $log -Append -Encoding utf8
  "Disco USB validado: $diskNo ($($disk.FriendlyName))" | Out-File -FilePath $log -Append -Encoding utf8

  $success = $false

  if ($partition.Size -le $limit32GB) {
    "Formatando unidade (<= 32 GB) diretamente..." | Out-File -FilePath $log -Append -Encoding utf8
    try {
      Close-ExplorerWindows '${letter}'
      Format-Volume -DriveLetter '${letter}' -FileSystem FAT32 -NewFileSystemLabel $targetLabel -Force -Confirm:$false -ErrorAction Stop | Out-Null
      $success = $true
      "Format-Volume FAT32 realizado com sucesso." | Out-File -FilePath $log -Append -Encoding utf8
    } catch {
      "Format-Volume direto falhou ($($_.Exception.Message)). Tentando fat32format.exe ou format.com..." | Out-File -FilePath $log -Append -Encoding utf8
    }

    if (-not $success -and $exePath -and (Test-Path $exePath)) {
      if (Invoke-Fat32FormatTool '${letter}' $exePath) {
        $success = $true
        "fat32format.exe realizado com sucesso." | Out-File -FilePath $log -Append -Encoding utf8
      }
    }

    if (-not $success) {
      try {
        Close-ExplorerWindows '${letter}'
        $fmtExe = Join-Path $env:SystemRoot 'System32\format.com'
        $fmtOut = "Y" | & $fmtExe '${letter}:' /FS:FAT32 "/V:$targetLabel" /Q /X /Y 2>&1
        $fmtCode = $LASTEXITCODE
        ($fmtOut | Out-String).Trim() | Out-File -FilePath $log -Append -Encoding utf8
        if ($fmtCode -eq 0) {
          $success = $true
          "format.com /FS:FAT32 realizado com sucesso." | Out-File -FilePath $log -Append -Encoding utf8
        }
      } catch {
        "format.com direto falhou ($($_.Exception.Message))." | Out-File -FilePath $log -Append -Encoding utf8
      }
    }

    if (-not $success) {
      "Tentando recriar particao primaria limpa (MBR) via diskpart..." | Out-File -FilePath $log -Append -Encoding utf8
      Close-ExplorerWindows '${letter}'
      & $mountvol '${letter}:\' '/D' 2>$null
      $dpCmds = @(
        "select disk $diskNo",
        "clean",
        "convert mbr",
        "create partition primary",
        "active",
        "format fs=fat32 quick label=""$targetLabel""",
        "assign letter=${letter}"
      )
      $dpOk = Invoke-DiskpartScript $dpCmds
      if ($dpOk) {
        Start-Sleep -Milliseconds 500
        $chkVol = Get-Volume -DriveLetter '${letter}' -ErrorAction SilentlyContinue
        if ($chkVol -and $chkVol.FileSystem -and $chkVol.FileSystem.ToUpperInvariant() -eq 'FAT32') {
          $success = $true
          "diskpart format FAT32 realizado com sucesso." | Out-File -FilePath $log -Append -Encoding utf8
        }
      }

      if (-not $success) {
        "Recriando particao via diskpart com format NTFS e convertendo para FAT32..." | Out-File -FilePath $log -Append -Encoding utf8
        Close-ExplorerWindows '${letter}'
        & $mountvol '${letter}:\' '/D' 2>$null
        $dpCmdsNtfs = @(
          "select disk $diskNo",
          "clean",
          "convert mbr",
          "create partition primary",
          "active",
          "format fs=ntfs quick label=""$targetLabel""",
          "assign letter=${letter}"
        )
        $dpNtfsOk = Invoke-DiskpartScript $dpCmdsNtfs
        if ($dpNtfsOk) {
          Start-Sleep -Milliseconds 500
          if ($exePath -and (Test-Path $exePath)) {
            $success = Invoke-Fat32FormatTool '${letter}' $exePath
          }
          if (-not $success) {
            try {
              Close-ExplorerWindows '${letter}'
              Format-Volume -DriveLetter '${letter}' -FileSystem FAT32 -NewFileSystemLabel $targetLabel -Force -Confirm:$false -ErrorAction Stop | Out-Null
              $success = $true
            } catch {
              $fmtExe = Join-Path $env:SystemRoot 'System32\format.com'
              $fmtOut = "Y" | & $fmtExe '${letter}:' /FS:FAT32 "/V:$targetLabel" /Q /X /Y 2>&1
              if ($LASTEXITCODE -eq 0) { $success = $true }
            }
          }
        }
      }

      if (-not $success) {
        throw "Nao foi possivel formatar a particao recriada em FAT32."
      }
    }
  } else {
    "Formatando unidade (> 32 GB) usando fat32format.exe..." | Out-File -FilePath $log -Append -Encoding utf8
    if (-not $exePath -or -not (Test-Path $exePath)) {
      throw "Para unidades maiores que 32 GB é necessário o utilitário fat32format.exe."
    }

    $vol = Get-Volume -DriveLetter '${letter}' -ErrorAction SilentlyContinue
    if (-not $vol) {
      "Volume não encontrado; inicializando particao limpa via diskpart..." | Out-File -FilePath $log -Append -Encoding utf8
      Close-ExplorerWindows '${letter}'
      & $mountvol '${letter}:\' '/D' 2>$null
      $dpCmds = @(
        "select disk $diskNo",
        "clean",
        "convert mbr",
        "create partition primary",
        "active",
        "format fs=ntfs quick label=""$targetLabel""",
        "assign letter=${letter}"
      )
      $dpOk = Invoke-DiskpartScript $dpCmds
      if (-not $dpOk) {
        throw "Falha ao recriar particao no disco $diskNo via diskpart."
      }
      Start-Sleep -Milliseconds 500
    }

    $success = Invoke-Fat32FormatTool '${letter}' $exePath
    if (-not $success) {
      "Tentativa inicial com fat32format falhou. Recriando estrutura da particao via diskpart..." | Out-File -FilePath $log -Append -Encoding utf8
      Close-ExplorerWindows '${letter}'
      & $mountvol '${letter}:\' '/D' 2>$null
      $dpCmds = @(
        "select disk $diskNo",
        "clean",
        "convert mbr",
        "create partition primary",
        "active",
        "format fs=ntfs quick label=""$targetLabel""",
        "assign letter=${letter}"
      )
      $dpOk = Invoke-DiskpartScript $dpCmds
      if ($dpOk) {
        Start-Sleep -Milliseconds 500
        $success = Invoke-Fat32FormatTool '${letter}' $exePath
      }
    }

    if (-not $success) {
      throw "fat32format falhou. Feche qualquer programa ou janela do Explorer e tente novamente."
    }
  }

  Start-Sleep -Milliseconds 500
  $verifyVol = Get-Volume -DriveLetter '${letter}' -ErrorAction SilentlyContinue
  if (-not $verifyVol -or -not $verifyVol.FileSystem -or $verifyVol.FileSystem.ToUpperInvariant() -ne 'FAT32') {
    throw "A unidade foi formatada, mas o sistema de arquivos resultante foi $(if ($verifyVol) { $verifyVol.FileSystem } else { 'indeterminado' }); esperado FAT32."
  }
  if ($verifyVol -and $targetLabel -and ($verifyVol.FileSystemLabel -ne $targetLabel)) {
    Set-Volume -DriveLetter '${letter}' -NewFileSystemLabel $targetLabel -ErrorAction SilentlyContinue
  }
  "Formatação FAT32 concluída com sucesso." | Out-File -FilePath $log -Append -Encoding utf8
} catch {
  ($_ | Out-String) | Out-File -FilePath $log -Append -Encoding utf8
  Close-ExplorerWindows '${letter}'
  exit 1
}

Close-ExplorerWindows '${letter}'
exit 0`;
}

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
    path.join(getBundledRoot(), "tools", "fat32format.exe"),
    path.join(getRepoRoot(), "dist", "tools", "fat32format.exe"),
    path.join(getRepoRoot(), "dist", "win-unpacked", "fat32format.exe"),
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
  guard?: WindowsFormatGuard,
): Promise<void> {
  const letter = driveLetterFromRoot(driveRoot);
  const { expectedVolumeGuid, expectedVolumeBytes } = validateWindowsFormatGuard(guard);
  const exe = resolveFat32FormatExe();
  const ts = Date.now();
  const ps1Path = path.join(os.tmpdir(), `godsend_fat32_${ts}.ps1`);
  const logPath = `${ps1Path}.log`;

  onProgress({ status: "Preparando dispositivo…", percent: 4 });

  try {
    onProgress({ status: "Formatando para FAT32…", percent: 8 });
    const innerScript = buildGuardedWindowsFat32Script(
      letter,
      exe || "",
      logPath,
      {
        expectedVolumeGuid,
        expectedVolumeBytes,
      },
      label,
    );
    fs.writeFileSync(ps1Path, innerScript, "utf8");

    const { code, cancelled } = await runPs1Elevated(ps1Path);
    const detail = readLogTail(logPath);

    if (cancelled) {
      throw new Error("Formatação cancelada (a elevação de Administrador foi negada).");
    }
    if (code !== 0) {
      if (!exe && /32\s*GB|34359738368/i.test(detail)) {
        throw new Error(
          `${detail}\n\nExecute "node scripts/download-fat32format.js" ou posicione fat32format.exe junto ao aplicativo.`,
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
  const closeScript = [
    `Get-Volume -DriveLetter '${letter}' -ErrorAction SilentlyContinue | Out-Null;`,
    `try {`,
    `  $shell = New-Object -ComObject Shell.Application`,
    `  foreach ($win in $shell.Windows()) {`,
    `    $loc = [string]$win.LocationURL`,
    `    $name = [string]$win.LocationName`,
    `    if ($loc -like "*${letter}:*" -or $loc -like "*${letter}%3A*" -or $name -like "${letter}:*") {`,
    `      $win.Quit()`,
    `    }`,
    `  }`,
    `} catch {}`,
  ].join("\r\n");
  await runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    closeScript,
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
  windowsGuard?: WindowsFormatGuard,
): Promise<void> {
  onProgress({ status: "Formatting drive to FAT32…", percent: 3 });

  if (process.platform === "win32") {
    await formatWindowsFat32(driveRoot, label, onProgress, windowsGuard);
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
