const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assessDeviceSafety,
  createDeviceFingerprint,
  enrichDeviceSafety,
  assertDeviceStillMatches,
  planRevalidationRetry,
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
    volumeGuid: "\\\\?\\Volume{12345678-1234-1234-1234-123456789abc}\\",
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

// Atenção ao montar este caso: os dois lados usam o MESMO número de bytes, o que
// só acontece em teste. Na máquina real o lado sintético carrega
// DriveInfo.TotalSize e o lado físico carrega Get-Partition.Size, que diferem —
// ver o teste "tamanhos reais" logo abaixo.
test("a revalidação aceita transição de dispositivo removível sintético para dispositivo físico", () => {
  const volumeGuid = "\\\\?\\Volume{abcdef01-2345-6789-abcd-ef0123456789}\\";
  const sizeBytes = 32 * 1024 ** 3;

  const syntheticSelection = enrichDeviceSafety({
    rootPath: "E:\\",
    label: "MEU_PENDRIVE",
    fileSystem: "FAT32",
    sizeBytes: sizeBytes,
    partitionSizeBytes: sizeBytes,
    freeBytes: 30 * 1024 ** 3,
    allocationUnitBytes: 32768,
    diskNumber: -1,
    partitionNumber: -1,
    diskUniqueId: volumeGuid,
    serialNumber: volumeGuid,
    volumeGuid: volumeGuid,
    friendlyName: "Dispositivo USB removivel",
    manufacturer: "",
    busType: "USB",
    partitionStyle: "",
    driveType: "Removable",
    diskPath: volumeGuid,
    operationalStatus: "Online (fallback nativo)",
    isBoot: false,
    isSystem: false,
    isReadOnly: false,
    isOffline: false,
    mountedPartitionCount: 1,
  });

  const physicalCurrent = enrichDeviceSafety(
    usb({
      rootPath: "E:\\",
      diskNumber: 2,
      partitionNumber: 1,
      diskUniqueId: "{99998888-7777-6666-5555-444433332222}",
      serialNumber: "SANDISK_CRUZER_123",
      volumeGuid: volumeGuid,
      friendlyName: "SanDisk Cruzer Blade USB Device",
      manufacturer: "SanDisk",
      sizeBytes: sizeBytes,
      partitionSizeBytes: sizeBytes,
    }),
  );

  assert.doesNotThrow(() =>
    assertDeviceStillMatches(syntheticSelection.fingerprint, physicalCurrent),
  );

  const swappedDevice = enrichDeviceSafety(
    usb({
      rootPath: "E:\\",
      diskNumber: 3,
      partitionNumber: 1,
      volumeGuid: "\\\\?\\Volume{different-guid-different-drive}\\",
      sizeBytes: 64 * 1024 ** 3,
      partitionSizeBytes: 64 * 1024 ** 3,
    }),
  );

  assert.throws(
    () => assertDeviceStillMatches(syntheticSelection.fingerprint, swappedDevice),
    /mudou desde a seleção/,
  );
});

test("com tamanhos reais, a tolerância sintética não cobre a troca de caminho de enumeração", () => {
  // O mesmo pendrive, descrito pelos dois scripts de enumeração. Os tamanhos são
  // os de um pendrive de 64 GB medido no Windows: DriveInfo.TotalSize (script
  // nativo), Get-Partition.Size e Get-Disk.Size (script físico) são três números
  // diferentes — em volumes NTFS reais a diferença medida foi de 3 a 4 KB, e em
  // FAT32 é maior, porque TotalSize exclui FATs e setores reservados.
  //
  // createSyntheticRemovableFingerprint só tenta partitionSizeBytes e sizeBytes do
  // dispositivo ATUAL, então nenhum dos candidatos reproduz o TotalSize que ficou
  // no fingerprint sintético. É por isso que requireSafeWindowsUsbTarget precisa
  // reexecutar o script de origem em vez de confiar nesta tolerância.
  const volumeGuid = "\\\\?\\Volume{7f8a1b2c-3d4e-5f60-7182-93a4b5c6d7e8}\\";
  const DRIVEINFO_SIZE = 61850222592;
  const PARTITION_SIZE = 61855465472;
  const DISK_SIZE = 61872242688;

  const nativeSelection = enrichDeviceSafety(
    usb({
      rootPath: "F:\\",
      diskNumber: -1,
      partitionNumber: -1,
      diskUniqueId: volumeGuid,
      serialNumber: volumeGuid,
      volumeGuid: volumeGuid,
      friendlyName: "Dispositivo USB removivel",
      manufacturer: "",
      sizeBytes: DRIVEINFO_SIZE,
      partitionSizeBytes: DRIVEINFO_SIZE,
    }),
  );

  const physicalCurrent = enrichDeviceSafety(
    usb({
      rootPath: "F:\\",
      diskNumber: 2,
      partitionNumber: 1,
      diskUniqueId: "SCSI\\Disk&Ven_SanDisk&Prod_Cruzer\\5&1c2a3b4c&0&000000",
      serialNumber: "4C530001120830108462",
      volumeGuid: volumeGuid,
      friendlyName: "SanDisk Cruzer Blade USB Device",
      manufacturer: "(Unidades de disco padrao)",
      sizeBytes: DISK_SIZE,
      partitionSizeBytes: PARTITION_SIZE,
    }),
  );

  assert.throws(
    () => assertDeviceStillMatches(nativeSelection.fingerprint, physicalCurrent),
    /mudou desde a seleção/,
  );
  assert.throws(
    () => assertDeviceStillMatches(physicalCurrent.fingerprint, nativeSelection),
    /mudou desde a seleção/,
  );
});

test("linha nativa sempre pede a segunda opinião do caminho físico", () => {
  const native = enrichDeviceSafety(
    usb({ diskNumber: -1, partitionNumber: -1, driveType: "Removable" }),
  );
  assert.equal(planRevalidationRetry(native), "physical");
});

test("linha física de pendrive removível pede a segunda opinião do caminho nativo", () => {
  const physical = enrichDeviceSafety(usb({ driveType: "Removable" }));
  assert.equal(planRevalidationRetry(physical), "native");
});

test("bloqueio do caminho físico não pode ser revertido pelo caminho nativo", () => {
  // O script nativo fixa IsReadOnly/IsOffline/IsBoot/IsSystem em $false e
  // MountedPartitionCount em 1. Reexecutá-lo depois de um bloqueio devolveria como
  // segura uma unidade que a enumeração física acabou de recusar — pendrive com
  // trava de gravação, ou que ganhou uma segunda partição montada.
  const readOnly = enrichDeviceSafety(usb({ driveType: "Removable", isReadOnly: true }));
  assert.equal(readOnly.safety.allowed, false);
  assert.equal(planRevalidationRetry(readOnly), "none");

  const multiPartition = enrichDeviceSafety(
    usb({ driveType: "Removable", mountedPartitionCount: 2 }),
  );
  assert.equal(multiPartition.safety.allowed, false);
  assert.equal(planRevalidationRetry(multiPartition), "none");
});

test("HD USB não paga retentativa por um caminho que nunca o lista", () => {
  // O script nativo pula tudo que não é DriveType.Removable, e HD USB aparece
  // como Fixed: a retentativa não produziria linha nenhuma, só um processo e um
  // timeout antes do mesmo erro.
  const usbHardDrive = enrichDeviceSafety(usb({ driveType: "Fixed" }));
  assert.equal(usbHardDrive.safety.allowed, true);
  assert.equal(planRevalidationRetry(usbHardDrive), "none");
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

