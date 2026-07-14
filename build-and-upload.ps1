<#
.SYNOPSIS
    Build portable + upload to HuggingFace (versioned) and R2 (unversioned distribution).

.DESCRIPTION
    Passo a passo completo:

    1. BUILD
       - Executa npm run build:electron:win:portable na raiz do projeto
       - Gera dist/xbox-360-companion-Portable-<VERSION>.exe

    2. UPLOAD PARA HUGGINGFACE (historico versionado)
       - Repo: luisluis123/versions (dataset)
       - Pasta: XBOX360Companion/
       - Arquivo: xbox-360-companion-Portable-<VERSION>.exe
       - Token: lido do .env (HF_TOKEN)
       - URL: https://huggingface.co/datasets/luisluis123/versions/tree/main/XBOX360Companion/

    3. UPLOAD PARA R2 (distribuicao - sempre sobrescreve)
       - Copia o portable com o nome xboxcompanion.exe
       - Envia via rclone para o bucket "versions" no Cloudflare R2
       - Remove o temporario apos verificar

    4. LIMPEZA
       - Remove xboxcompanion.exe temporario

.PARAMETER SkipBuild
    Pula o build (usa portable existente em dist/).

.PARAMETER SkipHF
    Pula upload para HuggingFace.

.PARAMETER SkipR2
    Pula upload para R2.

.PARAMETER PortablePath
    Caminho customizado para o portable.

.EXAMPLE
    .\build-and-upload.ps1
    Executa tudo: build + HF + R2.

.EXAMPLE
    .\build-and-upload.ps1 -SkipBuild
    Usa portable existente e faz upload para ambos.

.EXAMPLE
    .\build-and-upload.ps1 -SkipR2
    Build + upload apenas para HuggingFace.

.NOTES
    Pre-requisitos:
    - PowerShell 5.1+
    - Node.js 18+ com npm
    - rclone (winget install Rclone.Rclone) - necessario so para R2
    - huggingface_hub (pip install huggingface_hub) - necessario so para HF
    - Arquivo .env na raiz (veja .env.example) com os tokens
#>

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipHF,
    [switch]$SkipR2,
    [string]$PortablePath = ""
)

$ErrorActionPreference = "Stop"

# ─── CONFIG ──────────────────────────────────────────
$VERSION = "2.12.26"
$PROJECT_ROOT = "E:\projects\GODSend"
$DIST_DIR = Join-Path $PROJECT_ROOT "dist"
$ENV_FILE = Join-Path $PROJECT_ROOT ".env"

# Load .env
if (Test-Path -LiteralPath $ENV_FILE) {
    Get-Content -LiteralPath $ENV_FILE -Encoding UTF8 | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)\s*$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim().Trim('"', "'")
            Set-Variable -Name $k -Value $v -Scope Script
        }
    }
}

# HuggingFace
$HF_REPO = if ($env:HF_REPO) { $env:HF_REPO } elseif ($Script:HF_REPO) { $Script:HF_REPO } else { "luisluis123/versions" }
$HF_REPO_TYPE = "dataset"
$HF_FOLDER = "XBOX360Companion"
$HF_TOKEN = if ($env:HF_TOKEN) { $env:HF_TOKEN } elseif ($Script:HF_TOKEN) { $Script:HF_TOKEN } else { "" }

# R2
$R2_CONFIG = Join-Path $PROJECT_ROOT "r2-config.json"

$PORTABLE_FILENAME = "xbox-360-companion-Portable-$VERSION.exe"
$DEFAULT_PORTABLE_PATH = Join-Path $DIST_DIR $PORTABLE_FILENAME

# ─── HELPERS ─────────────────────────────────────────
function Print-Step {
    param([string]$Message, [string]$Color = "Cyan")
    Write-Host ""
    Write-Host "========================================" -ForegroundColor $Color
    Write-Host "  $Message" -ForegroundColor $Color
    Write-Host "========================================" -ForegroundColor $Color
}

function Find-Rclone {
    $cmd = Get-Command rclone -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidate = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter "rclone.exe" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
    if ($candidate) { return $candidate }

    throw "rclone.exe not found. Install with: winget install Rclone.Rclone (then restart shell)."
}

# ─── STEP 1: BUILD ──────────────────────────────────
if (-not $SkipBuild) {
    Print-Step "PASSO 1/3: Build do Portable ($VERSION)"

    Write-Host "Executando npm run build:electron:win:portable..." -ForegroundColor Yellow
    Push-Location -LiteralPath $PROJECT_ROOT
    try {
        npm run build:electron:win:portable 2>&1
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
            throw "npm build falhou com exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    if (-not (Test-Path -LiteralPath $DEFAULT_PORTABLE_PATH)) {
        throw "Build concluido mas o arquivo nao foi encontrado em: $DEFAULT_PORTABLE_PATH"
    }

    $fileSize = (Get-Item -LiteralPath $DEFAULT_PORTABLE_PATH).Length
    Write-Host "Portable gerado com sucesso:" -ForegroundColor Green
    Write-Host "  $DEFAULT_PORTABLE_PATH" -ForegroundColor Green
    Write-Host "  Tamanho: $([math]::Round($fileSize / 1MB, 2)) MB" -ForegroundColor Green
} else {
    Print-Step "PASSO 1/3: Build (SKIPPED - usando portable existente)"
}

if (-not $PortablePath) {
    $PortablePath = $DEFAULT_PORTABLE_PATH
}

if (-not (Test-Path -LiteralPath $PortablePath)) {
    throw "Portable nao encontrado em: $PortablePath`nExecute sem -SkipBuild ou especifique -PortablePath"
}

# ─── STEP 2: HUGGINGFACE UPLOAD ────────────────────
if (-not $SkipHF) {
    Print-Step "PASSO 2/3: Upload para HuggingFace"

    if (-not $HF_TOKEN) {
        throw "HF_TOKEN nao definido. Crie um arquivo .env na raiz (veja .env.example) ou defina a variavel de ambiente HF_TOKEN."
    }

    Write-Host "Repositorio: $HF_REPO ($HF_REPO_TYPE)" -ForegroundColor Yellow
    Write-Host "Pasta remota: $HF_FOLDER/" -ForegroundColor Yellow
    Write-Host "Arquivo: $PORTABLE_FILENAME" -ForegroundColor Yellow
    Write-Host ""

    $env:PYTHONIOENCODING = "utf-8"
    $hfRemotePath = "$HF_FOLDER/$PORTABLE_FILENAME"

    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        hf upload $HF_REPO "$PortablePath" $hfRemotePath `
            --repo-type $HF_REPO_TYPE --token $HF_TOKEN --commit-message "v$VERSION" 2>&1
    } finally {
        $ErrorActionPreference = $savedEAP
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Upload para HuggingFace falhou com exit code $LASTEXITCODE"
    }

    Write-Host ""
    Write-Host "Upload para HuggingFace concluido!" -ForegroundColor Green
    Write-Host "  URL: https://huggingface.co/datasets/$HF_REPO/blob/main/$hfRemotePath" -ForegroundColor Green
} else {
    Print-Step "PASSO 2/3: Upload para HuggingFace (SKIPPED)"
}

# ─── STEP 3: R2 UPLOAD (DISTRIBUICAO) ─────────────
if (-not $SkipR2) {
    Print-Step "PASSO 3/3: Upload para R2 (distribuicao)"

    # Try .env first, fall back to r2-config.json
    if ($Script:R2_ACCESS_KEY_ID -and $Script:R2_SECRET_ACCESS_KEY -and $Script:R2_ENDPOINT -and $Script:R2_BUCKET) {
        $cfg = [PSCustomObject]@{
            accessKeyId     = $Script:R2_ACCESS_KEY_ID
            secretAccessKey = $Script:R2_SECRET_ACCESS_KEY
            endpoint        = $Script:R2_ENDPOINT
            bucket          = $Script:R2_BUCKET
            publicBaseUrl   = if ($Script:R2_PUBLIC_URL) { $Script:R2_PUBLIC_URL } else { "" }
        }
    } elseif (Test-Path -LiteralPath $R2_CONFIG) {
        $cfg = Get-Content -LiteralPath $R2_CONFIG -Raw -Encoding UTF8 | ConvertFrom-Json
    } else {
        throw "Credenciais R2 nao encontradas. Defina R2_* no .env (veja .env.example) ou crie r2-config.json."
    }

    foreach ($field in @('accessKeyId', 'secretAccessKey', 'endpoint', 'bucket')) {
        if (-not $cfg.$field) {
            throw "Config R2 faltando campo obrigatorio: $field"
        }
    }

    $rclone = Find-Rclone

    # Temp copy named xboxcompanion.exe
    $tempDir = Join-Path $env:TEMP "godsend-upload"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $tempFile = Join-Path $tempDir "xboxcompanion.exe"
    Copy-Item -LiteralPath $PortablePath -Destination $tempFile -Force

    $dest = ":s3:$($cfg.bucket)"
    $s3Flags = @(
        "--s3-provider=Cloudflare",
        "--s3-access-key-id=$($cfg.accessKeyId)",
        "--s3-secret-access-key=$($cfg.secretAccessKey)",
        "--s3-endpoint=$($cfg.endpoint)",
        "--s3-no-check-bucket"
    )

    Write-Host "Enviando xboxcompanion.exe -> bucket '$($cfg.bucket)'..." -ForegroundColor Yellow
    & $rclone copy $tempFile $dest @s3Flags --progress
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        throw "rclone copy falhou com exit code $LASTEXITCODE"
    }

    # Verification
    Write-Host ""
    Write-Host "Verificando transferencia..." -ForegroundColor Yellow

    $remoteEntries = & $rclone lsjson $dest @s3Flags -R | ConvertFrom-Json
    $remoteByPath = @{}
    foreach ($e in $remoteEntries) {
        if (-not $e.IsDir) { $remoteByPath[$e.Path] = $e.Size }
    }

    $localSize = (Get-Item -LiteralPath $tempFile).Length
    if (-not $remoteByPath.ContainsKey("xboxcompanion.exe")) {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        throw "VERIFICACAO FALHOU: xboxcompanion.exe nao encontrado no remoto."
    }
    $remoteSize = $remoteByPath["xboxcompanion.exe"]
    if ($remoteSize -ne $localSize) {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        throw "VERIFICACAO FALHOU: tamanho diferente (local: $localSize bytes, remoto: $remoteSize bytes)"
    }
    Write-Host "  OK: xboxcompanion.exe ($localSize bytes)" -ForegroundColor Green
    Write-Host "Verificacao passou." -ForegroundColor Green

    # Cleanup
    Remove-Item -LiteralPath $tempFile -Force

    Write-Host ""
    Write-Host "Upload para R2 concluido!" -ForegroundColor Green
    if ($cfg.publicBaseUrl) {
        $base = $cfg.publicBaseUrl.TrimEnd('/')
        Write-Host "  URL publica: $base/xboxcompanion.exe" -ForegroundColor Green
    } else {
        Write-Host "  (defina publicBaseUrl no r2-config.json para ver a URL)" -ForegroundColor Yellow
    }
} else {
    Print-Step "PASSO 3/3: Upload para R2 (SKIPPED)"
}

# ─── SUMMARY ────────────────────────────────────────
Print-Step "RESUMO" "Green"

Write-Host "Versao: $VERSION" -ForegroundColor Green
Write-Host "Arquivo: $PORTABLE_FILENAME" -ForegroundColor Green
Write-Host ""

if (-not $SkipHF) {
    Write-Host "HuggingFace:" -ForegroundColor Cyan
    Write-Host "  https://huggingface.co/datasets/$HF_REPO/blob/main/$HF_FOLDER/$PORTABLE_FILENAME" -ForegroundColor Cyan
}

if (-not $SkipR2 -and $cfg.publicBaseUrl) {
    Write-Host "R2 (distribuicao):" -ForegroundColor Cyan
    Write-Host "  $base/xboxcompanion.exe" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Todos os passos concluidos com sucesso!" -ForegroundColor Green
