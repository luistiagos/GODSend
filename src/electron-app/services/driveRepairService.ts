import { spawn } from "child_process";
import { normalizeDriveRoot } from "../infrastructure/deviceSafetyPolicy";
import { appendAppEvent } from "../infrastructure/serverLog";


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
      "powershell.exe",
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

  return new Promise((resolve) => {
    // We execute cmd.exe /c "echo Y | chkdsk <Letter>: /f /x" to ensure non-interactive auto-confirmation.
    const child = spawn(
      "cmd.exe",
      ["/c", `echo Y | chkdsk ${driveLetter}: /f /x`],
      { windowsHide: true },
    );

    let fullOutput = "";

    const handleData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      fullOutput += text;
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      for (const line of lines) {
        onProgress?.(line);
      }
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);

    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        ok: false,
        rootPath: normalized,
        exitCode: -1,
        output: fullOutput,
        summary: "O reparo do disco excedeu o tempo limite de 5 minutos.",
        repaired: false,
        error: "Tempo limite excedido.",
      });
    }, 5 * 60 * 1000);

    child.on("close", (code) => {
      clearTimeout(timeout);
      const exitCode = code ?? 0;
      // chkdsk exit codes: 0 = No errors found, 1 = Errors found and fixed, 2 = Cleanup/garbage collected, 3 = Cannot check / errors not fixed
      const repaired = exitCode === 0 || exitCode === 1 || /corrigiu|corrigidos|corrigido|recuperado|fixed|recovered|clean/i.test(fullOutput);
      const hasFailure = exitCode > 1 && !repaired;

      let summary = "Reparo concluído com sucesso. O sistema de arquivos foi restaurado.";
      if (exitCode === 0 && !/encontrou erros/i.test(fullOutput)) {
        summary = "Nenhum erro encontrado. O sistema de arquivos está íntegro.";
      } else if (hasFailure) {
        summary = `O CHKDSK concluiu com avisos (código ${exitCode}). Verifique o relatório detalhado.`;
      }

      appendAppEvent(
        "usb",
        `Reparo CHKDSK em ${driveLetter}: finalizado (código ${exitCode}, reparado: ${repaired})`,
      );

      resolve({
        ok: !hasFailure,
        rootPath: normalized,
        exitCode,
        output: fullOutput,
        summary,
        repaired,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
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
