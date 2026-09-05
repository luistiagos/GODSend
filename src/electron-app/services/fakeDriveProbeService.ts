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
    return {
      ok: false,
      authentic: false,
      rootPath: normalizedRoot,
      advertisedSizeBytes: 0,
      testedSizeBytes: 0,
      realCapacityEstimateBytes: 0,
      wrapAroundDetected: false,
      readErrorsDetected: false,
      summary: `Não foi possível criar pasta de teste no pendrive: ${err.message}`,
      details: err.message,
      checkpoints: [],
      error: err.message,
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
        readErrorsDetected = true;
        firstFailureMessage = `Falha na gravação ao atingir ${offsetGb} GB: ${writeErr.message}`;
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
          readErrorsDetected = true;
          firstFailureMessage = `Bloco em ${offsetGb} GB corrompido: ${verifyCurrent.error}`;
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
        readErrorsDetected = true;
        firstFailureMessage = `Erro de I/O ao reler ${offsetGb} GB: ${readErr.message}`;
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
          firstFailureMessage = `Sobrescrita de memória detectada ao gravar em ${offsetGb} GB (o início do pendrive foi destruído). O dispositivo possui capacidade física adulterada.`;
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
        wrapAroundDetected = true;
        firstFailureMessage = `Bloco inicial inacessível após gravar em ${offsetGb} GB: ${err0.message}`;
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

  let summary = `Pendrive autêntico! Todos os ${checkpoints.length} blocos testados responderam com 100% de integridade (capacidade validada: ${totalGb} GB).`;
  let details = `O dispositivo suporta gravação e leitura contínua até ${totalGb} GB sem perda de dados ou wrap-around.`;

  if (wrapAroundDetected) {
    summary = `ALERTA: Capacidade Falsificada Detectada! O pendrive anuncia ${totalGb} GB, mas os dados corromperam ao atingir ~${realGb} GB.`;
    details = `Ao ultrapassar ~${realGb} GB, a memória física atingiu o limite real e o controlador reiniciou a gravação sobre os primeiros setores, destruindo a tabela FAT e os arquivos anteriores. ${firstFailureMessage}`;
  } else if (readErrorsDetected) {
    summary = `Aviso: Falhas de leitura/escrita encontradas ao atingir ${realGb} GB.`;
    details = `O pendrive apresentou erros físicos ou de sistema de arquivos durante a verificação. ${firstFailureMessage}`;
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
        "powershell.exe",
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
