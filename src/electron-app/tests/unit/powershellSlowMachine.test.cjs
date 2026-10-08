const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const childProcess = require("node:child_process");

const usbDevices = require("../../infrastructure/windowsUsbDeviceService.js");

// Reports 9527-9530: no PC do cliente cada powershell.exe leva 5-8 s (aqui ~0,5 s). Os prazos
// fixos (nativa 5 s, fisica 12 s) estouravam com o pendrive montado e listado, e o preparo — que
// nao tem ultima lista confiavel para cair — falhava com "O Windows ainda esta reconhecendo...".
const NATIVE_ROW = {
  RootPath: "E:\\",
  Label: "XBOX",
  FileSystem: "FAT32",
  SizeBytes: 16_000_000_000,
  PartitionSizeBytes: 16_000_000_000,
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

/**
 * Troca o powershell.exe por um node que responde como o PowerShell daquela maquina: cada script
 * leva `delays[tipo]` ms (Infinity = nunca responde). Devolve a lista de scripts iniciados.
 */
function slowPowerShell(t, delays) {
  const realSpawn = childProcess.spawn;
  const started = [];
  t.mock.method(childProcess, "spawn", (_exe, args) => {
    const script = fs.readFileSync(args[args.indexOf("-File") + 1], "utf8");
    const kind = script.includes("[System.IO.DriveInfo]::GetDrives()") ? "nativa" : "fisica";
    started.push(kind);
    const delay = delays[kind];
    const body = Number.isFinite(delay)
      ? `setTimeout(() => process.stdout.write(${JSON.stringify(JSON.stringify([NATIVE_ROW]))}), ${delay})`
      : "setInterval(() => {}, 60000)";
    return realSpawn(process.execPath, ["-e", body], { windowsHide: true });
  });
  return started;
}

test(
  "PowerShell lento: o preparo encontra o pendrive em vez de estourar o prazo fixo",
  { skip: process.platform !== "win32", timeout: 60_000 },
  async (t) => {
    t.mock.method(fs.promises, "statfs", async () => ({ bsize: 16_384, bavail: 1, blocks: 1 }));

    // Sem medida nenhuma ainda (app recem-aberto): a nativa leva 6 s, a fisica nao responde.
    // Antes: nativa 5 s -> fisica 12 s -> lanca. Agora a nativa ganha uma segunda tentativa.
    let started = slowPowerShell(t, { nativa: 6_000, fisica: Infinity });
    const [device] = await usbDevices.enumerateSafeWindowsUsbDevices();
    assert.equal(device.rootPath, "E:\\");
    assert.deepEqual(started, ["nativa", "nativa"]);
    // Sem Add-Type no script, o cluster vem do statfs (o mesmo GetDiskFreeSpace, via libuv).
    assert.equal(device.allocationUnitBytes, 16_384);

    // Depois de um sucesso de ~6 s, o prazo acompanha a maquina: uma tentativa so, sem estourar.
    t.mock.restoreAll();
    t.mock.method(fs.promises, "statfs", async () => ({ bsize: 16_384, bavail: 1, blocks: 1 }));
    started = slowPowerShell(t, { nativa: 6_000, fisica: Infinity });
    const revalidated = await usbDevices.requireSafeWindowsUsbTarget("e:", device.fingerprint);
    assert.equal(revalidated.fingerprint, device.fingerprint);
    assert.deepEqual(started, ["nativa"]);
  },
);

test("enumerationTimeoutFor: acompanha a mais lenta recente, nunca abaixo da base nem acima do teto", () => {
  const { enumerationTimeoutFor } = usbDevices;
  assert.equal(enumerationTimeoutFor(5_000, []), 5_000);
  assert.equal(enumerationTimeoutFor(5_000, [400, 600]), 5_000);
  assert.equal(enumerationTimeoutFor(5_000, [400, 6_000, 900]), 18_000);
  assert.equal(enumerationTimeoutFor(12_000, [2_000]), 12_000);
  // Controle: maquina lentissima ou filho que levou uma eternidade — o prazo para no teto.
  assert.equal(enumerationTimeoutFor(5_000, [25_000]), 30_000);
  assert.equal(enumerationTimeoutFor(40_000, [25_000]), 40_000);
});

test("explainSlowEnumeration: so troca a mensagem quando o prazo estourou com a letra montada", async (t) => {
  const { explainSlowEnumeration } = usbDevices;
  const timeout = Object.assign(new Error("O Windows ainda está reconhecendo seu pendrive ou HD."), {
    code: "USB_ENUMERATION_TIMEOUT",
    timeoutMs: 5_000,
  });

  t.mock.method(fs.promises, "stat", async () => ({ dev: 7 }));
  const slow = await explainSlowEnumeration(timeout, "e:");
  assert.equal(slow.code, "USB_ENUMERATION_TIMEOUT");
  assert.match(slow.message, /está conectado/);
  assert.match(slow.message, /não é preciso trocar de porta/i);
  assert.doesNotMatch(slow.message, /reconhecendo/);

  const other = new Error("Não foi possível identificar uma única unidade USB física.");
  assert.equal(await explainSlowEnumeration(other, "e:"), other);

  t.mock.restoreAll();
  t.mock.method(fs.promises, "stat", async () => {
    throw Object.assign(new Error("no such drive"), { code: "ENOENT" });
  });
  assert.equal(await explainSlowEnumeration(timeout, "e:"), timeout);
});
