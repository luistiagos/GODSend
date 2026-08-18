<#
.SYNOPSIS
    Uploads the portable build to Cloudflare R2 as xboxcompanion.exe (distribution version).
    Only keeps one version — always overwrites the remote file.
    Credentials lidos do build.properties (R2_*) ou r2-config.json.
#>
[CmdletBinding()]
param(
    [string]$LocalPath = "",
    [string]$Config = "",
    [switch]$NoVerify
)

$ErrorActionPreference = "Stop"

# Load build.properties
$envFile = Join-Path $PSScriptRoot "build.properties"
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile -Encoding UTF8 | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)\s*$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"', "'")
            Set-Variable -Name $k -Value $v -Scope Script
        }
    }
}

$pkgJson = Join-Path $PSScriptRoot "package.json"
$VERSION = if (Test-Path -LiteralPath $pkgJson) {
    (Get-Content -LiteralPath $pkgJson -Raw -Encoding UTF8 | ConvertFrom-Json).version
} else {
    "2.12.39"
}

if (-not $LocalPath) {
    $LocalPath = Join-Path $PSScriptRoot "dist\xbox-360-companion-Portable-$VERSION.exe"
}

if (-not (Test-Path -LiteralPath $LocalPath)) {
    throw "Portable build not found: $LocalPath`nRun 'npm run build:electron:win:portable' first."
}

# Try build.properties first, fall back to r2-config.json
if ($Script:R2_ACCESS_KEY_ID -and $Script:R2_SECRET_ACCESS_KEY -and $Script:R2_ENDPOINT -and $Script:R2_BUCKET) {
    $cfg = [PSCustomObject]@{
        accessKeyId     = $Script:R2_ACCESS_KEY_ID
        secretAccessKey = $Script:R2_SECRET_ACCESS_KEY
        endpoint        = $Script:R2_ENDPOINT
        bucket          = $Script:R2_BUCKET
        publicBaseUrl   = if ($Script:R2_PUBLIC_URL) { $Script:R2_PUBLIC_URL } else { "https://versions.digitalstoregames.com" }
    }
} else {
    if (-not $Config) {
        $Config = Join-Path $PSScriptRoot "r2-config.json"
    }
    if (-not (Test-Path -LiteralPath $Config)) {
        throw "Credenciais R2 nao encontradas. Defina R2_* no build.properties (veja build.properties.example) ou crie r2-config.json."
    }
    $cfg = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $cfg.publicBaseUrl) { $cfg.publicBaseUrl = "https://versions.digitalstoregames.com" }
}

foreach ($field in @('accessKeyId', 'secretAccessKey', 'endpoint', 'bucket')) {
    if (-not $cfg.$field) {
        throw "Config R2 faltando campo obrigatorio: $field"
    }
}

function Find-Rclone {
    $cmd = Get-Command rclone -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidate = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "rclone.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if ($candidate) { return $candidate }

    throw "rclone.exe not found. Install with: winget install Rclone.Rclone"
}

$rclone = Find-Rclone
$publicBase = if ($cfg.publicBaseUrl) { $cfg.publicBaseUrl.TrimEnd('/') } else { "https://versions.digitalstoregames.com" }

# Hash e tamanho
$localSha256 = (Get-FileHash -LiteralPath $LocalPath -Algorithm SHA256).Hash.ToLower()
$localSize = (Get-Item -LiteralPath $LocalPath).Length

# Gera version.json e .sha256
$distDir = Join-Path $PSScriptRoot "dist"
$shaFile = Join-Path $distDir "xboxcompanion.exe.sha256"
"$localSha256  xboxcompanion.exe" | Out-File -FilePath $shaFile -Encoding ascii -Force

$versionJsonFile = Join-Path $distDir "version.json"
$downloadUrl = "$publicBase/XBOX360Companion/xboxcompanion.exe?v=$VERSION"
$versionPayload = [ordered]@{
    version     = $VERSION
    versionCode = $VERSION
    releaseDate = (Get-Date -Format "yyyy-MM-dd")
    channel     = "default"
    downloadUrl = $downloadUrl
    sha256      = $localSha256
    size        = [long]$localSize
    notes       = "Xbox 360 Companion v$VERSION"
    portableUrl = $downloadUrl
} | ConvertTo-Json -Depth 4
$versionPayload | Out-File -FilePath $versionJsonFile -Encoding ascii -Force

# Copy to a temp file named xboxcompanion.exe for distribution
$tempDir = Join-Path $env:TEMP "godsend-upload"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$tempFile = Join-Path $tempDir "xboxcompanion.exe"
Copy-Item -LiteralPath $LocalPath -Destination $tempFile -Force

$destRoot = ":s3:$($cfg.bucket)"
$destFolder = ":s3:$($cfg.bucket)/XBOX360Companion"

$s3Flags = @(
    "--s3-provider=Cloudflare",
    "--s3-access-key-id=$($cfg.accessKeyId)",
    "--s3-secret-access-key=$($cfg.secretAccessKey)",
    "--s3-endpoint=$($cfg.endpoint)",
    "--s3-no-check-bucket"
)

Write-Host "Uploading xboxcompanion.exe -> '$($cfg.bucket)/XBOX360Companion' and root..." -ForegroundColor Cyan
& $rclone copy $tempFile $destFolder @s3Flags --progress
if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
    throw "rclone copy failed with exit code $LASTEXITCODE"
}
& $rclone copy $tempFile $destRoot @s3Flags

# Upload sidecars and version.json
$txtHeaders = @(
    "--header-upload=Content-Type: text/plain; charset=utf-8",
    "--header-upload=Cache-Control: max-age=300"
)
& $rclone copyto $shaFile "$destFolder/xboxcompanion.exe.sha256" @s3Flags @txtHeaders
& $rclone copyto $shaFile "$destRoot/xboxcompanion.exe.sha256" @s3Flags @txtHeaders

$jsonHeaders = @(
    "--header-upload=Content-Type: application/json; charset=utf-8",
    "--header-upload=Cache-Control: max-age=300"
)
& $rclone copyto $versionJsonFile "$destFolder/version.json" @s3Flags @jsonHeaders
& $rclone copyto $versionJsonFile "$destRoot/version.json" @s3Flags @jsonHeaders

if (-not $NoVerify) {
    Write-Host ""
    Write-Host "Verifying transfer..." -ForegroundColor Cyan

    $remoteEntries = & $rclone lsjson $destFolder @s3Flags -R | ConvertFrom-Json
    $remoteByName = @{}
    foreach ($e in $remoteEntries) {
        if (-not $e.IsDir) { $remoteByName[$e.Name] = $e.Size }
    }

    if (-not $remoteByName.ContainsKey("xboxcompanion.exe")) {
        Write-Host "  MISSING on remote: xboxcompanion.exe" -ForegroundColor Red
        throw "Verification failed - file did not upload."
    }
    $remoteSize = $remoteByName["xboxcompanion.exe"]
    if ($remoteSize -ne $localSize) {
        throw "SIZE MISMATCH: xboxcompanion.exe (local $localSize bytes, remote $remoteSize bytes)"
    }
    Write-Host ("  OK: xboxcompanion.exe ($localSize bytes)") -ForegroundColor Green
    Write-Host ("  OK: version.json and sidecar uploaded") -ForegroundColor Green
    Write-Host "Verification passed." -ForegroundColor Green
}

Remove-Item -LiteralPath $tempFile -Force

Write-Host ""
Write-Host "Public URLs:" -ForegroundColor Green
Write-Host "  $publicBase/XBOX360Companion/xboxcompanion.exe"
Write-Host "  $publicBase/XBOX360Companion/version.json"

Write-Host ""
Write-Host "Done - xboxcompanion.exe and version.json are live on the distribution server." -ForegroundColor Green
