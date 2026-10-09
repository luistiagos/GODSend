const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const usbDevices = require("../../infrastructure/windowsUsbDeviceService.js");

// Bug badavatar-lista-de-dispositivos-mostra-so-o-pendrive-e-omite-o-hd-externo: com um pendrive
// conectado a enumeracao nativa retornava cedo, e o HD externo (DriveType Fixed) so e achado pela
// fisica — o dropdown mostrava so o pendrive.
const PENDRIVE_NATIVE = {
  RootPath: "E:\\",
  Label: "XBOX",
  FileSystem: "FAT32",
  SizeBytes: 15_500_000_000,
  PartitionSizeBytes: 15_500_000_000,
  FreeBytes: 15_000_000_000,
  AllocationUnitBytes: 0,
  DiskNumber: -1,
  PartitionNumber: -1,
  DiskUniqueId: "\\\\?\\Volume{0b1c2d3e-0000-0000-0000-000000000001}\\",
  SerialNumber: "\\\\?\\Volume{0b1c2d3e-0000-0000-0000-000000000001}\\",
  VolumeGuid: "\\\\?\\Volume{0b1c2d3e-0000-0000-0000-000000000001}\\",
  FriendlyName: "Dispositivo USB removivel",
  BusType: "USB",
  DriveType: "Removable",
  OperationalStatus: "OK",
  HealthStatus: "Healthy",
  MountedPartitionCount: 1,
};
const PENDRIVE_PHYSICAL = {
  ...PENDRIVE_NATIVE,
  DiskNumber: 2,
  PartitionNumber: 1,
  DiskUniqueId: "USBSTOR-PENDRIVE",
  SerialNumber: "270039F46C714702",
  FriendlyName: "USB DISK 2.0",
  PartitionStyle: "MBR",
  PartitionCount: 1,
  MbrType: 12,
};
const HDD_PHYSICAL = {
  RootPath: "F:\\",
  Label: "HD",
  FileSystem: "FAT32",
  SizeBytes: 1_000_000_000_000,
  PartitionSizeBytes: 1_000_000_000_000,
  FreeBytes: 900_000_000_000,
  AllocationUnitBytes: 65_536,
  DiskNumber: 3,
  PartitionNumber: 1,
  DiskUniqueId: "JMICRON-HDD",
  SerialNumber: "HDD-SERIAL-1",
  VolumeGuid: "\\\\?\\Volume{0b1c2d3e-0000-0000-0000-000000000003}\\",
  FriendlyName: "JMicron Generic",
  BusType: "USB",
  PartitionStyle: "MBR",
  PartitionCount: 1,
  MbrType: 12,
  DriveType: "Fixed",
  OperationalStatus: "OK",
  HealthStatus: "Healthy",
  MountedPartitionCount: 1,
};
const marker = (root) => ({ RootPath: root, DriveType: "Fixed", FixedDriveMarker: true });

/**
 * Troca o powershell.exe por um node que devolve `outputs[tipo]` (null = sai com erro).
 * Devolve a lista de scripts iniciados, na ordem.
 */
function fakePowerShell(t, outputs) {
  const realSpawn = childProcess.spawn;
  const started = [];
  t.mock.method(childProcess, "spawn", (_exe, args) => {
    const script = fs.readFileSync(args[args.indexOf("-File") + 1], "utf8");
    const kind = script.includes("[System.IO.DriveInfo]::GetDrives()") ? "nativa" : "fisica";
    started.push(kind);
    const output = outputs[kind];
    const body = output === null
      ? "process.stderr.write('Get-Disk falhou'); process.exit(1)"
      : `process.stdout.write(${JSON.stringify(JSON.stringify(output))})`;
    return realSpawn(process.execPath, ["-e", body], { windowsHide: true });
  });
  return started;
}

function mockStatfs(t) {
  t.mock.method(fs.promises, "statfs", async () => ({ bsize: 16_384, bavail: 1, blocks: 1 }));
}

const winOnly = { skip: process.platform !== "win32", timeout: 30_000 };

test("pendrive + HD externo: a lista traz os dois, e o pendrive continua sendo a linha nativa", winOnly, async (t) => {
  mockStatfs(t);
  const started = fakePowerShell(t, {
    nativa: [PENDRIVE_NATIVE, marker("D:\\"), marker("F:\\")],
    fisica: [PENDRIVE_PHYSICAL, HDD_PHYSICAL],
  });
  const devices = await usbDevices.enumerateSafeWindowsUsbDevices();
  assert.deepEqual(devices.map((d) => d.rootPath), ["E:\\", "F:\\"]);
  assert.deepEqual(started, ["nativa", "fisica"]);
  // A linha do pendrive nao foi trocada pela fisica: o fingerprint da selecao continua o mesmo.
  assert.equal(devices[0].diskNumber, -1);
  assert.equal(devices[1].diskNumber, 3);
  // O marcador D:\ (disco interno) nunca vira dispositivo.
  assert.ok(!devices.some((d) => d.rootPath === "D:\\"));
});

test("revalidacao do preparo acha o HD com o pendrive conectado", winOnly, async (t) => {
  mockStatfs(t);
  const outputs = {
    nativa: [PENDRIVE_NATIVE, marker("F:\\")],
    fisica: [PENDRIVE_PHYSICAL, HDD_PHYSICAL],
  };
  fakePowerShell(t, outputs);
  const hdd = (await usbDevices.enumerateSafeWindowsUsbDevices()).find((d) => d.rootPath === "F:\\");
  t.mock.restoreAll();
  mockStatfs(t);
  fakePowerShell(t, outputs);
  const revalidated = await usbDevices.requireSafeWindowsUsbTarget("f:", hdd.fingerprint);
  assert.equal(revalidated.fingerprint, hdd.fingerprint);
});

test("controle: sem disco Fixed alem do sistema, so a nativa roda (nenhum PowerShell a mais)", winOnly, async (t) => {
  mockStatfs(t);
  const started = fakePowerShell(t, { nativa: [PENDRIVE_NATIVE], fisica: [HDD_PHYSICAL] });
  const devices = await usbDevices.enumerateSafeWindowsUsbDevices();
  assert.deepEqual(devices.map((d) => d.rootPath), ["E:\\"]);
  assert.deepEqual(started, ["nativa"]);
});

test("fisica falha: a lista fica com o pendrive em vez de lancar", winOnly, async (t) => {
  mockStatfs(t);
  const started = fakePowerShell(t, { nativa: [PENDRIVE_NATIVE, marker("D:\\")], fisica: null });
  const devices = await usbDevices.enumerateSafeWindowsUsbDevices();
  assert.deepEqual(devices.map((d) => d.rootPath), ["E:\\"]);
  assert.deepEqual(started, ["nativa", "fisica"]);
});

test("so marcadores Fixed na nativa: cai na fisica como antes e lista o HD", winOnly, async (t) => {
  mockStatfs(t);
  const started = fakePowerShell(t, { nativa: [marker("D:\\"), marker("F:\\")], fisica: [HDD_PHYSICAL] });
  const devices = await usbDevices.enumerateSafeWindowsUsbDevices();
  assert.deepEqual(devices.map((d) => d.rootPath), ["F:\\"]);
  assert.deepEqual(started, ["nativa", "fisica"]);
});
