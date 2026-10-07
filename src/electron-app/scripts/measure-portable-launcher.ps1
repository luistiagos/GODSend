<#
.SYNOPSIS
    Runs a portable .exe the way a customer does and records what they would see.

.DESCRIPTION
    Starts the launcher with TEMP/TMP pointed at -TempDir and samples, until the
    app window shows up or the launcher gives up:
      - how much of TEMP is in use, and by what (peak, and with the app open);
      - every window the launcher itself shows, with the text of its controls
        (progress window, warning boxes);
      - when the app window appears, the exit code, what is left in TEMP.
    Warning boxes of the launcher are answered after -DialogHoldSec. At the end
    it closes only what it started: processes whose image is under -TempDir.

    Use a copy of the .exe in a folder of its own: the portable keeps its data in
    <folder of the .exe>\godsend-data.

.EXAMPLE
    .\measure-portable-launcher.ps1 -Exe C:\t\run\xboxcompanion.exe -TempDir C:\t\temp

.EXAMPLE
    # the "no space" warning on a disk that has room
    .\measure-portable-launcher.ps1 -Exe C:\t\run\xboxcompanion.exe -TempDir C:\t\temp -Env @{ XBOX360COMPANION_LAUNCHER_EXTRA_MB = '99999999' }

.NOTES
    Compare second runs: the first run of a freshly built .exe includes a few
    seconds of antivirus scan before the process even starts.
#>
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$TempDir,
  [string]$ExeArgs = "",
  [hashtable]$Env = @{},
  [int]$TimeoutSec = 300,
  # Seconds to keep the app open once its window is up, to read the steady disk usage
  [int]$HoldSec = 6,
  # Answer to a warning box of the launcher: ok | none
  [string]$DialogAction = "ok",
  [int]$DialogHoldSec = 2,
  # Folder for PNGs of the launcher's windows
  [string]$ShotDir = "",
  [string[]]$AppProcessNames = @('Xbox360Companion', 'godsend-backend', 'aria2c'),
  [int]$PollMs = 200,
  [switch]$Timeline,
  [switch]$Json
)
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class LauncherWindows {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")] public static extern IntPtr SendMessageText(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll", EntryPoint="SendMessageW")] public static extern IntPtr SendMessageInt(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string Text(IntPtr h) { var sb = new StringBuilder(4096); SendMessageText(h, 0x000D, (IntPtr)sb.Capacity, sb); return sb.ToString(); }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }
  public static List<IntPtr> Top() { var l = new List<IntPtr>(); EnumWindows((h, p) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
  public static List<IntPtr> Kids(IntPtr p) { var l = new List<IntPtr>(); EnumChildWindows(p, (h, x) => { l.Add(h); return true; }, IntPtr.Zero); return l; }
}
"@

function Get-DirBytes([string]$p) {
  $sum = 0L
  if (-not (Test-Path -LiteralPath $p)) { return 0L }
  try {
    foreach ($f in [IO.Directory]::EnumerateFiles($p, '*', [IO.SearchOption]::AllDirectories)) {
      try { $sum += ([IO.FileInfo]$f).Length } catch {}
    }
  } catch {}
  return $sum
}

# One pass over TEMP: total bytes, plus each entry of the launcher's own folders
# (app, app.7z ... inside ns*.tmp) above 1 MB.
function Get-TempUsage {
  $total = 0L; $parts = @()
  foreach ($d in (Get-ChildItem -LiteralPath $TempDir -Force -ErrorAction SilentlyContinue)) {
    if ($d.PSIsContainer) {
      foreach ($e in (Get-ChildItem -LiteralPath $d.FullName -Force -ErrorAction SilentlyContinue)) {
        if ($e.PSIsContainer) { $sz = Get-DirBytes $e.FullName } else { $sz = $e.Length }
        $total += $sz
        if ($sz -gt 1MB) { $parts += ("{0}={1:N0} MB" -f $e.Name, ($sz / 1MB)) }
      }
    } else {
      $total += $d.Length
      if ($d.Length -gt 1MB) { $parts += ("{0}={1:N0} MB" -f $d.Name, ($d.Length / 1MB)) }
    }
  }
  return [pscustomobject]@{ bytes = $total; breakdown = ($parts -join ' + ') }
}

function Get-StartedAppProcesses {
  Get-Process -Name $AppProcessNames -ErrorAction SilentlyContinue | Where-Object {
    $p = $null
    try { $p = $_.Path } catch {}
    $p -and $p.StartsWith($TempDir, [StringComparison]::OrdinalIgnoreCase)
  }
}

function Get-VisibleWindows([int[]]$Pids) {
  $out = @()
  foreach ($h in [LauncherWindows]::Top()) {
    $procId = 0
    [void][LauncherWindows]::GetWindowThreadProcessId($h, [ref]$procId)
    if ($Pids -notcontains [int]$procId) { continue }
    if (-not [LauncherWindows]::IsWindowVisible($h)) { continue }
    $r = New-Object LauncherWindows+RECT
    [void][LauncherWindows]::GetWindowRect($h, [ref]$r)
    $kids = @()
    foreach ($k in [LauncherWindows]::Kids($h)) {
      if (-not [LauncherWindows]::IsWindowVisible($k)) { continue }
      $cls = [LauncherWindows]::Cls($k)
      $txt = [LauncherWindows]::Text($k)
      if ($cls -eq 'msctls_progress32') { $txt = "progress " + [LauncherWindows]::SendMessageInt($k, 0x0408, [IntPtr]::Zero, [IntPtr]::Zero).ToInt64() }
      if ($txt) { $kids += [pscustomobject]@{ hwnd = $k; cls = $cls; id = [LauncherWindows]::GetDlgCtrlID($k); text = $txt } }
    }
    $out += [pscustomobject]@{
      hwnd = $h; cls = [LauncherWindows]::Cls($h); title = [LauncherWindows]::Text($h)
      w = $r.R - $r.L; h = $r.B - $r.T; kids = $kids
    }
  }
  return $out
}

# Asks ONE window to paint itself into a bitmap (PrintWindow). It never copies
# the screen, which would capture whatever else is on top of those pixels.
function Save-WindowPng($win, [string]$name) {
  if (-not $ShotDir -or $win.w -le 0 -or $win.h -le 0) { return "" }
  New-Item -ItemType Directory -Force -Path $ShotDir | Out-Null
  $file = Join-Path $ShotDir $name
  $bmp = New-Object System.Drawing.Bitmap($win.w, $win.h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $ok = [LauncherWindows]::PrintWindow($win.hwnd, $hdc, 2)
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  if ($ok) { $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png) } else { $file = "" }
  $bmp.Dispose()
  return $file
}

if (Test-Path -LiteralPath $TempDir) {
  Get-ChildItem -LiteralPath $TempDir -Force | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
} else {
  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
}
$TempDir = (Resolve-Path -LiteralPath $TempDir).Path
$drive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($TempDir))
$freeStart = $drive.AvailableFreeSpace

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $Exe
$psi.Arguments = $ExeArgs
$psi.UseShellExecute = $false
$psi.WorkingDirectory = Split-Path -Parent $Exe
# A terminal inside VS Code exports ELECTRON_RUN_AS_NODE=1. With it the packaged
# app starts as plain Node and exits at once with code 0, which looks exactly
# like "the portable does not open". A customer never has these set.
foreach ($k in @($psi.EnvironmentVariables.Keys)) {
  if ($k -match '^(ELECTRON_|VSCODE_|CHROME_CRASHPAD)') { $psi.EnvironmentVariables.Remove($k) }
}
$psi.EnvironmentVariables['TEMP'] = $TempDir
$psi.EnvironmentVariables['TMP'] = $TempDir
foreach ($k in $Env.Keys) { $psi.EnvironmentVariables[$k] = [string]$Env[$k] }

$clock = [Diagnostics.Stopwatch]::StartNew()
$launcher = [Diagnostics.Process]::Start($psi)

$peak = 0L; $peakBreakdown = ""; $minFree = $freeStart
$firstLauncherWindow = $null; $lastLauncherWindow = $null; $appWindowAt = $null; $appWindow = ""
$windows = New-Object System.Collections.ArrayList
$seen = @{}
$samples = New-Object System.Collections.ArrayList
$boxSince = $null

while ($clock.Elapsed.TotalSeconds -lt $TimeoutSec) {
  $t = [math]::Round($clock.Elapsed.TotalSeconds, 1)
  $usage = Get-TempUsage
  $free = $drive.AvailableFreeSpace
  if ($free -lt $minFree) { $minFree = $free }
  if ($usage.bytes -gt $peak) { $peak = $usage.bytes; $peakBreakdown = $usage.breakdown }

  $box = $false
  foreach ($w in @(Get-VisibleWindows @($launcher.Id))) {
    if ($null -eq $firstLauncherWindow) { $firstLauncherWindow = $t }
    $lastLauncherWindow = $t
    # Digits out of the key: "24% (11 / 45 MB)" and "25% (12 / 45 MB)" are one state.
    $key = ("$($w.cls)|$($w.title)|" + (@($w.kids | Where-Object { $_.cls -ne 'msctls_progress32' } | ForEach-Object { $_.text }) -join '|')) -replace '\d+', '#'
    if (-not $seen.ContainsKey($key)) {
      $seen[$key] = $true
      [void]$windows.Add([pscustomobject]@{
        atSec = $t; title = $w.title.Trim(); size = "$($w.w)x$($w.h)"
        controls = @($w.kids | ForEach-Object { "[$($_.cls)] $($_.text)" })
        png = (Save-WindowPng $w ("launcher-{0}-t{1}.png" -f $windows.Count, $t))
      })
    }
    # A warning box: a dialog with a button and no progress bar.
    $buttons = @($w.kids | Where-Object { $_.cls -eq 'Button' })
    if ($w.cls -eq '#32770' -and $buttons.Count -gt 0 -and -not ($w.kids | Where-Object { $_.cls -eq 'msctls_progress32' })) {
      $box = $true
      if ($null -eq $boxSince) { $boxSince = $clock.Elapsed.TotalSeconds }
      if ($DialogAction -eq 'ok' -and ($clock.Elapsed.TotalSeconds - $boxSince) -ge $DialogHoldSec) {
        # WM_COMMAND to the dialog: BM_CLICK to the button is dropped when the
        # dialog is not the active window. Sent again while the box is still up.
        [void][LauncherWindows]::PostMessage($w.hwnd, 0x0111, [IntPtr]$buttons[0].id, $buttons[0].hwnd)
        $boxSince = $clock.Elapsed.TotalSeconds
      }
    }
  }
  if (-not $box) { $boxSince = $null }

  $apps = @(Get-StartedAppProcesses)
  if ($apps.Count -gt 0 -and $null -eq $appWindowAt) {
    $aw = @(Get-VisibleWindows @($apps | ForEach-Object { $_.Id })) | Where-Object { $_.w -gt 300 -and $_.h -gt 200 } | Select-Object -First 1
    if ($aw) { $appWindowAt = $t; $appWindow = "$($aw.title) ($($aw.w)x$($aw.h))" }
  }

  [void]$samples.Add(("{0,6}s  temp={1,6:N0} MB  app processes={2}  {3}" -f $t, ($usage.bytes / 1MB), $apps.Count, $usage.breakdown))
  if ($launcher.HasExited) { break }
  if ($null -ne $appWindowAt -and ($clock.Elapsed.TotalSeconds - $appWindowAt) -ge $HoldSec) { break }
  Start-Sleep -Milliseconds $PollMs
}

$timedOut = (-not $launcher.HasExited) -and ($null -eq $appWindowAt)
$steady = $null; $appImage = ""
if ($null -ne $appWindowAt) {
  $steady = Get-TempUsage
  $appImage = (@(Get-StartedAppProcesses) | Select-Object -First 1).Path
}

# Close only what this run started.
foreach ($p in @(Get-StartedAppProcesses)) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {} }
$wait = 180000
if ($timedOut) { $wait = 1500 } # no app was started: the launcher is stuck on a window of its own
if (-not $launcher.WaitForExit($wait)) { try { Stop-Process -Id $launcher.Id -Force } catch {}; [void]$launcher.WaitForExit(15000) }
foreach ($p in @(Get-StartedAppProcesses)) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {} }
Start-Sleep -Milliseconds 500

$result = [ordered]@{
  exe                 = $Exe
  exeBytes            = (Get-Item -LiteralPath $Exe).Length
  tempDir             = $TempDir
  freeAtStartMB       = [math]::Round($freeStart / 1MB)
  lowestFreeMB        = [math]::Round($minFree / 1MB)
  peakTempMB          = [math]::Round($peak / 1MB)
  peakTemp            = $peakBreakdown
  tempWithAppOpenMB   = $(if ($steady) { [math]::Round($steady.bytes / 1MB) } else { $null })
  tempWithAppOpen     = $(if ($steady) { $steady.breakdown } else { "" })
  launcherWindowFirstSec = $firstLauncherWindow
  launcherWindowLastSec  = $lastLauncherWindow
  appWindowSec        = $appWindowAt
  appWindow           = $appWindow
  appImage            = $appImage
  launcherStuck       = $timedOut
  launcherExitCode    = $(try { $launcher.ExitCode } catch { $null })
  leftInTempMB        = [math]::Round((Get-DirBytes $TempDir) / 1MB, 1)
  launcherWindows     = $windows
}

if ($Json) {
  $result | ConvertTo-Json -Depth 6
} else {
  "{0} ({1:N0} bytes)" -f $result.exe, $result.exeBytes
  "  TEMP: {0} ({1:N0} MB free at start, lowest {2:N0} MB)" -f $result.tempDir, $result.freeAtStartMB, $result.lowestFreeMB
  "  peak in TEMP: {0:N0} MB  [{1}]" -f $result.peakTempMB, $result.peakTemp
  if ($null -ne $appWindowAt) {
    "  app window at {0} s: {1}" -f $appWindowAt, $appWindow
    "  app image: {0}" -f $appImage
    "  in TEMP with the app open: {0:N0} MB  [{1}]" -f $result.tempWithAppOpenMB, $result.tempWithAppOpen
  } elseif ($timedOut) {
    "  NO APP WINDOW after {0} s; the launcher was still running and was killed" -f $TimeoutSec
  } else {
    "  NO APP WINDOW: the launcher ended by itself"
  }
  "  launcher exit code: {0}; left in TEMP: {1} MB" -f $result.launcherExitCode, $result.leftInTempMB
  if ($windows.Count -eq 0) {
    "  launcher windows: NONE"
  } else {
    "  launcher windows (first seen {0} s, last seen {1} s):" -f $firstLauncherWindow, $lastLauncherWindow
    foreach ($w in $windows) {
      "    {0,5} s  '{1}' {2}" -f $w.atSec, $w.title, $w.size
      foreach ($c in $w.controls) { "             " + ($c -replace "`r?`n", "`n             ") }
      if ($w.png) { "             png: $($w.png)" }
    }
  }
}
if ($Timeline) { ""; $samples }
