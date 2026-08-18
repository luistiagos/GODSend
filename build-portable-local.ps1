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
    [ValidateSet("x64", "ia32", "all")]
    [string]$Arch = "x64",
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

$PORTABLE_FILENAME = if ($Arch -eq "ia32") {
    "xbox-360-companion-Portable-$VERSION-ia32.exe"
} else {
    "xbox-360-companion-Portable-$VERSION.exe"
}
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
    if ($Arch -eq "all") {
        Invoke-Step "Build do backend Windows e ferramentas (all)" @("run", "build:server:win:all")
    } elseif ($Arch -eq "ia32") {
        Invoke-Step "Build do backend Windows e ferramentas (ia32)" @("run", "build:server:win:ia32")
    } else {
        Invoke-Step "Build do backend Windows e ferramentas (x64)" @("run", "build:server:win:x64")
    }
}

$portableScript = if ($Arch -eq "all") { "build:electron:win:portable:all" } elseif ($Arch -eq "ia32") { "build:electron:win:portable:ia32" } else { "build:electron:win:portable:x64" }
Invoke-Step "Build do executavel portable ($Arch)" @("run", $portableScript)

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
