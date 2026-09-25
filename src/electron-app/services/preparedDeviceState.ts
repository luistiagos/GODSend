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

/**
 * Tamanho basta aqui: esta resposta decide qual tela o usuário vê, não se a gravação vai ser
 * reaproveitada — quem confere SHA-256 arquivo por arquivo é o escritor transacional
 * (`simulatedTransactionalWriter.ts::fileMatches`), e hashear o pacote a cada varredura de 5 s
 * seria ler o pendrive inteiro com o app parado na Home.
 */
async function matchesBundledSize(root: string, file: ExploitProfileFile): Promise<boolean> {
  try {
    const stat = await fs.lstat(devicePath(root, file.path));
    return stat.isFile() && !stat.isSymbolicLink() && stat.size === file.sizeBytes;
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
    const present = await Promise.all(exploitProfile.map((file) => matchesBundledSize(root, file)));
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
