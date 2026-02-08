import type { Logger } from '../utils/logger.js';
export interface UpgradeResult {
    success: boolean;
    message: string;
    previousVersion: string;
    targetVersion?: string;
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
export declare function performUpgrade(targetVersion: string, downloadUrl: string, logger: Logger): Promise<UpgradeResult>;
/**
 * Rollback to previous version
 */
export declare function rollback(logger: Logger): Promise<UpgradeResult>;
//# sourceMappingURL=upgrader.d.ts.map