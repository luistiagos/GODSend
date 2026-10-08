const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// O portao escreve no log do app; fora do Electron o log cai em %APPDATA%, e sem isto as linhas do
// teste iriam para o log real da maquina.
const appData = fs.mkdtempSync(path.join(os.tmpdir(), "xbox-layout-test-"));
process.env.APPDATA = appData;

const test = require("node:test");
test.after(() => fs.rmSync(appData, { recursive: true, force: true }));
const assert = require("node:assert/strict");

const {
  assessXboxLayout,
  MBR_MAX_VOLUME_BYTES,
} = require("../../infrastructure/xboxDiskLayoutPolicy.js");
const { requireXboxReadableLayout } = require("../../services/fixedBadAvatarPreparationService.js");

// O pendrive do chamado #153 como o Windows o mostra: MBR, um volume, FAT32 (tipo 12 = FAT32 LBA).
const readable = {
  partitionStyle: "MBR",
  partitionCount: 1,
  mbrType: 12,
  logicalSectorSize: 512,
  fileSystem: "FAT32",
  partitionSizeBytes: 31_650_201_600,
};

test("MBR com particao unica FAT32 e setor de 512 bytes e o layout que o console le", () => {
  assert.deepEqual(assessXboxLayout(readable), {
    verdict: "ok",
    codes: [],
    reasons: [],
    fixableByFormat: true,
  });
  assert.equal(assessXboxLayout({ ...readable, mbrType: 11 }).verdict, "ok", "0x0B tambem e FAT32");
});

test("GPT reprova, e formatar resolve", () => {
  // Disco de dados GPT criado pelo Windows: a MSR, sem letra, conta como segunda particao.
  const result = assessXboxLayout({ ...readable, partitionStyle: "GPT", partitionCount: 2, mbrType: 0 });
  assert.equal(result.verdict, "rejected");
  assert.deepEqual(result.codes, ["NOT_MBR", "PARTITION_COUNT"]);
  assert.match(result.reasons[0], /GPT/);
  assert.equal(result.fixableByFormat, true);
});

test("segunda particao sem letra reprova, mesmo com o volume visivel certo", () => {
  const result = assessXboxLayout({ ...readable, partitionCount: 2 });
  assert.deepEqual(result.codes, ["PARTITION_COUNT"]);
  assert.match(result.reasons[0], /nem todas aparecem no Windows/);
});

test("particao MBR marcada como NTFS/exFAT (tipo 7) reprova", () => {
  const result = assessXboxLayout({ ...readable, mbrType: 7 });
  assert.deepEqual(result.codes, ["MBR_TYPE"]);
  assert.equal(result.fixableByFormat, true);
});

test("setor de 4096 bytes reprova, e formatar nao resolve", () => {
  const alone = assessXboxLayout({ ...readable, logicalSectorSize: 4096 });
  assert.deepEqual(alone.codes, ["SECTOR_SIZE"]);
  assert.equal(alone.fixableByFormat, false);

  // Junto com algo que formatar resolveria, continua sem saida: o setor e do hardware.
  const withGpt = assessXboxLayout({ ...readable, partitionStyle: "GPT", mbrType: 0, logicalSectorSize: 4096 });
  assert.deepEqual(withGpt.codes, ["NOT_MBR", "SECTOR_SIZE"]);
  assert.equal(withGpt.fixableByFormat, false);
});

test("volume acima de 2 TiB reprova; exatamente 2 TiB passa", () => {
  assert.deepEqual(
    assessXboxLayout({ ...readable, partitionSizeBytes: MBR_MAX_VOLUME_BYTES + 1 }).codes,
    ["VOLUME_TOO_LARGE"],
  );
  assert.equal(assessXboxLayout({ ...readable, partitionSizeBytes: MBR_MAX_VOLUME_BYTES }).verdict, "ok");
});

test("sistema de arquivos diferente de FAT32 reprova", () => {
  assert.deepEqual(assessXboxLayout({ ...readable, fileSystem: "exFAT" }).codes, ["NOT_FAT32"]);
  assert.deepEqual(assessXboxLayout({ ...readable, fileSystem: "" }).codes, ["NOT_FAT32"]);
});

test("linha sem layout fisico e desconhecida: nem aprova nem reprova", () => {
  // Enumeracao nativa e fallback Win32_DiskDrive: PartitionStyle vazio, contagens zeradas.
  const native = { ...readable, partitionStyle: "", partitionCount: 0, mbrType: 0, logicalSectorSize: 0 };
  assert.deepEqual(assessXboxLayout(native), {
    verdict: "unknown",
    codes: [],
    reasons: [],
    fixableByFormat: true,
  });
  assert.equal(assessXboxLayout({ ...readable, partitionCount: 0 }).verdict, "unknown");
  assert.equal(assessXboxLayout({ ...readable, logicalSectorSize: 0 }).verdict, "unknown");
});

// ---- portao do preparo (requireXboxReadableLayout) ----

const nativeRow = {
  ...readable,
  partitionStyle: "",
  partitionCount: 0,
  mbrType: 0,
  logicalSectorSize: 0,
  physicalSectorSize: 0,
  rootPath: "G:\\",
  diskNumber: -1,
  friendlyName: "Dispositivo USB removivel",
  serialNumber: "",
};

function physical(overrides = {}) {
  return {
    ...readable,
    physicalSectorSize: 512,
    rootPath: "G:\\",
    diskNumber: 3,
    friendlyName: "Mass Storage Device USB Device",
    serialNumber: "SERIAL-DO-CLIENTE-123",
    ...overrides,
  };
}

const gpt = { partitionStyle: "GPT", partitionCount: 2, mbrType: 0 };

function runGate(device, formatted, layoutRow) {
  const reads = [];
  const reports = [];
  const promise = requireXboxReadableLayout("G:\\", device, formatted, {
    readLayout: async (root) => {
      reads.push(root);
      return layoutRow;
    },
    report: (...args) => {
      reports.push(args);
    },
  });
  return { promise, reads, reports };
}

test("pendrive da enumeracao nativa: o portao le o layout fisico uma vez e aprova", async () => {
  const run = runGate(nativeRow, false, physical());
  await run.promise;
  assert.deepEqual(run.reads, ["G:\\"]);
  assert.equal(run.reports.length, 0);
});

test("sem formatar, GPT reprova e manda marcar Formatar antes, sem telemetria", async () => {
  const run = runGate(nativeRow, false, physical(gpt));
  await assert.rejects(run.promise, /não vai ler este dispositivo como está[\s\S]*GPT[\s\S]*Marque “Formatar antes”/);
  assert.equal(run.reports.length, 0, "dispositivo do usuario fora do padrao nao e bug nosso");
});

test("depois de formatar, layout errado e bug do formatador e vai para a telemetria", async () => {
  const run = runGate(nativeRow, true, physical(gpt));
  await assert.rejects(run.promise, (error) => {
    assert.match(error.message, /A formatação terminou, mas o disco ficou num formato que o Xbox 360 não lê/);
    assert.doesNotMatch(error.message, /Formatar antes/, "formatar de novo daria o mesmo resultado");
    return true;
  });
  assert.equal(run.reports.length, 1);
  const [component, , , message] = run.reports[0];
  assert.equal(component, "badavatar-layout");
  assert.match(message, /NOT_MBR, PARTITION_COUNT/);
  assert.match(message, /GPT, 2 particao\(oes\), tipo 0, setor 512\/512/);
  assert.match(message, /Mass Storage Device/, "o modelo ajuda a separar pendrive generico (H1)");
  assert.doesNotMatch(message, /SERIAL-DO-CLIENTE-123/, "o serial identifica o aparelho do cliente");
});

test("setor de 4 KB nao manda formatar: o setor e do hardware", async () => {
  for (const formatted of [false, true]) {
    const run = runGate(nativeRow, formatted, physical({ logicalSectorSize: 4096, physicalSectorSize: 4096 }));
    await assert.rejects(run.promise, (error) => {
      assert.match(error.message, /não funciona no Xbox 360/);
      assert.doesNotMatch(error.message, /Formatar antes/);
      return true;
    });
    assert.equal(run.reports.length, 0);
  }
});

test("HD vem da enumeracao fisica com o layout: nenhuma leitura a mais", async () => {
  const run = runGate(physical(gpt), false, physical());
  await assert.rejects(run.promise, /Formatar antes/);
  assert.deepEqual(run.reads, []);
});

test("layout que nao pode ser lido deixa o preparo seguir", async () => {
  // Storage Management sem resposta: readWindowsUsbDiskLayout devolve null.
  const unreadable = runGate(nativeRow, false, null);
  await unreadable.promise;
  assert.deepEqual(unreadable.reads, ["G:\\"]);

  // Fallback Win32_DiskDrive: a linha existe, mas sem estilo de particao.
  const cimRow = runGate(nativeRow, false, { ...nativeRow, diskNumber: -1 });
  await cimRow.promise;
  assert.equal(cimRow.reports.length, 0);
});
