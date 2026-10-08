<#
.SYNOPSIS
    Build portable + upload to HuggingFace (versioned) and R2 (unversioned distribution).

.DESCRIPTION
    Passo a passo completo, para cada arquitetura pedida em -Arch (padrao: x64 e ia32):

    1. BUILD
       - Executa npm run build:server na raiz do projeto (gera o backend x64 e ia32)
       - x64:  npm run build:electron:win:portable:x64  -> dist/xbox-360-companion-Portable-<VERSION>.exe
       - ia32: npm run build:electron:win:portable:ia32 -> dist/xbox-360-companion-Portable-<VERSION>-ia32.exe

    2. UPLOAD PARA HUGGINGFACE (historico versionado)
       - Repo: luisluis123/versions (dataset)
       - Pasta: XBOX360Companion/
       - Arquivos: xbox-360-companion-Portable-<VERSION>.exe (x64) e
                   xbox-360-companion-Portable-<VERSION>-ia32.exe (32 bits)
       - Token: lido do build.properties (HF_TOKEN)
       - URL: https://huggingface.co/datasets/luisluis123/versions/tree/main/XBOX360Companion/

    3. UPLOAD PARA R2 (distribuicao - sempre sobrescreve)
       - x64 como xboxcompanion.exe, 32 bits como xboxcompanion32.exe
         (na pasta XBOX360Companion/ e na raiz do bucket)
       - Envia via rclone para o bucket "versions" no Cloudflare R2
       - Remove o temporario apos verificar

    4. ANUNCIO (version.json)
       - Campos de topo = build x64 (o que todo app antigo le).
       - Bloco "ia32" = build 32 bits. A copia 32 bits so atualiza por ele
         (autoUpdateService.ts::selectManifestBuild); sem ele, nao atualiza.
       - O version.json publicado e MESCLADO: publicar so uma arquitetura preserva
         o bloco da outra.

.PARAMETER Arch
    x64, ia32 ou all (padrao). Publicar so ia32 exige que o version.json publicado ja
    exista, porque os campos de topo (x64) vem dele.

.PARAMETER SkipBuild
    Pula o build (usa portable existente em dist/).

.PARAMETER SkipHF
    Pula upload para HuggingFace.

.PARAMETER SkipR2
    Pula upload para R2.

.PARAMETER PortablePath
    Caminho customizado para o portable. So com uma arquitetura em -Arch.

.PARAMETER DryRun
    Nao envia nada: confere os arquivos, le o version.json publicado e mostra o
    version.json que seria publicado.

.EXAMPLE
    .\build-and-upload.ps1
    Executa tudo: build + HF + R2, x64 e 32 bits.

.EXAMPLE
    .\build-and-upload.ps1 -SkipBuild
    Usa os portables existentes e faz upload para ambos.

.EXAMPLE
    .\build-and-upload.ps1 -Arch ia32 -SkipBuild -DryRun
    Mostra o version.json que publicar so o 32 bits produziria.

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
    [ValidateSet("x64", "ia32", "all")]
    [string]$Arch = "all",
    [switch]$SkipBuild,
    [switch]$SkipHF,
    [switch]$SkipR2,
    [string]$PortablePath = "",
    [switch]$DryRun
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
$DEFAULT_PUBLIC_BASE = "https://versions.digitalstoregames.com"

# Uma entrada por arquitetura publicada. O x64 mantem os nomes de sempre: e o que
# os apps antigos baixam e o link que o suporte manda.
$ALL_TARGETS = @(
    [PSCustomObject]@{
        Arch           = "x64"
        Label          = "x64"
        NpmScript      = "build:electron:win:portable:x64"
        PortableName   = "xbox-360-companion-Portable-$VERSION.exe"
        DistName       = "xboxcompanion.exe"
        PortablePath   = ""
    },
    [PSCustomObject]@{
        Arch           = "ia32"
        Label          = "32 bits"
        NpmScript      = "build:electron:win:portable:ia32"
        PortableName   = "xbox-360-companion-Portable-$VERSION-ia32.exe"
        DistName       = "xboxcompanion32.exe"
        PortablePath   = ""
    }
)
$TARGETS = @($ALL_TARGETS | Where-Object { $Arch -eq "all" -or $_.Arch -eq $Arch })

if ($PortablePath -and $TARGETS.Count -ne 1) {
    throw "-PortablePath so vale com uma arquitetura (-Arch x64 ou -Arch ia32)."
}
foreach ($t in $TARGETS) {
    $t.PortablePath = if ($PortablePath) { $PortablePath } else { Join-Path $DIST_DIR $t.PortableName }
}

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

# Le o version.json publicado. $null quando nao existe ou nao responde.
function Get-PublishedManifest {
    param([string]$Url)
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        return Invoke-RestMethod -Uri "$Url`?t=$((Get-Date).Ticks)" -TimeoutSec 30 -Headers @{ 'Cache-Control' = 'no-cache' }
    } catch {
        Write-Host "  Aviso: nao foi possivel ler ${Url}: $($_.Exception.Message)" -ForegroundColor Yellow
        return $null
    }
}

# version.json novo: campos de topo do x64, bloco ia32 do 32 bits. A arquitetura que
# nao esta sendo publicada agora vem do manifesto publicado, sem mudanca.
function Merge-VersionManifest {
    param($Published, [hashtable]$Builds, [string]$Version, [string]$HfRepo, [string]$HfFolder)

    $releaseDate = Get-Date -Format "yyyy-MM-dd"
    $out = [ordered]@{}

    if ($Builds.ContainsKey("x64")) {
        $b = $Builds["x64"]
        $out.version     = $Version
        $out.versionCode = $Version
        $out.releaseDate = $releaseDate
        $out.channel     = "default"
        $out.downloadUrl = $b.Url
        $out.sha256      = $b.Sha256
        $out.size        = [long]$b.Size
        $out.notes       = "Xbox 360 Companion v$Version"
        $out.portableUrl = $b.Url
        $out.hfUrl       = "https://huggingface.co/datasets/$HfRepo/blob/main/$HfFolder/$($b.PortableName)"
    } else {
        if (-not $Published -or -not $Published.version) {
            throw "Publicando so o 32 bits, mas o version.json publicado nao foi lido: os campos de topo (x64) viriam vazios e quebrariam a atualizacao de todos os apps x64. Nada foi anunciado."
        }
        foreach ($p in $Published.PSObject.Properties) {
            if ($p.Name -ne "ia32") { $out[$p.Name] = $p.Value }
        }
    }

    if ($Builds.ContainsKey("ia32")) {
        $b = $Builds["ia32"]
        $out.ia32 = [ordered]@{
            version     = $Version
            releaseDate = $releaseDate
            downloadUrl = $b.Url
            sha256      = $b.Sha256
            size        = [long]$b.Size
            notes       = "Xbox 360 Companion v$Version (Windows 32 bits)"
            hfUrl       = "https://huggingface.co/datasets/$HfRepo/blob/main/$HfFolder/$($b.PortableName)"
        }
    } elseif ($Published -and $Published.ia32) {
        $out.ia32 = $Published.ia32
    }

    return ($out | ConvertTo-Json -Depth 6)
}

# ─── STEP 1: BUILD ──────────────────────────────────
if (-not $SkipBuild) {
    Print-Step "PASSO 1/4: Build do Portable ($VERSION, $(($TARGETS | ForEach-Object { $_.Label }) -join ' + '))"

    Write-Host "Executando npm run build:server..." -ForegroundColor Yellow
    Push-Location -LiteralPath $PROJECT_ROOT
    try {
        npm run build:server 2>&1
        if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
            throw "npm build:server falhou com exit code $LASTEXITCODE"
        }

        foreach ($t in $TARGETS) {
            Write-Host "Executando npm run $($t.NpmScript)..." -ForegroundColor Yellow
            npm run $t.NpmScript 2>&1
            if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne $null) {
                throw "npm $($t.NpmScript) falhou com exit code $LASTEXITCODE"
            }
        }
    } finally {
        Pop-Location
    }
} else {
    Print-Step "PASSO 1/4: Build (SKIPPED - usando portable existente)"
}

foreach ($t in $TARGETS) {
    if (-not (Test-Path -LiteralPath $t.PortablePath)) {
        throw "Portable $($t.Label) nao encontrado em: $($t.PortablePath)`nExecute sem -SkipBuild ou especifique -PortablePath"
    }
    $fileSize = (Get-Item -LiteralPath $t.PortablePath).Length
    Write-Host "Portable $($t.Label): $($t.PortablePath) ($([math]::Round($fileSize / 1MB, 2)) MB)" -ForegroundColor Green
}

# ─── STEP 2: HUGGINGFACE UPLOAD ────────────────────
if (-not $SkipHF) {
    Print-Step "PASSO 2/4: Upload para HuggingFace"

    if (-not $HF_TOKEN -and -not $DryRun) {
        throw "HF_TOKEN nao definido. Crie um arquivo build.properties na raiz (veja build.properties.example) ou defina a variavel de ambiente HF_TOKEN."
    }

    $env:PYTHONIOENCODING = "utf-8"
    foreach ($t in $TARGETS) {
        $hfRemotePath = "$HF_FOLDER/$($t.PortableName)"
        Write-Host "Repositorio: $HF_REPO ($HF_REPO_TYPE) <- $hfRemotePath" -ForegroundColor Yellow
        if ($DryRun) {
            Write-Host "  DRY-RUN: nao enviado" -ForegroundColor Yellow
            continue
        }

        $savedEAP = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        try {
            $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
            if ($pythonCmd) {
                & python -c "try:`n    import truststore; truststore.inject_into_ssl()`nexcept Exception:`n    pass`nfrom huggingface_hub.cli.hf import main; main()" upload $HF_REPO "$($t.PortablePath)" $hfRemotePath `
                    --repo-type $HF_REPO_TYPE --token $HF_TOKEN --commit-message "v$VERSION ($($t.Label))"
            } else {
                & hf upload $HF_REPO "$($t.PortablePath)" $hfRemotePath `
                    --repo-type $HF_REPO_TYPE --token $HF_TOKEN --commit-message "v$VERSION ($($t.Label))"
            }
        } finally {
            $ErrorActionPreference = $savedEAP
        }

        if ($LASTEXITCODE -ne 0) {
            throw "Upload para HuggingFace ($($t.Label)) falhou com exit code $LASTEXITCODE"
        }
        Write-Host "  OK: https://huggingface.co/datasets/$HF_REPO/blob/main/$hfRemotePath" -ForegroundColor Green
    }
} else {
    Print-Step "PASSO 2/4: Upload para HuggingFace (SKIPPED)"
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

    $cfg = $null
    # Try build.properties first, fall back to r2-config.json
    if ($Script:R2_ACCESS_KEY_ID -and $Script:R2_SECRET_ACCESS_KEY -and $Script:R2_ENDPOINT -and $Script:R2_BUCKET) {
        $cfg = [PSCustomObject]@{
            accessKeyId     = $Script:R2_ACCESS_KEY_ID
            secretAccessKey = $Script:R2_SECRET_ACCESS_KEY
            endpoint        = $Script:R2_ENDPOINT
            bucket          = $Script:R2_BUCKET
            publicBaseUrl   = if ($Script:R2_PUBLIC_URL) { $Script:R2_PUBLIC_URL } else { $DEFAULT_PUBLIC_BASE }
        }
    } elseif (Test-Path -LiteralPath $R2_CONFIG) {
        $cfg = Get-Content -LiteralPath $R2_CONFIG -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $cfg.publicBaseUrl) { $cfg.publicBaseUrl = $DEFAULT_PUBLIC_BASE }
    } elseif (-not $DryRun) {
        throw "Credenciais R2 nao encontradas. Defina R2_* no build.properties (veja build.properties.example) ou crie r2-config.json."
    }

    if (-not $DryRun) {
        foreach ($field in @('accessKeyId', 'secretAccessKey', 'endpoint', 'bucket')) {
            if (-not $cfg.$field) {
                throw "Config R2 faltando campo obrigatorio: $field"
            }
        }
        $rclone = Find-Rclone
    }
    $publicBase = if ($cfg -and $cfg.publicBaseUrl) { $cfg.publicBaseUrl.TrimEnd('/') } else { $DEFAULT_PUBLIC_BASE }

    if (-not $DryRun) {
        $destRoot = ":s3:$($cfg.bucket)"
        $destFolder = ":s3:$($cfg.bucket)/$HF_FOLDER"
        $s3Flags = @(
            "--s3-provider=Cloudflare",
            "--s3-access-key-id=$($cfg.accessKeyId)",
            "--s3-secret-access-key=$($cfg.secretAccessKey)",
            "--s3-endpoint=$($cfg.endpoint)",
            "--s3-no-check-bucket"
        )
        $txtHeaders = @(
            "--header-upload=Content-Type: text/plain; charset=utf-8",
            "--header-upload=Cache-Control: max-age=300"
        )
    }

    $builds = @{}
    $purgeUrls = @()
    foreach ($t in $TARGETS) {
        # Calcula hash SHA256 e tamanho
        $localSha256 = (Get-FileHash -LiteralPath $t.PortablePath -Algorithm SHA256).Hash.ToLower()
        $localSize = (Get-Item -LiteralPath $t.PortablePath).Length
        $builds[$t.Arch] = [PSCustomObject]@{
            Url          = "$publicBase/$HF_FOLDER/$($t.DistName)?v=$VERSION"
            Sha256       = $localSha256
            Size         = $localSize
            PortableName = $t.PortableName
        }
        $purgeUrls += "$publicBase/$HF_FOLDER/$($t.DistName)"
        $purgeUrls += "$publicBase/$($t.DistName)"

        Write-Host "$($t.Label): $($t.DistName) sha256=$localSha256 ($localSize bytes)" -ForegroundColor Yellow
        if ($DryRun) {
            Write-Host "  DRY-RUN: nao enviado" -ForegroundColor Yellow
            continue
        }

        # Gera o sidecar .sha256 no dist
        $shaFile = Join-Path $DIST_DIR "$($t.DistName).sha256"
        "$localSha256  $($t.DistName)" | Out-File -FilePath $shaFile -Encoding ascii -Force

        # Temp copy com o nome de distribuicao
        $tempDir = Join-Path $env:TEMP "godsend-upload"
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        $tempFile = Join-Path $tempDir $t.DistName
        Copy-Item -LiteralPath $t.PortablePath -Destination $tempFile -Force

        Write-Host "Enviando $($t.DistName) -> '$($cfg.bucket)/$HF_FOLDER' e raiz..." -ForegroundColor Yellow
        & $rclone copy $tempFile $destFolder @s3Flags --progress
        if ($LASTEXITCODE -ne 0) {
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
            throw "rclone copy ($($t.DistName)) falhou com exit code $LASTEXITCODE"
        }
        # Mantem copia na raiz: e o link curto que o suporte manda
        & $rclone copy $tempFile $destRoot @s3Flags

        # Envia sidecar .sha256
        & $rclone copyto $shaFile "$destFolder/$($t.DistName).sha256" @s3Flags @txtHeaders
        & $rclone copyto $shaFile "$destRoot/$($t.DistName).sha256" @s3Flags @txtHeaders

        # Verification do binario
        Write-Host "Verificando transferencia de $($t.DistName)..." -ForegroundColor Yellow
        $remoteEntries = & $rclone lsjson $destFolder @s3Flags | ConvertFrom-Json
        $remoteByName = @{}
        foreach ($e in $remoteEntries) {
            if (-not $e.IsDir) { $remoteByName[$e.Name] = $e.Size }
        }

        if (-not $remoteByName.ContainsKey($t.DistName)) {
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
            throw "VERIFICACAO FALHOU: $($t.DistName) nao encontrado no remoto."
        }
        $remoteSize = $remoteByName[$t.DistName]
        if ($remoteSize -ne $localSize) {
            Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
            throw "VERIFICACAO FALHOU: $($t.DistName) com tamanho diferente (local: $localSize bytes, remoto: $remoteSize bytes)"
        }
        Write-Host "  OK: $($t.DistName) ($localSize bytes)" -ForegroundColor Green

        Remove-Item -LiteralPath $tempFile -Force
    }

    # ─── STEP 4: ANUNCIO DA VERSAO (version.json) ──────
    Print-Step "PASSO 4/4: Anuncio da versao (version.json)"

    $versionJsonUrl = "$publicBase/$HF_FOLDER/version.json"
    $published = Get-PublishedManifest $versionJsonUrl
    $versionPayload = Merge-VersionManifest -Published $published -Builds $builds -Version $VERSION -HfRepo $HF_REPO -HfFolder $HF_FOLDER

    Write-Host "Conteudo do version.json:" -ForegroundColor Yellow
    Write-Host $versionPayload -ForegroundColor White
    Write-Host ""

    if ($DryRun) {
        Write-Host "DRY-RUN: version.json nao publicado" -ForegroundColor Yellow
    } else {
        $versionJsonFile = Join-Path $DIST_DIR "version.json"
        $versionPayload | Out-File -FilePath $versionJsonFile -Encoding ascii -Force

        $jsonHeaders = @(
            "--header-upload=Content-Type: application/json; charset=utf-8",
            "--header-upload=Cache-Control: max-age=300"
        )
        & $rclone copyto $versionJsonFile "$destFolder/version.json" @s3Flags @jsonHeaders
        & $rclone copyto $versionJsonFile "$destRoot/version.json" @s3Flags @jsonHeaders

        Write-Host "  OK: version.json publicado" -ForegroundColor Green

        # Purga do cache de borda
        $purgeUrls += $versionJsonUrl
        $purgeUrls += "$publicBase/version.json"
        if (Purge-EdgeCache $purgeUrls) {
            Start-Sleep -Seconds 3
        }

        # Verificacao do anuncio pela URL publica
        Write-Host "Verificando anuncio pela URL publica ($versionJsonUrl)..." -ForegroundColor Yellow
        $publicJson = Get-PublishedManifest $versionJsonUrl
        if ($publicJson) {
            if ($builds.ContainsKey("x64")) {
                if ($publicJson.version -ne $VERSION) {
                    Write-Host "AVISO: version.json publico ainda anuncia $($publicJson.version), esperado $VERSION (cache de borda)" -ForegroundColor Yellow
                } else {
                    Write-Host "  OK: app x64 vera a versao $($publicJson.version) (sha256 $($publicJson.sha256.Substring(0,8))...)" -ForegroundColor Green
                }
            }
            if ($builds.ContainsKey("ia32")) {
                if (-not $publicJson.ia32 -or $publicJson.ia32.version -ne $VERSION) {
                    Write-Host "AVISO: bloco ia32 do version.json publico ainda nao anuncia $VERSION (cache de borda)" -ForegroundColor Yellow
                } else {
                    Write-Host "  OK: app 32 bits vera a versao $($publicJson.ia32.version) (sha256 $($publicJson.ia32.sha256.Substring(0,8))...)" -ForegroundColor Green
                }
            }
        }
    }
} else {
    Print-Step "PASSO 3/4: Upload para R2 (SKIPPED)"
    Print-Step "PASSO 4/4: Anuncio da versao (SKIPPED)"
}

# ─── SUMMARY ────────────────────────────────────────
Print-Step "RESUMO" "Green"

Write-Host "Versao: $VERSION" -ForegroundColor Green
foreach ($t in $TARGETS) {
    Write-Host "Arquivo $($t.Label): $($t.PortableName)" -ForegroundColor Green
}
Write-Host ""

if (-not $SkipHF) {
    Write-Host "HuggingFace:" -ForegroundColor Cyan
    foreach ($t in $TARGETS) {
        Write-Host "  https://huggingface.co/datasets/$HF_REPO/blob/main/$HF_FOLDER/$($t.PortableName)" -ForegroundColor Cyan
    }
}

if (-not $SkipR2) {
    Write-Host "R2 (distribuicao):" -ForegroundColor Cyan
    foreach ($t in $TARGETS) {
        Write-Host "  $publicBase/$($t.DistName)  ($($t.Label))" -ForegroundColor Cyan
    }
    Write-Host "Anuncio da versao (lido pelo app):" -ForegroundColor Cyan
    Write-Host "  $publicBase/$HF_FOLDER/version.json" -ForegroundColor Cyan
}

Write-Host ""
if ($DryRun) {
    Write-Host "DRY-RUN concluido: nada foi enviado." -ForegroundColor Yellow
} else {
    Write-Host "Todos os passos concluidos com sucesso!" -ForegroundColor Green
}
