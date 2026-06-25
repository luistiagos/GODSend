const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildCleanDeviceImage,
  generateCleanLaunchIni,
  generateXeUnshackleAutoStart,
  validateCleanLaunchIni,
} = require("../../infrastructure/cleanDeviceImage.js");
const {
  buildTransactionalWritePlan,
} = require("../../infrastructure/transactionalWritePlan.js");

function temp(t, prefix = "xbox360-clean-image-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 75 }));
  return root;
}

function sha256(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}

function component(id, role, installPath) {
  return {
    id,
    role,
    displayName: id,
    version: "test-1",
    required: true,
    source: {
      url: `https://downloads.example.test/${id}.zip`,
      redirectHosts: [],
      fileName: `${id}.zip`,
      sizeBytes: 100,
      sha256: sha256(`archive:${id}`),
    },
    license: {
      spdx: "MIT",
      projectUrl: `https://example.test/${id}`,
      redistributionApproved: true,
      attribution: "Fixture de teste.",
    },
    archive: {
      format: "zip",
      installPath,
      maxExtractedBytes: 1024 * 1024,
      maxEntries: 100,
    },
  };
}

function extracted(t, root, trustedComponent, files) {
  const outputPath = path.join(root, `extracted-${trustedComponent.id}`);
  fs.mkdirSync(outputPath, { recursive: true });
  const descriptors = files.map((file) => {
    const sourcePath = path.join(outputPath, ...file.archivePath.split("/"));
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    const contents = Buffer.from(file.contents);
    fs.writeFileSync(sourcePath, contents);
    return {
      sourcePath,
      archivePath: file.archivePath,
      sizeBytes: contents.length,
      sha256: sha256(contents),
    };
  });
  return {
    component: trustedComponent,
    extraction: {
      outputPath,
      files: descriptors,
      totalBytes: descriptors.reduce((total, file) => total + file.sizeBytes, 0),
      entryCount: descriptors.length,
    },
  };
}

function fixture(t, overrides = {}) {
  const root = temp(t);
  const badavatar = component("abadavatar", "badavatar-entry", ".");
  const xeunshackle = component("xeunshackle", "xeunshackle-autostart", "BadUpdatePayload");
  const aurora = component("aurora", "dashboard-aurora", "Aurora");
  const inputs = [
    extracted(t, root, badavatar, overrides.badavatarFiles || [
      { archivePath: "Content/0000000000000000/profile", contents: "profile" },
    ]),
    extracted(t, root, xeunshackle, overrides.xeunshackleFiles || [
      { archivePath: "default.xex", contents: "xeunshackle" },
    ]),
    extracted(t, root, aurora, overrides.auroraFiles || [
      { archivePath: "default.xex", contents: "aurora" },
      { archivePath: "Data/settings.db", contents: "settings" },
    ]),
  ];
  const manifest = {
    schemaVersion: 1,
    manifestId: "xbox360-components.test",
    release: "0.1.0",
    createdAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2027-06-01T00:00:00.000Z",
    components: [badavatar, xeunshackle, aurora],
  };
  return { root, inputs, manifest };
}

test("monta imagem mínima limpa e produz arquivos aptos ao plano", async (t) => {
  const { root, inputs, manifest } = fixture(t);
  const result = await buildCleanDeviceImage(
    manifest,
    inputs,
    path.join(root, "image"),
    { now: new Date("2026-06-22T12:00:00.000Z") },
  );
  const launch = fs.readFileSync(path.join(result.imageRoot, "launch.ini"), "utf8");
  assert.equal(launch, generateCleanLaunchIni());
  assert.equal(launch.includes("[Plugins]"), false);
  assert.equal(launch.includes("noupdater = true"), true);
  assert.equal(fs.readFileSync(path.join(result.imageRoot, "BadUpdatePayload", "XeUnshackleAutoStart.txt"), "utf8"), "2.00");
  assert.equal(fs.existsSync(path.join(result.imageRoot, "Aurora", "default.xex")), true);
  assert.equal(fs.existsSync(path.join(result.imageRoot, ".xbox-downloader", "manifest.json")), true);
  const plan = await buildTransactionalWritePlan({
    sourceRoot: result.imageRoot,
    deviceFingerprint: "d".repeat(64),
    manifestId: manifest.manifestId,
    manifestRelease: manifest.release,
    entries: result.files,
  });
  assert.equal(plan.entries.length, result.files.length);
});

test("recusa imagem sem todos os papéis obrigatórios", async (t) => {
  const { root, inputs, manifest } = fixture(t);
  await assert.rejects(
    () => buildCleanDeviceImage(manifest, inputs.slice(0, 2), path.join(root, "image")),
    /componentes insuficientes|role dashboard-aurora/i,
  );
});

test("recusa colisão entre componentes", async (t) => {
  const { root, inputs, manifest } = fixture(t, {
    badavatarFiles: [
      { archivePath: "Content/0000000000000000/profile", contents: "profile" },
      { archivePath: "BadUpdatePayload/default.xex", contents: "collision" },
    ],
  });
  await assert.rejects(
    () => buildCleanDeviceImage(manifest, inputs, path.join(root, "image")),
    /colisão entre componentes/i,
  );
});

test("recusa MAC, NAND, KV e outros arquivos sensíveis", async (t) => {
  const { root, inputs, manifest } = fixture(t, {
    xeunshackleFiles: [
      { archivePath: "default.xex", contents: "xeunshackle" },
      { archivePath: "OriginalMACAddress.bin", contents: "mac" },
    ],
  });
  await assert.rejects(
    () => buildCleanDeviceImage(manifest, inputs, path.join(root, "image")),
    /arquivo sensível proibido/i,
  );
});

test("componentes não podem fornecer launch.ini ou metadados internos", async (t) => {
  const { root, inputs, manifest } = fixture(t, {
    badavatarFiles: [
      { archivePath: "Content/0000000000000000/profile", contents: "profile" },
      { archivePath: "launch.ini", contents: "unsafe" },
    ],
  });
  await assert.rejects(
    () => buildCleanDeviceImage(manifest, inputs, path.join(root, "image")),
    /arquivo reservado/i,
  );
});

test("validador aceita somente o launch.ini canônico", () => {
  assert.doesNotThrow(() => validateCleanLaunchIni(generateCleanLaunchIni()));
  assert.throws(
    () => validateCleanLaunchIni(`${generateCleanLaunchIni()}[Plugins]\r\nplugin1 = Usb:\\plugin.xex\r\n`),
    /configuração mínima e segura/i,
  );
  assert.throws(
    () => validateCleanLaunchIni(generateCleanLaunchIni().replace("noupdater = true", "noupdater = false")),
    /configuração mínima e segura/i,
  );
});

test("AutoStart usa dois segundos e recusa valor sem janela de cancelamento", () => {
  assert.equal(generateXeUnshackleAutoStart(), "2.00");
  assert.throws(() => generateXeUnshackleAutoStart(0), /entre 1 e 10 segundos/i);
  assert.throws(() => generateXeUnshackleAutoStart(11), /entre 1 e 10 segundos/i);
});

test("nunca sobrescreve uma imagem já montada", async (t) => {
  const { root, inputs, manifest } = fixture(t);
  const output = path.join(root, "image");
  fs.mkdirSync(output);
  await assert.rejects(
    () => buildCleanDeviceImage(manifest, inputs, output),
    /nunca será sobrescrita/i,
  );
});

