const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const {
  buildGuardedWindowsFat32Script,
  validateWindowsFormatGuard,
} = require("../../infrastructure/fat32Format.js");

const validGuard = {
  expectedVolumeGuid: "\\\\?\\Volume{3dbb510f-622c-11f0-9508-bcf171ac5412}\\",
  expectedVolumeBytes: 62_518_624_256,
};

test("aceita GUID de volume estavel e capacidade valida antes da formatacao", () => {
  assert.deepEqual(validateWindowsFormatGuard(validGuard), validGuard);
});

test("script elevado preserva barras e possui sintaxe PowerShell valida sem executa-lo", (t) => {
  const script = buildGuardedWindowsFat32Script(
    "F",
    "C:\\Xbox Companion\\fat32format.exe",
    "C:\\Temp\\fat32.log",
    validGuard,
  );
  assert.ok(script.includes("System32\\mountvol.exe"));
  assert.ok(script.includes("'F:\\' '/L'"));
  assert.ok(!script.includes("System32mountvol.exe"));

  if (process.platform !== "win32") {
    t.skip("validador de sintaxe PowerShell disponível somente no Windows");
    return;
  }
  const parserCommand = [
    "$source=[Console]::In.ReadToEnd()",
    "$tokens=$null",
    "$errors=$null",
    "[void][System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)",
    "if($errors.Count -gt 0){$errors | ForEach-Object { Write-Error $_.Message }; exit 1}",
    "Write-Output 'OK'",
  ].join("; ");
  const parsed = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", parserCommand,
  ], { input: script, encoding: "utf8", timeout: 10_000 });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
  assert.match(parsed.stdout, /OK/);
});

test("bloqueia formatacao sem GUID estavel ou com capacidade invalida", () => {
  assert.throws(
    () => validateWindowsFormatGuard({ expectedVolumeGuid: "F:\\", expectedVolumeBytes: 62_518_624_256 }),
    /identidade estável/,
  );
  assert.throws(
    () => validateWindowsFormatGuard({
      expectedVolumeGuid: "\\\\?\\Volume{3dbb510f-622c-11f0-9508-bcf171ac5412}\\",
      expectedVolumeBytes: 0,
    }),
    /capacidade esperada/,
  );
});

test("calcula tolerancia sem overflow de Int32 em unidades de grande capacidade (2 TB)", (t) => {
  const largeGuard = {
    expectedVolumeGuid: "\\\\?\\Volume{3dbb510f-622c-11f0-9508-bcf171ac5412}\\",
    expectedVolumeBytes: 2_097_133_649_900,
  };
  const script = buildGuardedWindowsFat32Script(
    "D",
    "C:\\Xbox Companion\\fat32format.exe",
    "C:\\Temp\\fat32.log",
    largeGuard,
  );
  assert.ok(script.includes("$expectedVolumeBytes = [int64]2097133649900"));

  if (process.platform !== "win32") {
    t.skip("avaliação de execução PowerShell disponível somente no Windows");
    return;
  }
  const evalCommand = [
    "$expectedVolumeBytes = [int64]2097133649900",
    "$tolerance = [Math]::Max([double]16777216, [Math]::Floor([double]$expectedVolumeBytes * 0.01))",
    "if ($tolerance -lt 20000000000) { throw 'Tolerancia incorreta' }",
    "Write-Output 'OK'",
  ].join("; ");
  const executed = spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", evalCommand,
  ], { encoding: "utf8", timeout: 10_000 });
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.match(executed.stdout, /OK/);
});

test("gera script com Format-Volume nativo e fallback de diskpart e fat32format para unidades pequenas (<= 32 GB)", () => {
  const smallGuard = {
    expectedVolumeGuid: "\\\\?\\Volume{975884d1-9cfc-11f1-bba6-bcf171ac5412}\\",
    expectedVolumeBytes: 1_998_782_464, // ~1.86 GB
  };
  const script = buildGuardedWindowsFat32Script(
    "E",
    "C:\\dist\\tools\\fat32format.exe",
    "C:\\Temp\\fat32_small.log",
    smallGuard,
    "XBOX360USB",
  );
  assert.ok(script.includes("$partition.Size -le $limit32GB"));
  assert.ok(script.includes("Close-ExplorerWindows"));
  assert.ok(script.includes("Format-Volume -DriveLetter 'E' -FileSystem FAT32"));
  assert.ok(script.includes("Invoke-Fat32FormatTool"));
  assert.ok(script.includes("Invoke-DiskpartScript"));
  assert.ok(script.includes('format fs=fat32 quick label=""$targetLabel"""'));
  assert.ok(script.includes("$targetLabel = 'XBOX360USB'"));
});


