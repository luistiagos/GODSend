import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { hashFileSha256 } from "./secureComponentStaging";
import {
  createTransactionJournal,
  loadTransactionJournal,
  transitionJournalEntry,
  transitionTransactionState,
  verifyTransactionJournalAgainstPlan,
  writeTransactionJournal,
  type TransactionJournal,
} from "./transactionJournal";
import {
  verifyTransactionalWritePlan,
  type TransactionalWritePlan,
  type TransactionalWritePlanEntry,
} from "./transactionalWritePlan";

export const SIMULATION_MARKER_FILE = ".xbox-downloader-simulation-root";
export const SIMULATION_MARKER_CONTENT = "XBOX360_TRANSACTION_SIMULATION_V1\n";

export type SimulationFaultPoint =
  | "after-journal-created"
  | "after-entry-staged"
  | "after-backup-created"
  | "after-target-promoted"
  | "after-entry-committed"
  | "after-completed";

export class SimulatedInterruptionError extends Error {
  constructor(message = "Interrupção simulada.") {
    super(message);
    this.name = "SimulatedInterruptionError";
  }
}

export interface SimulatedWriterOptions {
  revalidateTarget: () => Promise<void>;
  onProgress?: (progress: TransactionalWriterProgress) => void;
  faultInjector?: (
    point: SimulationFaultPoint,
    entry?: TransactionalWritePlanEntry,
  ) => void | Promise<void>;
}

export interface TransactionalWriterProgress {
  status: string;
  percent: number;
  completedFiles: number;
  totalFiles: number;
  relativePath?: string;
}

export interface SimulatedWriterResult {
  journal: TransactionJournal;
  resumed: boolean;
  reusedFiles: number;
  writtenFiles: number;
}

function resolveInside(root: string, relativePath: string): string {
  const candidate = path.resolve(root, ...relativePath.split("/"));
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Destino escaparia da raiz autorizada: ${relativePath}.`);
  }
  return candidate;
}

async function assertRegularDirectory(directoryPath: string, field: string): Promise<void> {
  const stat = await fsPromises.lstat(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${field} precisa ser um diretório real.`);
  }
}

async function verifySimulationRoot(targetRoot: string): Promise<string> {
  if (!path.isAbsolute(targetRoot)) throw new Error("A raiz simulada precisa ser absoluta.");
  const root = path.resolve(targetRoot);
  await assertRegularDirectory(root, "A raiz simulada");
  const realRoot = await fsPromises.realpath(root);
  if (
    (process.platform === "win32" ? realRoot.toLowerCase() : realRoot) !==
    (process.platform === "win32" ? root.toLowerCase() : root)
  ) {
    throw new Error("A raiz simulada atravessa link ou redirecionamento de diretório.");
  }
  const marker = path.join(root, SIMULATION_MARKER_FILE);
  let markerStat;
  try {
    markerStat = await fsPromises.lstat(marker);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("A raiz não contém o marcador obrigatório de simulação.");
    }
    throw error;
  }
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    throw new Error("A raiz não contém um marcador regular de simulação.");
  }
  if (await fsPromises.readFile(marker, "utf8") !== SIMULATION_MARKER_CONTENT) {
    throw new Error("O marcador da raiz simulada é inválido.");
  }
  return root;
}

async function verifyPhysicalRoot(targetRoot: string): Promise<string> {
  if (!path.isAbsolute(targetRoot)) throw new Error("A raiz do dispositivo precisa ser absoluta.");
  const root = path.resolve(targetRoot);
  await assertRegularDirectory(root, "A raiz do dispositivo");
  const realRoot = await fsPromises.realpath(root);
  if (
    (process.platform === "win32" ? realRoot.toLowerCase() : realRoot) !==
    (process.platform === "win32" ? root.toLowerCase() : root)
  ) {
    throw new Error("A raiz do dispositivo atravessa link ou redirecionamento de diretório.");
  }
  return root;
}

async function ensureSafeDirectory(
  root: string,
  directoryPath: string,
  revalidate: () => Promise<void>,
): Promise<void> {
  const relative = path.relative(root, directoryPath);
  if (relative === "" || relative === ".") return;
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Tentativa de criar diretório fora da raiz autorizada.");
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fsPromises.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Segmento de destino não é diretório real: ${current}.`);
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      await revalidate();
      await fsPromises.mkdir(current);
    }
  }
}

async function fileMatches(filePath: string, entry: TransactionalWritePlanEntry): Promise<boolean> {
  try {
    const stat = await fsPromises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.sizeBytes) return false;
    return (await hashFileSha256(filePath)) === entry.sha256;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fsPromises.lstat(filePath);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function copyAndVerify(
  entry: TransactionalWritePlanEntry,
  stagedPath: string,
  simulationRoot: string,
  revalidate: () => Promise<void>,
): Promise<void> {
  await ensureSafeDirectory(simulationRoot, path.dirname(stagedPath), revalidate);
  const partialPath = `${stagedPath}.partial`;
  await revalidate();
  await fsPromises.rm(partialPath, { force: true });
  try {
    await pipeline(
      fs.createReadStream(entry.sourcePath),
      fs.createWriteStream(partialPath, { flags: "wx", mode: 0o600 }),
    );
    if (!(await fileMatches(partialPath, entry))) {
      throw new Error(`Falha de verificação ao copiar ${entry.relativePath}.`);
    }
    const handle = await fsPromises.open(partialPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await revalidate();
    await fsPromises.rename(partialPath, stagedPath);
  } catch (error) {
    await fsPromises.rm(partialPath, { force: true }).catch(() => {});
    throw error;
  }
}

function metadataPaths(root: string, plan: TransactionalWritePlan, simulation: boolean) {
  const metadataRoot = path.join(root, simulation ? ".xbox-downloader-sim" : ".xbox-downloader");
  return {
    metadataRoot,
    journalRoot: path.join(metadataRoot, "transactions"),
    stagingRoot: path.join(metadataRoot, "staging", plan.transactionId),
    backupRoot: path.join(metadataRoot, "backup", plan.transactionId),
  };
}

async function persistJournal(
  paths: ReturnType<typeof metadataPaths>,
  journal: TransactionJournal,
  revalidate: () => Promise<void>,
): Promise<void> {
  await revalidate();
  await writeTransactionJournal(paths.journalRoot, journal);
}

async function loadOrCreateJournal(
  root: string,
  plan: TransactionalWritePlan,
  paths: ReturnType<typeof metadataPaths>,
  revalidate: () => Promise<void>,
): Promise<{ journal: TransactionJournal; resumed: boolean }> {
  const current = path.join(paths.journalRoot, `${plan.transactionId}.json`);
  const previous = path.join(paths.journalRoot, `${plan.transactionId}.previous.json`);
  if (await pathExists(current) || await pathExists(previous)) {
    const journal = await loadTransactionJournal(paths.journalRoot, plan.transactionId);
    verifyTransactionJournalAgainstPlan(journal, plan);
    return { journal, resumed: true };
  }
  await ensureSafeDirectory(root, paths.journalRoot, revalidate);
  const journal = createTransactionJournal(plan);
  await persistJournal(paths, journal, revalidate);
  return { journal, resumed: false };
}

async function executeTransactionalWrite(
  plan: TransactionalWritePlan,
  targetRoot: string,
  options: SimulatedWriterOptions,
  simulation: boolean,
): Promise<SimulatedWriterResult> {
  if (!options?.revalidateTarget) throw new Error("A gravação exige revalidação explícita do destino.");
  verifyTransactionalWritePlan(plan);
  const root = simulation
    ? await verifySimulationRoot(targetRoot)
    : await verifyPhysicalRoot(targetRoot);
  const paths = metadataPaths(root, plan, simulation);
  await options.revalidateTarget();
  options.onProgress?.({
    status: "Preparando a cópia…",
    percent: 1,
    completedFiles: 0,
    totalFiles: plan.entries.length,
  });
  let { journal, resumed } = await loadOrCreateJournal(root, plan, paths, options.revalidateTarget);
  let reusedFiles = 0;
  let writtenFiles = 0;

  try {
    if (!resumed) await options.faultInjector?.("after-journal-created");
    if (journal.state === "completed") {
      await options.revalidateTarget();
      await fsPromises.rm(paths.stagingRoot, { recursive: true, force: true });
      await fsPromises.rm(paths.backupRoot, { recursive: true, force: true });
      return { journal, resumed: true, reusedFiles: plan.entries.length, writtenFiles: 0 };
    }
    if (journal.state === "failed") {
      throw new Error("Uma transação marcada como falha não pode ser retomada; crie um novo plano.");
    }
    if (journal.state === "planned") {
      journal = transitionTransactionState(journal, "staging");
      await persistJournal(paths, journal, options.revalidateTarget);
    }

    if (journal.state === "staging") {
      for (let index = 0; index < plan.entries.length; index++) {
        const entry = plan.entries[index];
        options.onProgress?.({
          status: `Copiando ${entry.relativePath}`,
          percent: 5 + Math.floor((index / plan.entries.length) * 80),
          completedFiles: index,
          totalFiles: plan.entries.length,
          relativePath: entry.relativePath,
        });
        let journalEntry = journal.entries.find((item) => item.entryId === entry.entryId)!;
        const targetPath = resolveInside(root, entry.relativePath);
        const stagedPath = resolveInside(paths.stagingRoot, entry.relativePath);
        if (journalEntry.status === "committed") {
          if (!(await fileMatches(targetPath, entry))) {
            throw new Error(`Arquivo confirmado não confere: ${entry.relativePath}.`);
          }
          reusedFiles++;
          continue;
        }
        if (await fileMatches(targetPath, entry)) {
          if (journalEntry.status === "pending" || journalEntry.status === "staged") {
            journal = transitionJournalEntry(journal, entry.entryId, "committed");
            await persistJournal(paths, journal, options.revalidateTarget);
          }
          reusedFiles++;
          continue;
        }
        if (!(await fileMatches(stagedPath, entry))) {
          await copyAndVerify(entry, stagedPath, root, options.revalidateTarget);
        }
        if (journalEntry.status === "pending") {
          journal = transitionJournalEntry(journal, entry.entryId, "staged");
          await persistJournal(paths, journal, options.revalidateTarget);
        }
        await options.faultInjector?.("after-entry-staged", entry);
      }
      journal = transitionTransactionState(journal, "committing");
      await persistJournal(paths, journal, options.revalidateTarget);
    }

    if (journal.state !== "committing") throw new Error(`Estado inesperado para commit: ${journal.state}.`);
    for (let index = 0; index < plan.entries.length; index++) {
      const entry = plan.entries[index];
      options.onProgress?.({
        status: `Finalizando ${entry.relativePath}`,
        percent: 86 + Math.floor((index / plan.entries.length) * 13),
        completedFiles: index,
        totalFiles: plan.entries.length,
        relativePath: entry.relativePath,
      });
      let journalEntry = journal.entries.find((item) => item.entryId === entry.entryId)!;
      const targetPath = resolveInside(root, entry.relativePath);
      const stagedPath = resolveInside(paths.stagingRoot, entry.relativePath);
      const backupPath = resolveInside(paths.backupRoot, entry.relativePath);
      if (journalEntry.status === "committed") {
        if (!(await fileMatches(targetPath, entry))) {
          throw new Error(`Arquivo confirmado não confere: ${entry.relativePath}.`);
        }
        continue;
      }
      if (await fileMatches(targetPath, entry)) {
        journal = transitionJournalEntry(journal, entry.entryId, "committed");
        await persistJournal(paths, journal, options.revalidateTarget);
        await options.faultInjector?.("after-entry-committed", entry);
        continue;
      }
      if (journalEntry.status === "pending") {
        if (!(await fileMatches(stagedPath, entry))) {
          await copyAndVerify(entry, stagedPath, root, options.revalidateTarget);
        }
        journal = transitionJournalEntry(journal, entry.entryId, "staged");
        await persistJournal(paths, journal, options.revalidateTarget);
        journalEntry = journal.entries.find((item) => item.entryId === entry.entryId)!;
      }
      if (journalEntry.status === "staged") {
        if (await pathExists(targetPath)) {
          const targetStat = await fsPromises.lstat(targetPath);
          if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
            throw new Error(`Destino existente não é arquivo regular: ${entry.relativePath}.`);
          }
          await ensureSafeDirectory(root, path.dirname(backupPath), options.revalidateTarget);
          if (!(await pathExists(backupPath))) {
            await options.revalidateTarget();
            await fsPromises.rename(targetPath, backupPath);
          }
          journal = transitionJournalEntry(journal, entry.entryId, "backup-created");
          await persistJournal(paths, journal, options.revalidateTarget);
          await options.faultInjector?.("after-backup-created", entry);
          journalEntry = journal.entries.find((item) => item.entryId === entry.entryId)!;
        }
      }
      if (journalEntry.status !== "staged" && journalEntry.status !== "backup-created") {
        throw new Error(`Estado inesperado para ${entry.relativePath}: ${journalEntry.status}.`);
      }
      if (!(await fileMatches(stagedPath, entry))) {
        if (await fileMatches(targetPath, entry)) {
          journal = transitionJournalEntry(journal, entry.entryId, "committed");
          await persistJournal(paths, journal, options.revalidateTarget);
          continue;
        }
        await copyAndVerify(entry, stagedPath, root, options.revalidateTarget);
      }
      await ensureSafeDirectory(root, path.dirname(targetPath), options.revalidateTarget);
      await options.revalidateTarget();
      await fsPromises.rename(stagedPath, targetPath);
      await options.faultInjector?.("after-target-promoted", entry);
      if (!(await fileMatches(targetPath, entry))) {
        await options.revalidateTarget();
        await fsPromises.rm(targetPath, { force: true });
        if (await pathExists(backupPath)) await fsPromises.rename(backupPath, targetPath);
        throw new Error(`Falha de verificação após promover ${entry.relativePath}.`);
      }
      journal = transitionJournalEntry(journal, entry.entryId, "committed");
      await persistJournal(paths, journal, options.revalidateTarget);
      writtenFiles++;
      await options.faultInjector?.("after-entry-committed", entry);
    }

    journal = transitionTransactionState(journal, "completed");
    await persistJournal(paths, journal, options.revalidateTarget);
    await options.faultInjector?.("after-completed");
    await options.revalidateTarget();
    await fsPromises.rm(paths.stagingRoot, { recursive: true, force: true });
    await fsPromises.rm(paths.backupRoot, { recursive: true, force: true });
    options.onProgress?.({
      status: "Dispositivo preparado com sucesso.",
      percent: 100,
      completedFiles: plan.entries.length,
      totalFiles: plan.entries.length,
    });
    return { journal, resumed, reusedFiles, writtenFiles };
  } catch (error: any) {
    if (error instanceof SimulatedInterruptionError) throw error;
    // Keep the last monotonic journal resumable. A transient unplug, permission
    // error or failed revalidation must never convert a recoverable transaction
    // into a terminal state while a backup may be holding the original file.
    throw error;
  }
}

export async function executeTransactionalWriteSimulation(
  plan: TransactionalWritePlan,
  targetRoot: string,
  options: SimulatedWriterOptions,
): Promise<SimulatedWriterResult> {
  return executeTransactionalWrite(plan, targetRoot, options, true);
}

export async function executeTransactionalWriteToDevice(
  plan: TransactionalWritePlan,
  targetRoot: string,
  options: SimulatedWriterOptions,
): Promise<SimulatedWriterResult> {
  return executeTransactionalWrite(plan, targetRoot, options, false);
}
