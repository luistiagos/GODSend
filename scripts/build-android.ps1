# Script PowerShell para compilar o backend Go para Android (arm64)
$ErrorActionPreference = "Stop"

$Root = Resolve-Path "$PSScriptRoot\.."
$Dist = Join-Path $Root "dist"
$ServerDir = Join-Path $Root "src\server"
$Out = Join-Path $Dist "godsend-android-arm64"

if (-not (Test-Path $Dist)) {
    New-Item -ItemType Directory -Path $Dist | Out-Null
}

Write-Host "`n[build-android.ps1] Cross-compilando Go backend: android/arm64 -> dist/godsend-android-arm64" -ForegroundColor Cyan

$env:GOOS = "android"
$env:GOARCH = "arm64"
$env:CGO_ENABLED = "0"

Push-Location $ServerDir
try {
    go build -o $Out .
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[build-android.ps1] Compilado com sucesso: dist/godsend-android-arm64" -ForegroundColor Green
    } else {
        Write-Error "[build-android.ps1] Falha na compilação do binário Go para Android"
    }
} finally {
    Pop-Location
}
