/**
 * What the disk layout must look like for the Xbox 360 to read a USB device at all. A device that
 * fails this is listed by the console as "Não Formatado" (Configurações → Sistema → Armazenamento),
 * and nothing that depends on it runs: no ABadAvatar profile, no Aurora, no game.
 *
 * Kept apart from assessDeviceSafety on purpose: every code there blocks formatting, while most of
 * these are exactly what formatting fixes. No imports, so the unit tests load it directly.
 */

export type XboxLayoutCode =
  | "NOT_MBR"
  | "PARTITION_COUNT"
  | "MBR_TYPE"
  | "SECTOR_SIZE"
  | "NOT_FAT32"
  | "VOLUME_TOO_LARGE";

export interface XboxDiskLayout {
  partitionStyle: string;
  partitionCount: number;
  mbrType: number;
  logicalSectorSize: number;
  fileSystem: string;
  partitionSizeBytes: number;
}

export interface XboxLayoutAssessment {
  /** "unknown": the row carries no physical layout (native enumeration, Win32_DiskDrive fallback). */
  verdict: "ok" | "rejected" | "unknown";
  codes: XboxLayoutCode[];
  reasons: string[];
  /** False when a requirement fails that no formatter can change: the disk's sector size. */
  fixableByFormat: boolean;
}

/** MBR addresses 2^32 sectors of 512 bytes. */
export const MBR_MAX_VOLUME_BYTES = 2 * 1024 ** 4;

/** 0x0B FAT32 (CHS), 0x0C FAT32 (LBA). */
const FAT32_MBR_TYPES = [11, 12];

export function assessXboxLayout(layout: XboxDiskLayout): XboxLayoutAssessment {
  const style = String(layout.partitionStyle ?? "").trim();
  if (!style || !(layout.partitionCount > 0) || !(layout.logicalSectorSize > 0)) {
    return { verdict: "unknown", codes: [], reasons: [], fixableByFormat: true };
  }

  const codes: XboxLayoutCode[] = [];
  const reasons: string[] = [];
  const reject = (code: XboxLayoutCode, reason: string) => {
    codes.push(code);
    reasons.push(reason);
  };

  const isMbr = style.toUpperCase() === "MBR";
  if (!isMbr) {
    reject("NOT_MBR", `O disco está em ${style}, e o Xbox 360 só lê disco MBR.`);
  }
  if (layout.partitionCount !== 1) {
    reject(
      "PARTITION_COUNT",
      `O disco tem ${layout.partitionCount} partições (nem todas aparecem no Windows), e o Xbox 360 precisa de uma só.`,
    );
  }
  if (isMbr && !FAT32_MBR_TYPES.includes(layout.mbrType)) {
    reject("MBR_TYPE", `A partição está marcada com o tipo ${layout.mbrType}, e não como FAT32 (11 ou 12).`);
  }
  if (layout.logicalSectorSize !== 512) {
    reject(
      "SECTOR_SIZE",
      `O disco usa setores de ${layout.logicalSectorSize} bytes, e o Xbox 360 só lê setores de 512 bytes.`,
    );
  }
  if (String(layout.fileSystem ?? "").trim().toUpperCase() !== "FAT32") {
    reject("NOT_FAT32", `O sistema de arquivos é ${layout.fileSystem || "desconhecido"}, e não FAT32.`);
  }
  if (layout.partitionSizeBytes > MBR_MAX_VOLUME_BYTES) {
    reject("VOLUME_TOO_LARGE", "O volume passa de 2 TB, o limite do FAT32 em disco MBR.");
  }

  return {
    verdict: codes.length === 0 ? "ok" : "rejected",
    codes,
    reasons,
    fixableByFormat: !codes.includes("SECTOR_SIZE"),
  };
}
