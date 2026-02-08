# VelocityPulse Agent - Bootstrap Installer
# This script downloads and runs the full installer
# Usage: irm https://get.velocitypulse.io/agent | iex

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host "VelocityPulse Agent - Bootstrap Installer" -ForegroundColor Cyan
Write-Host "Downloading installer..." -ForegroundColor Yellow

$installerUrl = "https://raw.githubusercontent.com/velocityeu/velocitypulse-agent/main/scripts/install-windows.ps1"
$installerPath = "$env:TEMP\install-velocitypulse-agent.ps1"

try {
    Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
    Write-Host "Running installer..." -ForegroundColor Yellow
    & powershell -NoProfile -ExecutionPolicy Bypass -File $installerPath
} finally {
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
}
