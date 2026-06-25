const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  executeTransactionalWriteToDevice,
  executeTransactionalWriteSimulation,
  SIMULATION_MARKER_CONTENT,
  SIMULATION_MARKER_FILE,
  SimulatedInterruptionError,
} = require("../../infrastructure/simulatedTransactionalWriter.js");
const {
  buildTransactionalWritePlan,
} = require("../../infrastructure/transactionalWritePlan.js");

function temp(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));
  return root;
}

function createSimulationRoot(t) {
  const root = temp(t, "xbox360-writer-target-");
  fs.writeFileSync(path.join(root, SIMULATION_MARKER_FILE), SIMULATION_MARKER_CONTENT);
  return root;
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

async function createPlan(t, entries, transactionId = crypto.randomUUID()) {
  const sourceRoot = temp(t, "xbox360-writer-source-");
  const planEntries = entries.map((entry, index) => {
    const contents = Buffer.from(entry.contents);
    const sourcePath = path.join(sourceRoot, `source-${index}.bin`);
    fs.writeFileSync(sourcePath, contents);
    return {
      sourcePath,
      relativePath: entry.relativePath,
      sizeBytes: contents.length,
      sha256: sha256(contents),
    };
  });
  return buildTransactionalWritePlan({
    sourceRoot,
    deviceFingerprint: "c".repeat(64),
    manifestId: "test.production",
    manifestRelease: "0.1.0",
    entries: planEntries,
  }, new Date("2026-06-22T12:00:00.000Z"), transactionId);
}

test("executa commit completo somente dentro de raiz simulada", async (t) => {
  const target = createSimulationRoot(t);
  const plan = await createPlan(t, [
    { relativePath: "Aurora/default.xex", contents: "aurora" },
    { relativePath: "launch.ini", contents: "launch" },
  ]);
  let validations = 0;
  const result = await executeTransactionalWriteSimulation(plan, target, {
    revalidateTarget: async () => { validations++; },
  });
  assert.equal(result.journal.state, "completed");
  assert.equal(result.writtenFiles, 2);
  assert.equal(fs.readFileSync(path.join(target, "Aurora", "default.xex"), "utf8"), "aurora");
  assert.equal(fs.readFileSync(path.join(target, "launch.ini"), "utf8"), "launch");
  assert.ok(validations >= 8);
});

test("executa o mesmo commit transacional em uma raiz física revalidada", async (t) => {
  const target = temp(t, "xbox360-writer-physical-");
  const plan = await createPlan(t, [
    { relativePath: "apps/Aurora/default.xex", contents: "aurora-fixed" },
    { relativePath: "UsbdSecPatch.xex", contents: "usb-patch" },
  ]);
  const progress = [];
  let validations = 0;
  const result = await executeTransactionalWriteToDevice(plan, target, {
    revalidateTarget: async () => { validations++; },
    onProgress: (value) => progress.push(value),
  });
  assert.equal(result.journal.state, "completed");
  assert.equal(result.writtenFiles, 2);
  assert.equal(fs.readFileSync(path.join(target, "apps", "Aurora", "default.xex"), "utf8"), "aurora-fixed");
  assert.equal(fs.readFileSync(path.join(target, "UsbdSecPatch.xex"), "utf8"), "usb-patch");
  assert.ok(validations >= 8);
  assert.equal(progress.at(-1).percent, 100);
  assert.equal(fs.existsSync(path.join(target, ".xbox-downloader", "backup", plan.transactionId)), false);
});

test("reutiliza arquivo existente somente quando tamanho e hash conferem", async (t) => {
  const target = createSimulationRoot(t);
  fs.mkdirSync(path.join(target, "Aurora"));
  fs.writeFileSync(path.join(target, "Aurora", "default.xex"), "aurora");
  const plan = await createPlan(t, [
    { relativePath: "Aurora/default.xex", contents: "aurora" },
  ]);
  const result = await executeTransactionalWriteSimulation(plan, target, {
    revalidateTarget: async () => {},
  });
  assert.equal(result.reusedFiles, 1);
  assert.equal(result.writtenFiles, 0);
});

test("substitui arquivo diferente e remove backup somente após concluir", async (t) => {
  const target = createSimulationRoot(t);
  fs.mkdirSync(path.join(target, "Aurora"));
  fs.writeFileSync(path.join(target, "Aurora", "default.xex"), "antigo");
  const plan = await createPlan(t, [
    { relativePath: "Aurora/default.xex", contents: "novo" },
  ]);
  const result = await executeTransactionalWriteSimulation(plan, target, {
    revalidateTarget: async () => {},
  });
  assert.equal(result.journal.state, "completed");
  assert.equal(fs.readFileSync(path.join(target, "Aurora", "default.xex"), "utf8"), "novo");
  assert.equal(
    fs.existsSync(path.join(target, ".xbox-downloader-sim", "backup", plan.transactionId)),
    false,
  );
});

test("retoma após queda simulada entre promoção e atualização do diário", async (t) => {
  const target = createSimulationRoot(t);
  const plan = await createPlan(t, [
    { relativePath: "Content/game.bin", contents: "game" },
  ], "44444444-4444-4444-8444-444444444444");
  let interrupted = false;
  await assert.rejects(
    () => executeTransactionalWriteSimulation(plan, target, {
      revalidateTarget: async () => {},
      faultInjector: async (point) => {
        if (!interrupted && point === "after-target-promoted") {
          interrupted = true;
          throw new SimulatedInterruptionError();
        }
      },
    }),
    SimulatedInterruptionError,
  );
  assert.equal(fs.readFileSync(path.join(target, "Content", "game.bin"), "utf8"), "game");
  const resumed = await executeTransactionalWriteSimulation(plan, target, {
    revalidateTarget: async () => {},
  });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.journal.state, "completed");
});

test("retoma substituição interrompida depois de preservar o backup", async (t) => {
  const target = createSimulationRoot(t);
  fs.mkdirSync(path.join(target, "Aurora"));
  fs.writeFileSync(path.join(target, "Aurora", "default.xex"), "antigo");
  const plan = await createPlan(t, [
    { relativePath: "Aurora/default.xex", contents: "novo" },
  ], "55555555-5555-4555-8555-555555555555");
  let interrupted = false;
  await assert.rejects(
    () => executeTransactionalWriteSimulation(plan, target, {
      revalidateTarget: async () => {},
      faultInjector: async (point) => {
        if (!interrupted && point === "after-backup-created") {
          interrupted = true;
          throw new SimulatedInterruptionError();
        }
      },
    }),
    SimulatedInterruptionError,
  );
  assert.equal(fs.existsSync(path.join(target, "Aurora", "default.xex")), false);
  const resumed = await executeTransactionalWriteSimulation(plan, target, {
    revalidateTarget: async () => {},
  });
  assert.equal(resumed.journal.state, "completed");
  assert.equal(fs.readFileSync(path.join(target, "Aurora", "default.xex"), "utf8"), "novo");
});

test("recusa qualquer diretório sem marcador explícito de simulação", async (t) => {
  const target = temp(t, "xbox360-writer-unmarked-");
  const plan = await createPlan(t, [
    { relativePath: "launch.ini", contents: "launch" },
  ]);
  await assert.rejects(
    () => executeTransactionalWriteSimulation(plan, target, { revalidateTarget: async () => {} }),
    /marcador/i,
  );
  assert.equal(fs.existsSync(path.join(target, "launch.ini")), false);
});

test("aborta quando a revalidação do destino falha", async (t) => {
  const target = createSimulationRoot(t);
  const plan = await createPlan(t, [
    { relativePath: "launch.ini", contents: "launch" },
  ]);
  await assert.rejects(
    () => executeTransactionalWriteSimulation(plan, target, {
      revalidateTarget: async () => { throw new Error("dispositivo trocado"); },
    }),
    /dispositivo trocado/i,
  );
  assert.equal(fs.existsSync(path.join(target, "launch.ini")), false);
});

for (const [faultPoint, transactionId] of [
  ["after-journal-created", "61111111-1111-4111-8111-111111111111"],
  ["after-entry-staged", "62222222-2222-4222-8222-222222222222"],
  ["after-entry-committed", "63333333-3333-4333-8333-333333333333"],
  ["after-completed", "64444444-4444-4444-8444-444444444444"],
]) {
  test(`retoma após interrupção em ${faultPoint}`, async (t) => {
    const target = createSimulationRoot(t);
    const plan = await createPlan(t, [
      { relativePath: "launch.ini", contents: "launch" },
    ], transactionId);
    let interrupted = false;
    await assert.rejects(
      () => executeTransactionalWriteSimulation(plan, target, {
        revalidateTarget: async () => {},
        faultInjector: async (point) => {
          if (!interrupted && point === faultPoint) {
            interrupted = true;
            throw new SimulatedInterruptionError();
          }
        },
      }),
      SimulatedInterruptionError,
    );
    const resumed = await executeTransactionalWriteSimulation(plan, target, {
      revalidateTarget: async () => {},
    });
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.journal.state, "completed");
    assert.equal(fs.readFileSync(path.join(target, "launch.ini"), "utf8"), "launch");
  });
}
