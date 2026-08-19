<#
.SYNOPSIS
    Build portable + upload to HuggingFace (versioned) and R2 (unversioned distribution).

.DESCRIPTION
    Passo a passo completo:

    1. BUILD
       - Executa npm run build:server na raiz do projeto
       - Executa npm run build:electron:win:portable na raiz do projeto
       - Gera dist/xbox-360-companion-Portable-<VERSION>.exe

    2. UPLOAD PARA HUGGINGFACE (historico versionado)
       - Repo: luisluis123/versions (dataset)
       - Pasta: XBOX360Companion/
       - Arquivo: xbox-360-companion-Portable-<VERSION>.exe
       - Token: lido do build.properties (HF_TOKEN)
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
    - Arquivo build.properties na raiz (veja build.properties.example) com os tokens
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
$PROJECT_ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$PACKAGE_JSON = Join-Path $PROJECT_ROOT "package.json"
if (-not (Test-Path -LiteralPath $PACKAGE_JSON)) {
    throw "package.json nao encontrado em: $PACKAGE_JSON"
}

$VERSION = (Get-Content -LiteralPath $PACKAGE_JSON -Raw -Encoding UTF8 | ConvertFrom-Json).version
if (-not $VERSION) {
    throw "Nao foi possivel ler a versao em: $PACKAGE_JSON"
}

$DIST_DIR = Join-Path $PROJECT_ROOT "dist"
$ENV_FILE = Join-Path $PROJECT_ROOT "build.properties"

# Load build.properties
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

    Write-Host "Executando npm run build:server..." -ForegroundColor Yellow
    Push-Location -LiteralPath $PROJECT_ROOT
    try {
        npm run build:server 2>&1
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
            throw "npm build:server falhou com exit code $LASTEXITCODE"
        }

        Write-Host "Executando npm run build:electron:win:portable..." -ForegroundColor Yellow
        npm run build:electron:win:portable 2>&1
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
            throw "npm build:electron:win:portable falhou com exit code $LASTEXITCODE"
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
        throw "HF_TOKEN nao definido. Crie um arquivo build.properties na raiz (veja build.properties.example) ou defina a variavel de ambiente HF_TOKEN."
    }

    Write-Host "Repositorio: $HF_REPO ($HF_REPO_TYPE)" -ForegroundColor Yellow
    Write-Host "Pasta remota: $HF_FOLDER/" -ForegroundColor Yellow
    Write-Host "Arquivo: $PORTABLE_FILENAME" -ForegroundColor Yellow
    Write-Host ""

    $env:PYTHONIOENCODING = "utf-8"
    $hfRemotePath = "$HF_FOLDER/$PORTABLE_FILENAME"

    $savedEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try {
        & hf upload $HF_REPO "$PortablePath" $hfRemotePath `
            --repo-type $HF_REPO_TYPE --token $HF_TOKEN --commit-message "v$VERSION"
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

# Purga URLs no cache de borda do Cloudflare. Retorna $true se purgou.
function Purge-EdgeCache {
    param([string[]]$Urls)

    $cfToken = if ($env:CF_API_TOKEN) { $env:CF_API_TOKEN } elseif ($Script:CF_API_TOKEN) { $Script:CF_API_TOKEN } else { "" }
    $cfZone  = if ($env:CF_ZONE_ID) { $env:CF_ZONE_ID } elseif ($Script:CF_ZONE_ID) { $Script:CF_ZONE_ID } else { "" }

    if ([string]::IsNullOrWhiteSpace($cfToken) -or [string]::IsNullOrWhiteSpace($cfZone)) {
        Write-Host "Purga do cache: PULADA (defina CF_API_TOKEN e CF_ZONE_ID no build.properties para purga automatica)" -ForegroundColor Yellow
        return $false
    }

    Write-Host "Purgando cache de borda ($($Urls.Count) URL(s))..." -ForegroundColor Yellow
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    try {
        $purgeResp = Invoke-RestMethod -Method Post `
            -Uri "https://api.cloudflare.com/client/v4/zones/$cfZone/purge_cache" `
            -Headers @{ Authorization = "Bearer $cfToken" } `
            -ContentType 'application/json' `
            -Body (@{ files = $Urls } | ConvertTo-Json) `
            -TimeoutSec 60
        if (-not $purgeResp.success) {
            Write-Host "Purga falhou: $($purgeResp.errors | ConvertTo-Json -Compress)" -ForegroundColor Yellow
            return $false
        }
        Write-Host "  OK: cache purgado" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  Aviso na purga do cache: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

# ─── STEP 3: R2 UPLOAD (DISTRIBUICAO + ANUNCIO) ───
if (-not $SkipR2) {
    Print-Step "PASSO 3/4: Upload para R2 (distribuicao)"

    # Try build.properties first, fall back to r2-config.json
    if ($Script:R2_ACCESS_KEY_ID -and $Script:R2_SECRET_ACCESS_KEY -and $Script:R2_ENDPOINT -and $Script:R2_BUCKET) {
        $cfg = [PSCustomObject]@{
            accessKeyId     = $Script:R2_ACCESS_KEY_ID
            secretAccessKey = $Script:R2_SECRET_ACCESS_KEY
            endpoint        = $Script:R2_ENDPOINT
            bucket          = $Script:R2_BUCKET
            publicBaseUrl   = if ($Script:R2_PUBLIC_URL) { $Script:R2_PUBLIC_URL } else { "https://versions.digitalstoregames.com" }
        }
    } elseif (Test-Path -LiteralPath $R2_CONFIG) {
        $cfg = Get-Content -LiteralPath $R2_CONFIG -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $cfg.publicBaseUrl) { $cfg.publicBaseUrl = "https://versions.digitalstoregames.com" }
    } else {
        throw "Credenciais R2 nao encontradas. Defina R2_* no build.properties (veja build.properties.example) ou crie r2-config.json."
    }

    foreach ($field in @('accessKeyId', 'secretAccessKey', 'endpoint', 'bucket')) {
        if (-not $cfg.$field) {
            throw "Config R2 faltando campo obrigatorio: $field"
        }
    }

    $rclone = Find-Rclone
    $publicBase = if ($cfg.publicBaseUrl) { $cfg.publicBaseUrl.TrimEnd('/') } else { "https://versions.digitalstoregames.com" }

    # Calcula hash SHA256 e tamanho
    $localSha256 = (Get-FileHash -LiteralPath $PortablePath -Algorithm SHA256).Hash.ToLower()
    $localSize = (Get-Item -LiteralPath $PortablePath).Length

    # Gera arquivos locais no dist
    $shaFile = Join-Path $DIST_DIR "xboxcompanion.exe.sha256"
    "$localSha256  xboxcompanion.exe" | Out-File -FilePath $shaFile -Encoding ascii -Force

    $versionJsonFile = Join-Path $DIST_DIR "version.json"
    $downloadUrl = "$publicBase/$HF_FOLDER/xboxcompanion.exe?v=$VERSION"
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
        hfUrl       = "https://huggingface.co/datasets/$HF_REPO/blob/main/$HF_FOLDER/$PORTABLE_FILENAME"
    } | ConvertTo-Json -Depth 4
    $versionPayload | Out-File -FilePath $versionJsonFile -Encoding ascii -Force

    # Temp copy named xboxcompanion.exe
    $tempDir = Join-Path $env:TEMP "godsend-upload"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $tempFile = Join-Path $tempDir "xboxcompanion.exe"
    Copy-Item -LiteralPath $PortablePath -Destination $tempFile -Force

    $destRoot = ":s3:$($cfg.bucket)"
    $destFolder = ":s3:$($cfg.bucket)/$HF_FOLDER"
    $s3Flags = @(
        "--s3-provider=Cloudflare",
        "--s3-access-key-id=$($cfg.accessKeyId)",
        "--s3-secret-access-key=$($cfg.secretAccessKey)",
        "--s3-endpoint=$($cfg.endpoint)",
        "--s3-no-check-bucket"
    )

    Write-Host "Enviando xboxcompanion.exe -> '$($cfg.bucket)/$HF_FOLDER' e raiz..." -ForegroundColor Yellow
    & $rclone copy $tempFile $destFolder @s3Flags --progress
    if ($LASTEXITCODE -ne 0) {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        throw "rclone copy falhou com exit code $LASTEXITCODE"
    }
    # Mantem copia na raiz para retrocompatibilidade
    & $rclone copy $tempFile $destRoot @s3Flags

    # Envia sidecar .sha256
    $txtHeaders = @(
        "--header-upload=Content-Type: text/plain; charset=utf-8",
        "--header-upload=Cache-Control: max-age=300"
    )
    & $rclone copyto $shaFile "$destFolder/xboxcompanion.exe.sha256" @s3Flags @txtHeaders
    & $rclone copyto $shaFile "$destRoot/xboxcompanion.exe.sha256" @s3Flags @txtHeaders

    # Verification do binario
    Write-Host ""
    Write-Host "Verificando transferencia do executavel..." -ForegroundColor Yellow
    $remoteEntries = & $rclone lsjson $destFolder @s3Flags | ConvertFrom-Json
    $remoteByName = @{}
    foreach ($e in $remoteEntries) {
        if (-not $e.IsDir) { $remoteByName[$e.Name] = $e.Size }
    }

    if (-not $remoteByName.ContainsKey("xboxcompanion.exe")) {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        throw "VERIFICACAO FALHOU: xboxcompanion.exe nao encontrado no remoto."
    }
    $remoteSize = $remoteByName["xboxcompanion.exe"]
    if ($remoteSize -ne $localSize) {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
        throw "VERIFICACAO FALHOU: tamanho diferente (local: $localSize bytes, remoto: $remoteSize bytes)"
    }
    Write-Host "  OK: xboxcompanion.exe ($localSize bytes)" -ForegroundColor Green
    Write-Host "Verificacao passou." -ForegroundColor Green

    Remove-Item -LiteralPath $tempFile -Force

    # ─── STEP 4: ANUNCIO DA VERSAO (version.json) ──────
    Print-Step "PASSO 4/4: Anuncio da versao (version.json)"
    Write-Host "Conteudo do version.json:" -ForegroundColor Yellow
    Write-Host $versionPayload -ForegroundColor White
    Write-Host ""

    $jsonHeaders = @(
        "--header-upload=Content-Type: application/json; charset=utf-8",
        "--header-upload=Cache-Control: max-age=300"
    )
    & $rclone copyto $versionJsonFile "$destFolder/version.json" @s3Flags @jsonHeaders
    & $rclone copyto $versionJsonFile "$destRoot/version.json" @s3Flags @jsonHeaders

    Write-Host "  OK: version.json publicado" -ForegroundColor Green

    # Purga do cache de borda
    $versionJsonUrl = "$publicBase/$HF_FOLDER/version.json"
    $rootVersionJsonUrl = "$publicBase/version.json"
    $binaryBareUrl = "$publicBase/$HF_FOLDER/xboxcompanion.exe"
    $rootBinaryBareUrl = "$publicBase/xboxcompanion.exe"
    if (Purge-EdgeCache @($versionJsonUrl, $rootVersionJsonUrl, $binaryBareUrl, $rootBinaryBareUrl)) {
        Start-Sleep -Seconds 3
    }

    # Verificacao do anuncio pela URL publica
    Write-Host "Verificando anuncio pela URL publica ($versionJsonUrl)..." -ForegroundColor Yellow
    try {
        $publicJson = Invoke-RestMethod -Uri "$versionJsonUrl`?t=$((Get-Date).Ticks)" -TimeoutSec 30 -Headers @{ 'Cache-Control' = 'no-cache' }
        if ($publicJson.version -ne $VERSION) {
            Write-Host "AVISO: version.json publico ainda anuncia $($publicJson.version), esperado $VERSION (cache de borda)" -ForegroundColor Yellow
        } else {
            Write-Host "  OK: app vera a versao $($publicJson.version) (sha256 $($publicJson.sha256.Substring(0,8))...)" -ForegroundColor Green
        }
    } catch {
        Write-Host "  Aviso ao verificar ${versionJsonUrl}: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Print-Step "PASSO 3/4: Upload para R2 (SKIPPED)"
    Print-Step "PASSO 4/4: Anuncio da versao (SKIPPED)"
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

if (-not $SkipR2) {
    Write-Host "R2 (distribuicao):" -ForegroundColor Cyan
    Write-Host "  $publicBase/$HF_FOLDER/xboxcompanion.exe" -ForegroundColor Cyan
    Write-Host "Anuncio da versao (lido pelo app):" -ForegroundColor Cyan
    Write-Host "  $publicBase/$HF_FOLDER/version.json" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Todos os passos concluidos com sucesso!" -ForegroundColor Green
