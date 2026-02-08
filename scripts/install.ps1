#Requires -Version 5.1
<#
.SYNOPSIS
    VelocityPulse Agent - Windows Installer
.DESCRIPTION
    One-line installer for VelocityPulse Agent on Windows.
    Downloads, configures, and registers the agent as a Windows service.
.EXAMPLE
    irm https://get.velocitypulse.io/agent | iex
.EXAMPLE
    # Or download and run directly:
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/velocityeu/velocitypulse-agent/master/scripts/install.ps1" -OutFile "$env:TEMP\install.ps1"; & "$env:TEMP\install.ps1"
.NOTES
    Version: 1.0.0
    Author: Velocity EU
#>

[CmdletBinding()]
param(
    [string]$InstallPath = "$env:ProgramData\velocitypulse-agent",
    [string]$DashboardUrl,
    [string]$ApiKey,
    [string]$AgentName,
    [int]$UIPort = 3001,
    [switch]$Unattended,
    [switch]$Offline,
    [switch]$Uninstall,
    [switch]$Upgrade
)

$script:OfflineMode = $Offline
$script:InstallMode = $null
$script:UIPort = $UIPort

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Version and constants
$Version = "1.0.0"
$ZipUrl = "https://github.com/velocityeu/velocitypulse-agent/archive/refs/heads/master.zip"
# NSSM download URLs (primary + fallbacks)
$NssmUrls = @(
    "https://nssm.cc/release/nssm-2.24.zip",
    "https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip"
)
$NssmPath = "$InstallPath\nssm.exe"
$ServiceName = "VelocityPulseAgent"
$DefaultDashboardUrl = "https://app.velocitypulse.io"

# Colors
function Write-ColorText {
    param([string]$Text, [string]$Color = "White")
    Write-Host $Text -ForegroundColor $Color
}

function Write-Banner {
    Clear-Host
    Write-ColorText @"

 __     __   _            _ _         _____       _
 \ \   / /__| | ___   ___(_) |_ _   _|  __ \ _   _| |___  ___
  \ \ / / _ \ |/ _ \ / __| | __| | | | |__) | | | | / __|/ _ \
   \ V /  __/ | (_) | (__| | |_| |_| |  ___/| |_| | \__ \  __/
    \_/ \___|_|\___/ \___|_|\__|\__, |_|     \__,_|_|___/\___|
                                 __/ |
         Agent Installer        |___/           v$Version - Windows

"@ "Cyan"
}

function Write-Step {
    param([int]$Step, [int]$Total, [string]$Message)
    Write-ColorText "[$Step/$Total] $Message" "Yellow"
}

function Write-Success {
    param([string]$Message)
    Write-ColorText "[OK] $Message" "Green"
}

function Write-Error2 {
    param([string]$Message)
    Write-ColorText "[ERROR] $Message" "Red"
}

function Test-Administrator {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Request-Elevation {
    if (-not (Test-Administrator)) {
        Write-ColorText "This installer requires Administrator privileges." "Yellow"
        Write-ColorText "Restarting with elevation..." "Yellow"

        $scriptPath = $MyInvocation.PSCommandPath
        if (-not $scriptPath) {
            $scriptPath = $PSCommandPath
        }

        $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptPath`"")
        if ($InstallPath -ne "$env:ProgramData\velocitypulse-agent") {
            $arguments += "-InstallPath", "`"$InstallPath`""
        }
        if ($DashboardUrl) { $arguments += "-DashboardUrl", "`"$DashboardUrl`"" }
        if ($ApiKey) { $arguments += "-ApiKey", "`"$ApiKey`"" }
        if ($AgentName) { $arguments += "-AgentName", "`"$AgentName`"" }
        if ($Unattended) { $arguments += "-Unattended" }
        if ($Offline) { $arguments += "-Offline" }

        Start-Process powershell -ArgumentList $arguments -Verb RunAs -Wait
        exit
    }
}

function Test-NodeInstalled {
    try {
        $nodeVersion = & node --version 2>$null
        if ($nodeVersion -match "^v(\d+)") {
            $majorVersion = [int]$Matches[1]
            return $majorVersion -ge 18
        }
    } catch {}
    return $false
}

function Install-NodeJS {
    Write-ColorText "Node.js 18+ required. Installing..." "Yellow"

    $nodeUrl = "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi"
    $msiPath = "$env:TEMP\node-installer.msi"

    Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -UseBasicParsing
    Start-Process msiexec.exe -ArgumentList "/i", $msiPath, "/qn", "/norestart" -Wait -NoNewWindow

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    Remove-Item $msiPath -Force -ErrorAction SilentlyContinue

    if (-not (Test-NodeInstalled)) {
        throw "Node.js installation failed"
    }

    Write-Success "Node.js installed successfully"
}

function Download-NSSM {
    foreach ($url in $NssmUrls) {
        try {
            Write-ColorText "  Downloading NSSM from $url..." "Gray"
            $zipPath = "$env:TEMP\nssm.zip"
            Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 30

            $extractPath = "$env:TEMP\nssm-extract"
            Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

            $nssmExe = Get-ChildItem -Path $extractPath -Recurse -Filter "nssm.exe" | Where-Object { $_.FullName -like "*win64*" } | Select-Object -First 1
            if (-not $nssmExe) {
                $nssmExe = Get-ChildItem -Path $extractPath -Recurse -Filter "nssm.exe" | Select-Object -First 1
            }

            if ($nssmExe) {
                Copy-Item $nssmExe.FullName -Destination $NssmPath -Force
                Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
                Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
                return $true
            }
        } catch {
            Write-ColorText "  Failed: $_" "Gray"
        }
    }
    return $false
}

function Get-Configuration {
    if ($Unattended) {
        if (-not $DashboardUrl) { $script:DashboardUrl = $DefaultDashboardUrl }
        if (-not $ApiKey) { throw "ApiKey is required in unattended mode" }
        if (-not $AgentName) { $script:AgentName = $env:COMPUTERNAME }
        return
    }

    Write-ColorText "`nConfiguration" "White"
    Write-ColorText "=============" "White"

    # Dashboard URL
    $defaultUrl = if ($DashboardUrl) { $DashboardUrl } else { $DefaultDashboardUrl }
    $input = Read-Host "Dashboard URL [$defaultUrl]"
    $script:DashboardUrl = if ($input) { $input } else { $defaultUrl }

    # API Key
    while (-not $script:ApiKey) {
        $script:ApiKey = Read-Host "API Key (from VelocityPulse dashboard)"
        if (-not $script:ApiKey) {
            Write-ColorText "API Key is required" "Red"
        }
    }

    # Agent Name
    $defaultName = if ($AgentName) { $AgentName } else { $env:COMPUTERNAME }
    $input = Read-Host "Agent Name [$defaultName]"
    $script:AgentName = if ($input) { $input } else { $defaultName }
}

function Install-Agent {
    $totalSteps = 6

    Write-Step 1 $totalSteps "Checking prerequisites..."

    # Check/install Node.js
    if (-not (Test-NodeInstalled)) {
        Install-NodeJS
    } else {
        $nodeVersion = & node --version
        Write-Success "Node.js $nodeVersion found"
    }

    Write-Step 2 $totalSteps "Creating installation directory..."
    if (-not (Test-Path $InstallPath)) {
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    }
    Write-Success "Directory: $InstallPath"

    Write-Step 3 $totalSteps "Downloading agent..."
    $zipPath = "$env:TEMP\velocitypulse-agent.zip"
    Invoke-WebRequest -Uri $ZipUrl -OutFile $zipPath -UseBasicParsing

    $extractPath = "$env:TEMP\velocitypulse-extract"
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

    # Find the extracted folder (GitHub adds branch name)
    $sourceFolder = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
    Copy-Item -Path "$($sourceFolder.FullName)\*" -Destination $InstallPath -Recurse -Force

    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Success "Agent downloaded"

    Write-Step 4 $totalSteps "Installing dependencies..."
    Push-Location $InstallPath
    try {
        & npm install --production 2>&1 | Out-Null
        & npm run build 2>&1 | Out-Null
    } finally {
        Pop-Location
    }
    Write-Success "Dependencies installed"

    Write-Step 5 $totalSteps "Creating configuration..."
    $envContent = @"
# VelocityPulse Agent Configuration
VELOCITYPULSE_URL=$DashboardUrl
VP_API_KEY=$ApiKey
AGENT_NAME=$AgentName
AGENT_UI_PORT=$UIPort
HEARTBEAT_INTERVAL=60
STATUS_CHECK_INTERVAL=30
LOG_LEVEL=info
ENABLE_REALTIME=true
"@
    Set-Content -Path "$InstallPath\.env" -Value $envContent
    Write-Success "Configuration saved"

    Write-Step 6 $totalSteps "Registering Windows service..."

    # Download NSSM if needed
    if (-not (Test-Path $NssmPath)) {
        if (-not (Download-NSSM)) {
            throw "Failed to download NSSM service manager"
        }
    }

    # Stop existing service if running
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existingService) {
        if ($existingService.Status -eq 'Running') {
            & $NssmPath stop $ServiceName 2>&1 | Out-Null
            Start-Sleep -Seconds 2
        }
        & $NssmPath remove $ServiceName confirm 2>&1 | Out-Null
    }

    # Install service
    $nodePath = (Get-Command node).Source
    & $NssmPath install $ServiceName $nodePath "$InstallPath\dist\index.js" 2>&1 | Out-Null
    & $NssmPath set $ServiceName AppDirectory $InstallPath 2>&1 | Out-Null
    & $NssmPath set $ServiceName DisplayName "VelocityPulse Agent" 2>&1 | Out-Null
    & $NssmPath set $ServiceName Description "Network monitoring agent for VelocityPulse SaaS platform" 2>&1 | Out-Null
    & $NssmPath set $ServiceName Start SERVICE_AUTO_START 2>&1 | Out-Null
    & $NssmPath set $ServiceName AppStdout "$InstallPath\logs\service.log" 2>&1 | Out-Null
    & $NssmPath set $ServiceName AppStderr "$InstallPath\logs\service-error.log" 2>&1 | Out-Null

    # Create logs directory
    New-Item -ItemType Directory -Path "$InstallPath\logs" -Force | Out-Null

    # Start service
    & $NssmPath start $ServiceName 2>&1 | Out-Null
    Start-Sleep -Seconds 2

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq 'Running') {
        Write-Success "Service installed and running"
    } else {
        Write-ColorText "Service installed but may not be running. Check logs." "Yellow"
    }
}

function Uninstall-Agent {
    Write-ColorText "`nUninstalling VelocityPulse Agent..." "Yellow"

    # Stop and remove service
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existingService) {
        Write-ColorText "Stopping service..." "Gray"
        if ($existingService.Status -eq 'Running') {
            if (Test-Path $NssmPath) {
                & $NssmPath stop $ServiceName 2>&1 | Out-Null
            } else {
                Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            }
            Start-Sleep -Seconds 2
        }

        Write-ColorText "Removing service..." "Gray"
        if (Test-Path $NssmPath) {
            & $NssmPath remove $ServiceName confirm 2>&1 | Out-Null
        } else {
            sc.exe delete $ServiceName 2>&1 | Out-Null
        }
        Write-Success "Service removed"
    } else {
        Write-ColorText "Service not found" "Gray"
    }

    # Remove installation directory
    if (Test-Path $InstallPath) {
        Write-ColorText "Removing installation directory..." "Gray"
        Remove-Item -Path $InstallPath -Recurse -Force -ErrorAction SilentlyContinue
        Write-Success "Installation directory removed"
    }

    Write-ColorText "`n" "White"
    Write-ColorText "========================================" "Green"
    Write-ColorText "  Uninstallation Complete!" "Green"
    Write-ColorText "========================================" "Green"
}

function Upgrade-Agent {
    Write-ColorText "`nUpgrading VelocityPulse Agent..." "Yellow"

    # Check if agent is installed
    if (-not (Test-Path $InstallPath)) {
        throw "Agent not found at $InstallPath. Run install first."
    }

    # Backup current .env
    $envPath = "$InstallPath\.env"
    $envBackup = "$env:TEMP\velocitypulse-env-backup"
    if (Test-Path $envPath) {
        Copy-Item $envPath $envBackup -Force
        Write-Success "Configuration backed up"
    }

    # Stop service
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existingService -and $existingService.Status -eq 'Running') {
        Write-ColorText "Stopping service..." "Gray"
        if (Test-Path $NssmPath) {
            & $NssmPath stop $ServiceName 2>&1 | Out-Null
        } else {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }

    # Download new version
    Write-ColorText "Downloading latest version..." "Gray"
    $zipPath = "$env:TEMP\velocitypulse-agent.zip"
    Invoke-WebRequest -Uri $ZipUrl -OutFile $zipPath -UseBasicParsing

    $extractPath = "$env:TEMP\velocitypulse-extract"
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

    # Find the extracted folder (GitHub adds branch name)
    $sourceFolder = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1

    # Remove old files but keep logs and .env
    Get-ChildItem -Path $InstallPath -Exclude "logs", ".env", "nssm.exe" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    # Copy new files
    Copy-Item -Path "$($sourceFolder.FullName)\*" -Destination $InstallPath -Recurse -Force

    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Success "New version downloaded"

    # Restore .env if it was removed
    if (-not (Test-Path $envPath) -and (Test-Path $envBackup)) {
        Copy-Item $envBackup $envPath -Force
        Remove-Item $envBackup -Force -ErrorAction SilentlyContinue
    }

    # Rebuild
    Write-ColorText "Installing dependencies..." "Gray"
    Push-Location $InstallPath
    try {
        & npm install --production 2>&1 | Out-Null
        & npm run build 2>&1 | Out-Null
    } finally {
        Pop-Location
    }
    Write-Success "Dependencies installed"

    # Restart service
    Write-ColorText "Starting service..." "Gray"
    if (Test-Path $NssmPath) {
        & $NssmPath start $ServiceName 2>&1 | Out-Null
    } else {
        Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2

    $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq 'Running') {
        Write-Success "Service restarted"
    }

    Write-ColorText "`n" "White"
    Write-ColorText "========================================" "Green"
    Write-ColorText "  Upgrade Complete!" "Green"
    Write-ColorText "========================================" "Green"
}

# Main execution
try {
    Write-Banner
    Request-Elevation

    if ($Uninstall) {
        Uninstall-Agent
    } elseif ($Upgrade) {
        Upgrade-Agent
    } else {
        Get-Configuration
        Install-Agent

        Write-ColorText "`n" "White"
        Write-ColorText "========================================" "Green"
        Write-ColorText "  Installation Complete!" "Green"
        Write-ColorText "========================================" "Green"
        Write-ColorText "`nAgent installed to: $InstallPath" "White"
        Write-ColorText "Service name: $ServiceName" "White"
        Write-ColorText "Agent UI: http://localhost:$UIPort" "White"
        Write-ColorText "`nUseful commands:" "White"
        Write-ColorText "  Check status:  Get-Service $ServiceName" "Gray"
        Write-ColorText "  View logs:     Get-Content $InstallPath\logs\*.log -Tail 50" "Gray"
        Write-ColorText "  Restart:       Restart-Service $ServiceName" "Gray"
        Write-ColorText "  Uninstall:     .\install.ps1 -Uninstall" "Gray"
        Write-ColorText "  Upgrade:       .\install.ps1 -Upgrade" "Gray"
        Write-ColorText "`n"
    }

} catch {
    Write-Error2 "Installation failed: $_"
    exit 1
}
