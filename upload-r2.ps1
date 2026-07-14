<#
.SYNOPSIS
    Uploads the portable build to Cloudflare R2 as xboxcompanion.exe (distribution version).
    Only keeps one version — always overwrites the remote file.
    Credentials lidos do .env (R2_*) ou r2-config.json.
#>
[CmdletBinding()]
param(
    [string]$LocalPath = "",
    [string]$Config = "",
    [switch]$NoVerify
)

$ErrorActionPreference = "Stop"

# Load .env
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path -LiteralPath $envFile) {
    Get-Content -LiteralPath $envFile -Encoding UTF8 | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)\s*$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"', "'")
            Set-Variable -Name $k -Value $v -Scope Script
        }
    }
}

$VERSION = "2.12.26"

if (-not $LocalPath) {
    $LocalPath = Join-Path $PSScriptRoot "dist\xbox-360-companion-Portable-$VERSION.exe"
}

if (-not (Test-Path -LiteralPath $LocalPath)) {
    throw "Portable build not found: $LocalPath`nRun 'npm run build:electron:win:portable' first."
}

# Try .env first, fall back to r2-config.json
if ($Script:R2_ACCESS_KEY_ID -and $Script:R2_SECRET_ACCESS_KEY -and $Script:R2_ENDPOINT -and $Script:R2_BUCKET) {
    $cfg = [PSCustomObject]@{
        accessKeyId     = $Script:R2_ACCESS_KEY_ID
        secretAccessKey = $Script:R2_SECRET_ACCESS_KEY
        endpoint        = $Script:R2_ENDPOINT
        bucket          = $Script:R2_BUCKET
        publicBaseUrl   = if ($Script:R2_PUBLIC_URL) { $Script:R2_PUBLIC_URL } else { "" }
    }
} else {
    if (-not $Config) {
        $Config = Join-Path $PSScriptRoot "r2-config.json"
    }
    if (-not (Test-Path -LiteralPath $Config)) {
        throw "Credenciais R2 nao encontradas. Defina R2_* no .env (veja .env.example) ou crie r2-config.json."
    }
    $cfg = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
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

# Copy to a temp file named xboxcompanion.exe for distribution
$tempDir = Join-Path $env:TEMP "godsend-upload"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$tempFile = Join-Path $tempDir "xboxcompanion.exe"
Copy-Item -LiteralPath $LocalPath -Destination $tempFile -Force

$dest = ":s3:$($cfg.bucket)"

$s3Flags = @(
    "--s3-provider=Cloudflare",
    "--s3-access-key-id=$($cfg.accessKeyId)",
    "--s3-secret-access-key=$($cfg.secretAccessKey)",
    "--s3-endpoint=$($cfg.endpoint)",
    "--s3-no-check-bucket"
)

Write-Host "Uploading xboxcompanion.exe -> bucket '$($cfg.bucket)'..." -ForegroundColor Cyan
& $rclone copy $tempFile $dest @s3Flags --progress
if ($LASTEXITCODE -ne 0) {
    throw "rclone copy failed with exit code $LASTEXITCODE"
}

if (-not $NoVerify) {
    Write-Host ""
    Write-Host "Verifying transfer..." -ForegroundColor Cyan

    $remoteEntries = & $rclone lsjson $dest @s3Flags -R | ConvertFrom-Json
    $remoteByPath = @{}
    foreach ($e in $remoteEntries) {
        if (-not $e.IsDir) { $remoteByPath[$e.Path] = $e.Size }
    }

    $localSize = (Get-Item -LiteralPath $tempFile).Length
    if (-not $remoteByPath.ContainsKey("xboxcompanion.exe")) {
        Write-Host "  MISSING on remote: xboxcompanion.exe" -ForegroundColor Red
        throw "Verification failed - file did not upload."
    }
    $remoteSize = $remoteByPath["xboxcompanion.exe"]
    if ($remoteSize -ne $localSize) {
        throw "SIZE MISMATCH: xboxcompanion.exe (local $localSize bytes, remote $remoteSize bytes)"
    }
    Write-Host ("  OK: xboxcompanion.exe ($localSize bytes)") -ForegroundColor Green
    Write-Host "Verification passed." -ForegroundColor Green
}

Remove-Item -LiteralPath $tempFile -Force

if ($cfg.publicBaseUrl) {
    $base = $cfg.publicBaseUrl.TrimEnd('/')
    Write-Host ""
    Write-Host "Public URL:" -ForegroundColor Green
    Write-Host "  $base/xboxcompanion.exe"
}

Write-Host ""
Write-Host "Done - xboxcompanion.exe is live on the distribution server." -ForegroundColor Green
