import { createHash } from "crypto";
import { promises as fsPromises } from "fs";
import path from "path";
import { canonicalizeJson } from "./trustedComponentManifest";
import {
  verifyTransactionalWritePlan,
  type TransactionalWritePlan,
} from "./transactionalWritePlan";

export const TRANSACTION_JOURNAL_VERSION = 1;

export type TransactionState =
  | "planned"
  | "staging"
  | "committing"
  | "completed"
  | "failed";

export type TransactionEntryStatus =
  | "pending"
  | "staged"
  | "backup-created"
  | "committed";

export interface TransactionJournalEntry {
  entryId: string;
  relativePath: string;
  status: TransactionEntryStatus;
}

export interface TransactionJournal {
  journalVersion: 1;
  transactionId: string;
  planHash: string;
  deviceFingerprint: string;
  state: TransactionState;
  updatedAt: string;
  entries: TransactionJournalEntry[];
  error?: string;
  journalHash: string;
}

const STATE_TRANSITIONS: Record<TransactionState, ReadonlySet<TransactionState>> = {
  planned: new Set(["staging", "failed"]),
  staging: new Set(["committing", "failed"]),
  committing: new Set(["completed", "failed"]),
  completed: new Set(),
  failed: new Set(),
};

const ENTRY_TRANSITIONS: Record<TransactionEntryStatus, ReadonlySet<TransactionEntryStatus>> = {
  pending: new Set(["staged", "committed"]),
  staged: new Set(["backup-created", "committed"]),
  "backup-created": new Set(["committed"]),
  committed: new Set(),
};

function journalHash(journal: Omit<TransactionJournal, "journalHash">): string {
  return createHash("sha256").update(canonicalizeJson(journal), "utf8").digest("hex");
}

function freezeJournal(journal: TransactionJournal): TransactionJournal {
  for (const entry of journal.entries) Object.freeze(entry);
  Object.freeze(journal.entries);
  return Object.freeze(journal);
}

function withHash(journal: Omit<TransactionJournal, "journalHash">): TransactionJournal {
  return freezeJournal({ ...journal, journalHash: journalHash(journal) });
}

function isTransactionId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function verifyTransactionJournal(journal: TransactionJournal): void {
  if (journal.journalVersion !== TRANSACTION_JOURNAL_VERSION) {
    throw new Error("Versão do diário transacional não suportada.");
  }
  if (!isTransactionId(journal.transactionId)) throw new Error("transactionId inválido no diário.");
  if (!/^[a-f0-9]{64}$/.test(journal.planHash) || !/^[a-f0-9]{64}$/.test(journal.deviceFingerprint)) {
    throw new Error("Identidade inválida no diário transacional.");
  }
  if (!Object.prototype.hasOwnProperty.call(STATE_TRANSITIONS, journal.state)) {
    throw new Error("Estado inválido no diário transacional.");
  }
  if (typeof journal.updatedAt !== "string" || !Number.isFinite(Date.parse(journal.updatedAt))) {
    throw new Error("Data inválida no diário transacional.");
  }
  if (journal.error != null && (typeof journal.error !== "string" || journal.error.length > 1000)) {
    throw new Error("Erro inválido no diário transacional.");
  }
  if (!Array.isArray(journal.entries) || journal.entries.length === 0 || journal.entries.length > 100_000) {
    throw new Error("O diário transacional não possui entradas.");
  }
  const ids = new Set<string>();
  for (const entry of journal.entries) {
    if (!entry || typeof entry !== "object") throw new Error("Entrada inválida no diário.");
    if (
      !/^[a-f0-9]{64}$/.test(entry.entryId) ||
      !Object.prototype.hasOwnProperty.call(ENTRY_TRANSITIONS, entry.status)
    ) {
      throw new Error("Identidade ou estado de entrada inválido no diário.");
    }
    if (
      typeof entry.relativePath !== "string" ||
      !entry.relativePath ||
      entry.relativePath.length > 240 ||
      entry.relativePath.includes("\\") ||
      entry.relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new Error("Caminho vazio no diário transacional.");
    }
    if (ids.has(entry.entryId)) throw new Error("Entrada duplicada no diário transacional.");
    ids.add(entry.entryId);
  }
  const { journalHash: expected, ...contents } = journal;
  if (!/^[a-f0-9]{64}$/.test(expected) || journalHash(contents) !== expected) {
    throw new Error("O diário transacional foi alterado ou corrompido.");
  }
}

export function verifyTransactionJournalAgainstPlan(
  journal: TransactionJournal,
  plan: TransactionalWritePlan,
): void {
  verifyTransactionJournal(journal);
  verifyTransactionalWritePlan(plan);
  if (
    journal.transactionId !== plan.transactionId ||
    journal.planHash !== plan.planHash ||
    journal.deviceFingerprint !== plan.deviceFingerprint ||
    journal.entries.length !== plan.entries.length
  ) {
    throw new Error("O diário transacional não pertence ao plano de escrita informado.");
  }
  for (let index = 0; index < plan.entries.length; index++) {
    const journalEntry = journal.entries[index];
    const planEntry = plan.entries[index];
    if (
      journalEntry.entryId !== planEntry.entryId ||
      journalEntry.relativePath !== planEntry.relativePath
    ) {
      throw new Error("As entradas do diário não correspondem ao plano de escrita.");
    }
  }
}

export function createTransactionJournal(
  plan: TransactionalWritePlan,
  now = new Date(),
): TransactionJournal {
  verifyTransactionalWritePlan(plan);
  return withHash({
    journalVersion: TRANSACTION_JOURNAL_VERSION,
    transactionId: plan.transactionId,
    planHash: plan.planHash,
    deviceFingerprint: plan.deviceFingerprint,
    state: "planned",
    updatedAt: now.toISOString(),
    entries: plan.entries.map((entry) => ({
      entryId: entry.entryId,
      relativePath: entry.relativePath,
      status: "pending",
    })),
  });
}

export function transitionTransactionState(
  journal: TransactionJournal,
  nextState: TransactionState,
  now = new Date(),
  error?: string,
): TransactionJournal {
  verifyTransactionJournal(journal);
  if (!STATE_TRANSITIONS[journal.state].has(nextState)) {
    throw new Error(`Transição de transação inválida: ${journal.state} -> ${nextState}.`);
  }
  if (nextState === "completed" && journal.entries.some((entry) => entry.status !== "committed")) {
    throw new Error("A transação não pode terminar enquanto houver arquivos não confirmados.");
  }
  const { journalHash: _oldHash, error: _oldError, ...contents } = journal;
  return withHash({
    ...contents,
    state: nextState,
    updatedAt: now.toISOString(),
    ...(nextState === "failed" ? { error: (error || "Falha não especificada.").slice(0, 1000) } : {}),
  });
}

export function transitionJournalEntry(
  journal: TransactionJournal,
  entryId: string,
  nextStatus: TransactionEntryStatus,
  now = new Date(),
): TransactionJournal {
  verifyTransactionJournal(journal);
  const index = journal.entries.findIndex((entry) => entry.entryId === entryId);
  if (index < 0) throw new Error("A entrada não pertence ao diário transacional.");
  const current = journal.entries[index];
  if (!ENTRY_TRANSITIONS[current.status].has(nextStatus)) {
    throw new Error(`Transição de arquivo inválida: ${current.status} -> ${nextStatus}.`);
  }
  const entries = journal.entries.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, status: nextStatus } : { ...entry },
  );
  const { journalHash: _oldHash, ...contents } = journal;
  return withHash({ ...contents, updatedAt: now.toISOString(), entries });
}

function journalPaths(journalDirectory: string, transactionId: string) {
  if (!path.isAbsolute(journalDirectory)) throw new Error("A pasta do diário precisa ser absoluta.");
  if (!isTransactionId(transactionId)) throw new Error("transactionId inválido para arquivo de diário.");
  const root = path.resolve(journalDirectory);
  return {
    root,
    current: path.join(root, `${transactionId}.json`),
    previous: path.join(root, `${transactionId}.previous.json`),
    next: path.join(root, `${transactionId}.next.json`),
  };
}

export async function writeTransactionJournal(
  journalDirectory: string,
  journal: TransactionJournal,
): Promise<string> {
  verifyTransactionJournal(journal);
  const paths = journalPaths(journalDirectory, journal.transactionId);
  await fsPromises.mkdir(paths.root, { recursive: true });
  const rootStat = await fsPromises.lstat(paths.root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("A pasta do diário não é um diretório real.");
  }
  await fsPromises.rm(paths.next, { force: true });
  const handle = await fsPromises.open(paths.next, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalizeJson(journal)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fsPromises.rm(paths.previous, { force: true });
    await fsPromises.rename(paths.current, paths.previous);
  } catch (error: any) {
    if (error?.code !== "ENOENT") {
      await fsPromises.rm(paths.next, { force: true });
      throw error;
    }
  }
  await fsPromises.rename(paths.next, paths.current);
  return paths.current;
}

export async function loadTransactionJournal(
  journalDirectory: string,
  transactionId: string,
): Promise<TransactionJournal> {
  const paths = journalPaths(journalDirectory, transactionId);
  for (const candidate of [paths.current, paths.previous]) {
    try {
      const raw = await fsPromises.readFile(candidate, "utf8");
      if (raw.length > 20 * 1024 * 1024) throw new Error("Diário transacional excede o limite permitido.");
      const journal = JSON.parse(raw) as TransactionJournal;
      verifyTransactionJournal(journal);
      return freezeJournal(journal);
    } catch (error: any) {
      if (error?.code === "ENOENT") continue;
      if (candidate === paths.previous) throw error;
    }
  }
  throw new Error("Nenhum diário transacional válido foi encontrado.");
}
