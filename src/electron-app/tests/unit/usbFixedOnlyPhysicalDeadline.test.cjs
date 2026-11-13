const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const childProcess = require("node:child_process");

// Bug electron-main-hd-externo-estoura-12s-na-enumeracao-fisica-e-recuperacao-nativa-e-cega-para-
// fixed: HD externo USB (Fixed) sem pendrive. So a fisica acha o HD; num processo novo ela comecava
// em 12 s, a maquina do cliente passava disso com o HD montado, e a recuperacao pela nativa — cega
// para Fixed — terminava em "O Windows ainda esta reconhecendo... outra porta USB".
const MODULE = require.resolve("../../infrastructure/windowsUsbDeviceService.js");

/** O modulo guarda o historico de duracoes em memoria: cada teste comeca como um processo novo. */
function freshUsbDevices() {
  delete require.cache[MODULE];
  return require(MODULE);
}

const PENDRIVE_NATIVE = {
  RootPath: "E:\\",
  Label: "XBOX",
  FileSystem: "FAT32",
  SizeBytes: 16_000_000_000,
  PartitionSizeBytes: 16_000_000_000,
  FreeBytes: 15_000_000_000,
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
const HDD_PHYSICAL = {
  RootPath: "F:\\",
  Label: "BADAVATAR",
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
 * Troca o powershell.exe por um node: o script do tipo X devolve `plan[X].rows` depois de
 * `plan[X].delay` ms (Infinity = nunca responde). `plan` pode mudar entre chamadas.
 */
function fakePowerShell(t, plan) {
  const realSpawn = childProcess.spawn;
  const started = [];
  t.mock.method(childProcess, "spawn", (_exe, args) => {
    const script = fs.readFileSync(args[args.indexOf("-File") + 1], "utf8");
    const kind = script.includes("[System.IO.DriveInfo]::GetDrives()") ? "nativa" : "fisica";
    started.push(kind);
    const { rows, delay = 0 } = plan[kind];
    const body = Number.isFinite(delay)
      ? `setTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify(rows))}), ${delay})`
      : "setInterval(() => {}, 60000)";
    return realSpawn(process.execPath, ["-e", body], { windowsHide: true });
  });
  return started;
}

function mockStatfs(t) {
  t.mock.method(fs.promises, "statfs", async () => ({ bsize: 16_384, bavail: 1, blocks: 1 }));
}

const winOnly = { skip: process.platform !== "win32", timeout: 60_000 };

test("so HD Fixed, processo novo: a fisica que passa de 12 s ainda lista o HD", winOnly, async (t) => {
  const usbDevices = freshUsbDevices();
  mockStatfs(t);
  const started = fakePowerShell(t, {
    nativa: { rows: [marker("D:\\"), marker("F:\\")] },
    fisica: { rows: [HDD_PHYSICAL], delay: 13_000 },
  });
  const devices = await usbDevices.enumerateSafeWindowsUsbDevices(false);
  assert.deepEqual(devices.map((d) => d.rootPath), ["F:\\"]);
  assert.deepEqual(started, ["nativa", "fisica"]);
});

test("so HD Fixed e a fisica trava: erro diz que esta conectado, sem a nativa cega de novo", winOnly, async (t) => {
  const usbDevices = freshUsbDevices();
  mockStatfs(t);
  t.mock.method(fs.promises, "stat", async () => ({ dev: 7 }));
  const started = fakePowerShell(t, {
    nativa: { rows: [marker("F:\\")] },
    fisica: { rows: [], delay: Infinity },
  });
  await assert.rejects(usbDevices.enumerateSafeWindowsUsbDevices(false), (error) => {
    assert.equal(error.code, "USB_ENUMERATION_TIMEOUT");
    assert.equal(error.timeoutMs, 30_000);
    assert.match(error.message, /está conectado/);
    assert.doesNotMatch(error.message, /outra porta USB/);
    return true;
  });
  assert.deepEqual(started, ["nativa", "fisica"]);
});

test("cinco nativas rapidas nao expulsam a medida lenta da fisica", winOnly, async (t) => {
  const usbDevices = freshUsbDevices();
  mockStatfs(t);
  const plan = {
    nativa: { rows: [marker("F:\\")] },
    fisica: { rows: [HDD_PHYSICAL], delay: 4_500 },
  };
  fakePowerShell(t, plan);
  // A fisica leva ~4,5 s: prazo aprendido ~13,5 s (3x), acima da base de 12 s.
  await usbDevices.enumerateSafeWindowsUsbDevices(false);

  plan.nativa = { rows: [PENDRIVE_NATIVE] };
  for (let i = 0; i < 5; i++) await usbDevices.enumerateSafeWindowsUsbDevices(false);

  // Antes a janela unica so tinha as nativas rapidas e o layout estourava em 12 s.
  plan.fisica = { rows: [HDD_PHYSICAL], delay: 12_500 };
  const layout = await usbDevices.readWindowsUsbDiskLayout("f:");
  assert.ok(layout, "o layout do disco deveria ter sido lido");
  assert.equal(layout.partitionStyle, "MBR");
});
