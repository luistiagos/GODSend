import { promises as fs } from "fs";
import path from "path";
import { hashFileSha256 } from "./secureComponentStaging";
import { validateXboxTargetRelativePath } from "./transactionalWritePlan";

// O pacote BadAvatar foi capturado de um console real e carrega o estado dele: logs e crash
// dumps do Aurora e os bancos do FreeStyle, que descrevem 68 jogos num HD interno cujo serial
// nao existe no pendrive do usuario. Nada disso tem funcao no destino e o Aurora/FreeStyle
// recriam o que precisam, entao o estado alheio nao e replicado.
const FOREIGN_CONSOLE_STATE_PATTERNS = [
  /^aurora\/data\/logs\//,
  /^apps\/aurora\/data\/logs\//,
  /^apps\/freestyle\/data\/logs\//,
  /^apps\/freestyle\/data\/databases\//,
];

export function isForeignConsoleStatePath(relativePath: string): boolean {
  const key = String(relativePath || "").toLowerCase();
  return FOREIGN_CONSOLE_STATE_PATTERNS.some((pattern) => pattern.test(key));
}

interface BundledStateFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

async function regularDirectory(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`A migração exige um diretório real: ${directory}.`);
  }
}

// Verifica cada ancestral antes de ler ou mover arquivos; junctions também são recusadas.
async function checkedPath(root: string, relative: string, createParents = false): Promise<string> {
  const segments = validateXboxTargetRelativePath(relative).split("/");
  await regularDirectory(root);
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    if (createParents) {
      try {
        await fs.mkdir(current);
      } catch (error: any) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    await regularDirectory(current);
  }
  return path.join(current, segments[segments.length - 1]);
}

async function matchesBundle(root: string, file: BundledStateFile): Promise<boolean> {
  try {
    const candidate = await checkedPath(root, file.path);
    const stat = await fs.lstat(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`O estado antigo não é um arquivo regular: ${file.path}.`);
    }
    return stat.size === file.sizeBytes && await hashFileSha256(candidate) === file.sha256;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Retira somente cópias byte a byte do estado incluído no manifesto já validado.
 * Cada rename fica no mesmo volume: uma interrupção deixa o original ou sua cópia
 * em quarentena. A próxima preparação reavalia os caminhos mesmo com diário completed.
 * Arquivos alterados pelo console ficam intactos; não se apagam pastas de logs ou bancos.
 */
export async function quarantineForeignConsoleState(
  targetRoot: string,
  manifestFiles: readonly BundledStateFile[],
  revalidateTarget: () => Promise<void>,
): Promise<string[]> {
  if (!path.isAbsolute(targetRoot) || typeof revalidateTarget !== "function") {
    throw new Error("A migração exige uma raiz absoluta e revalidação do dispositivo.");
  }
  const candidates = manifestFiles.filter((file) => isForeignConsoleStatePath(file.path));
  const seen = new Set<string>();
  for (const file of candidates) {
    const key = validateXboxTargetRelativePath(file.path).toLowerCase();
    if (seen.has(key) || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0 ||
        !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`Entrada inválida para migrar estado antigo: ${file.path}.`);
    }
    seen.add(key);
  }
  const root = path.resolve(targetRoot);
  const assertTarget = async () => {
    await revalidateTarget();
    await regularDirectory(root);
    const realRoot = await fs.realpath(root);
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalize(realRoot) !== normalize(root)) {
      throw new Error("A raiz da migração atravessa link ou redirecionamento.");
    }
  };
  await assertTarget();
  const quarantined: string[] = [];
  let quarantineRoot: string | undefined;
  for (const file of candidates) {
    await assertTarget();
    if (!(await matchesBundle(root, file))) continue;
    if (!quarantineRoot) {
      const prefix = await checkedPath(root, ".xbox-downloader/quarantine/foreign-console-state-", true);
      quarantineRoot = await fs.mkdtemp(prefix);
    }
    const relative = path.relative(root, path.join(quarantineRoot, ...file.path.split("/")))
      .split(path.sep).join("/");
    const destination = await checkedPath(root, relative, true);
    // Revalidar antes da mutação e comparar novamente preserva um arquivo que mudou
    // durante a preparação. A pasta exclusiva impede sobrescrever quarentenas anteriores.
    await assertTarget();
    if (!(await matchesBundle(root, file))) continue;
    await checkedPath(root, relative);
    await fs.rename(await checkedPath(root, file.path), destination);
    quarantined.push(relative);
  }
  return quarantined;
}
