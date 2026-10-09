# Roda ELEVADO. Para cada cenario de scenarios.json (gerado por generate.cjs): cria um VHDX
# dinamico, monta o layout de chegada, troca o GUID/capacidade de mentira do template pelos reais,
# relaxa o guarda de BusType = USB SO nesta copia (passa a exigir 'File Backed Virtual' E o numero
# do disco do VHD), roda o script do formatador no mesmo powershell.exe do app e confere o disco por
# fora. Desmonta e apaga cada VHD no fim. Somente ASCII neste arquivo (PowerShell 5.1 le sem BOM
# como ANSI).
param([Parameter(Mandatory = $true)][string]$WorkDir)
$ErrorActionPreference = 'Stop'
$WorkDir = (Resolve-Path $WorkDir).Path
Start-Transcript -Path (Join-Path $WorkDir 'harness.transcript.txt') -Force | Out-Null
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$manifest = Get-Content (Join-Path $WorkDir 'scenarios.json') -Raw | ConvertFrom-Json
$preDisks = @(Get-Disk | ForEach-Object { [int]$_.Number })
"Discos antes do teste: $($preDisks -join ', ')"
$results = @()

function Invoke-Dp([string[]]$lines) {
  $f = [System.IO.Path]::GetTempFileName()
  try {
    $lines | Out-File -FilePath $f -Encoding ascii
    $out = & (Join-Path $env:SystemRoot 'System32\diskpart.exe') /s $f 2>&1
    if ($LASTEXITCODE -ne 0) { throw "diskpart falhou ($LASTEXITCODE): $($out | Out-String)" }
  } finally { Remove-Item $f -Force -ErrorAction SilentlyContinue }
}

function Replace-Once([string]$text, [string]$old, [string]$new) {
  $idx = $text.IndexOf($old)
  if ($idx -lt 0 -or $text.IndexOf($old, $idx + 1) -ge 0) { throw "trecho do template nao achado exatamente 1 vez: $old" }
  return $text.Replace($old, $new)
}

foreach ($s in $manifest.scenarios) {
  $vhd = Join-Path $WorkDir "$($s.id).vhdx"
  $r = [ordered]@{ id = $s.id; note = $s.note }
  try {
    if (Get-Volume -DriveLetter $s.letter -ErrorAction SilentlyContinue) { throw "letra $($s.letter): ja esta em uso" }
    if (Test-Path $vhd) { Remove-Item $vhd -Force }
    Invoke-Dp @("create vdisk file=""$vhd"" maximum=$($s.sizeMb) type=expandable", "select vdisk file=""$vhd""", "attach vdisk")
    Start-Sleep -Seconds 2
    $disk = Get-DiskImage -ImagePath $vhd | Get-Disk
    $n = [int]$disk.Number
    if ($disk.BusType -ne 'File Backed Virtual' -or $preDisks -contains $n) { throw "disco $n nao e o VHD novo (BusType=$($disk.BusType))" }
    $r.diskNumber = $n
    Initialize-Disk -Number $n -PartitionStyle $s.style
    switch ($s.setup) {
      'fat32' {
        $p = New-Partition -DiskNumber $n -UseMaximumSize -DriveLetter $s.letter
        Format-Volume -Partition $p -FileSystem FAT32 -NewFileSystemLabel 'CHEGADA' -Confirm:$false | Out-Null
      }
      'ntfs' {
        $p = New-Partition -DiskNumber $n -UseMaximumSize -DriveLetter $s.letter
        Format-Volume -Partition $p -FileSystem NTFS -NewFileSystemLabel 'CHEGADA' -Confirm:$false | Out-Null
      }
      'ntfs-type7' {
        $p = New-Partition -DiskNumber $n -UseMaximumSize -DriveLetter $s.letter -MbrType IFS
        Format-Volume -Partition $p -FileSystem NTFS -NewFileSystemLabel 'CHEGADA' -Confirm:$false | Out-Null
      }
      'two-partitions' {
        $p = New-Partition -DiskNumber $n -Size 4GB -DriveLetter $s.letter
        Format-Volume -Partition $p -FileSystem FAT32 -NewFileSystemLabel 'CHEGADA' -Confirm:$false | Out-Null
        $p2 = New-Partition -DiskNumber $n -Size 2GB -AssignDriveLetter:$false
        Format-Volume -Partition $p2 -FileSystem NTFS -NewFileSystemLabel 'SEGUNDA' -Confirm:$false | Out-Null
      }
      default { throw "setup desconhecido: $($s.setup)" }
    }
    Update-Disk -Number $n
    $arrDisk = Get-Disk -Number $n
    $arrParts = @(Get-Partition -DiskNumber $n)
    $part = Get-Partition -DriveLetter $s.letter
    $r.arrival = "$($arrDisk.PartitionStyle), $($arrParts.Count) particao(oes): " + (($arrParts | ForEach-Object { "#$($_.PartitionNumber) $($_.Type)/mbr$($_.MbrType) $([int64]$_.Size) letra=$($_.DriveLetter)" }) -join '; ')
    $guid = ((& (Join-Path $env:SystemRoot 'System32\mountvol.exe') "$($s.letter):\" '/L' 2>$null) -join '').Trim()
    if ($guid -notmatch '^\\\\\?\\Volume\{[0-9a-f-]+\}\\$') { throw "GUID do volume invalido: $guid" }

    $tpl = [System.IO.File]::ReadAllText((Join-Path $WorkDir "$($s.id).template.ps1"), $utf8NoBom)
    $txt = Replace-Once $tpl "`$expectedVolumeGuid = '$($manifest.dummyGuid)'" "`$expectedVolumeGuid = '$guid'"
    $txt = Replace-Once $txt "`$expectedVolumeBytes = [int64]$($manifest.dummyBytes)" "`$expectedVolumeBytes = [int64]$([int64]$part.Size)"
    $txt = Replace-Once $txt "`$disk.BusType -ne 'USB'" "(`$disk.BusType -ne 'File Backed Virtual' -or `$diskNo -ne $n)"
    foreach ($patch in @($s.patches)) {
      if ($patch) { $txt = Replace-Once $txt $patch.old $patch.new }
    }
    $ps1 = Join-Path $WorkDir "$($s.id).run.ps1"
    [System.IO.File]::WriteAllText($ps1, $txt, $utf8NoBom)

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $psExe -NoProfile -ExecutionPolicy Bypass -File $ps1 | Out-Null
    $r.exitCode = [int]$LASTEXITCODE
    $r.seconds = [Math]::Round($sw.Elapsed.TotalSeconds, 1)

    Update-Disk -Number $n
    $fd = Get-Disk -Number $n
    $fp = @(Get-Partition -DiskNumber $n)
    $r.finalStyle = [string]$fd.PartitionStyle
    $r.finalCount = $fp.Count
    if ($fp.Count -ge 1) {
      $r.finalMbrType = [int]$fp[0].MbrType
      $r.finalPartitionBytes = [int64]$fp[0].Size
      $r.finalLetter = [string]$fp[0].DriveLetter
      $fv = Get-Volume -Partition $fp[0] -ErrorAction SilentlyContinue
      $r.finalFs = [string]$fv.FileSystem
      $r.finalLabel = [string]$fv.FileSystemLabel
    }
    $r.diskBytes = [int64]$fd.Size
  } catch {
    $r.harnessError = ($_ | Out-String).Trim()
  } finally {
    try { Dismount-DiskImage -ImagePath $vhd -ErrorAction Stop | Out-Null } catch { $r.dismountError = $_.Exception.Message }
    Start-Sleep -Seconds 1
    Remove-Item $vhd -Force -ErrorAction SilentlyContinue
    $r.vhdRemoved = -not (Test-Path $vhd)
  }
  $results += [pscustomobject]$r
  "$($s.id): $(([pscustomobject]$r) | ConvertTo-Json -Compress)"
}

[System.IO.File]::WriteAllText((Join-Path $WorkDir 'results.json'), ($results | ConvertTo-Json -Depth 4), $utf8NoBom)
"Discos depois do teste: $((@(Get-Disk | ForEach-Object { [int]$_.Number })) -join ', ')"
Stop-Transcript | Out-Null
