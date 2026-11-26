const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { detectPreparedDeviceState } = require("../../services/preparedDeviceState.js");
const { detectXboxOneSeriesDeviceState } = require("../../services/xboxOneSeriesDeviceState.js");
const {
  buildXeniaPreparationReceipt,
  hasXeniaDevModeMarker,
  readXeniaPreparationReceipt,
  writeXeniaMarkerAndReceipt,
} = require("../../infrastructure/xeniaPreparationReceipt.js");
const {
  canSkipPreparation,
  canSkipXeniaPreparation,
  nextStepAfterPreparedUsbScan,
  nextStepAfterXeniaUsbScan,
  readPreparedXeniaDetection,
  strongestXboxOneSeriesDeviceState,
} = require("../../services/preparedUsbDetection.js");

const EXPLOIT_PROFILE = [
  { path: "Content/E0002FF78DFBDE7B/FFFE07D1/00010000/E0002FF78DFBDE7B", sizeBytes: 335872 },
];

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "xenia-device-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));
  return root;
}

function write(root, relativePath, contents = "x") {
  const filePath = path.join(root, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function makeXeniaDrive(root) {
  fs.mkdirSync(path.join(root, "Games"), { recursive: true });
  fs.mkdirSync(path.join(root, "Content", "0000000000000000"), { recursive: true });
  write(root, ".xbox-downloader/xenia-devmode-v1.marker", "xbox-companion-xenia-devmode-v1\r\n");
}

test("isolamento total: HD preparado para Xbox One/Series NUNCA e reconhecido no Xbox 360", async (t) => {
  const root = temp(t);
  makeXeniaDrive(root);

  // Mesmo se alguem passar sem fileSystem, o marcador xenia bloqueia o detector do Xbox 360.
  const state360NoFs = await detectPreparedDeviceState(root, EXPLOIT_PROFILE);
  assert.equal(state360NoFs, "sem-preparo");
  assert.equal(canSkipPreparation(state360NoFs, true), false);

  // E com NTFS tambem nunca conta como preparado para Xbox 360.
  const state360Ntfs = await detectPreparedDeviceState(root, EXPLOIT_PROFILE, { fileSystem: "NTFS" });
  assert.equal(state360Ntfs, "sem-preparo");
  assert.equal(canSkipPreparation(state360Ntfs, true), false);
});

test("isolamento total: pendrive preparado para Xbox 360 NUNCA e reconhecido no Xbox One/Series", async (t) => {
  const root = temp(t);
  write(root, "Aurora/default.xex", "aurora");
  write(root, "launch.ini", "[Paths]");
  write(root, ".xbox-downloader/ready-to-play-v4.marker", "xbox-companion-ready-to-play-v4\r\n");

  const xeniaState = await detectXboxOneSeriesDeviceState(root, {
    fileSystem: "FAT32",
    xbox360PreparedState: "preparado-rgh",
  });
  assert.equal(xeniaState, "preparado-outro-console");
  assert.equal(canSkipXeniaPreparation(xeniaState), false);
  assert.equal(nextStepAfterXeniaUsbScan("checking-prepared-xenia", xeniaState, false), "usb-xenia");

  // Mesmo se o filesystem fosse NTFS mas com artefatos de preparo do 360, continua outro console.
  const xeniaStateNtfsWith360 = await detectXboxOneSeriesDeviceState(root, {
    fileSystem: "NTFS",
    aclVerified: true,
  });
  assert.equal(xeniaStateNtfsWith360, "preparado-outro-console");
  assert.equal(canSkipXeniaPreparation(xeniaStateNtfsWith360), false);
});

test("preparado-xenia exige NTFS + marcador exclusivo + Games/ + Content/ + ACL verificada", async (t) => {
  const root = temp(t);
  makeXeniaDrive(root);

  // Sem ACL verificada: nao pula preparacao.
  const noAcl = await detectXboxOneSeriesDeviceState(root, {
    fileSystem: "NTFS",
    aclVerified: false,
  });
  assert.equal(noAcl, "ntfs-sem-permissoes");
  assert.equal(canSkipXeniaPreparation(noAcl), false);

  // Em FAT32: nao serve mesmo com marcador.
  const wrongFs = await detectXboxOneSeriesDeviceState(root, {
    fileSystem: "FAT32",
    aclVerified: true,
  });
  assert.equal(wrongFs, "sem-preparo");

  // Com NTFS + marcador + pastas + ACL verificada: pronto!
  const ready = await detectXboxOneSeriesDeviceState(root, {
    fileSystem: "NTFS",
    aclVerified: true,
  });
  assert.equal(ready, "preparado-xenia");
  assert.equal(canSkipXeniaPreparation(ready), true);
  assert.equal(
    nextStepAfterXeniaUsbScan("checking-prepared-xenia", ready, false),
    "prepared-detected-xenia",
  );
  // Respeita dismissal para preparar novamente.
  assert.equal(
    nextStepAfterXeniaUsbScan("checking-prepared-xenia", ready, true),
    "usb-xenia",
  );
});

test("gravacao e leitura do marcador e recibo Xenia preservam consoleTarget exclusivo", async (t) => {
  const root = temp(t);
  const receipt = buildXeniaPreparationReceipt({
    appVersion: "2.12.135",
    formatted: true,
    aclVerification: {
      verified: true,
      allApplicationPackagesPresent: true,
      restrictedPackagesPresent: true,
      everyonePresent: true,
      hasDenyRule: false,
      inheritanceActive: true,
      probeInherited: true,
    },
  });

  await writeXeniaMarkerAndReceipt(root, receipt);
  assert.equal(await hasXeniaDevModeMarker(root), true);
  const loaded = await readXeniaPreparationReceipt(root);
  assert.equal(loaded.consoleTarget, "xbox-one-series");
  assert.equal(loaded.mode, "xenia-devmode");
  assert.equal(loaded.aclVerification.verified, true);
});

test("com dois drives plugados (um 360 e um Xenia), cada fluxo enxerga apenas o proprio", () => {
  const mixedDrives = [
    { preparedState: "preparado-bloqueado-lt", xboxOneSeriesState: "preparado-outro-console" },
    { preparedState: "sem-preparo", xboxOneSeriesState: "preparado-xenia" },
  ];

  assert.equal(readPreparedXeniaDetection({ ok: true, drives: mixedDrives }), "preparado-xenia");
  assert.equal(
    strongestXboxOneSeriesDeviceState(["preparado-outro-console", "ntfs-sem-permissoes"]),
    "ntfs-sem-permissoes",
  );
  // console-choice nunca e desviado pela varredura em background.
  assert.equal(
    nextStepAfterPreparedUsbScan("console-choice", "preparado-bloqueado-lt", false, true),
    "console-choice",
  );
  assert.equal(
    nextStepAfterXeniaUsbScan("console-choice", "preparado-xenia", false),
    "console-choice",
  );
});
