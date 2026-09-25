const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  PREPARATION_RECEIPT_PATH,
  buildPreparationReceipt,
  writePreparationReceipt,
} = require("../../infrastructure/preparationReceipt.js");
const {
  buildTransactionalWritePlan,
} = require("../../infrastructure/transactionalWritePlan.js");
const {
  READY_TO_PLAY_MARKER_PATH,
  generateReadyToPlayMarker,
} = require("../../infrastructure/readyToPlayConfiguration.js");

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "preparation-receipt-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));
  return root;
}

test("o recibo guarda o modo, a data, a versao do app e o release do pacote", async (t) => {
  const root = temp(t);
  const receipt = buildPreparationReceipt({
    isRghOnly: true,
    appVersion: "2.12.99",
    release: "1.1-autostart-aurora-freestyle-dashlaunch-xexmenu",
    readyToPlayVersion: "4",
    preparedAt: new Date("2026-09-23T14:08:00.000Z"),
  });
  const destination = await writePreparationReceipt(root, receipt);

  assert.equal(destination, path.join(root, ...PREPARATION_RECEIPT_PATH.split("/")));
  assert.deepEqual(JSON.parse(fs.readFileSync(destination, "utf8")), {
    schemaVersion: 1,
    mode: "rgh",
    preparedAt: "2026-09-23T14:08:00.000Z",
    appVersion: "2.12.99",
    release: "1.1-autostart-aurora-freestyle-dashlaunch-xexmenu",
    readyToPlayVersion: "4",
  });
  assert.equal(
    buildPreparationReceipt({ isRghOnly: false, appVersion: "x", release: "y", readyToPlayVersion: "4" }).mode,
    "bloqueado-lt",
  );
});

/**
 * A razao de o recibo ficar fora da transacao: o `planHash` sai do conteudo das entradas, e o
 * `transactionId` nao. Dois preparos do mesmo pacote no mesmo dispositivo produzem o mesmo
 * `transactionId` com `planHash` diferente se qualquer byte do plano variar — e ai a retomada de
 * uma preparacao interrompida falha com "O diario transacional nao pertence ao plano de escrita
 * informado". Este teste trava a armadilha: um marcador com data muda o plano.
 */
test("data dentro do plano transacional muda o planHash e quebraria a retomada", async (t) => {
  const root = temp(t);
  const markerPath = path.join(root, ...READY_TO_PLAY_MARKER_PATH.split("/"));
  fs.mkdirSync(path.dirname(markerPath), { recursive: true });

  const planFor = async (contents) => {
    fs.writeFileSync(markerPath, contents, "utf8");
    return buildTransactionalWritePlan({
      sourceRoot: root,
      deviceFingerprint: "a".repeat(64),
      manifestId: "godsend.fixed.badavatar",
      manifestRelease: "1.1-test",
      entries: [{
        sourcePath: markerPath,
        relativePath: READY_TO_PLAY_MARKER_PATH,
        sizeBytes: Buffer.byteLength(contents, "utf8"),
        sha256: require("node:crypto").createHash("sha256").update(contents, "utf8").digest("hex"),
      }],
    }, new Date("2026-09-01T00:00:00.000Z"), "11111111-2222-5333-a444-555566667777");
  };

  const stable = await planFor(generateReadyToPlayMarker());
  const sameAgain = await planFor(generateReadyToPlayMarker());
  const withTimestamp = await planFor(`${generateReadyToPlayMarker().trim()} 2026-09-23T14:08:00.000Z\r\n`);

  assert.equal(stable.planHash, sameAgain.planHash);
  assert.equal(stable.transactionId, withTimestamp.transactionId);
  assert.notEqual(stable.planHash, withTimestamp.planHash);
});
