/**
 * Política pura de layout de disco para o Xbox One e Xbox Series X|S em Modo Desenvolvedor
 * (Xenia Canary UWP). Sem imports, para ser carregada diretamente pelos testes unitários.
 *
 * Diferenças em relação ao Xbox 360 (`xboxDiskLayoutPolicy.ts`):
 * - Exige NTFS (FAT32 e exFAT não suportam ACLs NTFS para `ALL APPLICATION PACKAGES` / S-1-15-2-1).
 * - Discos <= 2 TiB usam MBR (partição única primária NTFS, tipo 0x07) para máxima compatibilidade.
 * - Discos > 2 TiB usam GPT (partição única Basic Data NTFS), aproveitando toda a capacidade
 *   (3 TB, 4 TB, 8 TB etc.), diferente do teto de 2 TiB do Xbox 360.
 * - Aceita setores lógicos de 512 bytes e 4096 bytes (Windows 10/11 Core no Xbox One/Series).
 */

export type XboxOneSeriesLayoutCode =
  | "NOT_NTFS"
  | "PARTITION_STYLE"
  | "PARTITION_COUNT"
  | "SUPERFLOPPY"
  | "SECTOR_SIZE";

export interface XboxOneSeriesDiskLayout {
  partitionStyle: string;
  partitionCount: number;
  /** Offset inicial da partição em bytes; 0 significa superfloppy (sem tabela de partição real). */
  partitionOffsetBytes?: number;
  logicalSectorSize: number;
  fileSystem: string;
  /** Tamanho total físico do disco em bytes (usado para decidir MBR <= 2 TiB vs GPT > 2 TiB). */
  diskSizeBytes?: number;
  partitionSizeBytes: number;
}

export interface XboxOneSeriesLayoutAssessment {
  verdict: "ok" | "rejected" | "unknown";
  codes: XboxOneSeriesLayoutCode[];
  reasons: string[];
  /** Estilo de tabela recomendado ao recriar/formatar este disco. */
  recommendedPartitionStyle: "MBR" | "GPT";
  /** Sempre true exceto em setores lógicos exóticos fora de 512/4096. */
  fixableByFormat: boolean;
}

/** Limite de endereçamento MBR (2^32 setores de 512 bytes = 2 TiB). */
export const XBOX_ONE_SERIES_MBR_MAX_BYTES = 2 * 1024 ** 4;

/** Limiar informativo (não-bloqueante) para avisar sobre pendrives pequenos para jogos de Xbox 360. */
export const XBOX_ONE_SERIES_RECOMMENDED_MIN_BYTES = 16 * 1024 ** 3;

const SUPPORTED_SECTOR_SIZES = [512, 4096];

/** Decide MBR (<= 2 TiB) ou GPT (> 2 TiB) para formatação NTFS do Xbox One/Series. */
export function recommendedPartitionStyleForXboxOneSeries(diskSizeBytes: number): "MBR" | "GPT" {
  return Number.isFinite(diskSizeBytes) && diskSizeBytes > XBOX_ONE_SERIES_MBR_MAX_BYTES
    ? "GPT"
    : "MBR";
}

/** Indica se vale exibir aviso informativo leve (não-bloqueante) de pouca capacidade. */
export function isSmallCapacityForXeniaGames(sizeBytes?: number): boolean {
  return typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes < XBOX_ONE_SERIES_RECOMMENDED_MIN_BYTES;
}

export function assessXboxOneSeriesLayout(layout: XboxOneSeriesDiskLayout): XboxOneSeriesLayoutAssessment {
  const effectiveDiskBytes =
    typeof layout.diskSizeBytes === "number" && layout.diskSizeBytes > 0
      ? layout.diskSizeBytes
      : layout.partitionSizeBytes;
  const recommendedPartitionStyle = recommendedPartitionStyleForXboxOneSeries(effectiveDiskBytes);

  const style = String(layout.partitionStyle ?? "").trim().toUpperCase();
  if (!style || !(layout.partitionCount > 0) || !(layout.logicalSectorSize > 0)) {
    return {
      verdict: "unknown",
      codes: [],
      reasons: [],
      recommendedPartitionStyle,
      fixableByFormat: true,
    };
  }

  const codes: XboxOneSeriesLayoutCode[] = [];
  const reasons: string[] = [];
  const reject = (code: XboxOneSeriesLayoutCode, reason: string) => {
    codes.push(code);
    reasons.push(reason);
  };

  const fsName = String(layout.fileSystem ?? "").trim().toUpperCase();
  if (fsName !== "NTFS") {
    reject(
      "NOT_NTFS",
      `O sistema de arquivos é ${layout.fileSystem || "desconhecido"}, e o Xbox One / Series (Modo Desenvolvedor) exige NTFS.`,
    );
  }

  if (style !== "MBR" && style !== "GPT") {
    reject("PARTITION_STYLE", `O disco está em ${style || "formato desconhecido"}, e precisa ser MBR ou GPT.`);
  } else if (recommendedPartitionStyle === "GPT" && style !== "GPT") {
    reject("PARTITION_STYLE", "Discos acima de 2 TB precisam usar tabela GPT para aproveitar toda a capacidade no Xbox One / Series.");
  }

  // Em discos GPT, o Windows pode manter uma partição MSR reservada (16 MB) além da partição de dados;
  // aqui aceitamos exatamente 1 partição no MBR e 1 partição no GPT criado pelo nosso script.
  if (layout.partitionCount !== 1) {
    reject(
      "PARTITION_COUNT",
      `O disco tem ${layout.partitionCount} partições, e o preparo recomendado usa uma única partição NTFS.`,
    );
  }

  if (
    typeof layout.partitionOffsetBytes === "number" &&
    Number.isFinite(layout.partitionOffsetBytes) &&
    layout.partitionOffsetBytes <= 0
  ) {
    reject(
      "SUPERFLOPPY",
      "O disco está sem tabela de partições real (formato superfloppy, início no byte 0).",
    );
  }

  if (!SUPPORTED_SECTOR_SIZES.includes(layout.logicalSectorSize)) {
    reject(
      "SECTOR_SIZE",
      `O disco usa setores lógicos de ${layout.logicalSectorSize} bytes (esperado 512 ou 4096 bytes).`,
    );
  }

  return {
    verdict: codes.length === 0 ? "ok" : "rejected",
    codes,
    reasons,
    recommendedPartitionStyle,
    fixableByFormat: !codes.includes("SECTOR_SIZE"),
  };
}
