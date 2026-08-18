const assert = require("node:assert/strict");
const { app } = require("electron");

function normalizedRoot(value) {
  const match = String(value || "").match(/^([a-z]):/i);
  return match ? `${match[1].toUpperCase()}:\\` : String(value || "");
}

app.whenReady().then(async () => {
  try {
    const {
      enumerateSafeWindowsUsbDevices,
      requireSafeWindowsUsbTarget,
    } = require("../../infrastructure/windowsUsbDeviceService.js");
    const devices = await Promise.race([
      enumerateSafeWindowsUsbDevices(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("enumeração USB excedeu 8 segundos")), 8_000)),
    ]);
    assert.ok(Array.isArray(devices));
    for (const device of devices) {
      assert.match(device.rootPath, /^[A-Z]:\\$/);
      assert.equal(device.busType.toUpperCase(), "USB");
      assert.equal(device.fingerprint.length, 64);
      assert.equal(typeof device.safety.allowed, "boolean");
      assert.ok(device.allocationUnitBytes >= 512, `cluster inválido para ${device.rootPath}`);
      assert.match(device.volumeGuid, /^\\\\\?\\Volume\{[0-9a-f-]+\}\\?$/i);
    }
    const expected = process.env.EXPECT_USB_ROOT;
    if (expected) {
      const match = devices.find((device) => normalizedRoot(device.rootPath) === normalizedRoot(expected));
      assert.ok(match, `unidade esperada ${expected} não encontrada: ${devices.map((item) => item.rootPath).join(", ")}`);
      assert.equal(match.safety.allowed, true, `unidade ${expected} foi bloqueada: ${match.safety.reasons.join(" ")}`);
      const revalidated = await requireSafeWindowsUsbTarget(match.rootPath, match.fingerprint);
      assert.equal(revalidated.fingerprint, match.fingerprint, "a identidade mudou durante a revalidação");
    }
    console.log(JSON.stringify(devices, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
