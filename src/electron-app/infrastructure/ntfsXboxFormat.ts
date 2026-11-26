/**
 * Motor elevado de formatação NTFS e aplicação de permissões (ACLs) para
 * Xbox One e Xbox Series X|S (Modo Desenvolvedor / Xenia Canary UWP).
 *
 * Substitui integralmente o XboxMediaUSB resolvendo suas causas conhecidas de falha:
 * - Usa EXCLUSIVAMENTE SIDs numéricos universais (`*S-1-15-2-1`, `*S-1-15-2-2`, `*S-1-1-0`,
 *   `*S-1-5-32-544`, `*S-1-5-18`) — imune ao idioma do Windows (PT-BR, EN etc.).
 * - Remove regras `Deny` conflitantes e reabilita herança (`/inheritance:e`).
 * - Aplica `takeown` + `icacls` apenas nas pastas/arquivos de usuário na raiz (pulando
 *   `System Volume Information`, `$RECYCLE.BIN`, `Config.Msi` e `Recovery`), evitando falsos
 *   erros de "Acesso negado" em pastas protegidas do Windows.
 * - Recria tabela de partições limpa: MBR para discos <= 2 TiB e GPT para discos > 2 TiB
 *   (aproveitando HDs de 3 TB / 4 TB / 8 TB inteiros no Xbox One / Series).
 * - Recupera também discos USB sem letra / RAW / formatados pelo Xbox em modo "Jogos e Apps"
 *   (XboxFS), devolvendo uma letra montada e pronta para uso.
 * - Respeita todas as guardas de segurança contra disco 0, disco interno e volume do Windows,
 *   executando binários resolvidos de System32 (`windowsSystemExecutables.ts`).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import {
  readLogTail,
  runPs1Elevated,
  validateWindowsFormatGuard,
  writePowerShellScript,
  type WindowsFormatGuard,
} from "./fat32Format";
import { powerShellExe } from "./windowsSystemExecutables";
import { XBOX_ONE_SERIES_MBR_MAX_BYTES } from "./xboxOneSeriesDiskLayoutPolicy";

export const XBOX_ONE_SERIES_NTFS_SIDS = {
  ALL_APPLICATION_PACKAGES: "*S-1-15-2-1",
  ALL_RESTRICTED_APPLICATION_PACKAGES: "*S-1-15-2-2",
  EVERYONE: "*S-1-1-0",
  ADMINISTRATORS: "*S-1-5-32-544",
  SYSTEM: "*S-1-5-18",
} as const;

export interface UnassignedDiskFormatGuard {
  diskNumber: number;
  expectedDiskBytes: number;
  expectedDiskUniqueId?: string;
  expectedSerialNumber?: string;
}

export type NtfsXeniaTarget =
  | {
      kind: "volume";
      driveLetter: string;
      guard: WindowsFormatGuard;
    }
  | {
      kind: "unassigned-disk";
      guard: UnassignedDiskFormatGuard;
    };

export interface NtfsXeniaScriptOptions {
  target: NtfsXeniaTarget;
  formatDrive: boolean;
  label?: string;
  logPath: string;
}

export interface NtfsXeniaExecutionResult {
  driveRoot: string;
  partitionBytes?: number;
  partitionStyle?: string;
  logTail: string;
}

function sanitizeLabel(label?: string): string {
  const cleaned = String(label || "XENIA_USB")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim()
    .slice(0, 32);
  return cleaned || "XENIA_USB";
}

function normalizeDriveLetter(input: string): string {
  const m = String(input || "").trim().match(/^([A-Za-z]):?/);
  if (!m) throw new Error(`Letra de unidade Windows inválida: ${input}`);
  return m[1].toUpperCase();
}

export function validateUnassignedDiskGuard(
  guard?: UnassignedDiskFormatGuard,
): UnassignedDiskFormatGuard {
  const diskNumber = Number(guard?.diskNumber);
  const expectedDiskBytes = Number(guard?.expectedDiskBytes || 0);
  const expectedDiskUniqueId = String(guard?.expectedDiskUniqueId || "").trim();
  const expectedSerialNumber = String(guard?.expectedSerialNumber || "").trim();

  if (!Number.isInteger(diskNumber) || diskNumber <= 0) {
    throw new Error("O disco físico 0 ou inválido nunca pode ser formatado.");
  }
  if (!Number.isSafeInteger(expectedDiskBytes) || expectedDiskBytes < 1024 ** 3) {
    throw new Error("A capacidade esperada do disco USB é inválida; a formatação foi bloqueada.");
  }
  if (!expectedDiskUniqueId && !expectedSerialNumber) {
    throw new Error("O disco USB sem letra não possui identificador único nem número de série para validação segura.");
  }
  return {
    diskNumber,
    expectedDiskBytes,
    expectedDiskUniqueId,
    expectedSerialNumber,
  };
}

export function readNtfsFinalDriveLetter(log: string): string | undefined {
  const matches = [...String(log || "").matchAll(/^\uFEFF?Letra final: ([A-Za-z]):\s*$/gm)];
  return matches.length > 0 ? matches[matches.length - 1][1].toUpperCase() : undefined;
}

export function readNtfsFinalPartitionBytes(log: string): number | undefined {
  const matches = [...String(log || "").matchAll(/^\uFEFF?Particao final: (\d+) bytes\s*$/gm)];
  const bytes = matches.length > 0 ? Number(matches[matches.length - 1][1]) : NaN;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
}

export function readNtfsFinalPartitionStyle(log: string): string | undefined {
  const matches = [...String(log || "").matchAll(/^\uFEFF?Estilo final: (MBR|GPT)\s*$/gim)];
  return matches.length > 0 ? matches[matches.length - 1][1].toUpperCase() : undefined;
}

/**
 * Constrói o script PowerShell elevado de preparo NTFS + ACLs para Xbox One / Series (Xenia).
 * Exportado puro para testes unitários auditarem guardas de segurança, SIDs e MBR/GPT.
 */
export function buildGuardedWindowsNtfsXeniaScript(options: NtfsXeniaScriptOptions): string {
  const formatDrive = options.formatDrive === true;
  const targetLabel = sanitizeLabel(options.label);
  const escapedLog = options.logPath.replace(/'/g, "''");
  const escapedLabel = targetLabel.replace(/'/g, "''");

  if (options.target.kind === "unassigned-disk" && !formatDrive) {
    throw new Error("Um disco USB sem letra ou no formato Xbox precisa ser formatado em NTFS para ser preparado.");
  }

  let validationBlock = "";
  let headerTitle = "";

  if (options.target.kind === "volume") {
    const letter = normalizeDriveLetter(options.target.driveLetter);
    const { expectedVolumeGuid, expectedVolumeBytes } = validateWindowsFormatGuard(options.target.guard);
    const escapedGuid = expectedVolumeGuid.replace(/'/g, "''");
    headerTitle = `=== xenia-ntfs ${letter}: (format=${formatDrive}) ===`;
    validationBlock = String.raw`
  $targetLetter = '${letter}'
  $expectedVolumeGuid = '${escapedGuid}'
  $expectedVolumeBytes = [int64]${expectedVolumeBytes}
  Close-ExplorerWindows $targetLetter
  $mountvol = Join-Path $env:SystemRoot 'System32\mountvol.exe'
  $currentVolumeGuid = ((& $mountvol "$($targetLetter):\" '/L' 2>$null) -join '').Trim()
  if ((Normalize-VolumeGuid $currentVolumeGuid) -ne (Normalize-VolumeGuid $expectedVolumeGuid)) {
    throw "A unidade $($targetLetter): mudou antes do preparo. Esperado: $expectedVolumeGuid; atual: $currentVolumeGuid"
  }
  $partition = Get-Partition -DriveLetter $targetLetter -ErrorAction Stop
  $diskNo = [int]$partition.DiskNumber
  $disk = Get-Disk -Number $diskNo -ErrorAction Stop
  $arrivalPartitions = @(Get-Partition -DiskNumber $diskNo -ErrorAction Stop)
  $mountedCount = @($arrivalPartitions | Where-Object { $_.DriveLetter }).Count
  if ($diskNo -eq 0 -or $disk.BusType -ne 'USB' -or $disk.IsBoot -or $disk.IsSystem) {
    throw "O destino não é um disco USB externo seguro (disco=$diskNo, barramento=$($disk.BusType))."
  }
  if ($disk.IsOffline -or $disk.IsReadOnly -or $mountedCount -ne 1) {
    throw "O disco USB está offline, somente leitura ou possui mais de uma partição montada."
  }
  $tolerance = [Math]::Max([double]16777216, [Math]::Floor([double]$expectedVolumeBytes * 0.01))
  if ([Math]::Abs([double]$partition.Size - [double]$expectedVolumeBytes) -gt $tolerance) {
    throw "A capacidade da partição mudou antes da operação."
  }
  "Volume GUID validado: $currentVolumeGuid" | Out-File -FilePath $log -Append -Encoding utf8
  "Disco USB validado: $diskNo ($($disk.FriendlyName), $($disk.Size) bytes)" | Out-File -FilePath $log -Append -Encoding utf8
`;
  } else {
    const guard = validateUnassignedDiskGuard(options.target.guard);
    const escapedUid = (guard.expectedDiskUniqueId || "").replace(/'/g, "''");
    const escapedSerial = (guard.expectedSerialNumber || "").replace(/'/g, "''");
    headerTitle = `=== xenia-ntfs disk #${guard.diskNumber} (unassigned-recovery) ===`;
    validationBlock = String.raw`
  $targetLetter = ''
  $diskNo = [int]${guard.diskNumber}
  $expectedDiskBytes = [int64]${guard.expectedDiskBytes}
  $expectedUid = '${escapedUid}'
  $expectedSerial = '${escapedSerial}'
  $disk = Get-Disk -Number $diskNo -ErrorAction Stop
  if ($diskNo -eq 0 -or $disk.BusType -ne 'USB' -or $disk.IsBoot -or $disk.IsSystem) {
    throw "O destino não é um disco USB externo seguro (disco=$diskNo, barramento=$($disk.BusType))."
  }
  $actualUid = ([string]$disk.UniqueId).Trim()
  $actualSerial = ([string]$disk.SerialNumber).Trim()
  $uidMatch = ($expectedUid -and ($actualUid.ToLowerInvariant() -eq $expectedUid.ToLowerInvariant()))
  $serialMatch = ($expectedSerial -and ($actualSerial.ToLowerInvariant() -eq $expectedSerial.ToLowerInvariant()))
  if (-not ($uidMatch -or $serialMatch)) {
    throw "A identidade do disco USB #$diskNo mudou antes da formatação."
  }
  $tolerance = [Math]::Max([double]16777216, [Math]::Floor([double]$expectedDiskBytes * 0.01))
  if ([Math]::Abs([double]$disk.Size - [double]$expectedDiskBytes) -gt $tolerance) {
    throw "A capacidade do disco USB #$diskNo mudou antes da formatação."
  }
  $existingMounted = @(Get-Partition -DiskNumber $diskNo -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter })
  if ($existingMounted.Count -gt 0) {
    throw "O disco USB #$diskNo já possui letra montada; atualize a lista e selecione-o pela letra."
  }
  "Disco USB sem letra validado: $diskNo ($($disk.FriendlyName), $($disk.Size) bytes)" | Out-File -FilePath $log -Append -Encoding utf8
`;
  }

  return String.raw`$ErrorActionPreference = 'Stop'
$log = '${escapedLog}'
$targetLabel = '${escapedLabel}'
$doFormat = $${formatDrive ? "true" : "false"}
$mbrMaxBytes = [int64]${XBOX_ONE_SERIES_MBR_MAX_BYTES}
'${headerTitle}' | Out-File -FilePath $log -Encoding utf8

function Normalize-VolumeGuid([string]$value) {
  if (-not $value) { return '' }
  return $value.Trim().TrimEnd('\').ToLowerInvariant()
}

function Close-ExplorerWindows([string]$drvLetter) {
  if (-not $drvLetter) { return }
  try {
    $pfx = $drvLetter + ':'
    $enc = $drvLetter + '%3A'
    $shell = New-Object -ComObject Shell.Application
    foreach ($win in $shell.Windows()) {
      $loc = [string]$win.LocationURL
      $name = [string]$win.LocationName
      if ($loc -like "*$pfx*" -or $loc -like "*$enc*" -or $name -like "$pfx*") {
        $win.Quit()
      }
    }
  } catch {}
}

function Invoke-DiskpartScript([string[]]$commands) {
  $dpScript = [System.IO.Path]::GetTempFileName()
  try {
    $commands | Out-File -FilePath $dpScript -Encoding ascii
    $dpExe = Join-Path $env:SystemRoot 'System32\diskpart.exe'
    $dpOut = & $dpExe /s $dpScript 2>&1
    $dpCode = $LASTEXITCODE
    ($dpOut | Out-String).Trim() | Out-File -FilePath $log -Append -Encoding utf8
    return ($dpCode -eq 0)
  } finally {
    Remove-Item -Path $dpScript -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-SystemTool([string]$exeName, [string[]]$toolArgs) {
  $exe = Join-Path $env:SystemRoot ("System32\" + $exeName)
  $out = & $exe @toolArgs 2>&1 | ForEach-Object { [string]$_ }
  $ec = $LASTEXITCODE
  $outStr = ($out -join [Environment]::NewLine).Trim()
  if ($outStr) {
    $outStr | Out-File -FilePath $log -Append -Encoding utf8
  }
  return $ec
}

try {
${validationBlock}

  if ($doFormat) {
    $wantStyle = if ([double]$disk.Size -gt [double]$mbrMaxBytes) { 'gpt' } else { 'mbr' }
    "Formatando disco USB #$diskNo em NTFS (tabela $($wantStyle.ToUpperInvariant()), particao unica)..." | Out-File -FilePath $log -Append -Encoding utf8
    $dpCommands = @(
      "select disk $diskNo",
      "online disk noerr",
      "attributes disk clear readonly noerr",
      "clean",
      "convert $wantStyle",
      "create partition primary",
      "format fs=ntfs quick label=""$targetLabel"""
    )
    if ($targetLetter) {
      $dpCommands += "assign letter=$targetLetter"
    } else {
      $dpCommands += "assign"
    }

    $formattedOk = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      if ($targetLetter) { Close-ExplorerWindows $targetLetter }
      Start-Sleep -Milliseconds (350 * $attempt)
      if (Invoke-DiskpartScript $dpCommands) {
        $formattedOk = $true
        break
      }
      "diskpart tentativa $attempt falhou; aguardando liberacao do dispositivo..." | Out-File -FilePath $log -Append -Encoding utf8
    }
    if (-not $formattedOk) {
      throw "Não foi possível formatar o dispositivo em NTFS. Feche o Explorador de Arquivos ou outros programas usando o USB e tente novamente."
    }

    Update-Disk -Number $diskNo -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 1200

    # Descobre a letra final da partição de dados recém-criada
    $dataPart = @(Get-Partition -DiskNumber $diskNo -ErrorAction Stop | Where-Object { $_.DriveLetter }) | Select-Object -First 1
    if ($null -eq $dataPart -and $targetLetter) {
      $dataPart = Get-Partition -DriveLetter $targetLetter -ErrorAction SilentlyContinue
    }
    if ($null -eq $dataPart) {
      # Se o Windows não atribuiu letra ainda, força assign via diskpart
      $firstPart = @(Get-Partition -DiskNumber $diskNo -ErrorAction Stop | Where-Object { $_.Type -ne 'Reserved' }) | Select-Object -First 1
      if ($null -ne $firstPart) {
        Invoke-DiskpartScript @("select disk $diskNo", "select partition $($firstPart.PartitionNumber)", "assign") | Out-Null
        Start-Sleep -Milliseconds 1000
        $dataPart = @(Get-Partition -DiskNumber $diskNo -ErrorAction Stop | Where-Object { $_.DriveLetter }) | Select-Object -First 1
      }
    }
    if ($null -eq $dataPart -or -not $dataPart.DriveLetter) {
      throw "A formatação NTFS concluiu, mas o Windows não atribuiu uma letra ao dispositivo."
    }
    $targetLetter = [string]$dataPart.DriveLetter
    Close-ExplorerWindows $targetLetter
  } else {
    $curVol = Get-Volume -DriveLetter $targetLetter -ErrorAction Stop
    if (([string]$curVol.FileSystem).ToUpperInvariant() -ne 'NTFS') {
      throw "O dispositivo em $($targetLetter): está em $($curVol.FileSystem), e não em NTFS. Marque 'Formatar e preparar do zero' para convertê-lo para NTFS."
    }
    "Modo somente permissoes: preservando arquivos existentes em $($targetLetter): (NTFS)." | Out-File -FilePath $log -Append -Encoding utf8
  }

  $rootPath = "$($targetLetter):\"
  if (-not (Test-Path -LiteralPath $rootPath)) {
    throw "A unidade $rootPath não está acessível após o preparo."
  }

  # Cria apenas as pastas limpas do Xenia (decisão D1/G1) + pasta interna do app
  $gamesDir = Join-Path $rootPath 'Games'
  $contentDir = Join-Path $rootPath 'Content\0000000000000000'
  $metaDir = Join-Path $rootPath '.xbox-downloader'
  foreach ($d in @($gamesDir, $contentDir, $metaDir)) {
    if (-not (Test-Path -LiteralPath $d)) {
      New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
  }

  # Permissões NTFS via SIDs numéricos universais (imune ao idioma do Windows)
  $sidAllApp = '${XBOX_ONE_SERIES_NTFS_SIDS.ALL_APPLICATION_PACKAGES}'
  $sidRestricted = '${XBOX_ONE_SERIES_NTFS_SIDS.ALL_RESTRICTED_APPLICATION_PACKAGES}'
  $sidEveryone = '${XBOX_ONE_SERIES_NTFS_SIDS.EVERYONE}'
  $sidAdmins = '${XBOX_ONE_SERIES_NTFS_SIDS.ADMINISTRATORS}'
  $sidSystem = '${XBOX_ONE_SERIES_NTFS_SIDS.SYSTEM}'

  "Aplicando permissoes NTFS (SIDs universais) na raiz $rootPath..." | Out-File -FilePath $log -Append -Encoding utf8
  $rcRootDeny = Invoke-SystemTool 'icacls.exe' @($rootPath, '/remove:d', $sidAllApp, $sidRestricted, $sidEveryone, '/C')
  $rcRootGrant = Invoke-SystemTool 'icacls.exe' @(
    $rootPath,
    '/inheritance:e',
    '/grant:r', "$($sidAllApp):(OI)(CI)F",
    '/grant:r', "$($sidRestricted):(OI)(CI)F",
    '/grant:r', "$($sidEveryone):(OI)(CI)F",
    '/grant:r', "$($sidAdmins):(OI)(CI)F",
    '/grant:r', "$($sidSystem):(OI)(CI)F",
    '/C'
  )
  if ($rcRootGrant -ne 0) {
    throw "Falha ao aplicar permissões NTFS na raiz $rootPath (icacls codigo $rcRootGrant)."
  }

  # Aplica recursivamente em todas as pastas e arquivos de usuário na raiz (decisão G5),
  # pulando pastas protegidas do sistema Windows para nunca gerar falso erro de Acesso Negado.
  $skipNames = @('system volume information', '$recycle.bin', 'config.msi', 'recovery')
  $rootEntries = @(Get-ChildItem -LiteralPath $rootPath -Force -ErrorAction SilentlyContinue)
  foreach ($entry in $rootEntries) {
    $lowerName = $entry.Name.ToLowerInvariant()
    if ($skipNames -contains $lowerName) { continue }
    $itemPath = $entry.FullName

    if (-not $doFormat) {
      # Em modo sem formatar, arquivos de outros PCs podem ter Owner órfão bloqueando icacls.
      if ($entry.PSIsContainer) {
        Invoke-SystemTool 'takeown.exe' @('/F', $itemPath, '/A', '/R', '/D', 'Y') | Out-Null
      } else {
        Invoke-SystemTool 'takeown.exe' @('/F', $itemPath, '/A') | Out-Null
      }
    }

    if ($entry.PSIsContainer) {
      Invoke-SystemTool 'icacls.exe' @($itemPath, '/inheritance:e', '/T', '/C', '/Q') | Out-Null
      Invoke-SystemTool 'icacls.exe' @($itemPath, '/remove:d', $sidAllApp, $sidRestricted, $sidEveryone, '/T', '/C', '/Q') | Out-Null
      $rcSub = Invoke-SystemTool 'icacls.exe' @(
        $itemPath,
        '/grant', "$($sidAllApp):(OI)(CI)F",
        '/grant', "$($sidRestricted):(OI)(CI)F",
        '/grant', "$($sidEveryone):(OI)(CI)F",
        '/grant', "$($sidAdmins):(OI)(CI)F",
        '/grant', "$($sidSystem):(OI)(CI)F",
        '/T', '/C', '/Q'
      )
      if ($rcSub -ne 0 -and ($lowerName -eq 'games' -or $lowerName -eq 'content' -or $lowerName -eq '.xbox-downloader')) {
        throw "Falha ao aplicar permissões NTFS na pasta $itemPath (icacls codigo $rcSub)."
      }
    } else {
      Invoke-SystemTool 'icacls.exe' @($itemPath, '/inheritance:e', '/C', '/Q') | Out-Null
      Invoke-SystemTool 'icacls.exe' @($itemPath, '/remove:d', $sidAllApp, $sidRestricted, $sidEveryone, '/C', '/Q') | Out-Null
      Invoke-SystemTool 'icacls.exe' @(
        $itemPath,
        '/grant', "$($sidAllApp):F",
        '/grant', "$($sidRestricted):F",
        '/grant', "$($sidEveryone):F",
        '/C', '/Q'
      ) | Out-Null
    }
  }

  # Garante que Games e Content não fiquem ocultos nem somente leitura
  foreach ($d in @($gamesDir, (Join-Path $rootPath 'Content'), $contentDir)) {
    try {
      $item = Get-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue
      if ($null -ne $item) {
        $item.Attributes = ($item.Attributes -band (-bnot ([System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System -bor [System.IO.FileAttributes]::ReadOnly)))
      }
    } catch {}
  }

  Update-Disk -Number $diskNo -ErrorAction SilentlyContinue
  $finalDisk = Get-Disk -Number $diskNo -ErrorAction Stop
  $finalPartition = Get-Partition -DriveLetter $targetLetter -ErrorAction Stop
  $finalVol = Get-Volume -DriveLetter $targetLetter -ErrorAction Stop
  if (([string]$finalVol.FileSystem).ToUpperInvariant() -ne 'NTFS') {
    throw "Sistema de arquivos final inesperado: $($finalVol.FileSystem) (esperado NTFS)."
  }

  "Letra final: $($targetLetter):" | Out-File -FilePath $log -Append -Encoding utf8
  "Estilo final: $($finalDisk.PartitionStyle)" | Out-File -FilePath $log -Append -Encoding utf8
  "Particao final: $([int64]$finalPartition.Size) bytes" | Out-File -FilePath $log -Append -Encoding utf8
  "Sistema de arquivos final: $($finalVol.FileSystem)" | Out-File -FilePath $log -Append -Encoding utf8
  "Preparo NTFS + permissoes Xbox One/Series concluido com sucesso." | Out-File -FilePath $log -Append -Encoding utf8
} catch {
  ($_ | Out-String) | Out-File -FilePath $log -Append -Encoding utf8
  if ($targetLetter) { Close-ExplorerWindows $targetLetter }
  exit 1
}

if ($targetLetter) { Close-ExplorerWindows $targetLetter }
exit 0`;
}

function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Executa o script elevado de formatação NTFS e/ou aplicação de permissões do Xbox One / Series.
 */
export async function executeWindowsNtfsXeniaSetup(options: {
  target: NtfsXeniaTarget;
  formatDrive: boolean;
  label?: string;
}): Promise<NtfsXeniaExecutionResult> {
  if (process.platform !== "win32") {
    throw new Error("A preparação NTFS para Xbox One / Series está disponível somente no Windows.");
  }

  const ts = Date.now();
  const ps1Path = path.join(os.tmpdir(), `godsend_xenia_ntfs_${ts}.ps1`);
  const logPath = `${ps1Path}.log`;

  try {
    const script = buildGuardedWindowsNtfsXeniaScript({
      target: options.target,
      formatDrive: options.formatDrive,
      label: options.label || "XENIA_USB",
      logPath,
    });
    writePowerShellScript(ps1Path, script);

    const { code, cancelled } = await runPs1Elevated(ps1Path);
    const fullLog = readLogTail(logPath, Number.POSITIVE_INFINITY);
    const tail = readLogTail(logPath, 2000);

    if (cancelled) {
      throw new Error("Preparação cancelada (a permissão de Administrador do Windows foi negada).");
    }
    if (code !== 0) {
      throw new Error(
        tail || "Não foi possível preparar o dispositivo em NTFS. Feche pastas abertas do USB e tente novamente.",
      );
    }

    const finalLetter =
      readNtfsFinalDriveLetter(fullLog) ||
      (options.target.kind === "volume" ? normalizeDriveLetter(options.target.driveLetter) : undefined);

    if (!finalLetter) {
      throw new Error("O preparo NTFS terminou, mas o Windows não informou a letra atribuída ao dispositivo.");
    }

    // Fecha eventuais janelas do Explorer abertas automaticamente pelo Windows após remount
    await runCommand(powerShellExe(), [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-Volume -DriveLetter '${finalLetter}' -ErrorAction SilentlyContinue | Out-Null`,
    ]).catch(() => {});

    return {
      driveRoot: `${finalLetter}:\\`,
      partitionBytes: readNtfsFinalPartitionBytes(fullLog),
      partitionStyle: readNtfsFinalPartitionStyle(fullLog),
      logTail: tail,
    };
  } finally {
    for (const p of [ps1Path, logPath]) {
      try { fs.unlinkSync(p); } catch { /* best-effort cleanup */ }
    }
  }
}
