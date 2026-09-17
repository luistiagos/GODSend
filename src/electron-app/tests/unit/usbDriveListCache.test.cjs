const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");

const usbDevices = require("../../infrastructure/windowsUsbDeviceService.js");
const {
  invalidateUsbDriveListCache,
  listFat32UsbDrives,
} = require("../../services/badAvatarUsbService.js");

// Cada enumeracao real abre dois ou tres powershell.exe; em algumas maquinas cada
// um pisca uma janela de terminal. Com o app parado na Home, nenhuma deve abrir.
test(
  "listFat32UsbDrives: so reenumera (PowerShell) quando um volume montado muda",
  { skip: process.platform !== "win32" },
  async (t) => {
    let clock = 1_000_000;
    let volumes = { "C:\\": 1, "E:\\": 42 };
    let free = 400;
    let enumerations = 0;
    let releaseEnumeration = null;

    t.mock.method(performance, "now", () => clock);
    t.mock.method(fs.promises, "stat", async (root) => {
      const volume = volumes[root];
      if (volume === undefined) throw Object.assign(new Error("no such drive"), { code: "ENOENT" });
      if (volume === "RAW") throw Object.assign(new Error("unrecognized volume"), { code: "EIO" });
      return { dev: volume };
    });
    t.mock.method(fs.promises, "statfs", async () => ({ bavail: free, bsize: 1 }));
    t.mock.method(usbDevices, "enumerateSafeWindowsUsbDevices", async () => {
      enumerations++;
      if (releaseEnumeration) await new Promise((resolve) => { releaseEnumeration = resolve; });
      else await new Promise((resolve) => setImmediate(resolve));
      return [{ rootPath: "E:\\", label: "XBOX", sizeBytes: 1000, freeBytes: 400 }];
    });

    // Volume recem-montado: o Windows pode ainda nao listar o disco, nada fica em cache.
    await listFat32UsbDrives();
    await listFat32UsbDrives();
    assert.equal(enumerations, 2);

    // Assentado: uma enumeracao enche o cache e o polling para de abrir processos.
    clock += 15_000;
    await listFat32UsbDrives();
    await listFat32UsbDrives();
    await listFat32UsbDrives();
    assert.equal(enumerations, 3);

    // Espaco livre muda com downloads para o pendrive e e relido sem reenumerar.
    free = 123;
    const [drive] = await listFat32UsbDrives();
    assert.equal(drive.freeBytes, 123);
    assert.equal(enumerations, 3);

    // Formatar gera numero de serie novo: reenumera.
    volumes = { ...volumes, "E:\\": 43 };
    await listFat32UsbDrives();
    assert.equal(enumerations, 4);

    // Chamadas simultaneas (Home + contador de jogos) dividem uma enumeracao.
    await Promise.all([listFat32UsbDrives(), listFat32UsbDrives(), listFat32UsbDrives()]);
    assert.equal(enumerations, 5);

    // Pendrive RAW (novo, ext4, FAT corrompida) ganha letra mas o stat falha: ainda conta.
    clock += 15_000;
    await listFat32UsbDrives();
    await listFat32UsbDrives();
    assert.equal(enumerations, 6);
    volumes = { ...volumes, "F:\\": "RAW" };
    await listFat32UsbDrives();
    assert.equal(enumerations, 7);

    // "Atualizar" e o reparo (chkdsk) nao mudam letra nem serial: fresh/invalidar reenumeram.
    clock += 15_000;
    await listFat32UsbDrives();
    await listFat32UsbDrives();
    assert.equal(enumerations, 8);
    await listFat32UsbDrives(true);
    assert.equal(enumerations, 9);
    invalidateUsbDriveListCache();
    await listFat32UsbDrives();
    await listFat32UsbDrives();
    assert.equal(enumerations, 10);

    // Quem pede depois de invalidar nao pega carona na enumeracao anterior (resposta velha).
    invalidateUsbDriveListCache();
    releaseEnumeration = () => {};
    const beforeRepair = listFat32UsbDrives();
    await new Promise((resolve) => setImmediate(resolve));
    const releaseOld = releaseEnumeration;
    releaseEnumeration = null;
    invalidateUsbDriveListCache();
    const afterRepair = listFat32UsbDrives();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(enumerations, 12);
    releaseOld();
    await Promise.all([beforeRepair, afterRepair]);
    await listFat32UsbDrives();
    assert.equal(enumerations, 12);
  },
);
