const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createTransactionJournal,
  loadTransactionJournal,
  transitionJournalEntry,
  transitionTransactionState,
  verifyTransactionJournal,
  verifyTransactionJournalAgainstPlan,
  writeTransactionJournal,
} = require("../../infrastructure/transactionJournal.js");
const {
  buildTransactionalWritePlan,
} = require("../../infrastructure/transactionalWritePlan.js");

const DEVICE_FINGERPRINT = "b".repeat(64);
const TRANSACTION_ID = "22222222-2222-4222-8222-222222222222";

function temp(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return root;
}

async function makePlan(t) {
  const sourceRoot = temp(t, "xbox360-journal-source-");
  const sourcePath = path.join(sourceRoot, "aurora.xex");
  const contents = Buffer.from("aurora");
  fs.writeFileSync(sourcePath, contents);
  return buildTransactionalWritePlan(
    {
      sourceRoot,
      deviceFingerprint: DEVICE_FINGERPRINT,
      manifestId: "test.production",
      manifestRelease: "0.1.0",
      entries: [{
        sourcePath,
        relativePath: "Aurora/default.xex",
        sizeBytes: contents.length,
        sha256: crypto.createHash("sha256").update(contents).digest("hex"),
      }],
    },
    new Date("2026-06-22T12:00:00.000Z"),
    TRANSACTION_ID,
  );
}

test("cria diário verificável a partir do plano", async (t) => {
  const plan = await makePlan(t);
  const journal = createTransactionJournal(plan, new Date("2026-06-22T12:01:00.000Z"));
  assert.equal(journal.state, "planned");
  assert.equal(journal.entries[0].status, "pending");
  assert.equal(Object.isFrozen(journal), true);
  assert.doesNotThrow(() => verifyTransactionJournal(journal));
});

test("aplica somente transições válidas e exige todos confirmados para concluir", async (t) => {
  const plan = await makePlan(t);
  let journal = createTransactionJournal(plan);
  assert.throws(() => transitionTransactionState(journal, "completed"), /transição de transação inválida/i);
  journal = transitionTransactionState(journal, "staging");
  journal = transitionJournalEntry(journal, journal.entries[0].entryId, "staged");
  journal = transitionTransactionState(journal, "committing");
  assert.throws(() => transitionTransactionState(journal, "completed"), /arquivos não confirmados/i);
  journal = transitionJournalEntry(journal, journal.entries[0].entryId, "committed");
  journal = transitionTransactionState(journal, "completed");
  assert.equal(journal.state, "completed");
});

test("recusa regressão de estado de arquivo", async (t) => {
  const plan = await makePlan(t);
  let journal = createTransactionJournal(plan);
  journal = transitionTransactionState(journal, "staging");
  journal = transitionJournalEntry(journal, journal.entries[0].entryId, "staged");
  assert.throws(
    () => transitionJournalEntry(journal, journal.entries[0].entryId, "pending"),
    /transição de arquivo inválida/i,
  );
});

test("persiste e carrega diário com troca atômica", async (t) => {
  const plan = await makePlan(t);
  const journalRoot = temp(t, "xbox360-journal-data-");
  let journal = createTransactionJournal(plan);
  await writeTransactionJournal(journalRoot, journal);
  journal = transitionTransactionState(journal, "staging");
  await writeTransactionJournal(journalRoot, journal);
  const loaded = await loadTransactionJournal(journalRoot, TRANSACTION_ID);
  assert.equal(loaded.state, "staging");
  assert.equal(loaded.journalHash, journal.journalHash);
});

test("usa cópia anterior quando o diário atual está corrompido", async (t) => {
  const plan = await makePlan(t);
  const journalRoot = temp(t, "xbox360-journal-recovery-");
  let journal = createTransactionJournal(plan);
  await writeTransactionJournal(journalRoot, journal);
  journal = transitionTransactionState(journal, "staging");
  const currentPath = await writeTransactionJournal(journalRoot, journal);
  fs.writeFileSync(currentPath, "{corrompido");
  const recovered = await loadTransactionJournal(journalRoot, TRANSACTION_ID);
  assert.equal(recovered.state, "planned");
});

test("detecta alteração do diário mesmo com JSON válido", async (t) => {
  const plan = await makePlan(t);
  const journal = JSON.parse(JSON.stringify(createTransactionJournal(plan)));
  journal.state = "completed";
  assert.throws(() => verifyTransactionJournal(journal), /alterado ou corrompido/i);
});

test("vincula o diário ao plano exato", async (t) => {
  const plan = await makePlan(t);
  const journal = createTransactionJournal(plan);
  assert.doesNotThrow(() => verifyTransactionJournalAgainstPlan(journal, plan));
  const differentPlan = JSON.parse(JSON.stringify(plan));
  differentPlan.transactionId = "33333333-3333-4333-8333-333333333333";
  assert.throws(
    () => verifyTransactionJournalAgainstPlan(journal, differentPlan),
    /plano de escrita foi alterado|não pertence ao plano/i,
  );
});
