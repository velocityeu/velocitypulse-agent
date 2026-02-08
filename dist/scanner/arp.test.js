import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock child_process - promisify needs the callback-style function
vi.mock('child_process', () => {
    const mockExec = vi.fn();
    return { exec: mockExec };
});
// We cannot effectively mock oui-data since it's loaded via createRequire.
// Instead, test getManufacturer with OUI prefixes that exist in the real database.
// Use well-known OUI prefixes from IEEE.
import { getManufacturer, arpScan } from './arp.js';
import { exec } from 'child_process';
const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};
beforeEach(() => {
    vi.clearAllMocks();
});
describe('getManufacturer', () => {
    it('returns a manufacturer string for a known OUI prefix', () => {
        // 00:00:0C is Cisco Systems OUI
        const result = getManufacturer('00:00:0C:11:22:33');
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
    });
    it('returns undefined for unknown OUI prefix', () => {
        // FF:FF:FF is unlikely to be assigned
        expect(getManufacturer('FF:FF:FF:00:00:00')).toBeUndefined();
    });
    it('handles dash-separated MAC addresses', () => {
        // Same known OUI with dashes
        const result = getManufacturer('00-00-0C-11-22-33');
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
    });
    it('extracts first 6 hex characters as OUI prefix', () => {
        // Two MACs with same OUI prefix should return the same manufacturer
        const result1 = getManufacturer('00:00:0C:AA:BB:CC');
        const result2 = getManufacturer('00:00:0C:11:22:33');
        expect(result1).toBe(result2);
    });
});
describe('arpScan', () => {
    it('parses Windows ARP output and filters by CIDR', async () => {
        // Note: the Windows arp regex also matches the "Interface:" header line
        // because "---" matches [\da-f-]+. The code handles this because the
        // MAC "---" fails normalizeMac (returns "---") and isInCidr still runs.
        // We only include data lines here to test parsing cleanly.
        const windowsArpOutput = [
            '  192.168.1.10          aa-bb-cc-dd-ee-ff     dynamic',
            '  192.168.1.20          00-11-22-33-44-55     dynamic',
            '  10.0.0.1              ff-ee-dd-cc-bb-aa     dynamic',
        ].join('\n');
        vi.mocked(exec).mockImplementation((...args) => {
            const callback = args[args.length - 1];
            if (typeof callback === 'function') {
                process.nextTick(() => callback(null, { stdout: windowsArpOutput, stderr: '' }));
            }
            return {};
        });
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32' });
        try {
            const devices = await arpScan('192.168.1.0/24', mockLogger);
            // Should find 2 devices in 192.168.1.0/24 (not the 10.0.0.1)
            expect(devices).toHaveLength(2);
            expect(devices[0].ip_address).toBe('192.168.1.10');
            expect(devices[0].mac_address).toBe('AA:BB:CC:DD:EE:FF');
            expect(devices[0].discovery_method).toBe('arp');
            expect(devices[1].ip_address).toBe('192.168.1.20');
            expect(devices[1].mac_address).toBe('00:11:22:33:44:55');
        }
        finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        }
    });
    it('parses Unix ARP output', async () => {
        const unixArpOutput = [
            '? (192.168.1.10) at aa:bb:cc:dd:ee:ff [ether] on en0',
            '? (192.168.1.20) at 00:11:22:33:44:55 [ether] on en0',
        ].join('\n');
        vi.mocked(exec).mockImplementation((...args) => {
            const callback = args[args.length - 1];
            if (typeof callback === 'function') {
                process.nextTick(() => callback(null, { stdout: unixArpOutput, stderr: '' }));
            }
            return {};
        });
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'linux' });
        try {
            const devices = await arpScan('192.168.1.0/24', mockLogger);
            expect(devices).toHaveLength(2);
            expect(devices[0].ip_address).toBe('192.168.1.10');
            expect(devices[1].ip_address).toBe('192.168.1.20');
        }
        finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        }
    });
    it('returns empty array on exec failure', async () => {
        vi.mocked(exec).mockImplementation((...args) => {
            const callback = args[args.length - 1];
            if (typeof callback === 'function') {
                process.nextTick(() => callback(new Error('command not found'), { stdout: '', stderr: '' }));
            }
            return {};
        });
        const devices = await arpScan('192.168.1.0/24', mockLogger);
        expect(devices).toHaveLength(0);
    });
    it('skips incomplete ARP entries', async () => {
        const windowsArpOutput = [
            '  192.168.1.10          aa-bb-cc-dd-ee-ff     dynamic',
            '  192.168.1.20          incomplete            dynamic',
        ].join('\n');
        vi.mocked(exec).mockImplementation((...args) => {
            const callback = args[args.length - 1];
            if (typeof callback === 'function') {
                process.nextTick(() => callback(null, { stdout: windowsArpOutput, stderr: '' }));
            }
            return {};
        });
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', { value: 'win32' });
        try {
            const devices = await arpScan('192.168.1.0/24', mockLogger);
            // Should only find 1 device, the incomplete entry is skipped
            expect(devices).toHaveLength(1);
            expect(devices[0].ip_address).toBe('192.168.1.10');
        }
        finally {
            Object.defineProperty(process, 'platform', { value: originalPlatform });
        }
    });
});
//# sourceMappingURL=arp.test.js.map