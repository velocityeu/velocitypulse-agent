import { config as dotenvConfig } from 'dotenv';
// Load .env file
dotenvConfig();
/**
 * Validate API key format: vp_{org_prefix}_{random}
 */
function validateApiKey(key) {
    const pattern = /^vp_[a-zA-Z0-9]+_[a-zA-Z0-9]{20,}$/;
    return pattern.test(key);
}
export function loadConfig() {
    // Support both new and legacy environment variable names
    const dashboardUrl = process.env.VELOCITYPULSE_URL || process.env.DASHBOARD_URL;
    const apiKey = process.env.VP_API_KEY || process.env.AGENT_API_KEY;
    if (!dashboardUrl) {
        throw new Error('VELOCITYPULSE_URL is required (or DASHBOARD_URL for legacy compatibility)');
    }
    if (!apiKey) {
        throw new Error('VP_API_KEY is required (or AGENT_API_KEY for legacy compatibility)');
    }
    // Validate API key format for new-style keys
    if (apiKey.startsWith('vp_') && !validateApiKey(apiKey)) {
        throw new Error('Invalid VP_API_KEY format. Expected: vp_{org_prefix}_{random_24_chars}');
    }
    return {
        dashboardUrl: dashboardUrl.replace(/\/$/, ''), // Remove trailing slash
        apiKey,
        agentName: process.env.AGENT_NAME || 'VelocityPulse Agent',
        heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '60', 10) * 1000,
        statusCheckInterval: parseInt(process.env.STATUS_CHECK_INTERVAL || '30', 10) * 1000,
        statusFailureThreshold: Math.max(0, parseInt(process.env.STATUS_FAILURE_THRESHOLD || '2', 10)),
        logLevel: process.env.LOG_LEVEL || 'info',
        logDir: process.env.LOG_DIR || './logs',
        // Supabase Realtime settings (optional - can be provided via heartbeat)
        supabaseUrl: process.env.SUPABASE_URL,
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
        enableRealtime: process.env.ENABLE_REALTIME !== 'false', // Default: true
        // Auto-scan settings
        enableAutoScan: process.env.ENABLE_AUTO_SCAN !== 'false', // Default: true
        autoScanInterval: parseInt(process.env.AUTO_SCAN_INTERVAL || '300', 10), // Default: 5 minutes
        // Auto-upgrade settings
        enableAutoUpgrade: process.env.ENABLE_AUTO_UPGRADE === 'true', // Default: false (opt-in)
        autoUpgradeOnMinor: process.env.AUTO_UPGRADE_ON_MINOR !== 'false', // Default: true
    };
}
//# sourceMappingURL=config.js.map