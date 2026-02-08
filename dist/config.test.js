import { describe, it, expect, beforeEach, vi } from 'vitest';
// Mock dotenv so it doesn't load a real .env file during tests
vi.mock('dotenv', () => ({
    config: vi.fn(),
}));
// Must import after mock setup
import { loadConfig } from './config.js';
describe('loadConfig', () => {
    const originalEnv = process.env;
    beforeEach(() => {
        // Reset process.env to a clean state for each test
        process.env = { ...originalEnv };
        // Clear the required vars to ensure clean tests
        delete process.env.VELOCITYPULSE_URL;
        delete process.env.DASHBOARD_URL;
        delete process.env.VP_API_KEY;
        delete process.env.AGENT_API_KEY;
        // Reset module cache so serverEnvCache doesn't persist
        vi.resetModules();
    });
    it('throws when VELOCITYPULSE_URL is missing', () => {
        process.env.VP_API_KEY = 'test-api-key';
        expect(() => loadConfig()).toThrow('VELOCITYPULSE_URL is required');
    });
    it('throws when VP_API_KEY is missing', () => {
        process.env.VELOCITYPULSE_URL = 'https://app.velocitypulse.io';
        expect(() => loadConfig()).toThrow('VP_API_KEY is required');
    });
    it('returns valid config with correct defaults', () => {
        process.env.VELOCITYPULSE_URL = 'https://app.velocitypulse.io';
        process.env.VP_API_KEY = 'test-api-key';
        const config = loadConfig();
        expect(config.dashboardUrl).toBe('https://app.velocitypulse.io');
        expect(config.apiKey).toBe('test-api-key');
        expect(config.agentName).toBe('VelocityPulse Agent');
        expect(config.heartbeatInterval).toBe(60000); // 60 * 1000
        expect(config.statusCheckInterval).toBe(30000); // 30 * 1000
        expect(config.statusFailureThreshold).toBe(2);
        expect(config.logLevel).toBe('info');
        expect(config.logDir).toBe('./logs');
        expect(config.enableRealtime).toBe(true);
        expect(config.enableAutoScan).toBe(true);
        expect(config.autoScanInterval).toBe(300);
        expect(config.enableAutoUpgrade).toBe(false);
        expect(config.autoUpgradeOnMinor).toBe(true);
    });
    it('removes trailing slash from dashboard URL', () => {
        process.env.VELOCITYPULSE_URL = 'https://app.velocitypulse.io/';
        process.env.VP_API_KEY = 'test-api-key';
        const config = loadConfig();
        expect(config.dashboardUrl).toBe('https://app.velocitypulse.io');
    });
    it('supports legacy env var DASHBOARD_URL', () => {
        process.env.DASHBOARD_URL = 'https://legacy.velocitypulse.io';
        process.env.VP_API_KEY = 'test-api-key';
        const config = loadConfig();
        expect(config.dashboardUrl).toBe('https://legacy.velocitypulse.io');
    });
    it('supports legacy env var AGENT_API_KEY', () => {
        process.env.VELOCITYPULSE_URL = 'https://app.velocitypulse.io';
        process.env.AGENT_API_KEY = 'legacy-api-key';
        const config = loadConfig();
        expect(config.apiKey).toBe('legacy-api-key');
    });
    it('prefers new env vars over legacy ones', () => {
        process.env.VELOCITYPULSE_URL = 'https://new.velocitypulse.io';
        process.env.DASHBOARD_URL = 'https://legacy.velocitypulse.io';
        process.env.VP_API_KEY = 'new-key';
        process.env.AGENT_API_KEY = 'legacy-key';
        const config = loadConfig();
        expect(config.dashboardUrl).toBe('https://new.velocitypulse.io');
        expect(config.apiKey).toBe('new-key');
    });
    it('validates vp_ prefix API key format', () => {
        process.env.VELOCITYPULSE_URL = 'https://app.velocitypulse.io';
        process.env.VP_API_KEY = 'vp_invalid';
        expect(() => loadConfig()).toThrow('Invalid VP_API_KEY format');
    });
    it('accepts valid vp_ prefixed API key', () => {
        process.env.VELOCITYPULSE_URL = 'https://app.velocitypulse.io';
        process.env.VP_API_KEY = 'vp_acme_aBcDeFgHiJkLmNoPqRsT1234';
        const config = loadConfig();
        expect(config.apiKey).toBe('vp_acme_aBcDeFgHiJkLmNoPqRsT1234');
    });
    it('respects custom env var overrides', () => {
        process.env.VELOCITYPULSE_URL = 'https://app.velocitypulse.io';
        process.env.VP_API_KEY = 'test-api-key';
        process.env.AGENT_NAME = 'My Custom Agent';
        process.env.LOG_LEVEL = 'debug';
        process.env.ENABLE_AUTO_UPGRADE = 'true';
        process.env.ENABLE_REALTIME = 'false';
        const config = loadConfig();
        expect(config.agentName).toBe('My Custom Agent');
        expect(config.logLevel).toBe('debug');
        expect(config.enableAutoUpgrade).toBe(true);
        expect(config.enableRealtime).toBe(false);
    });
});
//# sourceMappingURL=config.test.js.map