import { spawn } from "child_process";
import { promises as fsPromises } from "fs";
import path from "path";
import { normalizeDriveRoot } from "../infrastructure/deviceSafetyPolicy";
import { appendAppEvent } from "../infrastructure/serverLog";
import { powerShellExe, system32Exe } from "../infrastructure/windowsSystemExecutables";
import { createAnsiDecoder, windowsAnsiCodePage } from "../infrastructure/windowsAnsiCodePage";


export interface DriveHealthDiagnostic {
  rootPath: string;
  driveLetter: string;
  fileSystem: string;
  healthStatus: "Healthy" | "Warning" | "Unhealthy" | "Unknown";
  operationalStatus: string;
  needsRepair: boolean;
  isCorrupted: boolean;
  summary: string;
}

export interface DriveRepairResult {
  ok: boolean;
  rootPath: string;
  exitCode: number;
  output: string;
  summary: string;
  repaired: boolean;
  error?: string;
}

/**
 * Normalizes a root path or letter to a single uppercase drive letter (e.g. "E").
 */
export function extractDriveLetter(pathOrLetter: string): string {
  const match = pathOrLetter.trim().match(/^([a-z]):?/i);
  return match ? match[1].toUpperCase() : pathOrLetter.trim().toUpperCase();
}

/**
 * Diagnoses the filesystem health and status of a drive on Windows.
 */
export async function diagnoseDrive(rootPath: string): Promise<DriveHealthDiagnostic> {
  const driveLetter = extractDriveLetter(rootPath);
  const normalized = `${driveLetter}:\\`;

  if (process.platform !== "win32") {
    return {
      rootPath: normalized,
      driveLetter,
      fileSystem: "UNKNOWN",
      healthStatus: "Healthy",
      operationalStatus: "OK (Non-Windows)",
      needsRepair: false,
      isCorrupted: false,
      summary: "Diagnóstico avançado de volume disponível apenas no Windows.",
    };
  }

  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$vol = Get-Volume -DriveLetter '${driveLetter}' -ErrorAction SilentlyContinue
if ($vol) {
  [PSCustomObject]@{
    FileSystem = [string]$vol.FileSystem
    HealthStatus = [string]$vol.HealthStatus
    OperationalStatus = (@($vol.OperationalStatus) -join ',')
    SizeRemaining = [int64]$vol.SizeRemaining
    Size = [int64]$vol.Size
  } | ConvertTo-Json -Compress
} else {
  '{}'
}
`;

  return new Promise((resolve) => {
    const child = spawn(
      powerShellExe(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );

    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.on("close", () => {
      try {
        const data = JSON.parse(stdout.trim() || "{}");
        const health = String(data.HealthStatus || "Unknown");
        const operational = String(data.OperationalStatus || "Unknown");
        const fs = String(data.FileSystem || "FAT32").toUpperCase();

        const isWarning = /Warning|Unhealthy/i.test(health);
        const needsFix = /Repair|Need|Corrupt|Warning/i.test(operational) || isWarning;

        let summary = "Sistema de arquivos íntegro e pronto para uso.";
        if (needsFix) {
          summary = `Inconsistências encontradas (${health} / ${operational}). Recomendado reparo com CHKDSK.`;
        }

        resolve({
          rootPath: normalized,
          driveLetter,
          fileSystem: fs,
          healthStatus: isWarning ? "Warning" : (health as any) || "Healthy",
          operationalStatus: operational,
          needsRepair: needsFix,
          isCorrupted: needsFix,
          summary,
        });
      } catch {
        resolve({
          rootPath: normalized,
          driveLetter,
          fileSystem: "FAT32",
          healthStatus: "Unknown",
          operationalStatus: "Unknown",
          needsRepair: false,
          isCorrupted: false,
          summary: "Não foi possível consultar status detalhado do volume.",
        });
      }
    });

    child.on("error", () => {
      resolve({
        rootPath: normalized,
        driveLetter,
        fileSystem: "FAT32",
        healthStatus: "Unknown",
        operationalStatus: "Unknown",
        needsRepair: false,
        isCorrupted: false,
        summary: "Falha ao executar diagnóstico de volume.",
      });
    });
  });
}

/**
 * Reads the dirty bit FastFAT keeps for a mounted volume (FSCTL_IS_VOLUME_DIRTY). It is set from the
 * NT flags byte of the boot sector, not from FAT[1]. The handle needs GENERIC_READ: with no data
 * access the request goes to the volume driver and fails with ERROR_INVALID_FUNCTION. A removable
 * volume opens without admin; a fixed one does not. Returns null when the answer is unknown, never
 * "clean".
 */
export async function isVolumeDirty(rootPath: string): Promise<boolean | null> {
  if (process.platform !== "win32") return null;
  const driveLetter = extractDriveLetter(rootPath);
  if (!/^[A-Z]$/.test(driveLetter)) return null;
  // Built outside the template: a backslash right before `${` escapes the substitution.
  const volumePath = `\\\\.\\${driveLetter}:`;

  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class XboxCompanionVolumeDirty {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool DeviceIoControl(IntPtr handle, uint code, IntPtr input, uint inputSize, out uint output, uint outputSize, out uint returned, IntPtr overlapped);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);
  public static string Query(string path) {
    IntPtr handle = CreateFileW(path, 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (handle == new IntPtr(-1)) return "error " + Marshal.GetLastWin32Error();
    try {
      uint state, returned;
      if (!DeviceIoControl(handle, 0x00090078, IntPtr.Zero, 0, out state, 4, out returned, IntPtr.Zero)) return "error " + Marshal.GetLastWin32Error();
      return "state " + state;
    } finally { CloseHandle(handle); }
  }
}
'@
[XboxCompanionVolumeDirty]::Query('${volumePath}')
`;

  return new Promise((resolve) => {
    const child = spawn(
      powerShellExe(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.on("close", () => {
      const match = stdout.match(/state (\d+)/);
      if (!match) {
        appendAppEvent("usb", `Bit de sujo de ${driveLetter}: não consultado (${stdout.trim() || "sem saída"})`);
        resolve(null);
        return;
      }
      // VOLUME_IS_DIRTY = 0x1
      resolve((Number(match[1]) & 1) === 1);
    });
    child.on("error", (err) => {
      appendAppEvent("usb", `Bit de sujo de ${driveLetter}: não consultado (${err.message})`);
      resolve(null);
    });
  });
}

// Codes a damaged directory entry gives back: Windows lists it, but cannot open it (18/09 the user
// could not delete one: "O nome de arquivo especificado é inválido ou muito longo"). Access errors
// (EACCES, EPERM, EBUSY) say nothing about the FAT and are left out.
const DAMAGED_ENTRY_CODES = new Set(["ENOENT", "EINVAL", "EIO", "ENAMETOOLONG", "UNKNOWN"]);

/**
 * Walks the volume with readdir + lstat and returns up to `limit` entries that are listed but
 * cannot be opened. Read-only. On a real 15 GB pendrive, 10,942 files took 11 s.
 * Each suspect is opened once more after the walk: on that same pendrive one run flagged 5 files
 * with ENOENT that opened fine on every run after it, and a false alarm here blocks a preparation.
 */
export async function findBrokenEntries(rootPath: string, limit = 5): Promise<string[]> {
  // Each suspect keeps the call that failed, to repeat it: a directory that cannot be listed
  // may still lstat fine.
  const suspects: Array<{ entry: string; open: () => Promise<unknown> }> = [];
  const pending = [rootPath];
  while (pending.length > 0 && suspects.length < limit) {
    const directory = pending.pop()!;
    let names: string[];
    try {
      names = await fsPromises.readdir(directory);
    } catch (error: any) {
      if (DAMAGED_ENTRY_CODES.has(error?.code)) {
        suspects.push({ entry: directory, open: () => fsPromises.readdir(directory) });
      }
      continue;
    }
    for (const name of names) {
      const fullPath = path.join(directory, name);
      try {
        const stats = await fsPromises.lstat(fullPath);
        if (stats.isDirectory()) pending.push(fullPath);
      } catch (error: any) {
        if (!DAMAGED_ENTRY_CODES.has(error?.code)) continue;
        suspects.push({ entry: fullPath, open: () => fsPromises.lstat(fullPath) });
        if (suspects.length >= limit) break;
      }
    }
  }

  const broken: string[] = [];
  for (const { entry, open } of suspects) {
    try {
      await open();
    } catch (error: any) {
      if (DAMAGED_ENTRY_CODES.has(error?.code)) broken.push(`${entry} (${error.code})`);
    }
  }
  return broken;
}

/**
 * Turns the chkdsk exit into the result shown to the user.
 * A null code means the process was killed by a signal, not that chkdsk passed —
 * it used to go through `code ?? 0` and get logged as "código 0, reparado: true".
 */
export function summarizeChkdskExit(
  code: number | null,
  output: string,
): { ok: boolean; exitCode: number; repaired: boolean; summary: string } {
  if (code === null) {
    return {
      ok: false,
      exitCode: -1,
      repaired: false,
      summary: "O CHKDSK foi interrompido antes de terminar. Execute o reparo novamente.",
    };
  }
  // chkdsk exit codes: 0 = No errors found, 1 = Errors found and fixed, 2 = Cleanup/garbage collected, 3 = Cannot check / errors not fixed
  const repaired = code === 0 || code === 1 || /corrigiu|corrigidos|corrigido|recuperado|fixed|recovered|clean/i.test(output);
  const hasFailure = code > 1 && !repaired;

  let summary = "Reparo concluído com sucesso. O sistema de arquivos foi restaurado.";
  if (code === 0 && !/encontrou erros/i.test(output)) {
    summary = "Nenhum erro encontrado. O sistema de arquivos está íntegro.";
  } else if (hasFailure) {
    summary = `O CHKDSK concluiu com avisos (código ${code}). Verifique o relatório detalhado.`;
  }
  return { ok: !hasFailure, exitCode: code, repaired, summary };
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

/**
 * Runs a non-interactive CHKDSK /F /X repair on the target drive and streams output in real time.
 */
export async function repairDrive(
  rootPath: string,
  onProgress?: (outputLine: string) => void,
): Promise<DriveRepairResult> {
  const driveLetter = extractDriveLetter(rootPath);
  const normalized = `${driveLetter}:\\`;

  if (process.platform !== "win32") {
    return {
      ok: false,
      rootPath: normalized,
      exitCode: -1,
      output: "",
      summary: "O reparo de sistema de arquivos CHKDSK está disponível apenas no Windows.",
      repaired: false,
      error: "Plataforma não suportada.",
    };
  }

  appendAppEvent("usb", `Iniciando reparo de volume CHKDSK na unidade ${driveLetter}:`);

  // chkdsk writes to a pipe in the ANSI code page, not UTF-8 — see windowsAnsiCodePage.ts.
  const codePage = await windowsAnsiCodePage();

  return new Promise((resolve) => {
    // We execute cmd.exe /c "echo Y | chkdsk <Letter>: /f /x" to ensure non-interactive auto-confirmation.
    // The chkdsk path goes in unquoted on purpose: Node escapes an inner `"` as `\"`, which cmd
    // does not understand and rejects with "não é reconhecido como um comando interno ou externo".
    const child = spawn(
      system32Exe("cmd.exe", "cmd.exe"),
      ["/c", `echo Y | ${system32Exe("chkdsk.exe", "chkdsk")} ${driveLetter}: /f /x`],
      { windowsHide: true },
    );

    let fullOutput = "";

    // One decoder per stream: `stream: true` keeps a DBCS character split across chunks intact.
    const handleData = (decoder: TextDecoder) => (chunk: Buffer) => {
      const text = decoder.decode(chunk, { stream: true });
      fullOutput += text;
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const line of lines) {
        onProgress?.(line);
      }
    };

    child.stdout.on("data", handleData(createAnsiDecoder(codePage)));
    child.stderr.on("data", handleData(createAnsiDecoder(codePage)));

    // No timeout: a /f repair is never killed halfway through writing the FAT, and on a
    // pendrive with tens of thousands of files it takes well over 5 minutes (16 min for
    // 65,912 files). Killing would not even stop it — child.kill() ends only cmd.exe,
    // chkdsk keeps running. stdin closes after `echo Y`, so no prompt can hang it.
    const startedAt = Date.now();

    child.on("close", (code) => {
      const { ok, exitCode, repaired, summary } = summarizeChkdskExit(code, fullOutput);

      appendAppEvent(
        "usb",
        `Reparo CHKDSK em ${driveLetter}: finalizado em ${formatElapsed(Date.now() - startedAt)} (código ${code ?? "nenhum"}, reparado: ${repaired})`,
      );

      resolve({
        ok,
        rootPath: normalized,
        exitCode,
        output: fullOutput,
        summary,
        repaired,
      });
    });

    child.on("error", (err) => {
      resolve({
        ok: false,
        rootPath: normalized,
        exitCode: -1,
        output: fullOutput,
        summary: `Falha ao iniciar o utilitário de reparo: ${err.message}`,
        repaired: false,
        error: err.message,
      });
    });
  });
}
