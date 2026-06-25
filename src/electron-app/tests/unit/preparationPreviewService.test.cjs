const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toPublicPreparationPreviewReport,
  validatePreparationPreviewRequest,
} = require("../../services/preparationPreviewService.js");

function request(overrides = {}) {
  return {
    driveRoot: "E:\\",
    expectedDeviceFingerprint: "a".repeat(64),
    console: {
      dashboardVersion: "17559",
      avatarDataInstalledConfirmed: true,
      networkDisconnectedConfirmed: true,
      nonPersistentExploitAcknowledged: true,
      exploitProfileSafetyAcknowledged: true,
    },
    ...overrides,
  };
}

test("aceita somente contrato estreito com unidade e fingerprint válidos", () => {
  assert.doesNotThrow(() => validatePreparationPreviewRequest(request()));
  assert.throws(
    () => validatePreparationPreviewRequest(request({ driveRoot: "C:\\Windows" })),
    /unidade USB válida/i,
  );
  assert.throws(
    () => validatePreparationPreviewRequest(request({ expectedDeviceFingerprint: "curto" })),
    /identidade do dispositivo/i,
  );
  assert.throws(
    () => validatePreparationPreviewRequest({ ...request(), componentUrl: "https://untrusted.test/payload.zip" }),
    /campos não permitidos.*componentUrl/i,
  );
  assert.throws(
    () => validatePreparationPreviewRequest(request({
      console: { ...request().console, networkDisconnectedConfirmed: "sim" },
    })),
    /confirmações do console/i,
  );
});

test("relatório público não expõe caminhos internos de staging", () => {
  const internal = "C:\\Users\\tester\\AppData\\preparation\\secret";
  const report = {
    mode: "read-only-preview",
    ready: true,
    blockers: [],
    warnings: ["aviso"],
    sessionId: "session-test",
    sessionRoot: internal,
    targetWritesPerformed: false,
    console: { allowed: true, blockers: [], warnings: [], normalizedDashboardVersion: "2.0.17559.0" },
    components: [{
      id: "aurora",
      role: "dashboard-aurora",
      version: "1",
      archiveFormat: "zip",
      extractedFiles: 2,
      extractedBytes: 10,
    }],
    image: { root: `${internal}\\image`, fileCount: 2, totalBytes: 10 },
    plan: {
      manifestId: "components.test",
      manifestRelease: "1.0.0",
      planHash: "b".repeat(64),
      totalBytes: 10,
      entries: [{ sourcePath: `${internal}\\image\\Aurora\\default.xex` }],
    },
    capacity: {
      allowed: true,
      filesToWrite: 2,
      filesReused: 0,
      requiredFreeBytes: 100,
      shortfallBytes: 0,
      storage: { freeBytes: 1000 },
    },
  };

  const publicReport = toPublicPreparationPreviewReport(report);
  assert.equal(publicReport.plan.hash, "b".repeat(64));
  assert.equal(publicReport.plan.fileCount, 1);
  assert.equal(publicReport.capacity.freeBytes, 1000);
  assert.equal(JSON.stringify(publicReport).includes(internal), false);
  assert.equal(Object.hasOwn(publicReport, "sessionRoot"), false);
});
