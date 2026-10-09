import { spawn } from "child_process";
import { writeFileSync, mkdtempSync, rmSync, promises as fsPromises } from "fs";
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
const REMOVABLE_RECOVERY_TIMEOUT_MS = 12_000;
const ENUMERATION_RECOVERY_DELAY_MS = 750;
const HEALTH_PROBE_TIMEOUT_MS = 3_000;
const ENUMERATION_TIMEOUT_CEILING_MS = 30_000;
const SLOW_MACHINE_TIMEOUT_FACTOR = 3;
const RECENT_DURATION_SAMPLES = 5;
const SLOW_POWERSHELL_LOG_MS = 2_000;

const recentPowerShellDurationsMs: number[] = [];

/**
 * Deadline for an enumeration script on a machine whose recent PowerShell runs took
 * `recentDurationsMs`. The bases were tuned where a powershell.exe answers in ~0.5 s; on
 * machines where it takes 5–8 s (slow PC, antivirus inspecting every process) they expired with
 * the drive mounted and listed, and the preparation — which has no last good list to fall back
 * on — failed with "O Windows ainda está reconhecendo...". Never below the base, never above the
 * ceiling, so a child that is really stuck still expires.
 */
export function enumerationTimeoutFor(baseMs: number, recentDurationsMs: readonly number[]): number {
  const slowest = Math.max(0, ...recentDurationsMs);
  return Math.max(baseMs, Math.min(ENUMERATION_TIMEOUT_CEILING_MS, slowest * SLOW_MACHINE_TIMEOUT_FACTOR));
}

// Only successes are measured: a timeout may be a real hang (Storage Management after a flaky
// disconnect), and learning from it would stretch every later wait toward the ceiling.
function enumerationTimeout(baseMs: number): number {
  return enumerationTimeoutFor(baseMs, recentPowerShellDurationsMs);
}

type UsbEnumerationTimeoutError = Error & {
  code?: string;
  timeoutMs?: number;
};

function usbEnumerationTimeout(timeoutMs: number): UsbEnumerationTimeoutError {
  const error = new Error(
    "O Windows ainda está reconhecendo seu pendrive ou HD. " +
      "Aguarde alguns instantes e clique no botão 'Atualizar'. " +
      "(Dica: se não aparecer após alguns segundos, experimente reconectar em outra porta USB).",
  ) as UsbEnumerationTimeoutError;
  error.code = "USB_ENUMERATION_TIMEOUT";
  error.timeoutMs = timeoutMs;
  return error;
}

function isUsbEnumerationTimeout(error: unknown): boolean {
  return (error as UsbEnumerationTimeoutError | undefined)?.code === "USB_ENUMERATION_TIMEOUT";
}

/**
 * The timeout message blames the device ("ainda está reconhecendo... outra porta USB"). When the
 * drive letter answers, Windows has already mounted it and the time went to PowerShell itself —
 * a customer told to swap ports changes nothing. Any other error is returned untouched.
 */
export async function explainSlowEnumeration(error: unknown, rootPath: string): Promise<unknown> {
  if (!isUsbEnumerationTimeout(error)) return error;
  try {
    await fsPromises.stat(normalizeRoot(rootPath));
  } catch {
    return error;
  }
  const slow = new Error(
    "Seu pendrive ou HD está conectado, mas o computador está demorando para responder à " +
      "verificação de segurança do Windows (computador lento ou antivírus analisando). " +
      "Não é preciso trocar de porta: aguarde alguns segundos e tente de novo.",
  ) as UsbEnumerationTimeoutError;
  slow.code = "USB_ENUMERATION_TIMEOUT";
  slow.timeoutMs = (error as UsbEnumerationTimeoutError).timeoutMs;
  return slow;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LATE_TIMER_GRACE_MS = 1_000;

/**
 * setTimeout for a child-process deadline. A timer that fires well past its deadline means the
 * event loop was blocked, and the child's exit may already be queued: on Windows it is delivered
 * in libuv's poll phase, which runs after the timers phase. Expiring there reports a finished
 * PowerShell as "O Windows ainda está reconhecendo..." — so a late timer waits one short grace
 * period first. A child that is really stuck still expires (deadline + grace at most).
 * Returns the cancel function.
 */
export function setLoopAwareTimeout(timeoutMs: number, onExpire: () => void): () => void {
  const deadline = Date.now() + timeoutMs;
  let graceUsed = false;
  let timer: ReturnType<typeof setTimeout>;
  const fire = () => {
    if (!graceUsed && Date.now() - deadline > LATE_TIMER_GRACE_MS) {
      graceUsed = true;
      timer = setTimeout(fire, LATE_TIMER_GRACE_MS);
      return;
    }
    onExpire();
  };
  timer = setTimeout(fire, timeoutMs);
  return () => clearTimeout(timer);
}

/**
 * @param label Names the script in the log lines about slow or expired runs.
 * @param learnDuration Feed this run's duration into enumerationTimeout(). Off for scripts that
 * are slow by nature (ejection), which say nothing about how fast this machine starts PowerShell.
 */
function runPowerShell(
  script: string,
  timeoutMs: number,
  label: string,
  learnDuration = true,
): Promise<string> {
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

    const startedAt = performance.now();
    const child = spawn(
      powerShellExe(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      { windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      callback();
    };
    const cleanup = () => {
      if (tmpDir) try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    };

    const cancelTimeout = setLoopAwareTimeout(timeoutMs, () => {
      child.kill();
      finish(() => {
        cleanup();
        appendAppEvent("usb", `powershell (${label}) excedeu o prazo de ${timeoutMs} ms`);
        reject(usbEnumerationTimeout(timeoutMs));
      });
    });
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => finish(() => {
      cleanup();
      reject(isExecutableNotFound(error) ? new Error(powerShellMissingMessage()) : error);
    }));
    child.on("close", (code) => {
      finish(() => {
        cleanup();
        if (code !== 0) {
          reject(new Error(stderr.trim() || "Não foi possível enumerar os dispositivos USB."));
          return;
        }
        const durationMs = Math.round(performance.now() - startedAt);
        if (learnDuration) {
          recentPowerShellDurationsMs.push(durationMs);
          if (recentPowerShellDurationsMs.length > RECENT_DURATION_SAMPLES) recentPowerShellDurationsMs.shift();
        }
        if (durationMs >= SLOW_POWERSHELL_LOG_MS) {
          appendAppEvent("usb", `powershell (${label}) respondeu em ${durationMs} ms (prazo ${timeoutMs} ms)`);
        }
        resolve(stdout);
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
//
// AllocationUnitBytes stays 0 here and fillAllocationUnits() reads it from fs.statfs. It used to
// come from GetDiskFreeSpace through Add-Type, which compiles C# with csc.exe on every run — the
// costliest step of the script, and worse on the slow machines where enumerations time out.
//
// A USB HDD is reported as Fixed, so it never becomes a row here. Each mounted Fixed drive other
// than the system one is emitted as a bare marker row instead (FixedDriveMarker = $true): the
// native listing cannot tell its bus, but the marker tells enumerateSafeWindowsUsbDevices() that
// the physical script has something to find next to the pendrive. Markers never become devices.
const ENUMERATE_REMOVABLE_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()
$mountvol = Join-Path $env:SystemRoot 'System32\mountvol.exe'
$systemRoot = ([string]$env:SystemDrive).TrimEnd('\').ToUpperInvariant() + '\'

foreach ($drive in [System.IO.DriveInfo]::GetDrives()) {
  try {
    if (-not $drive.IsReady) { continue }
    if ($drive.DriveType -eq [System.IO.DriveType]::Fixed) {
      $fixedRoot = $drive.Name.ToUpperInvariant()
      if ($fixedRoot -ne $systemRoot) {
        $rows += [PSCustomObject]@{ RootPath = $fixedRoot; DriveType = 'Fixed'; FixedDriveMarker = $true }
      }
      continue
    }
    if ($drive.DriveType -ne [System.IO.DriveType]::Removable) { continue }
    $root = $drive.Name.ToUpperInvariant()
    $volumeGuid = ((& $mountvol $root '/L' 2>$null) -join '').Trim()
    if (-not $volumeGuid) {
      $volumeGuid = 'removable|' + $root + '|' + [string]$drive.TotalSize + '|' + [string]$drive.VolumeLabel
    }

    $rows += [PSCustomObject]@{
      RootPath = $root
      Label = if ($drive.VolumeLabel) { [string]$drive.VolumeLabel } else { 'Sem nome' }
      FileSystem = [string]$drive.DriveFormat
      SizeBytes = [int64]$drive.TotalSize
      PartitionSizeBytes = [int64]$drive.TotalSize
      FreeBytes = [int64]$drive.AvailableFreeSpace
      AllocationUnitBytes = 0
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
    $partitions = @(Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue)
    $mounted = @($partitions | Where-Object { $_.DriveLetter })
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
        PartitionCount = [int]$partitions.Count
        MbrType = [int]$partition.MbrType
        LogicalSectorSize = [int]$disk.LogicalSectorSize
        PhysicalSectorSize = [int]$disk.PhysicalSectorSize
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
    partitionCount: asNumber(row.PartitionCount),
    mbrType: asNumber(row.MbrType),
    logicalSectorSize: asNumber(row.LogicalSectorSize),
    physicalSectorSize: asNumber(row.PhysicalSectorSize),
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

/** A marker row from ENUMERATE_REMOVABLE_SCRIPT for a Fixed drive: never a device. */
function isFixedDriveMarker(row: any): boolean {
  return row?.FixedDriveMarker === true;
}

function normalizeRoot(rootPath: string): string {
  const match = rootPath.trim().match(/^([a-z]):/i);
  return match ? `${match[1].toUpperCase()}:\\` : rootPath.trim();
}

/**
 * Cluster size for rows whose script could not read it (the native script never does, nor the
 * Win32_DiskDrive fallback). On Windows libuv fills statfs' bsize with SectorsPerAllocationUnit ×
 * BytesPerSector from FileFsFullSizeInformation — the same numbers GetDiskFreeSpace returns. A
 * failure leaves 0, which assessWriteCapacity already treats as unknown.
 */
async function fillAllocationUnits(devices: SafeUsbDevice[]): Promise<SafeUsbDevice[]> {
  await Promise.all(
    devices
      .filter((device) => !device.allocationUnitBytes)
      .map(async (device) => {
        try {
          device.allocationUnitBytes = (await fsPromises.statfs(normalizeRoot(device.rootPath))).bsize;
        } catch {
          // keep 0
        }
      }),
  );
  return devices;
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

  // Fixed deadline on purpose: the hints are best-effort, and waiting longer for them on a slow
  // machine would delay the whole device list.
  const output = (await runPowerShell(script, HEALTH_PROBE_TIMEOUT_MS, "diagnostico de integridade")).trim();
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

async function finishRemovableEnumeration(
  devices: SafeUsbDevice[],
  includeHealth: boolean,
  logPrefix = "enumeracao nativa",
): Promise<SafeUsbDevice[]> {
  if (includeHealth) {
    try {
      await annotateRemovableHealth(devices);
    } catch (error: any) {
      // Best-effort: the rows keep the neutral Healthy/OK they were built with.
      appendAppEvent(
        "usb",
        `diagnostico de integridade indisponivel: ${error?.message || String(error)}`,
      );
    }
  }
  appendAppEvent(
    "usb",
    `${logPrefix} encontrou ${devices.length} unidade(s): ${devices.map((device) => device.rootPath).join(", ")}`,
  );
  return devices;
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
  const parseRows = (rawOutput: string): any[] => {
    const output = rawOutput.trim();
    if (!output) return [];
    let parsed: any;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new Error("O Windows retornou dados inválidos ao enumerar os dispositivos USB.");
    }
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return rows.filter((row) => row?.RootPath);
  };
  const toDevices = (rows: any[]): Promise<SafeUsbDevice[]> =>
    fillAllocationUnits(rows.map((row) => enrichDeviceSafety(parsePhysicalDevice(row), systemDrive)));
  const parseOutput = (rawOutput: string): Promise<SafeUsbDevice[]> => toDevices(parseRows(rawOutput));

  // The native rows plus whether a non-system Fixed drive (a possible USB HDD) is mounted.
  let fixedDriveMounted = false;
  const parseNativeOutput = (rawOutput: string): Promise<SafeUsbDevice[]> => {
    const rows = parseRows(rawOutput);
    fixedDriveMounted = rows.some(isFixedDriveMarker);
    return toDevices(rows.filter((row) => !isFixedDriveMarker(row)));
  };

  // The native listing returns early with the pendrives, and a USB HDD (Fixed) is only ever found
  // by the physical script — so with both plugged in the HDD vanished from the list. When a Fixed
  // drive is mounted, ask the physical script for it. Its failure costs the HDD, never the pendrives.
  const finishNative = async (
    removable: SafeUsbDevice[],
    logPrefix?: string,
  ): Promise<SafeUsbDevice[]> => {
    const devices = await finishRemovableEnumeration(removable, includeHealth, logPrefix);
    if (!fixedDriveMounted) return devices;
    const listed = new Set(devices.map((device) => normalizeRoot(device.rootPath)));
    try {
      const fixed = (
        await parseOutput(
          await runPowerShell(
            ENUMERATE_USB_SCRIPT,
            enumerationTimeout(USB_ENUMERATION_TIMEOUT_MS),
            "enumeracao fisica de HD USB",
          ),
        )
      ).filter((device) => !listed.has(normalizeRoot(device.rootPath)));
      appendAppEvent(
        "usb",
        `enumeracao fisica de HD USB encontrou ${fixed.length} unidade(s): ${fixed.map((device) => device.rootPath).join(", ") || "nenhuma"}`,
      );
      return [...devices, ...fixed];
    } catch (error: any) {
      appendAppEvent(
        "usb",
        `enumeracao fisica de HD USB falhou; listando so os removiveis: ${error?.message || String(error)}`,
      );
      return devices;
    }
  };

  // Also without includeHealth: the preparation's revalidation has no last good list to fall
  // back on, so a second, longer native attempt is all that stands between a slow PowerShell and
  // a failed preparation (finishRemovableEnumeration skips the health probe there).
  let nativeRecoveryAttempted = false;
  const recoverNativeListing = async (reason: string): Promise<SafeUsbDevice[] | null> => {
    if (nativeRecoveryAttempted) return null;
    nativeRecoveryAttempted = true;
    appendAppEvent("usb", `${reason}; tentando novamente pela enumeracao nativa`);
    await wait(ENUMERATION_RECOVERY_DELAY_MS);
    try {
      const removable = await parseNativeOutput(
        await runPowerShell(
          ENUMERATE_REMOVABLE_SCRIPT,
          enumerationTimeout(REMOVABLE_RECOVERY_TIMEOUT_MS),
          "enumeracao nativa, nova tentativa",
        ),
      );
      if (removable.length > 0) {
        return finishNative(removable, "enumeracao nativa recuperada");
      }
    } catch (error: any) {
      appendAppEvent(
        "usb",
        `recuperacao por enumeracao nativa falhou: ${error?.message || String(error)}`,
      );
    }
    return null;
  };

  try {
    const removable = await parseNativeOutput(
      await runPowerShell(
        ENUMERATE_REMOVABLE_SCRIPT,
        enumerationTimeout(REMOVABLE_ENUMERATION_TIMEOUT_MS),
        "enumeracao nativa",
      ),
    );
    if (removable.length > 0) {
      return finishNative(removable);
    }
  } catch (error: any) {
    appendAppEvent("usb", `enumeracao nativa falhou: ${error?.message || String(error)}`);
    if (isUsbEnumerationTimeout(error)) {
      const recovered = await recoverNativeListing("enumeracao nativa excedeu o tempo");
      if (recovered) return recovered;
    }
  }

  try {
    const devices = await parseOutput(
      await runPowerShell(
        ENUMERATE_USB_SCRIPT,
        enumerationTimeout(USB_ENUMERATION_TIMEOUT_MS),
        "enumeracao fisica",
      ),
    );
    appendAppEvent(
      "usb",
      `enumeracao fisica encontrou ${devices.length} unidade(s): ${devices.map((device) => device.rootPath).join(", ") || "nenhuma"}`,
    );
    return devices;
  } catch (error: any) {
    appendAppEvent("usb", `enumeracao fisica falhou: ${error?.message || String(error)}`);
    if (isUsbEnumerationTimeout(error)) {
      const recovered = await recoverNativeListing("enumeracao fisica excedeu o tempo");
      if (recovered) return recovered;
    }
    throw error;
  }
}

/**
 * The physical row (partition style, partition count, MBR type, sector size) for the drive at
 * `rootPath`, for the preparation's console-compatibility gate.
 *
 * A pendrive is listed by ENUMERATE_REMOVABLE_SCRIPT, which cannot see any of that, so the gate
 * runs the physical script once per preparation. Never call this from a poll: it is Storage
 * Management, the service the native listing exists to stay clear of.
 *
 * Returns null when the layout cannot be read (PowerShell slow or failing, no single row for
 * the letter) and logs why; the caller decides what an unknown layout means. A row from the
 * Win32_DiskDrive fallback comes back with an empty partition style, which is unknown too.
 */
export async function readWindowsUsbDiskLayout(rootPath: string): Promise<PhysicalUsbDevice | null> {
  if (process.platform !== "win32") return null;
  const normalizedRoot = normalizeRoot(rootPath);
  let rows: any[];
  try {
    const output = (
      await runPowerShell(
        ENUMERATE_USB_SCRIPT,
        enumerationTimeout(USB_ENUMERATION_TIMEOUT_MS),
        "layout do disco",
      )
    ).trim();
    const parsed = output ? JSON.parse(output) : [];
    rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  } catch (error: any) {
    appendAppEvent("usb", `layout do disco ${normalizedRoot} indisponivel: ${error?.message || String(error)}`);
    return null;
  }
  const matches = rows.filter(
    (row) => row?.RootPath && normalizeRoot(asString(row.RootPath)) === normalizedRoot,
  );
  if (matches.length !== 1) {
    appendAppEvent("usb", `layout do disco ${normalizedRoot}: ${matches.length} linha(s) na enumeracao fisica`);
    return null;
  }
  return parsePhysicalDevice(matches[0]);
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
    const res = await runPowerShell(script, 10_000, "ejecao", false);
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
  let devices: SafeUsbDevice[];
  try {
    devices = await enumerateSafeWindowsUsbDevices();
  } catch (error) {
    throw await explainSlowEnumeration(error, normalizedRoot);
  }
  const matches = devices.filter((device) => normalizeRoot(device.rootPath) === normalizedRoot);
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
  const output = (
    await runPowerShell(script, enumerationTimeout(timeoutMs), "revalidacao pela outra enumeracao")
  ).trim();
  if (!output) return null;

  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const candidates = rows
    .filter((row: any) => row?.RootPath && !isFixedDriveMarker(row))
    .map((row: any) => enrichDeviceSafety(parsePhysicalDevice(row), systemDrive))
    .filter((device) => normalizeRoot(device.rootPath) === normalizedRoot);
  if (candidates.length !== 1) return null;

  assertDeviceStillMatches(expectedFingerprint, candidates[0]);
  return (await fillAllocationUnits(candidates))[0];
}


