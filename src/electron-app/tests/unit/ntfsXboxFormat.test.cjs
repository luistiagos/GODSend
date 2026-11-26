const test = require("node:test");
const assert = require("node:assert/strict");

const {
  XBOX_ONE_SERIES_NTFS_SIDS,
  buildGuardedWindowsNtfsXeniaScript,
  readNtfsFinalDriveLetter,
  readNtfsFinalPartitionBytes,
  readNtfsFinalPartitionStyle,
  validateUnassignedDiskGuard,
} = require("../../infrastructure/ntfsXboxFormat.js");
const {
  buildNtfsAclAuditScript,
  evaluateNtfsAclAudits,
  parseNtfsAclAuditJson,
} = require("../../infrastructure/ntfsAclVerifier.js");

const VALID_VOLUME_GUARD = {
  expectedVolumeGuid: "\\\\?\\Volume{12345678-1234-1234-1234-1234567890ab}\\",
  expectedVolumeBytes: 64 * 1024 ** 3,
};

test("script elevado usa apenas SIDs numericos universais (sem nomes localizados de grupo)", () => {
  const script = buildGuardedWindowsNtfsXeniaScript({
    target: { kind: "volume", driveLetter: "E", guard: VALID_VOLUME_GUARD },
    formatDrive: true,
    label: "XENIA_USB",
    logPath: "C:\\Temp\\xenia.log",
  });

  // Todos os SIDs obrigatorios presentes
  assert.ok(script.includes(XBOX_ONE_SERIES_NTFS_SIDS.ALL_APPLICATION_PACKAGES));
  assert.ok(script.includes(XBOX_ONE_SERIES_NTFS_SIDS.ALL_RESTRICTED_APPLICATION_PACKAGES));
  assert.ok(script.includes(XBOX_ONE_SERIES_NTFS_SIDS.EVERYONE));
  assert.ok(script.includes(XBOX_ONE_SERIES_NTFS_SIDS.ADMINISTRATORS));
  assert.ok(script.includes(XBOX_ONE_SERIES_NTFS_SIDS.SYSTEM));

  // Nunca usar nomes textuais localizados em comandos icacls (falham em Windows PT-BR)
  assert.equal(script.includes("ALL APPLICATION PACKAGES"), false);
  assert.doesNotMatch(script, /\/grant[^;\r\n]*(?:ALL APPLICATION PACKAGES|\bEveryone\b|\bTodos\b)/i);

  // Valida sintaxe PowerShell real do script gerado (sem executa-lo)
  if (process.platform === "win32") {
    const { execFileSync } = require("node:child_process");
    const { powerShellExe } = require("../../infrastructure/windowsSystemExecutables.js");
    const check = execFileSync(
      powerShellExe(),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$code = [Console]::In.ReadToEnd(); $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseInput($code, [ref]$null, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { $_.Message }; exit 1 }",
      ],
      { input: script, encoding: "utf8" },
    );
    assert.equal(check.trim(), "");
  }

  // Guardas de seguranca obrigatorias contra disco 0, interno, boot/system
  assert.match(script, /\$diskNo -eq 0 -or \$disk\.BusType -ne 'USB' -or \$disk\.IsBoot -or \$disk\.IsSystem/);
  assert.match(script, /Normalize-VolumeGuid \$currentVolumeGuid/);

  // Escolha automatica MBR (<= 2 TiB) vs GPT (> 2 TiB)
  assert.match(script, /\$wantStyle = if \(\[double\]\$disk\.Size -gt \[double\]\$mbrMaxBytes\) \{ 'gpt' \} else \{ 'mbr' \}/);
  assert.match(script, /convert \$wantStyle/);
  assert.match(script, /format fs=ntfs quick/);

  // Remove regras Deny e pula pastas protegidas do Windows
  assert.match(script, /\/remove:d/);
  assert.match(script, /system volume information/);
  assert.match(script, /\$recycle\.bin/);
});

test("modo sem formatar exige NTFS existente e usa takeown para arquivos orfaos", () => {
  const script = buildGuardedWindowsNtfsXeniaScript({
    target: { kind: "volume", driveLetter: "F", guard: VALID_VOLUME_GUARD },
    formatDrive: false,
    logPath: "C:\\Temp\\xenia-perms.log",
  });

  assert.match(script, /\$doFormat = \$false/);
  assert.match(script, /takeown\.exe/);
  assert.match(script, /icacls\.exe/);
  assert.match(script, /\/inheritance:e/);
});

test("disco USB sem letra (formato XboxFS / RAW) exige formatDrive=true e valida diskNumber > 0", () => {
  assert.throws(
    () =>
      buildGuardedWindowsNtfsXeniaScript({
        target: {
          kind: "unassigned-disk",
          guard: { diskNumber: 2, expectedDiskBytes: 1000 * 1024 ** 3, expectedDiskUniqueId: "UID-1" },
        },
        formatDrive: false,
        logPath: "C:\\Temp\\x.log",
      }),
    /precisa ser formatado/,
  );

  assert.throws(
    () => validateUnassignedDiskGuard({ diskNumber: 0, expectedDiskBytes: 500 * 1024 ** 3, expectedDiskUniqueId: "UID-0" }),
    /disco físico 0/i,
  );
  assert.throws(
    () => validateUnassignedDiskGuard({ diskNumber: 2, expectedDiskBytes: 500 * 1024 ** 3 }),
    /identificador único/i,
  );

  const script = buildGuardedWindowsNtfsXeniaScript({
    target: {
      kind: "unassigned-disk",
      guard: { diskNumber: 2, expectedDiskBytes: 4 * 1024 ** 4, expectedDiskUniqueId: "USB-4TB-UID" },
    },
    formatDrive: true,
    logPath: "C:\\Temp\\xenia-recovery.log",
  });
  assert.match(script, /\$diskNo = \[int\]2/);
  assert.match(script, /USB-4TB-UID/);
  assert.match(script, /online disk noerr/);
  assert.match(script, /attributes disk clear readonly noerr/);
});

test("parsers de log extraem letra final, estilo MBR/GPT e tamanho da particao", () => {
  const sampleLog = [
    "\uFEFF=== xenia-ntfs disk #2 ===",
    "Letra final: G:",
    "Estilo final: GPT",
    "Particao final: 4000785000448 bytes",
  ].join("\r\n");

  assert.equal(readNtfsFinalDriveLetter(sampleLog), "G");
  assert.equal(readNtfsFinalPartitionStyle(sampleLog), "GPT");
  assert.equal(readNtfsFinalPartitionBytes(sampleLog), 4000785000448);
});

test("auditoria de ACL reprova Deny, heranca bloqueada, S-1-15-2-1 ausente ou probe sem heranca", () => {
  const auditScript = buildNtfsAclAuditScript(["E:\\", "E:\\Games"]);
  assert.match(auditScript, /S-1-15-2-1/);
  assert.match(auditScript, /SecurityIdentifier/);
  // Zero Add-Type / csc.exe
  assert.equal(auditScript.includes("Add-Type"), false);

  const baseOk = [
    { path: "E:\\", exists: true, isDirectory: true, inheritanceProtected: true, hasAllAppPackages: true, hasRestrictedPackages: true, hasEveryone: true, hasDenyRule: false },
    { path: "E:\\Games", exists: true, isDirectory: true, inheritanceProtected: false, hasAllAppPackages: true, hasRestrictedPackages: true, hasEveryone: true, hasDenyRule: false },
    { path: "E:\\Content\\0000000000000000", exists: true, isDirectory: true, inheritanceProtected: false, hasAllAppPackages: true, hasRestrictedPackages: true, hasEveryone: true, hasDenyRule: false },
    { path: "E:\\Games\\probe.tmp", exists: true, isDirectory: false, inheritanceProtected: false, hasAllAppPackages: true, hasRestrictedPackages: true, hasEveryone: true, hasDenyRule: false },
  ];

  const pass = evaluateNtfsAclAudits(baseOk, "E:\\Games\\probe.tmp");
  assert.equal(pass.verified, true);
  assert.equal(pass.probeInherited, true);
  assert.deepEqual(pass.reasons, []);

  // Regra Deny bloqueia mesmo com Allow presente
  const withDeny = baseOk.map((a, i) => (i === 1 ? { ...a, hasDenyRule: true } : a));
  assert.equal(evaluateNtfsAclAudits(withDeny, "E:\\Games\\probe.tmp").verified, false);

  // Heranca bloqueada na subpasta Games reprova
  const brokenInherit = baseOk.map((a, i) => (i === 1 ? { ...a, inheritanceProtected: true } : a));
  assert.equal(evaluateNtfsAclAudits(brokenInherit, "E:\\Games\\probe.tmp").verified, false);

  // Arquivo probe nao herdou S-1-15-2-1 reprova
  const brokenProbe = baseOk.map((a, i) => (i === 3 ? { ...a, hasAllAppPackages: false } : a));
  const resBrokenProbe = evaluateNtfsAclAudits(brokenProbe, "E:\\Games\\probe.tmp");
  assert.equal(resBrokenProbe.verified, false);
  assert.equal(resBrokenProbe.probeInherited, false);

  // Parser JSON lida tanto com objeto unico quanto array
  assert.equal(parseNtfsAclAuditJson(JSON.stringify(baseOk[0])).length, 1);
  assert.equal(parseNtfsAclAuditJson(JSON.stringify(baseOk)).length, 4);
});
