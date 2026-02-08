import { describe, it, expect, vi, beforeEach } from 'vitest';
// Mock all scanner dependencies
vi.mock('../utils/ip-utils.js', () => ({
    isLocalNetwork: vi.fn(),
    isInCidr: vi.fn(),
}));
vi.mock('./arp.js', () => ({
    arpScan: vi.fn(),
    populateArpCache: vi.fn(),
}));
vi.mock('./ping-sweep.js', () => ({
    pingSweep: vi.fn(),
}));
vi.mock('./mdns.js', () => ({
    mdnsScan: vi.fn(),
}));
vi.mock('./ssdp.js', () => ({
    ssdpScan: vi.fn(),
}));
import { discoverDevices } from './discover.js';
import { isLocalNetwork, isInCidr } from '../utils/ip-utils.js';
import { arpScan, populateArpCache } from './arp.js';
import { pingSweep } from './ping-sweep.js';
import { mdnsScan } from './mdns.js';
import { ssdpScan } from './ssdp.js';
const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};
beforeEach(() => {
    vi.clearAllMocks();
});
describe('discoverDevices', () => {
    it('uses ARP + mDNS + SSDP for local networks', async () => {
        vi.mocked(isLocalNetwork).mockReturnValue(true);
        vi.mocked(populateArpCache).mockResolvedValue(undefined);
        vi.mocked(isInCidr).mockReturnValue(true);
        const arpDevices = [
            { ip_address: '192.168.1.10', mac_address: 'AA:BB:CC:DD:EE:FF', discovery_method: 'arp' },
        ];
        const mdnsDevices = [
            { ip_address: '192.168.1.20', hostname: 'printer.local', discovery_method: 'mdns' },
        ];
        const ssdpDevices = [
            { ip_address: '192.168.1.30', upnp_info: { friendlyName: 'Smart TV' }, discovery_method: 'ssdp' },
        ];
        vi.mocked(arpScan).mockResolvedValue(arpDevices);
        vi.mocked(mdnsScan).mockResolvedValue(mdnsDevices);
        vi.mocked(ssdpScan).mockResolvedValue(ssdpDevices);
        const devices = await discoverDevices('192.168.1.0/24', mockLogger);
        expect(isLocalNetwork).toHaveBeenCalledWith('192.168.1.0/24');
        expect(populateArpCache).toHaveBeenCalledWith('192.168.1.0/24', mockLogger);
        expect(arpScan).toHaveBeenCalledWith('192.168.1.0/24', mockLogger);
        expect(mdnsScan).toHaveBeenCalledWith(mockLogger);
        expect(ssdpScan).toHaveBeenCalledWith(mockLogger);
        expect(pingSweep).not.toHaveBeenCalled();
        expect(devices).toHaveLength(3);
    });
    it('uses only ping sweep for remote networks', async () => {
        vi.mocked(isLocalNetwork).mockReturnValue(false);
        const pingDevices = [
            { ip_address: '10.0.0.1', discovery_method: 'arp' },
            { ip_address: '10.0.0.2', discovery_method: 'arp' },
        ];
        vi.mocked(pingSweep).mockResolvedValue(pingDevices);
        const devices = await discoverDevices('10.0.0.0/24', mockLogger);
        expect(pingSweep).toHaveBeenCalledWith('10.0.0.0/24', mockLogger, 50);
        expect(arpScan).not.toHaveBeenCalled();
        expect(mdnsScan).not.toHaveBeenCalled();
        expect(ssdpScan).not.toHaveBeenCalled();
        expect(devices).toHaveLength(2);
    });
    it('deduplicates devices by IP and merges fields', async () => {
        vi.mocked(isLocalNetwork).mockReturnValue(true);
        vi.mocked(populateArpCache).mockResolvedValue(undefined);
        vi.mocked(isInCidr).mockReturnValue(true);
        // Same IP from ARP (has MAC) and mDNS (has hostname)
        const arpDevices = [
            {
                ip_address: '192.168.1.10',
                mac_address: 'AA:BB:CC:DD:EE:FF',
                manufacturer: 'Apple, Inc.',
                discovery_method: 'arp',
            },
        ];
        const mdnsDevices = [
            {
                ip_address: '192.168.1.10',
                hostname: 'macbook.local',
                discovery_method: 'mdns',
            },
        ];
        const ssdpDevices = [];
        vi.mocked(arpScan).mockResolvedValue(arpDevices);
        vi.mocked(mdnsScan).mockResolvedValue(mdnsDevices);
        vi.mocked(ssdpScan).mockResolvedValue(ssdpDevices);
        const devices = await discoverDevices('192.168.1.0/24', mockLogger);
        // Should merge into 1 device with fields from both sources
        expect(devices).toHaveLength(1);
        expect(devices[0].ip_address).toBe('192.168.1.10');
        expect(devices[0].mac_address).toBe('AA:BB:CC:DD:EE:FF');
        expect(devices[0].hostname).toBe('macbook.local');
        expect(devices[0].manufacturer).toBe('Apple, Inc.');
    });
    it('filters mDNS/SSDP results by CIDR range', async () => {
        vi.mocked(isLocalNetwork).mockReturnValue(true);
        vi.mocked(populateArpCache).mockResolvedValue(undefined);
        // isInCidr returns false for out-of-range IPs
        vi.mocked(isInCidr).mockImplementation((ip) => {
            return ip.startsWith('192.168.1.');
        });
        const arpDevices = [];
        const mdnsDevices = [
            { ip_address: '192.168.1.10', hostname: 'local.device', discovery_method: 'mdns' },
            { ip_address: '10.0.0.5', hostname: 'remote.device', discovery_method: 'mdns' },
        ];
        const ssdpDevices = [];
        vi.mocked(arpScan).mockResolvedValue(arpDevices);
        vi.mocked(mdnsScan).mockResolvedValue(mdnsDevices);
        vi.mocked(ssdpScan).mockResolvedValue(ssdpDevices);
        const devices = await discoverDevices('192.168.1.0/24', mockLogger);
        // Only the 192.168.1.10 device should remain
        expect(devices).toHaveLength(1);
        expect(devices[0].ip_address).toBe('192.168.1.10');
    });
});
//# sourceMappingURL=discover.test.js.map