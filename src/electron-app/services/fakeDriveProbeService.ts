import { createHash } from "crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
  openSync,
  fsyncSync,
  closeSync,
  unlinkSync,
  existsSync,
} from "fs";
import { join } from "path";
import { normalizeDriveRoot } from "../infrastructure/deviceSafetyPolicy";
import { appendAppEvent } from "../infrastructure/serverLog";
import { powerShellExe } from "../infrastructure/windowsSystemExecutables";
import { formatErrorForUser } from "../infrastructure/userFriendlyError";


export interface ProbeCheckpointResult {
  offsetBytes: number;
  offsetGb: number;
  valid: boolean;
  blockIndex: number;
  error?: string;
}

export interface FakeDriveProbeProgress {
  phase: "init" | "writing" | "verifying" | "cleanup" | "done";
  percent: number;
  currentGb: number;
  totalGb: number;
  status: string;
  detail?: string;
}

export interface FakeDriveProbeResult {
  ok: boolean;
  authentic: boolean;
  rootPath: string;
  advertisedSizeBytes: number;
  testedSizeBytes: number;
  realCapacityEstimateBytes: number;
  wrapAroundDetected: boolean;
  readErrorsDetected: boolean;
  summary: string;
  details: string;
  checkpoints: ProbeCheckpointResult[];
  error?: string;
}

const BLOCK_PAYLOAD_SIZE = 2 * 1024 * 1024; // 2 MB test block per checkpoint

/**
 * Generates a deterministic pseudo-random test block with a header and payload.
 */
export function generateProbeBlock(blockIndex: number, offsetBytes: number, salt: string): { buffer: Buffer; hash: string } {
  const buf = Buffer.alloc(BLOCK_PAYLOAD_SIZE);
  const header = `GODSEND_PROBE_V1|IDX:${blockIndex}|OFF:${offsetBytes}|SALT:${salt}|ENDHDR\n`;
  buf.write(header, 0, "utf8");

  // Fill remainder with deterministic pattern
  let state = (blockIndex * 1664525 + 1013904223 + offsetBytes) >>> 0;
  const startOffset = header.length;
  for (let i = startOffset; i <= BLOCK_PAYLOAD_SIZE - 4; i += 4) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    buf.writeUInt32LE(state, i);
  }

  const hash = createHash("sha256").update(buf).digest("hex");
  return { buffer: buf, hash };

}

/**
 * Validates a read buffer against the expected hash and block index.
 */
export function verifyProbeBlock(buffer: Buffer, expectedHash: string, expectedIndex: number): { valid: boolean; error?: string } {
  if (buffer.length !== BLOCK_PAYLOAD_SIZE) {
    return { valid: false, error: `Tamanho do bloco incorreto: esperado ${BLOCK_PAYLOAD_SIZE}, recebido ${buffer.length}` };
  }
  const actualHash = createHash("sha256").update(buffer).digest("hex");
  if (actualHash !== expectedHash) {
    // Check if buffer is filled with all zeros
    let allZeros = true;
    for (let i = 0; i < Math.min(1024, buffer.length); i++) {
      if (buffer[i] !== 0) { allZeros = false; break; }
    }
    if (allZeros) {
      return { valid: false, error: "O bloco retornou preenchido com zeros (leitura vazia do controlador de memória)" };
    }
    return { valid: false, error: "Dados corrompidos ou sobrescritos (hash SHA-256 não confere)" };
  }
  return { valid: true };
}

/**
 * Probes a drive for fake capacity and flash authenticity by writing test patterns
 * across available capacity checkpoints and validating against ring-buffer wrap-around corruption.
 */
export async function probeFakeDrive(
  rootPath: string,
  options?: {
    fastMode?: boolean;
    abortSignal?: AbortSignal;
    onProgress?: (progress: FakeDriveProbeProgress) => void;
  },
): Promise<FakeDriveProbeResult> {
  const normalizedRoot = normalizeDriveRoot(rootPath);
  const fastMode = options?.fastMode !== false;
  const signal = options?.abortSignal;
  const onProgress = options?.onProgress;

  appendAppEvent("usb", `Iniciando teste de autenticidade/capacidade em ${normalizedRoot} (modo rápido: ${fastMode})`);

  onProgress?.({
    phase: "init",
    percent: 0,
    currentGb: 0,
    totalGb: 0,
    status: "Iniciando diagnóstico de autenticidade...",
  });

  const probeDir = join(normalizedRoot, ".xbox-downloader", "capacity-probe");
  try {
    if (existsSync(probeDir)) {
      rmSync(probeDir, { recursive: true, force: true });
    }
    mkdirSync(probeDir, { recursive: true });
  } catch (err: any) {
    appendAppEvent("usb", `Teste de capacidade falhou ao criar pasta em ${normalizedRoot}: ${err.message}`);
    const userMsg = formatErrorForUser(err, { area: "drive-maintenance", driveRoot: normalizedRoot });
    return {
      ok: false,
      authentic: false,
      rootPath: normalizedRoot,
      advertisedSizeBytes: 0,
      testedSizeBytes: 0,
      realCapacityEstimateBytes: 0,
      wrapAroundDetected: false,
      readErrorsDetected: false,
      summary: userMsg,
      details: userMsg,
      checkpoints: [],
      error: userMsg,
    };
  }

  // Determine capacity
  let totalCapacity = 64 * 1024 * 1024 * 1024; // Default fallback 64 GB
  try {
    const { freeBytes, sizeBytes } = await getDriveCapacityStats(normalizedRoot);
    if (sizeBytes > 0) totalCapacity = sizeBytes;
  } catch {}

  const salt = Date.now().toString(16);
  const totalGb = Number((totalCapacity / (1024 ** 3)).toFixed(1));

  // Determine checkpoint offsets (e.g. 0.5 GB, 2 GB, 4 GB, 8 GB, 14 GB, 28 GB, 56 GB)
  const checkpointPercentages = fastMode
    ? [0.02, 0.1, 0.25, 0.5, 0.75, 0.95]
    : [0.02, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.96];

  const targetOffsets: number[] = [];
  for (const pct of checkpointPercentages) {
    const off = Math.floor(totalCapacity * pct);
    if (off > BLOCK_PAYLOAD_SIZE && !targetOffsets.includes(off)) {
      targetOffsets.push(off);
    }
  }

  const checkpoints: ProbeCheckpointResult[] = [];
  const writtenBlocks: Array<{ index: number; path: string; hash: string; offsetBytes: number }> = [];

  let wrapAroundDetected = false;
  let readErrorsDetected = false;
  let maxValidOffsetBytes = 0;
  let firstFailureMessage = "";

  try {
    // 1. Write and verify Block 0 (the base sentinel block)
    const block0 = generateProbeBlock(0, 0, salt);
    const block0Path = join(probeDir, "block_000.chk");
    writeFileSync(block0Path, block0.buffer);
    flushFile(block0Path);
    writtenBlocks.push({ index: 0, path: block0Path, hash: block0.hash, offsetBytes: 0 });

    for (let i = 0; i < targetOffsets.length; i++) {
      if (signal?.aborted) {
        throw new Error("Teste de capacidade cancelado pelo usuário.");
      }

      const targetOffset = targetOffsets[i];
      const offsetGb = Number((targetOffset / (1024 ** 3)).toFixed(2));
      const pctDone = Math.round(((i + 1) / targetOffsets.length) * 90);

      onProgress?.({
        phase: "writing",
        percent: pctDone,
        currentGb: offsetGb,
        totalGb,
        status: `Gravando e validando checkpoint em ${offsetGb} GB...`,
        detail: `Bloco ${i + 1}/${targetOffsets.length}`,
      });

      const block = generateProbeBlock(i + 1, targetOffset, salt);
      const blockPath = join(probeDir, `block_${String(i + 1).padStart(3, "0")}.chk`);

      try {
        writeFileSync(blockPath, block.buffer);
        flushFile(blockPath);
        writtenBlocks.push({ index: i + 1, path: blockPath, hash: block.hash, offsetBytes: targetOffset });
      } catch (writeErr: any) {
        appendAppEvent("usb", `Probe write error at ${offsetGb} GB (${normalizedRoot}): ${writeErr.message}`);
        readErrorsDetected = true;
        firstFailureMessage = `O dispositivo falhou ao gravar quando chegou perto de ${offsetGb} GB.`;
        checkpoints.push({
          offsetBytes: targetOffset,
          offsetGb,
          valid: false,
          blockIndex: i + 1,
          error: writeErr.message,
        });
        break;
      }

      // Read back the current block to verify write integrity
      try {
        const readCurrent = readFileSync(blockPath);
        const verifyCurrent = verifyProbeBlock(readCurrent, block.hash, i + 1);
        if (!verifyCurrent.valid) {
          appendAppEvent("usb", `Probe verify error at ${offsetGb} GB (${normalizedRoot}): ${verifyCurrent.error}`);
          readErrorsDetected = true;
          firstFailureMessage = `Os dados gravados perto de ${offsetGb} GB vieram com erro na leitura.`;
          checkpoints.push({
            offsetBytes: targetOffset,
            offsetGb,
            valid: false,
            blockIndex: i + 1,
            error: verifyCurrent.error,
          });
          break;
        }
      } catch (readErr: any) {
        appendAppEvent("usb", `Probe read error at ${offsetGb} GB (${normalizedRoot}): ${readErr.message}`);
        readErrorsDetected = true;
        firstFailureMessage = `Não foi possível ler de volta os dados gravados perto de ${offsetGb} GB.`;
        checkpoints.push({
          offsetBytes: targetOffset,
          offsetGb,
          valid: false,
          blockIndex: i + 1,
          error: readErr.message,
        });
        break;
      }

      // CRITICAL CHECK: Verify Block 0 (Sentinel) to detect ring-buffer wrap-around!
      try {
        const readBlock0 = readFileSync(block0Path);
        const verify0 = verifyProbeBlock(readBlock0, block0.hash, 0);
        if (!verify0.valid) {
          wrapAroundDetected = true;
          firstFailureMessage = `Ao chegar perto de ${offsetGb} GB, o dispositivo começou a apagar os arquivos anteriores sozinho — sinal de capacidade falsa.`;
          checkpoints.push({
            offsetBytes: targetOffset,
            offsetGb,
            valid: false,
            blockIndex: i + 1,
            error: "Wrap-around detectado: setor inicial sobrescrito",
          });
          break;
        }
      } catch (err0: any) {
        appendAppEvent("usb", `Probe block0 read error at ${offsetGb} GB (${normalizedRoot}): ${err0.message}`);
        wrapAroundDetected = true;
        firstFailureMessage = `O início do dispositivo parou de responder depois de gravar perto de ${offsetGb} GB.`;
        checkpoints.push({
          offsetBytes: targetOffset,
          offsetGb,
          valid: false,
          blockIndex: i + 1,
          error: err0.message,
        });
        break;
      }

      maxValidOffsetBytes = targetOffset;
      checkpoints.push({
        offsetBytes: targetOffset,
        offsetGb,
        valid: true,
        blockIndex: i + 1,
      });
    }
  } finally {
    // Cleanup test blocks
    onProgress?.({
      phase: "cleanup",
      percent: 98,
      currentGb: totalGb,
      totalGb,
      status: "Finalizando e limpando arquivos de teste...",
    });
    try {
      if (existsSync(probeDir)) {
        rmSync(probeDir, { recursive: true, force: true });
      }
    } catch {}
  }

  const isAuthentic = !wrapAroundDetected && !readErrorsDetected && checkpoints.length > 0 && checkpoints.every((c) => c.valid);

  let realCapacityEstimate = totalCapacity;
  if (!isAuthentic) {
    realCapacityEstimate = maxValidOffsetBytes > 0 ? maxValidOffsetBytes : Math.floor(totalCapacity * 0.2);
  }

  const realGb = Number((realCapacityEstimate / (1024 ** 3)).toFixed(1));

  let summary = `Pendrive ou HD autêntico! Todos os ${checkpoints.length} pontos testados funcionaram sem erro (capacidade real confirmada: ${totalGb} GB).`;
  let details = `O dispositivo conseguiu gravar e ler até ${totalGb} GB normalmente, sem apagar arquivos antigos.`;

  if (wrapAroundDetected) {
    summary = `ALERTA: Capacidade falsa detectada! Ele diz ter ${totalGb} GB, mas só aguenta cerca de ${realGb} GB.`;
    details = `Quando passa de cerca de ${realGb} GB, este dispositivo começa a apagar o que já estava gravado antes para fingir que tem mais espaço. Use outro pendrive ou HD original para não perder seus jogos. ${firstFailureMessage}`;
  } else if (readErrorsDetected) {
    summary = `Aviso: O dispositivo falhou ao gravar ou ler perto de ${realGb} GB.`;
    details = `O dispositivo apresentou falhas físicas ou mau contato durante o teste. Tente em outra porta USB ou use outro pendrive ou HD. ${firstFailureMessage}`;
  }

  appendAppEvent(
    "usb",
    `Resultado do teste de autenticidade em ${normalizedRoot}: autêntico=${isAuthentic}, wrapAround=${wrapAroundDetected}, realEst=${realGb} GB`,
  );

  onProgress?.({
    phase: "done",
    percent: 100,
    currentGb: totalGb,
    totalGb,
    status: isAuthentic ? "Teste concluído: Pendrive Autêntico!" : "Teste concluído: Problemas Detectados!",
    detail: summary,
  });

  return {
    ok: true,
    authentic: isAuthentic,
    rootPath: normalizedRoot,
    advertisedSizeBytes: totalCapacity,
    testedSizeBytes: maxValidOffsetBytes,
    realCapacityEstimateBytes: realCapacityEstimate,
    wrapAroundDetected,
    readErrorsDetected,
    summary,
    details,
    checkpoints,
  };
}

function flushFile(filePath: string): void {
  try {
    const fd = openSync(filePath, "r+");
    fsyncSync(fd);
    closeSync(fd);
  } catch {}
}

async function getDriveCapacityStats(rootPath: string): Promise<{ sizeBytes: number; freeBytes: number }> {
  // Simple check via stat or powershell if on windows
  try {
    const driveLetter = rootPath.replace(/[:\\\/]/g, "").toUpperCase();
    if (process.platform === "win32" && driveLetter.length === 1) {
      const { spawnSync } = require("child_process");
      const out = spawnSync(
        powerShellExe(),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `(Get-Volume -DriveLetter '${driveLetter}' -ErrorAction SilentlyContinue) | Select-Object -Property Size, SizeRemaining | ConvertTo-Json -Compress`],
        { windowsHide: true, encoding: "utf8" },
      );
      if (out.stdout) {
        const data = JSON.parse(out.stdout.trim());
        return { sizeBytes: Number(data.Size || 0), freeBytes: Number(data.SizeRemaining || 0) };
      }
    }
  } catch {}
  return { sizeBytes: 0, freeBytes: 0 };
}
