<#
.SYNOPSIS
    Upload the latest portable build to HuggingFace datasets under XBOX360Companion/.
    Token lido do build.properties (HF_TOKEN) ou da variavel de ambiente HF_TOKEN.
#>
param(
    [string]$PortablePath = "",
    [string]$HfToken = ""
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

$VERSION = "2.12.26"
$REPO = "luisluis123/versions"
$REPO_TYPE = "dataset"
$FOLDER = "XBOX360Companion"

if (-not $HfToken) {
    $HfToken = if ($env:HF_TOKEN) { $env:HF_TOKEN } elseif ($Script:HF_TOKEN) { $Script:HF_TOKEN } else { "" }
}

if (-not $HfToken) {
    throw "HF_TOKEN nao definido. Crie um build.properties ou defina a variavel de ambiente HF_TOKEN."
}

if (-not $PortablePath) {
    $PortablePath = Join-Path $PSScriptRoot "dist\xbox-360-companion-Portable-$VERSION.exe"
}

if (-not (Test-Path -LiteralPath $PortablePath)) {
    throw "Portable file not found: $PortablePath"
}

Write-Host "Uploading to HuggingFace..." -ForegroundColor Cyan
Write-Host "  Repo: $REPO ($REPO_TYPE)" -ForegroundColor Cyan
Write-Host "  Path in repo: $FOLDER/" -ForegroundColor Cyan
Write-Host "  File: $PortablePath" -ForegroundColor Cyan

$env:PYTHONIOENCODING = "utf-8"
$savedEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    hf upload $REPO "$PortablePath" "$FOLDER/" `
        --repo-type $REPO_TYPE --token $HfToken --commit-message "v$VERSION" 2>&1
} finally {
    $ErrorActionPreference = $savedEAP
}

if ($LASTEXITCODE -ne 0) {
    throw "HuggingFace upload failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Upload complete!" -ForegroundColor Green
Write-Host "https://huggingface.co/datasets/$REPO/tree/main/$FOLDER/" -ForegroundColor Green
