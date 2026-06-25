const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assessDeviceSafety,
  createDeviceFingerprint,
  enrichDeviceSafety,
  assertDeviceStillMatches,
} = require("../../infrastructure/deviceSafetyPolicy.js");

function usb(overrides = {}) {
  return {
    rootPath: "E:\\",
    label: "XBOX360",
    fileSystem: "FAT32",
    sizeBytes: 64 * 1024 ** 3,
    partitionSizeBytes: 64 * 1024 ** 3,
    freeBytes: 60 * 1024 ** 3,
    allocationUnitBytes: 32 * 1024,
    diskNumber: 3,
    partitionNumber: 1,
    diskUniqueId: "{12345678-1234-1234-1234-123456789abc}",
    serialNumber: "USB-TEST-0001",
    friendlyName: "Test USB Device",
    manufacturer: "Test Vendor",
    busType: "USB",
    partitionStyle: "GPT",
    driveType: "Removable",
    diskPath: "test-path",
    operationalStatus: "Online",
    isBoot: false,
    isSystem: false,
    isReadOnly: false,
    isOffline: false,
    mountedPartitionCount: 1,
    ...overrides,
  };
}

test("permite um único dispositivo USB externo com identidade forte", () => {
  const assessment = assessDeviceSafety(usb(), "C:");
  assert.equal(assessment.allowed, true);
  assert.deepEqual(assessment.codes, []);
});

test("bloqueia disco interno, de sistema e volume do Windows", () => {
  const assessment = assessDeviceSafety(
    usb({ rootPath: "C:\\", busType: "SATA", isBoot: true, isSystem: true }),
    "C:",
  );
  assert.equal(assessment.allowed, false);
  assert.ok(assessment.codes.includes("NOT_USB"));
  assert.ok(assessment.codes.includes("BOOT_OR_SYSTEM"));
  assert.ok(assessment.codes.includes("WINDOWS_VOLUME"));
});

test("bloqueia disco físico zero mesmo quando reportado como USB", () => {
  const assessment = assessDeviceSafety(usb({ diskNumber: 0 }));
  assert.equal(assessment.allowed, false);
  assert.ok(assessment.codes.includes("DISK_ZERO"));
});

test("bloqueia dispositivo sem identificador único e sem serial", () => {
  const assessment = assessDeviceSafety(usb({ diskUniqueId: "", serialNumber: "" }));
  assert.equal(assessment.allowed, false);
  assert.ok(assessment.codes.includes("AMBIGUOUS_IDENTITY"));
});

test("bloqueia disco offline, somente leitura ou com múltiplas partições montadas", () => {
  const assessment = assessDeviceSafety(
    usb({ isOffline: true, isReadOnly: true, mountedPartitionCount: 2 }),
  );
  assert.equal(assessment.allowed, false);
  assert.ok(assessment.codes.includes("OFFLINE"));
  assert.ok(assessment.codes.includes("READ_ONLY"));
  assert.ok(assessment.codes.includes("MULTIPLE_MOUNTED_PARTITIONS"));
});

test("a impressão digital é estável para a mesma identidade", () => {
  assert.equal(createDeviceFingerprint(usb()), createDeviceFingerprint(usb()));
});

test("a revalidação recusa troca de dispositivo", () => {
  const selected = enrichDeviceSafety(usb());
  const replaced = enrichDeviceSafety(usb({ serialNumber: "USB-OTHER-9999" }));
  assert.throws(
    () => assertDeviceStillMatches(selected.fingerprint, replaced),
    /mudou desde a seleção/,
  );
});

test("a revalidação aceita o mesmo dispositivo ainda seguro", () => {
  const selected = enrichDeviceSafety(usb());
  assert.doesNotThrow(() => assertDeviceStillMatches(selected.fingerprint, selected));
});
