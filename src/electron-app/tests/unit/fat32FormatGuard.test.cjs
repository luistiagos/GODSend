const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildElevationScript,
  buildGuardedWindowsFat32Script,
  readFormattedPartitionBytes,
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
  assert.ok(script.includes("$targetBytes -le $limit32GB"));
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

test("adota liberacao orfa de execucao anterior para ela nao virar permanente", () => {
  const script = bigDriveScript();
  const unblock = script.slice(
    script.indexOf("function Unblock-Fat32RawWrite"),
    script.indexOf("function Restore-Fat32RawWriteProtection"),
  );
  // O flag "nos adicionamos" vive so no processo elevado. Se uma execucao morrer antes do
  // finally (queda de energia, processo morto), a entrada fica na lista; sem adotar, toda
  // execucao seguinte a veria como preexistente e o fat32format.exe ficaria liberado para
  // sempre na protecao contra ransomware do usuario.
  const alreadyBranch = unblock.slice(
    unblock.indexOf("if (Test-Fat32Allowlisted $fatExe) {"),
    unblock.indexOf("  try {"),
  );
  assert.ok(alreadyBranch.includes("sobra de execucao anterior"));
  assert.match(alreadyBranch, /\$script:cfaAllowlistAdded = \$true/);
  const restore = script.slice(
    script.indexOf("function Restore-Fat32RawWriteProtection"),
    script.indexOf("function Write-Fat32AccessDiagnostics"),
  );
  assert.ok(restore.includes("if (-not $script:cfaAllowlistAdded) { return }"));
});

test("Defender gerenciado por politica vira passo a passo manual com o caminho do exe", () => {
  const script = bigDriveScript();
  assert.ok(script.includes("$script:cfaManualAllowNeeded = $true"));
  assert.ok(script.includes("Permitir um aplicativo pelo acesso controlado a pastas e adicione: $exePath"));
  assert.ok(script.includes("$cfaHint"));
  // O estado do acesso controlado tem de aparecer no log de acesso negado.
  assert.ok(script.includes("Acesso controlado a pastas ATIVO (modo $cfaMode)"));
});

// ---- layout que o Xbox 360 le: MBR com particao unica (bug "Nao Formatado", T2) ----

function psFunction(script, name) {
  const start = script.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} existe no script`);
  return script.slice(start, script.indexOf("\n}\n", start) + 2);
}

function runPowerShellCode(code) {
  return spawnSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand",
    Buffer.from(code, "utf16le").toString("base64"),
  ], { encoding: "utf8", timeout: 20_000 });
}

function smallDriveScript() {
  return buildGuardedWindowsFat32Script(
    "E",
    "C:\\dist\\tools\\fat32format.exe",
    "C:\\Temp\\fat32_small.log",
    { expectedVolumeGuid: validGuard.expectedVolumeGuid, expectedVolumeBytes: 15_524_167_680 },
  );
}

test("so MBR com particao unica escapa da recriacao da tabela (funcoes executadas no PowerShell)", (t) => {
  if (process.platform !== "win32") {
    t.skip("execucao PowerShell disponivel somente no Windows");
    return;
  }
  const script = bigDriveScript();
  const executed = runPowerShellCode([
    psFunction(script, "Get-XboxLayoutProblem"),
    psFunction(script, "Get-Fat32MbrTypeProblem"),
    "$p = [pscustomobject]@{ MbrType = [uint16]12 }",
    "[ordered]@{",
    // Disco de dados GPT criado pelo Windows: MSR sem letra + particao de dados.
    "  gpt = Get-XboxLayoutProblem ([pscustomobject]@{ PartitionStyle = 'GPT' }) @([pscustomobject]@{}, $p)",
    "  mbrDuas = Get-XboxLayoutProblem ([pscustomobject]@{ PartitionStyle = 'MBR' }) @($p, $p)",
    "  mbrUma = Get-XboxLayoutProblem ([pscustomobject]@{ PartitionStyle = 'MBR' }) @($p)",
    "  raw = Get-XboxLayoutProblem ([pscustomobject]@{ PartitionStyle = 'RAW' }) @()",
    "  mbrVazio = Get-XboxLayoutProblem ([pscustomobject]@{ PartitionStyle = 'MBR' }) @()",
    "  mbrNulo = Get-XboxLayoutProblem ([pscustomobject]@{ PartitionStyle = 'MBR' }) $null",
    "  tipo12 = Get-Fat32MbrTypeProblem $p",
    "  tipo11 = Get-Fat32MbrTypeProblem ([pscustomobject]@{ MbrType = [uint16]11 })",
    "  tipo7 = Get-Fat32MbrTypeProblem ([pscustomobject]@{ MbrType = [uint16]7 })",
    "  tipoGpt = Get-Fat32MbrTypeProblem ([pscustomobject]@{ MbrType = $null })",
    "} | ConvertTo-Json -Compress",
  ].join("\n"));
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  const result = JSON.parse(executed.stdout.trim());
  assert.equal(result.gpt, "disco GPT, nao MBR");
  assert.equal(result.mbrDuas, "2 particoes no disco");
  assert.equal(result.mbrUma, "", "o caso comum continua formatando a particao existente");
  assert.equal(result.raw, "disco RAW, nao MBR");
  assert.equal(result.mbrVazio, "0 particoes no disco");
  // @($null).Count e 1 no PowerShell: sem o teste explicito, nenhuma particao passaria por uma.
  assert.equal(result.mbrNulo, "0 particoes no disco");
  assert.equal(result.tipo12, "");
  assert.equal(result.tipo11, "");
  assert.equal(result.tipo7, "particao com tipo 7, nao FAT32 (11 ou 12)");
  assert.equal(result.tipoGpt, "particao com tipo 0, nao FAT32 (11 ou 12)");
});

test("layout de chegada fora do padrao vai direto ao diskpart clean + convert mbr nos dois ramos", () => {
  for (const script of [smallDriveScript(), bigDriveScript()]) {
    // Conta todas as particoes do disco, inclusive as sem letra, antes de filtrar as montadas.
    assert.ok(script.includes("$arrivalPartitions = @(Get-Partition -DiskNumber $diskNo -ErrorAction Stop)"));
    assert.ok(script.includes("$mountedCount = @($arrivalPartitions | Where-Object { $_.DriveLetter }).Count"));
    assert.ok(script.includes("$needsNewTable = [bool]$arrivalProblem"));
    assert.ok(
      script.indexOf("$needsNewTable = [bool]$arrivalProblem") < script.indexOf("Unblock-Fat32RawWrite $exePath"),
      "a decisao vem antes de qualquer formatador",
    );
  }
  const script = smallDriveScript();
  // <= 32 GB: os tres formatadores da particao existente ficam atras do teste, o diskpart nao.
  const guard = script.indexOf("if (-not $needsNewTable) {");
  const inPlace = script.indexOf("Format-Volume -DriveLetter 'E' -FileSystem FAT32");
  const formatCom = script.indexOf("format.com direto falhou");
  const diskpart = script.indexOf("Tentando recriar particao primaria limpa (MBR) via diskpart...");
  assert.ok(guard > 0 && guard < inPlace && inPlace < formatCom && formatCom < diskpart);
  const dpBlock = script.slice(diskpart, script.indexOf("$dpOk = Invoke-DiskpartScript $dpCmds"));
  assert.ok(dpBlock.includes('"clean"') && dpBlock.includes('"convert mbr"'));
  // > 32 GB: a tabela e recriada sem sistema de arquivos antes do fat32format.
  const big = bigDriveScript();
  const recreate = big.indexOf("if ($needsNewTable -or -not $vol) {");
  assert.ok(recreate > 0);
  assert.ok(big.indexOf("$dpOk = Invoke-DiskpartScript $rawPartitionCmds", recreate) > recreate);
  assert.ok(
    big.indexOf("$success = Invoke-Fat32FormatTool 'D' $exePath", recreate) >
      big.indexOf("$dpOk = Invoke-DiskpartScript $rawPartitionCmds", recreate),
  );
});

test("com a tabela recriada o formatador e escolhido pelo tamanho que a particao vai ter", (t) => {
  const script = bigDriveScript();
  const line = script.split("\n").find((candidate) => candidate.trim().startsWith("$targetBytes = "));
  assert.ok(line, "o script calcula $targetBytes");
  assert.ok(script.includes("$mbrMaxBytes = [int64]2199023255552"));
  if (process.platform !== "win32") {
    t.skip("execucao PowerShell disponivel somente no Windows");
    return;
  }
  const executed = runPowerShellCode([
    "$limit32GB = [int64]34359738368",
    "$mbrMaxBytes = [int64]2199023255552",
    "function Pick($diskSize, $partSize, $needsNewTable) {",
    "  $disk = [pscustomobject]@{ Size = [uint64]$diskSize }",
    "  $partition = [pscustomobject]@{ Size = [uint64]$partSize }",
    line.trim(),
    "  if ($targetBytes -le $limit32GB) { 'ate32' } else { 'acima32' }",
    "}",
    "[ordered]@{",
    "  hdGptRecriado = Pick 4000787030016 4000650887168 $true",
    "  pendriveGptRecriado = Pick 15524167680 15507390464 $true",
    "  segundaParticaoRecriada = Pick 64021856256 8589934592 $true",
    "  segundaParticaoMantida = Pick 64021856256 8589934592 $false",
    "} | ConvertTo-Json -Compress",
  ].join("\n"));
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.deepEqual(JSON.parse(executed.stdout.trim()), {
    hdGptRecriado: "acima32",
    pendriveGptRecriado: "ate32",
    // Particao de 8 GB num disco de 64 GB: recriada, ela vira 64 GB, que o format fs=fat32 recusa.
    segundaParticaoRecriada: "acima32",
    segundaParticaoMantida: "ate32",
  });
});

test("depois de formatar o script confere MBR, particao unica e tipo FAT32 antes de declarar sucesso", () => {
  const script = bigDriveScript();
  const order = [
    "$verifyVol = Get-Volume -DriveLetter 'D'",
    "Update-Disk -Number $diskNo -ErrorAction SilentlyContinue",
    "$finalPartitions = @(Get-Partition -DiskNumber $diskNo -ErrorAction Stop)",
    "$finalProblem = Get-XboxLayoutProblem $finalDisk $finalPartitions",
    'throw "A formatacao terminou, mas o Xbox 360 nao vai ler o disco: $finalProblem."',
    "Set-Partition -DiskNumber $diskNo -PartitionNumber $finalPartition.PartitionNumber -MbrType 12 -ErrorAction Stop",
    'throw "A formatacao terminou, mas o Xbox 360 nao vai ler o disco: $typeProblem."',
    '"Particao final: $([int64]$finalPartition.Size) bytes"',
    "Formatação FAT32 concluída com sucesso.",
  ].map((needle) => {
    const at = script.indexOf(needle);
    assert.ok(at > 0, `o script contem: ${needle}`);
    return at;
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "conferencia na ordem certa");
  // Dentro do try principal: a reprovacao sai por exit 1 e o finally devolve o Defender.
  assert.ok(order[order.length - 1] < script.lastIndexOf("\n} catch {"));
});

test("o tamanho final da particao chega ao app pela linha do log", (t) => {
  const log = [
    "=== fat32format D: ===",
    "Layout final: MBR, 1 particao, tipo 12.",
    "Particao final: 2199022206976 bytes",
    "Formatação FAT32 concluída com sucesso.",
  ].join("\r\n");
  assert.equal(readFormattedPartitionBytes(log), 2_199_022_206_976);
  assert.equal(readFormattedPartitionBytes("\uFEFFParticao final: 31457280000 bytes\r\n"), 31_457_280_000);
  assert.equal(readFormattedPartitionBytes("Particao final: 1 bytes\nParticao final: 2 bytes"), 2, "vale a ultima");
  assert.equal(readFormattedPartitionBytes("Formatação FAT32 concluída com sucesso."), undefined);
  assert.equal(readFormattedPartitionBytes("Particao final: 0 bytes"), undefined);
  assert.equal(readFormattedPartitionBytes(""), undefined);

  if (process.platform !== "win32") {
    t.skip("Out-File do PowerShell disponivel somente no Windows");
    return;
  }
  // Gravado como o script elevado grava: Out-File -Encoding utf8 (com BOM) e depois -Append.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fat32-log-"));
  const logPath = path.join(dir, "fat32.log");
  try {
    const escaped = logPath.replace(/'/g, "''");
    const written = runPowerShellCode([
      `$log = '${escaped}'`,
      "'=== fat32format D: ===' | Out-File -FilePath $log -Encoding utf8",
      '"Particao final: $([int64]15524167680) bytes" | Out-File -FilePath $log -Append -Encoding utf8',
      '"Formatação FAT32 concluída com sucesso." | Out-File -FilePath $log -Append -Encoding utf8',
    ].join("\n"));
    assert.equal(written.status, 0, written.stderr || written.stdout);
    assert.equal(readFormattedPartitionBytes(fs.readFileSync(logPath, "utf8")), 15_524_167_680);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
