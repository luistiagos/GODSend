const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const {
  buildElevationScript,
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

test("script de elevacao cita o interpretador ja resolvido e escapa aspas simples", (t) => {
  const script = buildElevationScript(
    "C:\\Temp\\It's Here\\fat32.ps1",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  // O caminho resolvido pelo processo pai entra literal: o Start-Process aninhado
  // nao pode repetir a busca no %PATH% e acabar noutro PowerShell.
  assert.ok(script.includes("Start-Process 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'"));
  // Aspas simples no caminho do .ps1 viram '' — senao o script quebra ou muda de alvo.
  assert.ok(script.includes("It''s Here"));

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



const bigDriveGuard = {
  expectedVolumeGuid: "\\\\?\\Volume{3dbb510f-622c-11f0-9508-bcf171ac5412}\\",
  expectedVolumeBytes: 2_199_022_206_976, // 2 TiB, o HD do relato de acesso negado
};

function bigDriveScript() {
  return buildGuardedWindowsFat32Script(
    "D",
    "C:\\dist\\tools\\fat32format.exe",
    "C:\\Temp\\fat32_big.log",
    bigDriveGuard,
  );
}

test("a particao entregue ao fat32format nao tem sistema de arquivos montado (> 32 GB)", () => {
  const script = bigDriveScript();
  const rawCmds = script.slice(
    script.indexOf("$rawPartitionCmds"),
    script.indexOf("$vol = Get-Volume"),
  );
  assert.ok(rawCmds.includes("create partition primary"));
  assert.ok(rawCmds.includes("convert mbr"), "o Xbox 360 le FAT32 em MBR");
  assert.ok(rawCmds.includes("assign letter=D"));
  // O fat32format escreve setores direto em \\.\D:; com NTFS montado o Windows
  // recusa a escrita com GetLastError()=5 e nenhuma repeticao resolve.
  assert.ok(
    !/format fs=ntfs/.test(rawCmds),
    "pre-formatar NTFS antes do fat32format reintroduz o acesso negado",
  );
});

test("acesso negado para de repetir, diagnostica e nao culpa o Explorer", () => {
  const script = bigDriveScript();
  assert.ok(script.includes("GetLastError\\(\\)=5:"));
  assert.ok(script.includes("Write-Fat32AccessDiagnostics"));
  assert.ok(script.includes("Deny_Write"), "o log precisa dizer se a politica bloqueia escrita");
  assert.ok(script.includes("negou a escrita direta na unidade D:"));
  // A saida nativa passa por [string] para nao virar o bloco NativeCommandError.
  assert.ok(script.includes("ForEach-Object { [string]$_ }"));
});

test("falha na formatacao devolve a particao a NTFS em vez de deixar o HD em RAW", () => {
  const script = bigDriveScript();
  assert.ok(script.includes("select partition 1"));
  assert.ok(script.includes("devolvendo a particao a NTFS"));
});


test("libera o fat32format no acesso controlado a pastas e desfaz a liberacao no fim", () => {
  const script = bigDriveScript();
  // O print do usuario e o bloqueio do Defender: "Alteracoes nao autorizadas bloqueadas ...
  // de fazer alteracoes na memoria". Sem a liberacao, a escrita bruta volta GetLastError()=5.
  assert.ok(script.includes("Add-MpPreference -ControlledFolderAccessAllowedApplications $fatExe"));
  assert.ok(script.includes("Remove-MpPreference -ControlledFolderAccessAllowedApplications $fatExe"));
  assert.ok(script.includes("Unblock-Fat32RawWrite $exePath"));
  // A restauracao fica no finally porque o catch faz 'exit 1': sem isso, uma formatacao
  // que falha deixaria o exe permanentemente liberado na maquina do usuario.
  const tail = script.slice(script.indexOf("} catch {"));
  assert.match(tail, /\} finally \{[\s\S]*Restore-Fat32RawWriteProtection \$exePath/);
});

test("nao desliga o acesso controlado a pastas nem mexe fora dos modos que bloqueiam", () => {
  const script = bigDriveScript();
  // Desligar a protecao inteira seria desproporcional; so o nosso exe e liberado.
  assert.ok(!/Set-MpPreference/.test(script), "a protecao nunca e desligada globalmente");
  // Modos 2 e 4 sao auditoria e deixam a escrita passar; 0 esta desligado.
  assert.ok(script.includes("if ($mode -ne 1 -and $mode -ne 3) { return }"));
});

test("nao retira do Defender uma liberacao que ja existia antes", () => {
  const script = bigDriveScript();
  const restore = script.slice(
    script.indexOf("function Restore-Fat32RawWriteProtection"),
    script.indexOf("function Write-Fat32AccessDiagnostics"),
  );
  assert.ok(restore.includes("if (-not $script:cfaAllowlistAdded) { return }"));
  const unblock = script.slice(
    script.indexOf("function Unblock-Fat32RawWrite"),
    script.indexOf("function Restore-Fat32RawWriteProtection"),
  );
  assert.ok(unblock.includes("if (Test-Fat32Allowlisted $fatExe) {"));
  assert.ok(unblock.includes("ja constava na lista de aplicativos permitidos"));
});

test("Defender gerenciado por politica vira passo a passo manual com o caminho do exe", () => {
  const script = bigDriveScript();
  assert.ok(script.includes("$script:cfaManualAllowNeeded = $true"));
  assert.ok(script.includes("Permitir um aplicativo pelo acesso controlado a pastas e adicione: $exePath"));
  assert.ok(script.includes("$cfaHint"));
  // O estado do acesso controlado tem de aparecer no log de acesso negado.
  assert.ok(script.includes("Acesso controlado a pastas ATIVO (modo $cfaMode)"));
});
