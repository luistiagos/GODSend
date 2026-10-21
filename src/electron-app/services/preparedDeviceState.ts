import { promises as fs } from "fs";
import path from "path";
import type { ExploitProfileFile } from "./fixedBadAvatarPreparationService";
import type { PreparedDeviceState } from "./preparedUsbDetection";

// Estes sete indicadores eram a resposta inteira, e nenhum deles é exclusivo de um dispositivo
// preparado para console Bloqueado/LT: `Content/0000000000000000` é criado pelo baixador de jogos
// sozinho, `Aurora`/`launch.ini` também saem de um preparo em modo RGH, e os demais vêm de pacotes
// de terceiros que o usuário já tinha no pendrive. Hoje eles só distinguem "tem algo de Xbox aqui"
// de "está vazio" — quem decide se há desbloqueio é o perfil do exploit.
const XBOX_FOLDER_INDICATORS = [
  "Content/0000000000000000",
  "Aurora",
  "Games",
  "FSD",
  "Freestyle",
  "default.xex",
  "launch.ini",
];

// Qualquer versão do marcador conta: um pendrive preparado numa versão anterior do aplicativo
// continua sendo um pendrive que este aplicativo preparou. Mesmo critério de
// `infrastructure/consoleCrashArtifacts.ts`.
const MARKER_DIRECTORY = ".xbox-downloader";
const MARKER_PATTERN = /^ready-to-play-v\d+\.marker$/i;

const AURORA_EXECUTABLE = "Aurora/default.xex";
const RGH_BOOT_CONFIGURATION = "launch.ini";

function deviceRoot(driveRoot: string): string {
  const root = String(driveRoot || "").trim();
  if (process.platform === "win32") return root.endsWith("\\") ? root : `${root}\\`;
  return root.endsWith("/") ? root : `${root}/`;
}

function devicePath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split("/"));
}

async function exists(root: string, relativePath: string): Promise<boolean> {
  try {
    await fs.lstat(devicePath(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

const STFS_MAGICS = new Set(["CON ", "LIVE", "PIRS"]);
const STFS_HEADER_BYTES = 0x3a0;
const STFS_BLOCK_BYTES = 0x1000;

/**
 * Endereço do fim do último bloco que o cabeçalho STFS declara alocado
 * (`ComputeBackingDataBlockNumber` do STFS: a cada 0xAA blocos de dados, e a cada 0x70E4, há uma
 * tabela de hash de 1 ou 2 blocos). `null` se o cabeçalho não é de um pacote STFS com blocos.
 */
function stfsRequiredBytes(header: Buffer): number | null {
  if (header.length < STFS_HEADER_BYTES || !STFS_MAGICS.has(header.toString("latin1", 0, 4))) return null;
  const headerSize = header.readUInt32BE(0x340);
  const hashShift = ~header[0x37b] & 1;
  const allocated = header.readUInt32BE(0x395);
  if (allocated === 0) return null;
  const last = allocated - 1;
  let backing = (Math.floor((last + 0xaa) / 0xaa) << hashShift) + last;
  if (last >= 0xaa) backing += Math.floor((last + 0x70e4) / 0x70e4) << hashShift;
  if (last >= 0x70e4) backing += 1 << hashShift;
  const firstBlock = Math.ceil(headerSize / STFS_BLOCK_BYTES) * STFS_BLOCK_BYTES;
  return firstBlock + (backing + 1) * STFS_BLOCK_BYTES;
}

/**
 * O perfil do exploit é um pacote `CON ` que o console regrava ao usar o perfil (GPD do dashboard,
 * títulos jogados), e ele cresce. Por isso o tamanho do manifesto não serve: a conferência é o
 * pacote conter todos os blocos que o próprio cabeçalho declara, o que recusa a cópia truncada em
 * qualquer tamanho. Ver
 * `docs/bugs/open/badavatar-hd-preparado-em-modo-bloqueado-acusado-como-rgh-depois-de-usado-no-console_2026-10-21T17-49.md`.
 *
 * Hash não serve, porque o console reassina o pacote. Quem confere SHA-256 do que foi gravado é o
 * escritor transacional (`simulatedTransactionalWriter.ts::fileMatches`).
 */
async function hasCompleteProfilePackage(root: string, file: ExploitProfileFile): Promise<boolean> {
  try {
    const filePath = devicePath(root, file.path);
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    const handle = await fs.open(filePath, "r");
    try {
      const header = Buffer.alloc(STFS_HEADER_BYTES);
      const { bytesRead } = await handle.read(header, 0, STFS_HEADER_BYTES, 0);
      const required = stfsRequiredBytes(header.subarray(0, bytesRead));
      return required !== null && stat.size >= required;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function preparedByThisApp(root: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(devicePath(root, MARKER_DIRECTORY), { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && MARKER_PATTERN.test(entry.name));
  } catch {
    return false;
  }
}

/**
 * Responde "este dispositivo tem o exploit?" — a pergunta que decide se o `ABadAvatar` vai aparecer
 * na tela de perfis de um console travado ou LT. Ver
 * `docs/bugs/closed/badavatar-usb-service-declara-ja-preparado-sem-conferir-o-perfil-do-exploit_2026-09-23T14-08.md`.
 *
 * `exploitProfile` vem do manifesto ativo (`exploitProfileFiles()`). Lista vazia — manifesto
 * ilegível — nunca produz `preparado-bloqueado-lt`: sem poder conferir, o assistente pergunta o
 * modo do console em vez de convidar a pular a preparação.
 */
export async function detectPreparedDeviceState(
  driveRoot: string,
  exploitProfile: readonly ExploitProfileFile[],
): Promise<PreparedDeviceState> {
  const root = deviceRoot(driveRoot);
  if (!root) return "sem-preparo";

  if (exploitProfile.length > 0) {
    const present = await Promise.all(exploitProfile.map((file) => hasCompleteProfilePackage(root, file)));
    if (present.every(Boolean)) return "preparado-bloqueado-lt";
  }

  if (await preparedByThisApp(root)) return "preparado-rgh";
  if (await exists(root, AURORA_EXECUTABLE) && await exists(root, RGH_BOOT_CONFIGURATION)) {
    return "preparado-rgh";
  }

  const indicators = await Promise.all(
    XBOX_FOLDER_INDICATORS.map((indicator) => exists(root, indicator)),
  );
  return indicators.some(Boolean) ? "jogos-apenas" : "sem-preparo";
}
