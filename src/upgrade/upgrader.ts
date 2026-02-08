import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as https from 'https'
import * as http from 'http'
import type { Logger } from '../utils/logger.js'
import { VERSION } from '../utils/version.js'

const execAsync = promisify(exec)
const fsPromises = fs.promises

export interface UpgradeResult {
  success: boolean
  message: string
  previousVersion: string
  targetVersion?: string
}

/**
 * Download a file from a URL to a local path
 */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const protocol = url.startsWith('https') ? https : http

    protocol.get(url, (response) => {
      // Follow redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          file.close()
          fs.unlinkSync(dest)
          downloadFile(redirectUrl, dest).then(resolve).catch(reject)
          return
        }
      }

      if (response.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        reject(new Error(`Download failed: HTTP ${response.statusCode}`))
        return
      }

      response.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve()
      })
    }).on('error', (err) => {
      file.close()
      try { fs.unlinkSync(dest) } catch { /* ignore */ }
      reject(err)
    })
  })
}

/**
 * Get the installation directory (where the agent is running from)
 */
function getInstallDir(): string {
  // In production, __dirname is dist/upgrade/, go up two levels
  // In development, we use the project root
  const scriptDir = path.dirname(new URL(import.meta.url).pathname)

  // Windows path fix
  const normalizedDir = process.platform === 'win32'
    ? scriptDir.replace(/^\//, '').replace(/\//g, '\\')
    : scriptDir

  // Go up from upgrade/ to the installation root
  return path.resolve(normalizedDir, '..', '..')
}

/**
 * Perform a self-upgrade of the agent
 *
 * Strategy:
 * 1. Download new release to temp directory
 * 2. Extract / verify
 * 3. Backup current version to ./previous/
 * 4. Platform-specific swap:
 *    - Windows: Write PowerShell script, spawn detached, exit
 *    - Linux: Write bash script, spawn detached, exit
 * 5. The spawned script replaces files and restarts the service
 */
export async function performUpgrade(
  targetVersion: string,
  downloadUrl: string,
  logger: Logger
): Promise<UpgradeResult> {
  const previousVersion = VERSION
  const installDir = getInstallDir()
  const tempDir = path.join(os.tmpdir(), `vp-agent-upgrade-${Date.now()}`)
  const backupDir = path.join(installDir, 'previous')

  logger.info(`Starting upgrade: ${previousVersion} -> ${targetVersion}`)
  logger.info(`Install dir: ${installDir}`)
  logger.info(`Temp dir: ${tempDir}`)

  try {
    // Create temp directory
    await fsPromises.mkdir(tempDir, { recursive: true })

    // Step 1: Download
    const archiveExt = downloadUrl.endsWith('.tar.gz') ? '.tar.gz' : '.zip'
    const archivePath = path.join(tempDir, `agent${archiveExt}`)

    logger.info(`Downloading from: ${downloadUrl}`)
    await downloadFile(downloadUrl, archivePath)

    // Verify download exists and has size
    const archiveStat = await fsPromises.stat(archivePath)
    if (archiveStat.size < 1024) {
      throw new Error(`Downloaded file too small: ${archiveStat.size} bytes`)
    }
    logger.info(`Downloaded: ${(archiveStat.size / 1024 / 1024).toFixed(1)} MB`)

    // Step 2: Extract
    const extractDir = path.join(tempDir, 'extracted')
    await fsPromises.mkdir(extractDir, { recursive: true })

    if (archiveExt === '.tar.gz') {
      await execAsync(`tar -xzf "${archivePath}" -C "${extractDir}"`)
    } else {
      // Use PowerShell on Windows for zip extraction
      if (process.platform === 'win32') {
        await execAsync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`)
      } else {
        await execAsync(`unzip -o "${archivePath}" -d "${extractDir}"`)
      }
    }

    logger.info('Archive extracted successfully')

    // Step 3: Backup current version
    await fsPromises.mkdir(backupDir, { recursive: true })

    // Copy key files to backup
    const filesToBackup = ['package.json', 'dist']
    for (const f of filesToBackup) {
      const src = path.join(installDir, f)
      const dest = path.join(backupDir, f)
      try {
        const stat = await fsPromises.stat(src)
        if (stat.isDirectory()) {
          await fsPromises.cp(src, dest, { recursive: true })
        } else {
          await fsPromises.copyFile(src, dest)
        }
      } catch {
        // File may not exist, skip
      }
    }
    logger.info('Current version backed up')

    // Step 4: Platform-specific swap
    if (process.platform === 'win32') {
      await windowsUpgrade(extractDir, installDir, targetVersion, logger)
    } else {
      await linuxUpgrade(extractDir, installDir, targetVersion, logger)
    }

    return {
      success: true,
      message: `Upgrade initiated: ${previousVersion} -> ${targetVersion}. Agent will restart.`,
      previousVersion,
      targetVersion,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`Upgrade failed: ${errorMsg}`)

    // Cleanup temp
    try { await fsPromises.rm(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }

    return {
      success: false,
      message: `Upgrade failed: ${errorMsg}`,
      previousVersion,
      targetVersion,
    }
  }
}

/**
 * Windows upgrade: write PowerShell script, spawn detached, exit
 */
async function windowsUpgrade(
  extractDir: string,
  installDir: string,
  targetVersion: string,
  logger: Logger
): Promise<void> {
  const scriptPath = path.join(os.tmpdir(), `vp-upgrade-${Date.now()}.ps1`)

  const script = `
# VelocityPulse Agent Upgrade Script
# Upgrading to version ${targetVersion}
Start-Sleep -Seconds 2

$source = "${extractDir.replace(/\\/g, '\\\\')}"
$dest = "${installDir.replace(/\\/g, '\\\\')}"

# Find the extracted content (may be in a subdirectory)
$content = Get-ChildItem -Path $source -Directory | Select-Object -First 1
if ($content) { $source = $content.FullName }

# Copy new files
try {
    if (Test-Path "$source\\dist") {
        Copy-Item -Path "$source\\dist\\*" -Destination "$dest\\dist\\" -Recurse -Force
    }
    if (Test-Path "$source\\package.json") {
        Copy-Item -Path "$source\\package.json" -Destination "$dest\\package.json" -Force
    }
    if (Test-Path "$source\\node_modules") {
        Copy-Item -Path "$source\\node_modules\\*" -Destination "$dest\\node_modules\\" -Recurse -Force
    }
} catch {
    Write-Error "Failed to copy files: $_"
    exit 1
}

# Restart the service
try {
    $serviceName = "VelocityPulseAgent"
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service) {
        Restart-Service -Name $serviceName -Force
    } else {
        # Fallback: try pm2
        & pm2 restart velocitypulse-agent 2>$null
        if ($LASTEXITCODE -ne 0) {
            # Start directly
            Start-Process -FilePath "node" -ArgumentList "$dest\\dist\\index.js" -WorkingDirectory $dest -WindowStyle Hidden
        }
    }
} catch {
    Write-Error "Failed to restart: $_"
}

# Cleanup
Remove-Item -Path "${extractDir.replace(/\\/g, '\\\\')}" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`

  await fsPromises.writeFile(scriptPath, script, 'utf-8')
  logger.info(`Upgrade script written to: ${scriptPath}`)

  // Spawn detached PowerShell process
  const { spawn } = await import('child_process')
  const child = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()

  logger.info('Upgrade script launched, agent will exit for restart...')

  // Give time for the process to start
  await new Promise(resolve => setTimeout(resolve, 500))

  // Exit - the upgrade script will restart us
  process.exit(0)
}

/**
 * Linux upgrade: write bash script, spawn detached, exit
 */
async function linuxUpgrade(
  extractDir: string,
  installDir: string,
  targetVersion: string,
  logger: Logger
): Promise<void> {
  const scriptPath = path.join(os.tmpdir(), `vp-upgrade-${Date.now()}.sh`)

  const script = `#!/bin/bash
# VelocityPulse Agent Upgrade Script
# Upgrading to version ${targetVersion}
sleep 2

SOURCE="${extractDir}"
DEST="${installDir}"

# Find extracted content (may be in a subdirectory)
CONTENT=$(find "$SOURCE" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ -n "$CONTENT" ]; then SOURCE="$CONTENT"; fi

# Copy new files
if [ -d "$SOURCE/dist" ]; then
    cp -rf "$SOURCE/dist/"* "$DEST/dist/"
fi
if [ -f "$SOURCE/package.json" ]; then
    cp -f "$SOURCE/package.json" "$DEST/package.json"
fi
if [ -d "$SOURCE/node_modules" ]; then
    cp -rf "$SOURCE/node_modules/"* "$DEST/node_modules/"
fi

# Restart the service
if systemctl is-active --quiet velocitypulse-agent 2>/dev/null; then
    systemctl restart velocitypulse-agent
elif command -v pm2 &>/dev/null; then
    pm2 restart velocitypulse-agent 2>/dev/null || node "$DEST/dist/index.js" &
else
    node "$DEST/dist/index.js" &
fi

# Cleanup
rm -rf "${extractDir}"
rm -f "$0"
`

  await fsPromises.writeFile(scriptPath, script, 'utf-8')
  await execAsync(`chmod +x "${scriptPath}"`)
  logger.info(`Upgrade script written to: ${scriptPath}`)

  // Spawn detached bash process
  const { spawn } = await import('child_process')
  const child = spawn('bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()

  logger.info('Upgrade script launched, agent will exit for restart...')
  await new Promise(resolve => setTimeout(resolve, 500))
  process.exit(0)
}

/**
 * Rollback to previous version
 */
export async function rollback(logger: Logger): Promise<UpgradeResult> {
  const installDir = getInstallDir()
  const backupDir = path.join(installDir, 'previous')

  try {
    const backupExists = await fsPromises.stat(backupDir).then(() => true).catch(() => false)
    if (!backupExists) {
      return { success: false, message: 'No backup found for rollback', previousVersion: VERSION }
    }

    // Copy backup files back
    const files = await fsPromises.readdir(backupDir)
    for (const f of files) {
      const src = path.join(backupDir, f)
      const dest = path.join(installDir, f)
      const stat = await fsPromises.stat(src)
      if (stat.isDirectory()) {
        await fsPromises.cp(src, dest, { recursive: true })
      } else {
        await fsPromises.copyFile(src, dest)
      }
    }

    logger.info('Rollback completed, restart required')
    return { success: true, message: 'Rollback completed', previousVersion: VERSION }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    return { success: false, message: `Rollback failed: ${errorMsg}`, previousVersion: VERSION }
  }
}
