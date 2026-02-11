/**
 * Centralized version management for VelocityPulse Agent
 * Single source of truth for version information
 */
export declare const VERSION = "1.0.0";
export declare const BUILD_ID = "__BUILD_ID__";
export declare const PRODUCT_NAME = "VelocityPulse Agent";
/**
 * Compare two semantic version strings
 * @returns -1 if a < b, 0 if a == b, 1 if a > b
 */
export declare function compareVersions(a: string, b: string): number;
/**
 * Check if latest version is newer than current version
 */
export declare function isNewerVersion(latest: string, current: string): boolean;
/**
 * Parse version into major, minor, patch components
 */
export declare function parseVersion(version: string): {
    major: number;
    minor: number;
    patch: number;
};
/**
 * Check if upgrade is a major version change (potentially breaking)
 */
export declare function isMajorUpgrade(latest: string, current: string): boolean;
/**
 * Check if upgrade is a minor version change (new features)
 */
export declare function isMinorUpgrade(latest: string, current: string): boolean;
/**
 * Check if upgrade is a patch version change (bug fixes)
 */
export declare function isPatchUpgrade(latest: string, current: string): boolean;
/**
 * Determine if auto-upgrade should proceed based on version type
 * @param autoUpgradeOnMinor Whether to allow auto-upgrade for minor versions
 * @returns true if auto-upgrade should proceed
 */
export declare function shouldAutoUpgrade(latest: string, current: string, autoUpgradeOnMinor?: boolean): boolean;
//# sourceMappingURL=version.d.ts.map