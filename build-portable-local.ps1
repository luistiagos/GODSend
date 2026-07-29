<#
.SYNOPSIS
    Builds the Windows portable executable locally, without upload.

.DESCRIPTION
    Generates dist/xbox-360-companion-Portable-<VERSION>.exe from the
    current repository checkout. By default it also rebuilds the Windows
    backend and bundled tools required by the Electron portable package.

.PARAMETER SkipBackend
    Skips npm run build:server and only packages the Electron portable app.

.PARAMETER Clean
    Removes previous xbox-360-companion portable executables from dist first.

.PARAMETER DryRun
    Prints the commands that would run without executing them.

.EXAMPLE
    .\build-portable-local.ps1

.EXAMPLE
    .\build-portable-local.ps1 -Clean

.EXAMPLE
    .\build-portable-local.ps1 -SkipBackend
#>

[CmdletBinding()]
param(
    [switch]$SkipBackend,
    [switch]$Clean,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$DIST_DIR = Join-Path $PROJECT_ROOT "dist"
$PACKAGE_JSON = Join-Path $PROJECT_ROOT "package.json"

if (-not (Test-Path -LiteralPath $PACKAGE_JSON)) {
    throw "package.json nao encontrado em: $PACKAGE_JSON"
}

$VERSION = (Get-Content -LiteralPath $PACKAGE_JSON -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $VERSION) {
    throw "Nao foi possivel ler a versao em: $PACKAGE_JSON"
}

$PORTABLE_FILENAME = "xbox-360-companion-Portable-$VERSION.exe"
$PORTABLE_PATH = Join-Path $DIST_DIR $PORTABLE_FILENAME

function Get-NpmCommand {
    $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $cmd = Get-Command npm -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    throw "npm nao encontrado no PATH."
}

function Invoke-Step {
    param(
        [string]$Label,
        [string[]]$Arguments
    )

    $npm = Get-NpmCommand
    Write-Host ""
    Write-Host "==> $Label" -ForegroundColor Cyan
    Write-Host "    npm $($Arguments -join ' ')" -ForegroundColor DarkGray

    if ($DryRun) {
        return
    }

    $process = Start-Process -FilePath $npm -ArgumentList $Arguments -WorkingDirectory $PROJECT_ROOT -NoNewWindow -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "$Label falhou com exit code $($process.ExitCode)."
    }
}

Write-Host "Xbox 360 Companion portable local build" -ForegroundColor Green
Write-Host "Projeto: $PROJECT_ROOT"
Write-Host "Versao: $VERSION"

if ($Clean -and (Test-Path -LiteralPath $DIST_DIR)) {
    Write-Host ""
    Write-Host "Limpando portables antigos em dist..." -ForegroundColor Yellow
    if (-not $DryRun) {
        Get-ChildItem -LiteralPath $DIST_DIR -Filter "xbox-360-companion-Portable-*.exe" -ErrorAction SilentlyContinue |
            Remove-Item -Force
    }
}

if (-not $SkipBackend) {
    Invoke-Step "Build do backend Windows e ferramentas" @("run", "build:server")
}

Invoke-Step "Build do executavel portable" @("run", "build:electron:win:portable")

if ($DryRun) {
    Write-Host ""
    Write-Host "Dry run concluido. Nenhum build foi executado." -ForegroundColor Yellow
    exit 0
}

if (-not (Test-Path -LiteralPath $PORTABLE_PATH)) {
    throw "Build terminou, mas o portable esperado nao foi encontrado: $PORTABLE_PATH"
}

$fileSize = (Get-Item -LiteralPath $PORTABLE_PATH).Length
Write-Host ""
Write-Host "Portable gerado com sucesso:" -ForegroundColor Green
Write-Host "  $PORTABLE_PATH" -ForegroundColor Green
Write-Host "  Tamanho: $([math]::Round($fileSize / 1MB, 2)) MB" -ForegroundColor Green
