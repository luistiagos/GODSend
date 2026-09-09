import { spawn } from "child_process";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertDeviceStillMatches,
  enrichDeviceSafety,
  planRevalidationRetry,
  type PhysicalUsbDevice,
  type SafeUsbDevice,
} from "./deviceSafetyPolicy";
import { appendAppEvent } from "./serverLog";
import {
  isExecutableNotFound,
  powerShellExe,
  powerShellMissingMessage,
} from "./windowsSystemExecutables";

const USB_ENUMERATION_TIMEOUT_MS = 12_000;
const REMOVABLE_ENUMERATION_TIMEOUT_MS = 5_000;
const HEALTH_PROBE_TIMEOUT_MS = 3_000;

function runPowerShell(script: string, timeoutMs = USB_ENUMERATION_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    // Write script to a temp file so PowerShell uses -File instead of -Command.
    // -Command has trouble parsing complex multiline scripts (hashtables, if/else
    // expressions, embedded quotes) and does not accept -ExecutionPolicy Bypass.
    let tmpDir = "";
    let scriptPath = "";
    try {
      tmpDir = mkdtempSync(join(tmpdir(), "godsend-ps-"));
      scriptPath = join(tmpDir, "usb.ps1");
      writeFileSync(scriptPath, script, { encoding: "utf8" });
    } catch (e) {
      if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      reject(e);
      return;
    }

    const child = spawn(
      powerShellExe(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const cleanup = () => {
      if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    };

    timeout = setTimeout(() => {
      child.kill();
      finish(() => {
        cleanup();
        reject(
          new Error(
            "O Windows demorou demais para listar os dispositivos USB. " +
              "Remova e conecte o pendrive novamente, aguarde alguns segundos e tente atualizar a lista.",
          ),
        );
      });
    }, timeoutMs);
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => finish(() => {
      cleanup();
      reject(isExecutableNotFound(error) ? new Error(powerShellMissingMessage()) : error);
    }));
    child.on("close", (code) => {
      finish(() => {
        cleanup();
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || "Não foi possível enumerar os dispositivos USB."));
      });
    });
  });
}

// Storage Management (Get-Disk/Get-Volume/Get-CimInstance) can block indefinitely
// after a flaky USB disconnect. DriveInfo + mountvol use independent Win32 paths
// and keep ordinary removable pendrives selectable while that service recovers.
//
// Nothing in this script may call Storage Management, or the fallback stops being
// a fallback. Health/repair hints used to be read here with Get-Volume, which cost
// 1.2 s on a healthy machine and hung on exactly the machines this script exists
// for; they now come from annotateRemovableHealth(), out of band.
const ENUMERATE_REMOVABLE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
$mountvol = Join-Path $env:SystemRoot 'System32\mountvol.exe'

try {
  Add-Type -Namespace XboxCompanion -Name NativeDisk -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern bool GetDiskFreeSpace(
  string rootPath,
  out uint sectorsPerCluster,
  out uint bytesPerSector,
  out uint freeClusters,
  out uint totalClusters
);
'@
} catch {}

foreach ($drive in [System.IO.DriveInfo]::GetDrives()) {
  try {
    if (-not $drive.IsReady -or $drive.DriveType -ne [System.IO.DriveType]::Removable) { continue }
    $root = $drive.Name.ToUpperInvariant()
    $volumeGuid = ((& $mountvol $root '/L' 2>$null) -join '').Trim()
    if (-not $volumeGuid) {
      $volumeGuid = 'removable|' + $root + '|' + [string]$drive.TotalSize + '|' + [string]$drive.VolumeLabel
    }
    [uint32]$sectorsPerCluster = 0
    [uint32]$bytesPerSector = 0
    [uint32]$freeClusters = 0
    [uint32]$totalClusters = 0
    [int64]$allocationUnitBytes = 0
    try {
      if ([XboxCompanion.NativeDisk]::GetDiskFreeSpace(
        $root,
        [ref]$sectorsPerCluster,
        [ref]$bytesPerSector,
        [ref]$freeClusters,
        [ref]$totalClusters
      )) {
        $allocationUnitBytes = [int64]$sectorsPerCluster * [int64]$bytesPerSector
      }
    } catch {}

    $rows += [PSCustomObject]@{
      RootPath = $root
      Label = if ($drive.VolumeLabel) { [string]$drive.VolumeLabel } else { 'Sem nome' }
      FileSystem = [string]$drive.DriveFormat
      SizeBytes = [int64]$drive.TotalSize
      PartitionSizeBytes = [int64]$drive.TotalSize
      FreeBytes = [int64]$drive.AvailableFreeSpace
      AllocationUnitBytes = $allocationUnitBytes
      DiskNumber = -1
      PartitionNumber = -1
      DiskUniqueId = $volumeGuid
      SerialNumber = $volumeGuid
      VolumeGuid = $volumeGuid
      FriendlyName = 'Dispositivo USB removivel'
      Manufacturer = ''
      BusType = 'USB'
      PartitionStyle = ''
      DriveType = 'Removable'
      DiskPath = $volumeGuid
      OperationalStatus = 'OK'
      HealthStatus = 'Healthy'
      NeedsRepair = $false
      IsBoot = $false
      IsSystem = $false
      IsReadOnly = $false
      IsOffline = $false
      MountedPartitionCount = 1
    }
  } catch {}
}

if ($rows.Count -eq 0) { '[]' } else { @($rows) | ConvertTo-Json -Compress -Depth 4 }
`;

const ENUMERATE_USB_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
$mountvol = Join-Path $env:SystemRoot 'System32\mountvol.exe'

try {
  $disks = @(Get-Disk -ErrorAction SilentlyContinue | Where-Object { $_.BusType -eq 'USB' })
  foreach ($disk in $disks) {
    $mounted = @(Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter })
    foreach ($partition in $mounted) {
      $volume = Get-Volume -Partition $partition -ErrorAction SilentlyContinue
      $rootPath = $partition.DriveLetter.ToString().ToUpperInvariant() + ':\'
      $volumeGuid = ((& $mountvol $rootPath '/L' 2>$null) -join '').Trim()
      $health = if ($volume.HealthStatus) { [string]$volume.HealthStatus } else { 'Healthy' }
      $op = if ($volume.OperationalStatus) { (@($volume.OperationalStatus) -join ',') } else { (@($disk.OperationalStatus) -join ',') }
      $needsFix = [bool]($health -match 'Warning|Unhealthy' -or $op -match 'Repair|Need|Corrupt')
      $rows += [PSCustomObject]@{
        RootPath = $rootPath
        Label = if ($volume.FileSystemLabel) { [string]$volume.FileSystemLabel } else { 'Sem nome' }
        FileSystem = if ($volume.FileSystem) { [string]$volume.FileSystem } else { '' }
        SizeBytes = [int64]$disk.Size
        PartitionSizeBytes = [int64]$partition.Size
        FreeBytes = if ($volume.SizeRemaining -ne $null) { [int64]$volume.SizeRemaining } else { 0 }
        AllocationUnitBytes = if ($volume.AllocationUnitSize -ne $null) { [int64]$volume.AllocationUnitSize } else { 0 }
        DiskNumber = [int]$disk.Number
        PartitionNumber = [int]$partition.PartitionNumber
        DiskUniqueId = [string]$disk.UniqueId
        SerialNumber = [string]$disk.SerialNumber
        VolumeGuid = $volumeGuid
        FriendlyName = [string]$disk.FriendlyName
        Manufacturer = [string]$disk.Manufacturer
        BusType = [string]$disk.BusType
        PartitionStyle = [string]$disk.PartitionStyle
        DriveType = if ($volume.DriveType) { [string]$volume.DriveType } else { '' }
        DiskPath = [string]$disk.Path
        OperationalStatus = $op
        HealthStatus = $health
        NeedsRepair = $needsFix
        IsBoot = [bool]($disk.IsBoot -or $partition.IsBoot)
        IsSystem = [bool]($disk.IsSystem -or $partition.IsSystem)
        IsReadOnly = [bool]$disk.IsReadOnly
        IsOffline = [bool]$disk.IsOffline
        MountedPartitionCount = [int]$mounted.Count
      }
    }
  }
} catch {}

if ($rows.Count -eq 0) {
  $usbDrives = @(Get-CimInstance -ClassName Win32_DiskDrive -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceType -eq 'USB' })
  foreach ($disk in $usbDrives) {
    $safeId = $disk.DeviceID -replace '\\','\\' -replace "'","''"
    $parts = @(Get-CimInstance -Query "ASSOCIATORS OF {Win32_DiskDrive.DeviceID='$safeId'} WHERE AssocClass=Win32_DiskDriveToDiskPartition" -ErrorAction SilentlyContinue)
    foreach ($part in $parts) {
      $logicals = @(Get-CimInstance -Query "ASSOCIATORS OF {Win32_DiskPartition.DeviceID='$($part.DeviceID)'} WHERE AssocClass=Win32_LogicalDiskToPartition" -ErrorAction SilentlyContinue)
      foreach ($ld in $logicals) {
        if (-not $ld.DeviceID) { continue }
        $rootPath = $ld.DeviceID + '\'
        $volumeGuid = ((& $mountvol $rootPath '/L' 2>$null) -join '').Trim()
        $rows += [PSCustomObject]@{
          RootPath = $rootPath
          Label = if ($ld.VolumeName) { [string]$ld.VolumeName } else { 'Sem nome' }
          FileSystem = if ($ld.FileSystem) { [string]$ld.FileSystem } else { '' }
          SizeBytes = [int64]$disk.Size
          PartitionSizeBytes = [int64]$ld.Size
          FreeBytes = if ($ld.FreeSpace -ne $null) { [int64]$ld.FreeSpace } else { 0 }
          AllocationUnitBytes = 0
          DiskNumber = -1
          PartitionNumber = -1
          DiskUniqueId = [string]$disk.SerialNumber
          SerialNumber = [string]$disk.SerialNumber
          VolumeGuid = $volumeGuid
          FriendlyName = [string]$disk.Model
          Manufacturer = [string]$disk.Manufacturer
          BusType = 'USB'
          PartitionStyle = ''
          DriveType = 'Removable'
          DiskPath = [string]$disk.DeviceID
          OperationalStatus = 'OK'
          HealthStatus = 'Healthy'
          NeedsRepair = $false
          IsBoot = $false
          IsSystem = $false
          IsReadOnly = $false
          IsOffline = $false
          MountedPartitionCount = 1
        }
      }
    }
  }
}

if ($rows.Count -eq 0) { '[]' } else { @($rows) | ConvertTo-Json -Compress -Depth 4 }
`;

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true || String(value).toLowerCase() === "true";
}

function parsePhysicalDevice(row: any): PhysicalUsbDevice {
  return {
    rootPath: asString(row.RootPath),
    label: asString(row.Label) || "Sem nome",
    fileSystem: asString(row.FileSystem),
    sizeBytes: asNumber(row.SizeBytes),
    partitionSizeBytes: asNumber(row.PartitionSizeBytes),
    freeBytes: asNumber(row.FreeBytes),
    allocationUnitBytes: asNumber(row.AllocationUnitBytes),
    diskNumber: asNumber(row.DiskNumber),
    partitionNumber: asNumber(row.PartitionNumber),
    diskUniqueId: asString(row.DiskUniqueId),
    serialNumber: asString(row.SerialNumber),
    volumeGuid: asString(row.VolumeGuid),
    friendlyName: asString(row.FriendlyName),
    manufacturer: asString(row.Manufacturer),
    busType: asString(row.BusType),
    partitionStyle: asString(row.PartitionStyle),
    driveType: asString(row.DriveType),
    diskPath: asString(row.DiskPath),
    operationalStatus: asString(row.OperationalStatus),
    healthStatus: asString(row.HealthStatus) || "Healthy",
    needsRepair: asBoolean(row.NeedsRepair),
    isBoot: asBoolean(row.IsBoot),
    isSystem: asBoolean(row.IsSystem),
    isReadOnly: asBoolean(row.IsReadOnly),
    isOffline: asBoolean(row.IsOffline),
    mountedPartitionCount: asNumber(row.MountedPartitionCount),
  };
}

function normalizeRoot(rootPath: string): string {
  const match = rootPath.trim().match(/^([a-z]):/i);
  return match ? `${match[1].toUpperCase()}:\\` : rootPath.trim();
}

/**
 * Fills in the health/repair hints that ENUMERATE_REMOVABLE_SCRIPT deliberately
 * leaves out, in a process of its own.
 *
 * These hints only drive the "sistema de arquivos com inconsistências" banner —
 * they are read by neither `createDeviceFingerprint` nor `assessDeviceSafety`, so
 * losing them costs a suggestion, not a safety check. Reading them costs a call to
 * Get-Volume, which is Storage Management: the service that wedges after a flaky
 * USB disconnect and the reason the native enumeration exists at all. Probing it
 * separately means a wedged service degrades the banner instead of taking the
 * whole device list down with it.
 */
async function annotateRemovableHealth(devices: SafeUsbDevice[]): Promise<void> {
  const byLetter = new Map<string, SafeUsbDevice[]>();
  for (const device of devices) {
    const letter = normalizeRoot(device.rootPath)[0];
    if (!/^[A-Z]$/.test(letter)) continue;
    const bucket = byLetter.get(letter);
    if (bucket) bucket.push(device);
    else byLetter.set(letter, [device]);
  }
  if (byLetter.size === 0) return;

  const letters = [...byLetter.keys()].map((letter) => `'${letter}'`).join(",");
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
foreach ($letter in @(${letters})) {
  $vol = Get-Volume -DriveLetter $letter -ErrorAction SilentlyContinue
  if (-not $vol) { continue }
  $rows += [PSCustomObject]@{
    DriveLetter = $letter
    HealthStatus = [string]$vol.HealthStatus
    OperationalStatus = (@($vol.OperationalStatus) -join ',')
  }
}
if ($rows.Count -eq 0) { '[]' } else { @($rows) | ConvertTo-Json -Compress -Depth 3 }
`;

  const output = (await runPowerShell(script, HEALTH_PROBE_TIMEOUT_MS)).trim();
  if (!output) return;
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  for (const row of rows) {
    const targets = byLetter.get(asString(row?.DriveLetter).toUpperCase());
    if (!targets) continue;
    const health = asString(row.HealthStatus) || "Healthy";
    const operational = asString(row.OperationalStatus) || "OK";
    for (const device of targets) {
      device.healthStatus = health;
      device.operationalStatus = operational;
      device.needsRepair =
        /Warning|Unhealthy/i.test(health) || /Repair|Need|Corrupt/i.test(operational);
    }
  }
}

/**
 * @param includeHealth Probe the health/repair hints too. Off by default: this
 * function is also the revalidation path, which `createThrottledUsbTargetRevalidator`
 * fires every 10 s for the whole write phase, and the hints are read only by the
 * device list in the UI. Probing them there as well would spawn a Get-Volume every
 * 10 s throughout a preparation — putting Storage Management back on the hot path
 * that ENUMERATE_REMOVABLE_SCRIPT exists to keep clear of it.
 */
export async function enumerateSafeWindowsUsbDevices(
  includeHealth = false,
): Promise<SafeUsbDevice[]> {
  if (process.platform !== "win32") return [];
  const systemDrive = process.env.SystemDrive || "C:";
  const parseOutput = (rawOutput: string): SafeUsbDevice[] => {
    const output = rawOutput.trim();
    if (!output) return [];
    let parsed: any;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error("O Windows retornou dados inválidos ao enumerar os dispositivos USB.");
    }
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return rows
      .filter((row) => row?.RootPath)
      .map((row) => enrichDeviceSafety(parsePhysicalDevice(row), systemDrive));
  };

  try {
    const removable = parseOutput(
      await runPowerShell(ENUMERATE_REMOVABLE_SCRIPT, REMOVABLE_ENUMERATION_TIMEOUT_MS),
    );
    if (removable.length > 0) {
      if (includeHealth) {
        try {
          await annotateRemovableHealth(removable);
        } catch (error: any) {
          // Best-effort: the rows keep the neutral Healthy/OK they were built with.
          appendAppEvent(
            "usb",
            `diagnóstico de integridade indisponível: ${error?.message || String(error)}`,
          );
        }
      }
      appendAppEvent(
        "usb",
        `enumeração nativa encontrou ${removable.length} unidade(s): ${removable.map((device) => device.rootPath).join(", ")}`,
      );
      return removable;
    }
  } catch (error: any) {
    appendAppEvent("usb", `enumeração nativa falhou: ${error?.message || String(error)}`);
  }

  const devices = parseOutput(await runPowerShell(ENUMERATE_USB_SCRIPT));
  appendAppEvent(
    "usb",
    `enumeração física encontrou ${devices.length} unidade(s): ${devices.map((device) => device.rootPath).join(", ") || "nenhuma"}`,
  );
  return devices;
}

export async function safelyEjectWindowsDrive(rootPath: string): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "win32") {
    return { ok: false, error: "A ejeção de dispositivos só é suportada no Windows." };
  }
  const driveLetter = rootPath.trim().replace(/[:\\\/]/g, "").toUpperCase();
  if (!driveLetter || driveLetter.length !== 1) {
    return { ok: false, error: "Letra da unidade inválida para ejeção." };
  }
  const script = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$letter = '${driveLetter}'
try {
  $vol = Get-Volume -DriveLetter $letter -ErrorAction SilentlyContinue
  if ($vol) {
    $vol | Optimize-Volume -Analyze -ErrorAction SilentlyContinue
  }
  $shell = New-Object -ComObject Shell.Application
  $drive = $shell.Namespace(17).ParseName("${driveLetter}:")
  if ($drive) {
    $drive.InvokeVerb("E&ject")
    Write-Output "OK"
  } else {
    Write-Output "FAIL: Dispositivo não encontrado no Shell"
  }
} catch {
  Write-Output "FAIL: $($_.Exception.Message)"
}
`;
  try {
    const res = await runPowerShell(script, 10_000);
    if (res.includes("OK")) {
      appendAppEvent("usb", `Dispositivo ${driveLetter}: ejetado com sucesso.`);
      return { ok: true };
    }
    return { ok: false, error: res.trim().replace(/^FAIL:\s*/i, "") || "Não foi possível ejetar a unidade." };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function requireSafeWindowsUsbTarget(
  rootPath: string,
  expectedFingerprint: string,
): Promise<SafeUsbDevice> {
  if (process.platform !== "win32") {
    throw new Error("O preparador seguro está disponível somente no Windows nesta fase.");
  }

  const normalizedRoot = normalizeRoot(rootPath);
  const matches = (await enumerateSafeWindowsUsbDevices()).filter(
    (device) => normalizeRoot(device.rootPath) === normalizedRoot,
  );
  if (matches.length !== 1) {
    throw new Error(
      "Não foi possível identificar uma única unidade USB física para o destino selecionado.",
    );
  }

  try {
    assertDeviceStillMatches(expectedFingerprint, matches[0]);
    return matches[0];
  } catch (initialError: any) {
    // A fingerprint minted by one enumeration script is never reproduced by the
    // other, and which script answers is decided at runtime — so retry against the
    // path the user's fingerprint must have come from before accusing them of
    // swapping a device that never left the port. See planRevalidationRetry() for
    // why the retry is deliberately asymmetric.
    const retry = planRevalidationRetry(matches[0]);
    if (retry !== "none") {
      const [fallbackScript, fallbackTimeout] =
        retry === "physical"
          ? ([ENUMERATE_USB_SCRIPT, USB_ENUMERATION_TIMEOUT_MS] as const)
          : ([ENUMERATE_REMOVABLE_SCRIPT, REMOVABLE_ENUMERATION_TIMEOUT_MS] as const);
      try {
        const recovered = await revalidateWithScript(
          fallbackScript,
          fallbackTimeout,
          normalizedRoot,
          expectedFingerprint,
        );
        if (recovered) return recovered;
      } catch {
        // The other path cannot confirm it either; report the original failure.
      }
    }
    throw initialError;
  }
}

/**
 * Re-runs one specific enumeration script and revalidates the selection against
 * whatever it reports for `normalizedRoot`.
 *
 * Returns null when that script cannot single out the drive; throws when it can
 * but the device does not match. Either way the caller falls back to the error
 * from the first attempt.
 */
async function revalidateWithScript(
  script: string,
  timeoutMs: number,
  normalizedRoot: string,
  expectedFingerprint: string,
): Promise<SafeUsbDevice | null> {
  const systemDrive = process.env.SystemDrive || "C:";
  const output = (await runPowerShell(script, timeoutMs)).trim();
  if (!output) return null;

  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const candidates = rows
    .filter((row: any) => row?.RootPath)
    .map((row: any) => enrichDeviceSafety(parsePhysicalDevice(row), systemDrive))
    .filter((device) => normalizeRoot(device.rootPath) === normalizedRoot);
  if (candidates.length !== 1) return null;

  assertDeviceStillMatches(expectedFingerprint, candidates[0]);
  return candidates[0];
}


