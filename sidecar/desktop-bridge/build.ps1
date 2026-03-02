# Build desktop-bridge sidecar as self-contained single-file exe
# Requires: .NET 8 SDK (for building only — the output has no runtime dependency)

$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputDir = Join-Path $env:USERPROFILE ".jarvis" "sidecar"

Write-Host "[build] Building desktop-bridge..." -ForegroundColor Cyan

dotnet publish $projectDir `
    -c Release `
    -r win-x64 `
    --self-contained `
    /p:PublishSingleFile=true `
    /p:PublishTrimmed=false `
    -o $outputDir

Write-Host "[build] Output: $outputDir\desktop-bridge.exe" -ForegroundColor Green
