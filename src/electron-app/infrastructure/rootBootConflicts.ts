import { promises as fs } from "fs";
import path from "path";

/**
 * Entradas soltas na raiz do pendrive/HD USB que interferem no boot do Xbox 360 e
 * disparam o erro de sistema E 71 (código secundário 1013) ou loops de atualização:
 *
 * - `default.xex` na raiz: durante o boot o console pode tentar carregar/interpretar esse
 *   executável solto na raiz USB em vez do painel (`dash.xex`), derrubando a inicialização em E 71.
 *   Os executáveis legítimos do preparo vivem sempre dentro de subpastas (`Aurora/default.xex`,
 *   `BadUpdatePayload/default.xex`, `games/<jogo>/default.xex`), nunca na raiz.
 * - `$SystemUpdate`, `$$ystemUpdate` e `$$SystemUpdate` na raiz: pacotes residuais ou
 *   incompletos de atualização de dashboard deixados na raiz do pendrive (por exemplo, após
 *   tentar instalar a atualização 17559 no mesmo dispositivo), que podem disparar E 71 ou
 *   prompts/conflitos de atualização tanto em consoles travados/LT quanto em RGH.
 *
 * Assim como `foreignConsoleState.ts`, a limpeza nunca apaga dados do usuário: move cada item
 * conflitante atomicamente (rename no mesmo volume) para uma pasta exclusiva sob
 * `.xbox-downloader/quarantine/root-boot-conflicts-<id>/`, validando todos os diretórios
 * contra links simbólicos e junctions.
 */
const CONFLICTING_ROOT_BOOT_NAMES = new Set([
  "default.xex",
  "$systemupdate",
  "$$ystemupdate",
  "$$systemupdate",
]);

export interface QuarantinedRootBootEntry {
  originalName: string;
  kind: "file" | "directory";
  quarantinePath: string;
}

export function isConflictingRootBootEntryName(entryName: string): boolean {
  const trimmed = String(entryName || "").trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) return false;
  return CONFLICTING_ROOT_BOOT_NAMES.has(trimmed.toLowerCase());
}

function normalizeRoot(driveRoot: string): string {
  const root = String(driveRoot || "").trim();
  if (!root) return "";
  if (process.platform === "win32") return root.endsWith("\\") ? root : `${root}\\`;
  return root.endsWith("/") ? root : `${root}/`;
}

async function assertRegularDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`A raiz ou quarentena exige um diretório real: ${directory}.`);
  }
}

async function ensureCheckedQuarantineDir(root: string, segments: readonly string[]): Promise<string> {
  await assertRegularDirectory(root);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      await fs.mkdir(current);
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
    }
    await assertRegularDirectory(current);
  }
  return current;
}

/**
 * Lista nomes reais (na caixa gravada em disco) de entradas conflitantes presentes diretamente
 * na raiz do dispositivo. Nunca lança erro em leitura indisponível (uso seguro no polling de estado).
 */
export async function listConflictingRootBootEntries(driveRoot: string): Promise<string[]> {
  const root = normalizeRoot(driveRoot);
  if (!root) return [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => isConflictingRootBootEntryName(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  } catch {
    return [];
  }
}

export async function hasConflictingRootBootEntries(driveRoot: string): Promise<boolean> {
  const entries = await listConflictingRootBootEntries(driveRoot);
  return entries.length > 0;
}

function buildRootConflictFailureError(entryName: string, reason: string): Error {
  return new Error(
    `Não foi possível isolar arquivo conflitante na raiz do dispositivo (${entryName}): ${reason}`,
  );
}

/**
 * Move entradas conflitantes da raiz (`default.xex`, `$SystemUpdate`, `$$ystemUpdate`,
 * `$$SystemUpdate`) para `.xbox-downloader/quarantine/root-boot-conflicts-<id>/` no mesmo volume.
 *
 * - Revalida o dispositivo físico antes de cada mutação (`revalidateTarget`).
 * - Recusa links simbólicos e junctions tanto na raiz quanto nas entradas ou na pasta de quarentena.
 * - Não cria `.xbox-downloader/` se nenhum conflito for encontrado.
 * - Se falhar ao isolar uma entrada conflitante, lança erro explícito para nunca deixar o gatilho
 *   de E 71 na raiz enquanto o preparo declara sucesso.
 */
export async function quarantineConflictingRootBootEntries(
  targetRoot: string,
  revalidateTarget: () => Promise<void>,
): Promise<QuarantinedRootBootEntry[]> {
  if (!path.isAbsolute(targetRoot) || typeof revalidateTarget !== "function") {
    throw new Error("O isolamento de conflitos exige uma raiz absoluta e revalidação do dispositivo.");
  }

  const root = path.resolve(targetRoot);
  const assertTarget = async () => {
    await revalidateTarget();
    await assertRegularDirectory(root);
    const realRoot = await fs.realpath(root);
    const normalize = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
    if (normalize(realRoot) !== normalize(root)) {
      throw new Error("A raiz do dispositivo atravessa link ou redirecionamento.");
    }
  };

  await assertTarget();
  const rootEntries = await fs.readdir(root, { withFileTypes: true });
  const conflictingNames = rootEntries
    .filter((entry) => isConflictingRootBootEntryName(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));

  if (conflictingNames.length === 0) {
    return [];
  }

  const quarantined: QuarantinedRootBootEntry[] = [];
  let quarantineDir: string | undefined;

  for (const entryName of conflictingNames) {
    await assertTarget();
    const sourcePath = path.join(root, entryName);

    let stat;
    try {
      stat = await fs.lstat(sourcePath);
    } catch (error: any) {
      if (error?.code === "ENOENT") continue;
      throw buildRootConflictFailureError(entryName, error?.message || String(error));
    }

    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw buildRootConflictFailureError(
        entryName,
        "o item é um link simbólico ou redirecionamento não permitido",
      );
    }

    const kind: "file" | "directory" = stat.isDirectory() ? "directory" : "file";

    if (!quarantineDir) {
      const quarantineParent = await ensureCheckedQuarantineDir(root, [".xbox-downloader", "quarantine"]);
      quarantineDir = await fs.mkdtemp(path.join(quarantineParent, "root-boot-conflicts-"));
    }

    const destinationPath = path.join(quarantineDir, entryName);
    await assertTarget();

    try {
      await fs.rename(sourcePath, destinationPath);
    } catch (renameErr: any) {
      if (kind === "file" && (renameErr?.code === "EPERM" || renameErr?.code === "EACCES")) {
        await fs.chmod(sourcePath, 0o666).catch(() => {});
        try {
          await fs.rename(sourcePath, destinationPath);
        } catch (retryErr: any) {
          throw buildRootConflictFailureError(entryName, retryErr?.message || String(retryErr));
        }
      } else {
        throw buildRootConflictFailureError(entryName, renameErr?.message || String(renameErr));
      }
    }

    const relativeQuarantine = path.relative(root, destinationPath).split(path.sep).join("/");
    quarantined.push({
      originalName: entryName,
      kind,
      quarantinePath: relativeQuarantine,
    });
  }

  return quarantined;
}
