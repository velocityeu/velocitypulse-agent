#Requires -RunAsAdministrator
<#
.SYNOPSIS
    VelocityPulse Agent installer for Windows.

.DESCRIPTION
    Downloads and installs the VelocityPulse Agent as a Windows service.
    One-liner: irm https://get.velocitypulse.io/agent | iex

.PARAMETER ApiKey
    The agent API key from your VelocityPulse dashboard.

.PARAMETER DashboardUrl
    The dashboard URL (default: https://app.velocitypulse.io).

.PARAMETER InstallDir
    Installation directory (default: C:\Program Files\VelocityPulse Agent).

.PARAMETER AgentName
    Display name for this agent (default: hostname).
#>
param(
    [string]$ApiKey,
    [string]$DashboardUrl = "https://app.velocitypulse.io",
    [string]$InstallDir = "C:\Program Files\VelocityPulse Agent",
    [string]$AgentName = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ============================================
# Banner
# ============================================
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   VelocityPulse Agent Installer (Windows)" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# Prerequisites
# ============================================
Write-Host "[1/6] Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
$nodeVersion = $null
try { $nodeVersion = (node --version 2>$null) } catch {}

if (-not $nodeVersion) {
    Write-Host "  ERROR: Node.js is not installed." -ForegroundColor Red
    Write-Host "  Please install Node.js 18+ from https://nodejs.org" -ForegroundColor Red
    exit 1
}

$major = [int]($nodeVersion -replace '^v(\d+)\..*', '$1')
if ($major -lt 18) {
    Write-Host "  ERROR: Node.js $nodeVersion is too old. Version 18+ required." -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js $nodeVersion OK" -ForegroundColor Green

# ============================================
# Prompt for API Key if not provided
# ============================================
if (-not $ApiKey) {
    Write-Host ""
    Write-Host "[2/6] Configuration" -ForegroundColor Yellow
    $ApiKey = Read-Host "  Enter your Agent API Key (from VelocityPulse dashboard)"
    if (-not $ApiKey) {
        Write-Host "  ERROR: API key is required." -ForegroundColor Red
        exit 1
    }
    $DashboardUrl = Read-Host "  Dashboard URL (press Enter for $DashboardUrl)"
    if (-not $DashboardUrl) { $DashboardUrl = "https://app.velocitypulse.io" }
} else {
    Write-Host "[2/6] Using provided configuration" -ForegroundColor Yellow
}

Write-Host "  Dashboard: $DashboardUrl" -ForegroundColor Green
Write-Host "  Agent Name: $AgentName" -ForegroundColor Green

# ============================================
# Download latest release
# ============================================
Write-Host ""
Write-Host "[3/6] Downloading latest agent release..." -ForegroundColor Yellow

$releasesUrl = "https://api.github.com/repos/velocityeu/velocitypulse-agent/releases/latest"
try {
    $release = Invoke-RestMethod -Uri $releasesUrl -Headers @{ "User-Agent" = "VelocityPulse-Installer" }
    $version = $release.tag_name
    $asset = $release.assets | Where-Object { $_.name -like "*windows*" -or $_.name -like "*.zip" } | Select-Object -First 1

    if (-not $asset) {
        Write-Host "  WARNING: No Windows-specific release found, using source." -ForegroundColor Yellow
        $asset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
    }

    if ($asset) {
        $downloadUrl = $asset.browser_download_url
    } else {
        $downloadUrl = $release.zipball_url
    }
    Write-Host "  Version: $version" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Could not fetch latest release. Using repository clone." -ForegroundColor Yellow
    $version = "latest"
    $downloadUrl = "https://github.com/velocityeu/velocitypulse-agent/archive/refs/heads/main.zip"
}

$tempZip = Join-Path $env:TEMP "vp-agent-$([guid]::NewGuid().ToString('N').Substring(0,8)).zip"
$tempExtract = Join-Path $env:TEMP "vp-agent-extract"

Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip
Write-Host "  Downloaded to: $tempZip" -ForegroundColor Green

# ============================================
# Extract and install
# ============================================
Write-Host ""
Write-Host "[4/6] Installing to $InstallDir..." -ForegroundColor Yellow

if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force

# Find the extracted directory (GitHub adds a prefix)
$sourceDir = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1
if (-not $sourceDir) {
    Write-Host "  ERROR: Could not find extracted directory." -ForegroundColor Red
    exit 1
}

# Create install directory
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Copy files
Copy-Item -Path "$($sourceDir.FullName)\*" -Destination $InstallDir -Recurse -Force
Write-Host "  Files installed" -ForegroundColor Green

# Install npm dependencies
Write-Host "  Installing dependencies..."
Push-Location $InstallDir
npm install --production --silent 2>$null
Pop-Location
Write-Host "  Dependencies installed" -ForegroundColor Green

# ============================================
# Configure
# ============================================
Write-Host ""
Write-Host "[5/6] Configuring agent..." -ForegroundColor Yellow

$envFile = Join-Path $InstallDir ".env"
@"
# VelocityPulse Agent Configuration
VELOCITYPULSE_URL=$DashboardUrl
VP_API_KEY=$ApiKey
AGENT_NAME=$AgentName
LOG_LEVEL=info
ENABLE_AUTO_SCAN=true
ENABLE_REALTIME=true
"@ | Set-Content -Path $envFile -Encoding UTF8

Write-Host "  Configuration written to .env" -ForegroundColor Green

# ============================================
# Register as Windows Service via NSSM or sc.exe
# ============================================
Write-Host ""
Write-Host "[6/6] Registering Windows service..." -ForegroundColor Yellow

$serviceName = "VelocityAgent"
$serviceDisplay = "VelocityPulse Agent"
$nodeExe = (Get-Command node).Source
$entryPoint = Join-Path $InstallDir "dist\index.js"

# Check if service already exists
$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "  Stopping existing service..." -ForegroundColor Yellow
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $serviceName | Out-Null
    Start-Sleep -Seconds 2
}

# Create service using sc.exe
$binPath = "`"$nodeExe`" `"$entryPoint`""
sc.exe create $serviceName binPath= $binPath start= auto DisplayName= $serviceDisplay | Out-Null
sc.exe description $serviceName "VelocityPulse network monitoring agent" | Out-Null

# Set working directory via registry
$regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName"
if (Test-Path $regPath) {
    # sc.exe doesn't support working directory, so we wrap in a cmd call
    $wrappedBinPath = "cmd.exe /c `"cd /d `"$InstallDir`" && `"$nodeExe`" `"$entryPoint`"`""
    Set-ItemProperty -Path $regPath -Name ImagePath -Value $wrappedBinPath
}

# Start the service
try {
    Start-Service -Name $serviceName
    Write-Host "  Service started successfully" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: Could not start service. You may need to start it manually." -ForegroundColor Yellow
    Write-Host "  Run: Start-Service -Name $serviceName" -ForegroundColor Yellow
}

# ============================================
# Cleanup
# ============================================
Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue

# ============================================
# Done
# ============================================
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "   Installation Complete!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Install Dir:  $InstallDir" -ForegroundColor Cyan
Write-Host "  Service Name: $serviceName" -ForegroundColor Cyan
Write-Host "  Dashboard:    $DashboardUrl" -ForegroundColor Cyan
Write-Host "  Agent UI:     http://localhost:3001" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Commands:" -ForegroundColor Yellow
Write-Host "    Start:   Start-Service $serviceName" -ForegroundColor White
Write-Host "    Stop:    Stop-Service $serviceName" -ForegroundColor White
Write-Host "    Status:  Get-Service $serviceName" -ForegroundColor White
Write-Host "    Logs:    Get-Content '$InstallDir\logs\agent.log' -Tail 50" -ForegroundColor White
Write-Host ""
