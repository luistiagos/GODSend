import { spawn } from "child_process";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertDeviceStillMatches,
  enrichDeviceSafety,
  type PhysicalUsbDevice,
  type SafeUsbDevice,
} from "./deviceSafetyPolicy";

function runPowerShell(script: string): Promise<string> {
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
      "powershell.exe",
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
        reject(new Error("O Windows demorou demais para listar os dispositivos USB."));
      });
    }, 10_000);
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", (error) => finish(() => { cleanup(); reject(error); }));
    child.on("close", (code) => {
      finish(() => {
        cleanup();
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr.trim() || "Não foi possível enumerar os dispositivos USB."));
      });
    });
  });
}

const ENUMERATE_USB_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$rows = @()

try {
  $disks = @(Get-Disk -ErrorAction SilentlyContinue | Where-Object { $_.BusType -eq 'USB' })
  foreach ($disk in $disks) {
    $mounted = @(Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter })
    foreach ($partition in $mounted) {
      $volume = Get-Volume -Partition $partition -ErrorAction SilentlyContinue
      $rows += [PSCustomObject]@{
        RootPath = ($partition.DriveLetter.ToString().ToUpperInvariant() + ':\')
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
        FriendlyName = [string]$disk.FriendlyName
        Manufacturer = [string]$disk.Manufacturer
        BusType = [string]$disk.BusType
        PartitionStyle = [string]$disk.PartitionStyle
        DriveType = if ($volume.DriveType) { [string]$volume.DriveType } else { '' }
        DiskPath = [string]$disk.Path
        OperationalStatus = (@($disk.OperationalStatus) -join ',')
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
        $rows += [PSCustomObject]@{
          RootPath = $ld.DeviceID + '\'
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
          FriendlyName = [string]$disk.Model
          Manufacturer = [string]$disk.Manufacturer
          BusType = 'USB'
          PartitionStyle = ''
          DriveType = 'Removable'
          DiskPath = [string]$disk.DeviceID
          OperationalStatus = ''
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
    friendlyName: asString(row.FriendlyName),
    manufacturer: asString(row.Manufacturer),
    busType: asString(row.BusType),
    partitionStyle: asString(row.PartitionStyle),
    driveType: asString(row.DriveType),
    diskPath: asString(row.DiskPath),
    operationalStatus: asString(row.OperationalStatus),
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

export async function enumerateSafeWindowsUsbDevices(): Promise<SafeUsbDevice[]> {
  if (process.platform !== "win32") return [];
  const output = (await runPowerShell(ENUMERATE_USB_SCRIPT)).trim();
  if (!output) return [];

  let parsed: any;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("O Windows retornou dados inválidos ao enumerar os dispositivos USB.");
  }

  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const systemDrive = process.env.SystemDrive || "C:";
  return rows
    .filter((row) => row?.RootPath)
    .map((row) => enrichDeviceSafety(parsePhysicalDevice(row), systemDrive));
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

  assertDeviceStillMatches(expectedFingerprint, matches[0]);
  return matches[0];
}
