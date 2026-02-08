/**
 * Centralized version management for VelocityPulse Agent
 * Single source of truth for version information
 */
// Agent version - UPDATE THIS for each release
export const VERSION = '1.0.0';
// Product name for branding
export const PRODUCT_NAME = 'VelocityPulse Agent';
/**
 * Compare two semantic version strings
 * @returns -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a, b) {
    const parseVersion = (v) => {
        return v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    };
    const partsA = parseVersion(a);
    const partsB = parseVersion(b);
    // Pad to same length
    const maxLen = Math.max(partsA.length, partsB.length);
    while (partsA.length < maxLen)
        partsA.push(0);
    while (partsB.length < maxLen)
        partsB.push(0);
    for (let i = 0; i < maxLen; i++) {
        if (partsA[i] < partsB[i])
            return -1;
        if (partsA[i] > partsB[i])
            return 1;
    }
    return 0;
}
/**
 * Check if latest version is newer than current version
 */
export function isNewerVersion(latest, current) {
    return compareVersions(latest, current) > 0;
}
/**
 * Parse version into major, minor, patch components
 */
export function parseVersion(version) {
    const parts = version.replace(/^v/, '').split('.');
    return {
        major: parseInt(parts[0], 10) || 0,
        minor: parseInt(parts[1], 10) || 0,
        patch: parseInt(parts[2], 10) || 0,
    };
}
/**
 * Check if upgrade is a major version change (potentially breaking)
 */
export function isMajorUpgrade(latest, current) {
    const latestParts = parseVersion(latest);
    const currentParts = parseVersion(current);
    return latestParts.major > currentParts.major;
}
/**
 * Check if upgrade is a minor version change (new features)
 */
export function isMinorUpgrade(latest, current) {
    const latestParts = parseVersion(latest);
    const currentParts = parseVersion(current);
    return latestParts.major === currentParts.major && latestParts.minor > currentParts.minor;
}
/**
 * Check if upgrade is a patch version change (bug fixes)
 */
export function isPatchUpgrade(latest, current) {
    const latestParts = parseVersion(latest);
    const currentParts = parseVersion(current);
    return (latestParts.major === currentParts.major &&
        latestParts.minor === currentParts.minor &&
        latestParts.patch > currentParts.patch);
}
/**
 * Determine if auto-upgrade should proceed based on version type
 * @param autoUpgradeOnMinor Whether to allow auto-upgrade for minor versions
 * @returns true if auto-upgrade should proceed
 */
export function shouldAutoUpgrade(latest, current, autoUpgradeOnMinor = true) {
    if (!isNewerVersion(latest, current)) {
        return false;
    }
    // Never auto-upgrade major versions (breaking changes possible)
    if (isMajorUpgrade(latest, current)) {
        return false;
    }
    // Allow minor upgrades based on config
    if (isMinorUpgrade(latest, current)) {
        return autoUpgradeOnMinor;
    }
    // Always allow patch upgrades
    return true;
}
//# sourceMappingURL=version.js.map