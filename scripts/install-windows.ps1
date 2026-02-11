<#
.SYNOPSIS
    VelocityPulse Agent installer for Windows.

.DESCRIPTION
    Downloads and installs the VelocityPulse Agent as a Windows service.
    Detects existing installs and offers upgrade, clean install, or uninstall.
    One-liner: irm https://get.velocitypulse.io/agent | iex

.PARAMETER ApiKey
    The agent API key from your VelocityPulse dashboard.

.PARAMETER DashboardUrl
    The dashboard URL (default: https://app.velocitypulse.io).

.PARAMETER InstallDir
    Installation directory (default: C:\Program Files\VelocityPulse Agent).

.PARAMETER AgentName
    Display name for this agent (default: hostname).

.PARAMETER CleanInstall
    Remove everything and reinstall from scratch.

.PARAMETER Uninstall
    Remove the agent completely and exit.

.PARAMETER Upgrade
    Upgrade files while keeping existing .env configuration.

.PARAMETER Force
    Skip interactive prompts (for automation/silent installs).
#>
param(
    [string]$ApiKey,
    [string]$DashboardUrl = "https://app.velocitypulse.io",
    [string]$InstallDir = "C:\Program Files\VelocityPulse Agent",
    [string]$AgentName = $env:COMPUTERNAME,
    [switch]$CleanInstall,
    [switch]$Uninstall,
    [switch]$Upgrade,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ServiceName = "VelocityPulseAgent"
$ServiceDisplay = "VelocityPulse Agent"
$InstallerVersion = "3.0.0"

# ============================================
# Self-elevation (replaces "run as admin" error)
# ============================================
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host ""
    Write-Host "  Requesting administrator privileges..." -ForegroundColor Yellow

    # Build argument list forwarding all params
    $paramArgs = @()
    if ($ApiKey)       { $paramArgs += "-ApiKey '$ApiKey'" }
    if ($DashboardUrl -ne "https://app.velocitypulse.io") { $paramArgs += "-DashboardUrl '$DashboardUrl'" }
    if ($InstallDir -ne "C:\Program Files\VelocityPulse Agent") { $paramArgs += "-InstallDir '$InstallDir'" }
    if ($AgentName -ne $env:COMPUTERNAME) { $paramArgs += "-AgentName '$AgentName'" }
    if ($CleanInstall) { $paramArgs += "-CleanInstall" }
    if ($Uninstall)    { $paramArgs += "-Uninstall" }
    if ($Upgrade)      { $paramArgs += "-Upgrade" }
    if ($Force)        { $paramArgs += "-Force" }
    $argString = $paramArgs -join " "

    try {
        if ($MyInvocation.PSCommandPath) {
            # Running from a saved script file
            $scriptPath = $MyInvocation.PSCommandPath
            Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $argString"
        } else {
            # Running via irm | iex — save to temp file first
            $tempScript = Join-Path $env:TEMP "install-vp-agent.ps1"
            $scriptUrl = "https://get.velocitypulse.io/agent"
            Invoke-WebRequest -Uri $scriptUrl -OutFile $tempScript -UseBasicParsing
            Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$tempScript`" $argString"
        }
        Write-Host "  Elevated process launched. This window can be closed." -ForegroundColor Green
        exit 0
    } catch {
        Write-Host ""
        Write-Host "  ERROR: Could not elevate to Administrator." -ForegroundColor Red
        Write-Host "  Right-click PowerShell and select 'Run as Administrator'." -ForegroundColor Red
        Write-Host ""
        exit 1
    }
}

# ============================================
# Banner
# ============================================
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "   VelocityPulse Agent Installer v$InstallerVersion" -ForegroundColor Cyan
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host ""

# ============================================
# Helper functions
# ============================================

function Test-ExistingInstall {
    $result = @{
        ServiceExists       = $false
        ServiceStatus       = $null
        ServiceImagePath    = $null
        DirExists           = $false
        EnvExists           = $false
        EnvApiKey           = $null
        EnvDashboardUrl     = $null
        EnvAgentName        = $null
        HasPackageJson      = $false
        HasEntryPoint       = $false
        NodeModulesHealthy  = $false
        Summary             = "none"
    }

    # Check service
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        $result.ServiceExists = $true
        $result.ServiceStatus = $svc.Status.ToString()
        $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
        if (Test-Path $regPath) {
            $result.ServiceImagePath = (Get-ItemProperty -Path $regPath -Name ImagePath -ErrorAction SilentlyContinue).ImagePath
        }
    }

    # Check install directory
    if (Test-Path $InstallDir) {
        $result.DirExists = $true
        $result.HasPackageJson = Test-Path (Join-Path $InstallDir "package.json")
        $result.HasEntryPoint = Test-Path (Join-Path $InstallDir "dist\index.js")

        # Check node_modules health
        $nmDir = Join-Path $InstallDir "node_modules"
        if (Test-Path $nmDir) {
            $hasExpress = Test-Path (Join-Path $nmDir "express")
            $hasDotenv = Test-Path (Join-Path $nmDir "dotenv")
            $result.NodeModulesHealthy = $hasExpress -and $hasDotenv
        }

        # Parse .env
        $envPath = Join-Path $InstallDir ".env"
        if (Test-Path $envPath) {
            $result.EnvExists = $true
            $envContent = Get-Content $envPath -ErrorAction SilentlyContinue
            foreach ($line in $envContent) {
                if ($line -match '^\s*VP_API_KEY\s*=\s*(.+)$') { $result.EnvApiKey = $Matches[1].Trim() }
                if ($line -match '^\s*VELOCITYPULSE_URL\s*=\s*(.+)$') { $result.EnvDashboardUrl = $Matches[1].Trim() }
                if ($line -match '^\s*AGENT_NAME\s*=\s*(.+)$') { $result.EnvAgentName = $Matches[1].Trim() }
            }
        }
    }

    # Determine summary
    if ($result.ServiceExists -and $result.DirExists -and $result.HasEntryPoint -and $result.NodeModulesHealthy) {
        $result.Summary = "healthy"
    } elseif ($result.ServiceExists -or $result.DirExists) {
        if (-not $result.HasPackageJson -or -not $result.HasEntryPoint -or -not $result.NodeModulesHealthy) {
            $result.Summary = "corrupt"
        } else {
            $result.Summary = "partial"
        }
    }

    return $result
}

function Stop-AgentService {
    param([int]$TimeoutSeconds = 30)

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) { return }

    $status = $svc.Status.ToString()

    # Handle stuck pending states by killing the process
    if ($status -eq "StopPending" -or $status -eq "StartPending") {
        Write-Host "  Service is stuck ($status). Killing process..." -ForegroundColor Yellow
        Kill-AgentProcess
        Start-Sleep -Seconds 2
        return
    }

    if ($status -eq "Running") {
        Write-Host "  Stopping service..." -ForegroundColor Yellow

        # Try NSSM stop first if available
        $nssmPath = Join-Path $InstallDir "nssm.exe"
        if (Test-Path $nssmPath) {
            & $nssmPath stop $ServiceName 2>&1 | Out-Null
        } else {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        }

        # Wait for it to stop
        $elapsed = 0
        while ($elapsed -lt $TimeoutSeconds) {
            Start-Sleep -Seconds 2
            $elapsed += 2
            $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
            if (-not $svc -or $svc.Status -eq "Stopped") { return }
        }

        # Timed out - force kill
        Write-Host "  Stop timed out after ${TimeoutSeconds}s. Force killing..." -ForegroundColor Yellow
        Kill-AgentProcess
        Start-Sleep -Seconds 2
    }
}

function Kill-AgentProcess {
    $entryPoint = Join-Path $InstallDir "dist\index.js"
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
        foreach ($proc in $procs) {
            if ($proc.CommandLine -and $proc.CommandLine -like "*$entryPoint*") {
                Write-Host "  Killing node.exe (PID $($proc.ProcessId))..." -ForegroundColor Yellow
                Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        # Fallback: kill all node processes that reference our install dir
        Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
            try { $_.Path -and $_.MainModule.FileName } catch { $false }
        } | ForEach-Object {
            Write-Host "  Killing node.exe (PID $($_.Id)) via fallback..." -ForegroundColor Yellow
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

function Remove-AgentService {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) { return }

    # Try NSSM remove first
    $nssmPath = Join-Path $InstallDir "nssm.exe"
    if (Test-Path $nssmPath) {
        & $nssmPath remove $ServiceName confirm 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $svc) { return }
    }

    # Fallback: sc.exe delete
    $scResult = sc.exe delete $ServiceName 2>&1
    Start-Sleep -Seconds 2

    # Verify deletion
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        # Fallback: direct registry removal
        Write-Host "  sc.exe delete failed, removing via registry..." -ForegroundColor Yellow
        $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"
        if (Test-Path $regPath) {
            Remove-Item -Path $regPath -Recurse -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }
}

function Remove-InstallDirectory {
    if (-not (Test-Path $InstallDir)) { return }

    try {
        Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction Stop
    } catch {
        # Long path fallback: robocopy /MIR with empty dir
        Write-Host "  Standard removal failed, using robocopy fallback..." -ForegroundColor Yellow
        $emptyDir = Join-Path $env:TEMP "vp-empty-$([guid]::NewGuid().ToString('N').Substring(0,8))"
        New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
        robocopy $emptyDir $InstallDir /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $emptyDir -Force -ErrorAction SilentlyContinue
    }
}

function Remove-TempFiles {
    Get-ChildItem -Path $env:TEMP -Filter "vp-agent-*" -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Backup-EnvFile {
    $envPath = Join-Path $InstallDir ".env"
    if (Test-Path $envPath) {
        $backupPath = Join-Path $env:TEMP "vp-agent-env-backup.txt"
        Copy-Item -Path $envPath -Destination $backupPath -Force
        return $backupPath
    }
    return $null
}

function Restore-EnvFile {
    param([string]$BackupPath)
    if ($BackupPath -and (Test-Path $BackupPath)) {
        $envPath = Join-Path $InstallDir ".env"
        Copy-Item -Path $BackupPath -Destination $envPath -Force
        Remove-Item $BackupPath -Force -ErrorAction SilentlyContinue
        return $true
    }
    return $false
}

function Invoke-FullCleanup {
    Write-Host "  Stopping service..." -ForegroundColor Yellow
    Stop-AgentService
    Write-Host "  Removing service..." -ForegroundColor Yellow
    Remove-AgentService
    Write-Host "  Removing install directory..." -ForegroundColor Yellow
    Remove-InstallDirectory
    Write-Host "  Cleaning temp files..." -ForegroundColor Yellow
    Remove-TempFiles
}

function Show-InstallStatus {
    param($State)

    Write-Host "  Existing installation detected:" -ForegroundColor White
    Write-Host ""

    $svcColor = if ($State.ServiceExists) {
        if ($State.ServiceStatus -eq "Running") { "Green" } else { "Yellow" }
    } else { "DarkGray" }
    $svcText = if ($State.ServiceExists) { "$($State.ServiceStatus)" } else { "Not found" }
    Write-Host "    Service:      $svcText" -ForegroundColor $svcColor

    $dirColor = if ($State.DirExists) { "Green" } else { "DarkGray" }
    $dirText = if ($State.DirExists) { "Present" } else { "Not found" }
    Write-Host "    Install Dir:  $dirText" -ForegroundColor $dirColor

    $envColor = if ($State.EnvExists) { "Green" } else { "DarkGray" }
    $envText = if ($State.EnvExists) { "Present" } else { "Not found" }
    Write-Host "    Config (.env): $envText" -ForegroundColor $envColor

    if ($State.EnvAgentName) {
        Write-Host "    Agent Name:   $($State.EnvAgentName)" -ForegroundColor Cyan
    }

    $epColor = if ($State.HasEntryPoint) { "Green" } else { "Red" }
    $epText = if ($State.HasEntryPoint) { "OK" } else { "Missing" }
    Write-Host "    Entry point:  $epText" -ForegroundColor $epColor

    $nmColor = if ($State.NodeModulesHealthy) { "Green" } else { "Red" }
    $nmText = if ($State.NodeModulesHealthy) { "OK" } else { "Corrupt or missing" }
    Write-Host "    Dependencies: $nmText" -ForegroundColor $nmColor

    Write-Host ""
}

function Install-NodeJS {
    Write-Host "  Node.js not found. Attempting auto-install..." -ForegroundColor Yellow

    # Try WinGet first
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  Installing Node.js LTS via WinGet..." -ForegroundColor Yellow
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $wingetOutput = winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent 2>&1
        $wingetExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP

        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

        $nodeCheck = $null
        try { $nodeCheck = (node --version 2>$null) } catch {}
        if ($nodeCheck) {
            Write-Host "  Node.js $nodeCheck installed via WinGet" -ForegroundColor Green
            return $true
        }
    }

    # Fallback: direct MSI download
    Write-Host "  WinGet unavailable or failed. Downloading Node.js MSI..." -ForegroundColor Yellow
    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $nodeUrl = "https://nodejs.org/dist/v22.15.0/node-v22.15.0-$arch.msi"
    $nodeMsi = Join-Path $env:TEMP "node-lts-install.msi"

    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeMsi -UseBasicParsing
        Write-Host "  Running Node.js installer..." -ForegroundColor Yellow
        $msiResult = Start-Process msiexec.exe -ArgumentList "/i `"$nodeMsi`" /qn /norestart" -Wait -PassThru
        Remove-Item $nodeMsi -Force -ErrorAction SilentlyContinue

        if ($msiResult.ExitCode -ne 0) {
            Write-Host "  MSI installer exited with code $($msiResult.ExitCode)" -ForegroundColor Yellow
        }

        # Refresh PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

        $nodeCheck = $null
        try { $nodeCheck = (node --version 2>$null) } catch {}
        if ($nodeCheck) {
            Write-Host "  Node.js $nodeCheck installed via MSI" -ForegroundColor Green
            return $true
        }
    } catch {
        Write-Host "  MSI download failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }

    # Both methods failed
    Write-Host "  ERROR: Could not auto-install Node.js." -ForegroundColor Red
    Write-Host "  Please install Node.js 18+ manually from https://nodejs.org" -ForegroundColor Red
    return $false
}

function Install-NSSM {
    $nssmPath = Join-Path $InstallDir "nssm.exe"

    # Already present
    if (Test-Path $nssmPath) {
        Write-Host "  NSSM already present" -ForegroundColor Green
        return $true
    }

    # Create install dir if needed
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    $nssmUrls = @(
        "https://nssm.cc/release/nssm-2.24.zip",
        "https://nssm.cc/ci/nssm-2.24-101-g897c7ad.zip",
        "https://web.archive.org/web/2024/https://nssm.cc/release/nssm-2.24.zip"
    )

    $nssmZip = Join-Path $env:TEMP "nssm-download.zip"
    $nssmExtract = Join-Path $env:TEMP "nssm-extract"
    $downloaded = $false

    foreach ($url in $nssmUrls) {
        try {
            Write-Host "  Downloading NSSM from $url..." -ForegroundColor Yellow
            Invoke-WebRequest -Uri $url -OutFile $nssmZip -UseBasicParsing -TimeoutSec 30
            $zipSize = (Get-Item $nssmZip).Length
            if ($zipSize -gt 10240) {
                $downloaded = $true
                break
            }
            Write-Host "  Download too small ($zipSize bytes), trying next mirror..." -ForegroundColor Yellow
            Remove-Item $nssmZip -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Host "  Mirror failed: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    if (-not $downloaded) {
        Write-Host "  ERROR: Could not download NSSM from any mirror." -ForegroundColor Red
        Write-Host "  Please download manually from https://nssm.cc/release/nssm-2.24.zip" -ForegroundColor Red
        Write-Host "  Extract nssm.exe to: $InstallDir" -ForegroundColor Red
        return $false
    }

    # Extract
    if (Test-Path $nssmExtract) { Remove-Item $nssmExtract -Recurse -Force }
    Expand-Archive -Path $nssmZip -DestinationPath $nssmExtract -Force

    # Find the right binary (prefer 64-bit)
    $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
    $nssmExe = Get-ChildItem -Path $nssmExtract -Filter "nssm.exe" -Recurse | Where-Object {
        $_.DirectoryName -like "*$arch*"
    } | Select-Object -First 1

    if (-not $nssmExe) {
        # Fallback: any nssm.exe
        $nssmExe = Get-ChildItem -Path $nssmExtract -Filter "nssm.exe" -Recurse | Select-Object -First 1
    }

    if (-not $nssmExe) {
        Write-Host "  ERROR: nssm.exe not found in downloaded archive." -ForegroundColor Red
        Remove-Item $nssmZip -Force -ErrorAction SilentlyContinue
        Remove-Item $nssmExtract -Recurse -Force -ErrorAction SilentlyContinue
        return $false
    }

    Copy-Item -Path $nssmExe.FullName -Destination $nssmPath -Force

    # Cleanup
    Remove-Item $nssmZip -Force -ErrorAction SilentlyContinue
    Remove-Item $nssmExtract -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "  NSSM installed" -ForegroundColor Green
    return $true
}

function Protect-EnvFile {
    $envFile = Join-Path $InstallDir ".env"
    if (-not (Test-Path $envFile)) { return }

    try {
        $acl = Get-Acl $envFile
        $acl.SetAccessRuleProtection($true, $false)  # Disable inheritance, remove inherited rules
        # Clear existing access rules
        $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) } | Out-Null
        # Add SYSTEM FullControl
        $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule("NT AUTHORITY\SYSTEM", "FullControl", "Allow")
        $acl.AddAccessRule($systemRule)
        # Add Administrators FullControl
        $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule("BUILTIN\Administrators", "FullControl", "Allow")
        $acl.AddAccessRule($adminRule)
        Set-Acl -Path $envFile -AclObject $acl
        Write-Host "  .env file permissions locked (SYSTEM + Administrators only)" -ForegroundColor Green
    } catch {
        Write-Host "  WARNING: Could not restrict .env permissions: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function New-UpgradeBackup {
    if (-not (Test-Path $InstallDir)) { return $null }

    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupDir = Join-Path (Split-Path $InstallDir -Parent) "VelocityPulse-backup-$timestamp"
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

    # Backup key files
    $distDir = Join-Path $InstallDir "dist"
    if (Test-Path $distDir) {
        Copy-Item -Path $distDir -Destination (Join-Path $backupDir "dist") -Recurse -Force
    }
    foreach ($file in @("package.json", "package-lock.json", ".env")) {
        $src = Join-Path $InstallDir $file
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination (Join-Path $backupDir $file) -Force
        }
    }
    $nssmSrc = Join-Path $InstallDir "nssm.exe"
    if (Test-Path $nssmSrc) {
        Copy-Item -Path $nssmSrc -Destination (Join-Path $backupDir "nssm.exe") -Force
    }

    Write-Host "  Backup created at $backupDir" -ForegroundColor Green
    return $backupDir
}

function Restore-UpgradeBackup {
    param([string]$BackupDir)
    if (-not $BackupDir -or -not (Test-Path $BackupDir)) { return $false }

    Write-Host "  Rolling back from backup..." -ForegroundColor Yellow

    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    # Restore dist/
    $backupDist = Join-Path $BackupDir "dist"
    if (Test-Path $backupDist) {
        $destDist = Join-Path $InstallDir "dist"
        if (Test-Path $destDist) { Remove-Item $destDist -Recurse -Force -ErrorAction SilentlyContinue }
        Copy-Item -Path $backupDist -Destination $destDist -Recurse -Force
    }

    # Restore individual files
    foreach ($file in @("package.json", "package-lock.json", ".env", "nssm.exe")) {
        $src = Join-Path $BackupDir $file
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination (Join-Path $InstallDir $file) -Force
        }
    }

    # Re-register and start service
    $nssmPath = Join-Path $InstallDir "nssm.exe"
    $nodeExe = $null
    try { $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source } catch {}

    if ($nodeExe -and (Test-Path $nssmPath)) {
        $entryPoint = Join-Path $InstallDir "dist\index.js"
        & $nssmPath install $ServiceName $nodeExe 2>&1 | Out-Null
        & $nssmPath set $ServiceName AppDirectory $InstallDir 2>&1 | Out-Null
        & $nssmPath set $ServiceName Start SERVICE_AUTO_START 2>&1 | Out-Null
        $paramsRegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
        if (Test-Path $paramsRegPath) {
            Set-ItemProperty -Path $paramsRegPath -Name "AppParameters" -Value "`"$entryPoint`""
        }
        & $nssmPath start $ServiceName 2>&1 | Out-Null
    }

    Write-Host "  Rollback complete. Old version restored and service restarted." -ForegroundColor Green
    return $true
}

function Remove-UpgradeBackup {
    param([string]$BackupDir)
    if ($BackupDir -and (Test-Path $BackupDir)) {
        Remove-Item $BackupDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ============================================
# Detect existing installation
# ============================================
$existingState = Test-ExistingInstall

# Determine install mode
$mode = "fresh"

if ($Uninstall) {
    $mode = "uninstall"
} elseif ($CleanInstall) {
    $mode = "clean"
} elseif ($Upgrade) {
    $mode = "upgrade"
} elseif ($existingState.Summary -ne "none") {
    # Existing install found - show menu or fail if -Force without explicit mode
    if ($Force) {
        # Default to upgrade when -Force is used with existing install
        $mode = "upgrade"
    } else {
        Show-InstallStatus $existingState

        if ($existingState.Summary -eq "corrupt") {
            Write-Host "  WARNING: Installation appears corrupt." -ForegroundColor Red
            Write-Host ""
        }

        Write-Host "  What would you like to do?" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "    1. Upgrade        (keep .env config, update files)" -ForegroundColor White
        Write-Host "    2. Clean Install  (remove everything, start fresh)" -ForegroundColor White
        Write-Host "    3. Uninstall      (remove agent completely)" -ForegroundColor White
        Write-Host "    4. Cancel" -ForegroundColor White
        Write-Host ""

        $choice = Read-Host "  Enter choice (1-4)"
        switch ($choice) {
            "1" { $mode = "upgrade" }
            "2" { $mode = "clean" }
            "3" { $mode = "uninstall" }
            default {
                Write-Host ""
                Write-Host "  Cancelled." -ForegroundColor Yellow
                exit 0
            }
        }
    }
}

# ============================================
# Uninstall mode
# ============================================
if ($mode -eq "uninstall") {
    Write-Host ""
    Write-Host "  Uninstalling VelocityPulse Agent..." -ForegroundColor Yellow
    Write-Host ""
    Invoke-FullCleanup
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host "   VelocityPulse Agent Uninstalled" -ForegroundColor Green
    Write-Host "  ============================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# ============================================
# [1/9] Check prerequisites
# ============================================
Write-Host "[1/9] Checking prerequisites..." -ForegroundColor Yellow

# Node.js check with auto-install
$nodeVersion = $null
try { $nodeVersion = (node --version 2>$null) } catch {}

if (-not $nodeVersion) {
    $installed = Install-NodeJS
    if (-not $installed) { exit 1 }
    $nodeVersion = (node --version 2>$null)
}

$major = [int]($nodeVersion -replace '^v(\d+)\..*', '$1')
if ($major -lt 18) {
    Write-Host "  ERROR: Node.js $nodeVersion is too old. Version 18+ required." -ForegroundColor Red
    exit 1
}
Write-Host "  Node.js $nodeVersion" -ForegroundColor Green

# Disk space check (require 500MB)
$installDrive = Split-Path $InstallDir -Qualifier
if (-not $installDrive) { $installDrive = "C:" }
try {
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$installDrive'" -ErrorAction SilentlyContinue
    if ($disk) {
        $freeGB = [math]::Round($disk.FreeSpace / 1GB, 1)
        $freeMB = [math]::Round($disk.FreeSpace / 1MB, 0)
        if ($disk.FreeSpace -lt 524288000) {  # 500MB
            Write-Host "  ERROR: Insufficient disk space on $installDrive" -ForegroundColor Red
            Write-Host "  Required: 500 MB  |  Available: $freeMB MB" -ForegroundColor Red
            exit 1
        }
        Write-Host "  Disk space: ${freeGB} GB free on $installDrive" -ForegroundColor Green
    }
} catch {
    Write-Host "  Disk space check skipped" -ForegroundColor Yellow
}

# Port 3001 check (skip in upgrade mode - service already stopped)
if ($mode -ne "upgrade") {
    try {
        $portInUse = Get-NetTCPConnection -LocalPort 3001 -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($portInUse) {
            $proc = Get-Process -Id $portInUse.OwningProcess -ErrorAction SilentlyContinue
            $procName = if ($proc) { $proc.ProcessName } else { "unknown" }
            $procPid = $portInUse.OwningProcess

            # Check if it's our own agent
            $isOurAgent = $false
            if ($procName -eq "node") {
                try {
                    $cimProc = Get-CimInstance Win32_Process -Filter "ProcessId = $procPid" -ErrorAction SilentlyContinue
                    if ($cimProc.CommandLine -like "*VelocityPulse*") { $isOurAgent = $true }
                } catch {}
            }

            if (-not $isOurAgent) {
                Write-Host "  WARNING: Port 3001 is in use by $procName (PID $procPid)" -ForegroundColor Yellow
                Write-Host "  The agent may not start correctly. Consider stopping that process first." -ForegroundColor Yellow
            }
        }
    } catch {
        # Get-NetTCPConnection may not be available on all systems
    }
}

# ============================================
# [2/9] Configuration
# ============================================
Write-Host "[2/9] Configuration..." -ForegroundColor Yellow

$envBackupPath = $null

if ($mode -eq "upgrade" -and $existingState.EnvExists) {
    # Back up .env for restore after upgrade
    $envBackupPath = Backup-EnvFile
    Write-Host "  Reusing existing configuration" -ForegroundColor Green
    if ($existingState.EnvAgentName) { Write-Host "  Agent Name: $($existingState.EnvAgentName)" -ForegroundColor Cyan }
    if ($existingState.EnvDashboardUrl) { Write-Host "  Dashboard:  $($existingState.EnvDashboardUrl)" -ForegroundColor Cyan }
} else {
    # Need API key for fresh and clean installs
    if (-not $ApiKey) {
        if ($Force) {
            Write-Host "  ERROR: -ApiKey is required with -Force for new installations." -ForegroundColor Red
            exit 1
        }
        Write-Host ""
        $ApiKey = Read-Host "  Enter your Agent API Key (from VelocityPulse dashboard)"
        if (-not $ApiKey) {
            Write-Host "  ERROR: API key is required." -ForegroundColor Red
            exit 1
        }
        $inputUrl = Read-Host "  Dashboard URL (press Enter for $DashboardUrl)"
        if ($inputUrl) { $DashboardUrl = $inputUrl }
        $inputName = Read-Host "  Agent Name (press Enter for $AgentName)"
        if ($inputName) { $AgentName = $inputName }
    }
    Write-Host "  Dashboard:  $DashboardUrl" -ForegroundColor Green
    Write-Host "  Agent Name: $AgentName" -ForegroundColor Green
}

# ============================================
# [3/9] Cleanup + backup
# ============================================
Write-Host "[3/9] Cleanup..." -ForegroundColor Yellow

$upgradeBackupDir = $null

if ($mode -eq "clean" -or $mode -eq "upgrade") {
    Stop-AgentService
    Remove-AgentService
    if ($mode -eq "clean") {
        Remove-InstallDirectory
    } elseif ($mode -eq "upgrade") {
        # Create backup for rollback before removing files
        $upgradeBackupDir = New-UpgradeBackup
        # Remove everything except .env (already backed up)
        if (Test-Path $InstallDir) {
            Get-ChildItem -Path $InstallDir -Exclude ".env" -ErrorAction SilentlyContinue | ForEach-Object {
                try {
                    Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop
                } catch {
                    Write-Host "  Warning: Could not remove $($_.Name)" -ForegroundColor Yellow
                }
            }
        }
    }
    Remove-TempFiles
    Write-Host "  Cleanup complete" -ForegroundColor Green
} elseif ($existingState.ServiceExists) {
    # Fresh install but orphaned service found
    Write-Host "  Removing orphaned service..." -ForegroundColor Yellow
    Stop-AgentService
    Remove-AgentService
    Write-Host "  Orphaned service removed" -ForegroundColor Green
} else {
    Write-Host "  Nothing to clean" -ForegroundColor Green
}

# ============================================
# Steps 4-8 wrapped in try/catch for upgrade rollback
# ============================================
$installFailed = $false

try {

# ============================================
# [4/9] Download NSSM
# ============================================
Write-Host "[4/9] Installing NSSM service manager..." -ForegroundColor Yellow

$nssmReady = Install-NSSM
if (-not $nssmReady) {
    throw "NSSM installation failed"
}

# ============================================
# [5/9] Download from GitHub
# ============================================
Write-Host "[5/9] Downloading latest agent release..." -ForegroundColor Yellow

# Monorepo releases: filter for agent-v* tags
# Supports private repos via GITHUB_TOKEN env var
$releasesUrl = "https://api.github.com/repos/velocityeu/velocitypulse/releases"
$apiHeaders = @{ "User-Agent" = "VelocityPulse-Installer" }
if ($env:GITHUB_TOKEN) {
    $apiHeaders["Authorization"] = "token $($env:GITHUB_TOKEN)"
}
try {
    $releases = Invoke-RestMethod -Uri $releasesUrl -Headers $apiHeaders
    $agentRelease = $releases | Where-Object { $_.tag_name -like "agent-v*" } | Select-Object -First 1

    if ($agentRelease) {
        $version = $agentRelease.tag_name
        # Prefer .zip for Windows
        $asset = $agentRelease.assets | Where-Object { $_.name -like "velocitypulse-agent-*.zip" } | Select-Object -First 1
        if (-not $asset) {
            $asset = $agentRelease.assets | Where-Object { $_.name -like "velocitypulse-agent-*" } | Select-Object -First 1
        }

        if ($asset) {
            # For private repos, use API asset endpoint (browser_download_url returns 404)
            if ($env:GITHUB_TOKEN) {
                $downloadUrl = "https://api.github.com/repos/velocityeu/velocitypulse/releases/assets/$($asset.id)"
                $useApiDownload = $true
            } else {
                $downloadUrl = $asset.browser_download_url
                $useApiDownload = $false
            }
        } else {
            $downloadUrl = $agentRelease.zipball_url
            $useApiDownload = $false
        }
        Write-Host "  Version: $version" -ForegroundColor Green
    } else {
        throw "No agent releases found"
    }
} catch {
    Write-Host "  WARNING: Could not fetch latest release." -ForegroundColor Yellow
    if (-not $env:GITHUB_TOKEN) {
        Write-Host "  For private repos, set GITHUB_TOKEN env var before running." -ForegroundColor Yellow
    }
    Write-Host "  Falling back to main branch archive." -ForegroundColor Yellow
    $version = "latest"
    $downloadUrl = "https://github.com/velocityeu/velocitypulse/archive/refs/heads/main.zip"
    $useApiDownload = $false
}

$tempZip = Join-Path $env:TEMP "vp-agent-$([guid]::NewGuid().ToString('N').Substring(0,8)).zip"
$tempExtract = Join-Path $env:TEMP "vp-agent-extract"

$dlHeaders = @{ "User-Agent" = "VelocityPulse-Installer" }
if ($useApiDownload -and $env:GITHUB_TOKEN) {
    $dlHeaders["Authorization"] = "token $($env:GITHUB_TOKEN)"
    $dlHeaders["Accept"] = "application/octet-stream"
}
Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -Headers $dlHeaders
Write-Host "  Downloaded OK" -ForegroundColor Green

# ============================================
# [6/9] Extract + npm install + verify
# ============================================
Write-Host "[6/9] Installing files..." -ForegroundColor Yellow

if (Test-Path $tempExtract) { Remove-Item $tempExtract -Recurse -Force }
Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force

# Find extracted directory (GitHub adds a prefix)
$sourceDir = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1
if (-not $sourceDir) {
    throw "Could not find extracted directory."
}

# Create install directory
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Copy files
Copy-Item -Path "$($sourceDir.FullName)\*" -Destination $InstallDir -Recurse -Force
Write-Host "  Files extracted" -ForegroundColor Green

$entryPoint = Join-Path $InstallDir "dist\index.js"

# Check if this is a pre-built release or source archive
if (Test-Path $entryPoint) {
    # Pre-built release: install production dependencies only
    Write-Host "  Pre-built dist/ found. Installing production dependencies..."
    Push-Location $InstallDir
    try {
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $npmOutput = npm install --omit=dev 2>&1
        $npmExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
    } finally {
        Pop-Location
    }
    if ($npmExit -ne 0) {
        throw "npm install failed (exit code $npmExit). Output: $npmOutput"
    }
} else {
    # Source archive: install all dependencies (including TypeScript) and build
    Write-Host "  No pre-built dist/ found. Building from source..." -ForegroundColor Yellow
    Push-Location $InstallDir
    try {
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "Continue"

        Write-Host "  Installing dependencies (this may take a minute)..."
        $npmOutput = npm install 2>&1
        $npmExit = $LASTEXITCODE
        if ($npmExit -ne 0) {
            throw "npm install failed (exit code $npmExit). Output: $npmOutput"
        }

        Write-Host "  Building agent..."
        $buildOutput = npm run build 2>&1
        $buildExit = $LASTEXITCODE
        if ($buildExit -ne 0) {
            throw "npm run build failed (exit code $buildExit). Output: $buildOutput"
        }

        $ErrorActionPreference = $prevEAP
        Write-Host "  Build completed" -ForegroundColor Green
    } finally {
        Pop-Location
    }

    # Verify build output
    if (-not (Test-Path $entryPoint)) {
        throw "Build completed but dist\index.js not found. Check build configuration."
    }
}

# Verify node_modules
$nmDir = Join-Path $InstallDir "node_modules"
if (-not (Test-Path (Join-Path $nmDir "express")) -or -not (Test-Path (Join-Path $nmDir "dotenv"))) {
    throw "node_modules is incomplete. Key packages missing."
}

Write-Host "  Dependencies installed" -ForegroundColor Green

# ============================================
# [7/9] Write .env config + ACL
# ============================================
Write-Host "[7/9] Configuring agent..." -ForegroundColor Yellow

if ($mode -eq "upgrade" -and $envBackupPath) {
    $restored = Restore-EnvFile $envBackupPath
    if ($restored) {
        Write-Host "  Restored existing .env configuration" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: Could not restore .env backup. Writing new config." -ForegroundColor Yellow
        $mode = "fresh"  # Fall through to write new .env
    }
}

if ($mode -ne "upgrade") {
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
}

# Lock down .env permissions
Protect-EnvFile

# ============================================
# [8/9] Register and start Windows service via NSSM
# ============================================
Write-Host "[8/9] Registering Windows service..." -ForegroundColor Yellow

$nodeExe = (Get-Command node).Source
$nssmPath = Join-Path $InstallDir "nssm.exe"

# Create logs directory
$logsDir = Join-Path $InstallDir "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

# Register service via NSSM
& $nssmPath install $ServiceName $nodeExe 2>&1 | Out-Null
& $nssmPath set $ServiceName AppDirectory $InstallDir 2>&1 | Out-Null
& $nssmPath set $ServiceName DisplayName $ServiceDisplay 2>&1 | Out-Null
& $nssmPath set $ServiceName Description "VelocityPulse network monitoring agent" 2>&1 | Out-Null
& $nssmPath set $ServiceName Start SERVICE_AUTO_START 2>&1 | Out-Null
& $nssmPath set $ServiceName AppStdout (Join-Path $logsDir "service.log") 2>&1 | Out-Null
& $nssmPath set $ServiceName AppStderr (Join-Path $logsDir "service-error.log") 2>&1 | Out-Null
& $nssmPath set $ServiceName AppRotateFiles 1 2>&1 | Out-Null
& $nssmPath set $ServiceName AppRotateBytes 1048576 2>&1 | Out-Null

# Set AppParameters via registry — PowerShell's argument escaping to native exes
# is unreliable with embedded quotes, so write the quoted path directly to the registry
$paramsRegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters"
if (Test-Path $paramsRegPath) {
    Set-ItemProperty -Path $paramsRegPath -Name "AppParameters" -Value "`"$entryPoint`""
}

# Verify service was created
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    throw "Service registration failed."
}
Write-Host "  Service registered (NSSM)" -ForegroundColor Green

# Start service
try {
    Start-Service -Name $ServiceName
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc.Status -eq "Running") {
        Write-Host "  Service started successfully" -ForegroundColor Green
    } else {
        throw "Service status: $($svc.Status)"
    }
} catch {
    Write-Host "  WARNING: Service failed to start." -ForegroundColor Yellow
    # Query Event Log for errors
    try {
        $events = Get-WinEvent -FilterHashtable @{
            LogName = "System"
            ProviderName = "Service Control Manager"
            Level = 2
            StartTime = (Get-Date).AddMinutes(-2)
        } -MaxEvents 3 -ErrorAction SilentlyContinue

        if ($events) {
            Write-Host "  Recent error events:" -ForegroundColor Yellow
            foreach ($evt in $events) {
                Write-Host "    $($evt.TimeCreated): $($evt.Message.Substring(0, [Math]::Min(120, $evt.Message.Length)))" -ForegroundColor DarkYellow
            }
        }
    } catch {}
    Write-Host ""
    Write-Host "  Manual test: cd '$InstallDir' && node dist\index.js" -ForegroundColor Yellow
    Write-Host "  Start:       Start-Service $ServiceName" -ForegroundColor Yellow
}

} catch {
    # ============================================
    # Upgrade rollback on failure
    # ============================================
    $installFailed = $true
    Write-Host ""
    Write-Host "  ERROR: Installation failed: $($_.Exception.Message)" -ForegroundColor Red

    if ($mode -eq "upgrade" -and $upgradeBackupDir) {
        Write-Host ""
        $rolledBack = Restore-UpgradeBackup $upgradeBackupDir
        if ($rolledBack) {
            Write-Host "  Previous version has been restored." -ForegroundColor Yellow
        } else {
            Write-Host "  WARNING: Rollback also failed. Manual recovery may be needed." -ForegroundColor Red
            Write-Host "  Backup dir: $upgradeBackupDir" -ForegroundColor Yellow
        }
    } else {
        Write-Host ""
        Write-Host "  Installation aborted." -ForegroundColor Red
    }
}

# ============================================
# [9/9] Post-install verification
# ============================================
if (-not $installFailed) {
    Write-Host "[9/9] Verifying installation..." -ForegroundColor Yellow

    $finalState = Test-ExistingInstall

    $allGood = $true
    if (-not $finalState.ServiceExists) {
        Write-Host "  FAIL: Service not found" -ForegroundColor Red; $allGood = $false
    }
    if (-not $finalState.HasEntryPoint) {
        Write-Host "  FAIL: dist\index.js missing" -ForegroundColor Red; $allGood = $false
    }
    if (-not $finalState.NodeModulesHealthy) {
        Write-Host "  FAIL: node_modules incomplete" -ForegroundColor Red; $allGood = $false
    }
    if (-not $finalState.EnvExists) {
        Write-Host "  FAIL: .env missing" -ForegroundColor Red; $allGood = $false
    }
    if ($allGood) {
        Write-Host "  All checks passed" -ForegroundColor Green
    }
}

# ============================================
# Cleanup temp files + upgrade backup
# ============================================
if (Test-Path variable:tempZip) {
    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
}
if (Test-Path variable:tempExtract) {
    Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
}
if (-not $installFailed -and $upgradeBackupDir) {
    Remove-UpgradeBackup $upgradeBackupDir
}

# ============================================
# Done
# ============================================
if ($installFailed) {
    exit 1
}

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
if ($mode -eq "upgrade") {
    Write-Host "   Upgrade Complete!" -ForegroundColor Green
} else {
    Write-Host "   Installation Complete!" -ForegroundColor Green
}
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Install Dir:  $InstallDir" -ForegroundColor Cyan
Write-Host "  Service Name: $ServiceName" -ForegroundColor Cyan
Write-Host "  Agent UI:     http://localhost:3001" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Commands:" -ForegroundColor Yellow
Write-Host "    Start:     Start-Service $ServiceName" -ForegroundColor White
Write-Host "    Stop:      Stop-Service $ServiceName" -ForegroundColor White
Write-Host "    Status:    Get-Service $ServiceName" -ForegroundColor White
Write-Host "    Logs:      Get-Content '$InstallDir\logs\service.log' -Tail 50" -ForegroundColor White
Write-Host "    Errors:    Get-Content '$InstallDir\logs\service-error.log' -Tail 50" -ForegroundColor White
Write-Host "    Uninstall: .\install-windows.ps1 -Uninstall" -ForegroundColor White
Write-Host ""
