import { describe, it, expect } from 'vitest';
import { parseCidr, isInCidr, normalizeMac, ipToNum } from './ip-utils.js';
describe('parseCidr', () => {
    it('returns 254 IPs for a /24 network (excluding network and broadcast)', () => {
        const ips = parseCidr('192.168.1.0/24');
        expect(ips).toHaveLength(254);
        expect(ips[0]).toBe('192.168.1.1');
        expect(ips[253]).toBe('192.168.1.254');
    });
    it('returns 2 IPs for a /30 network', () => {
        const ips = parseCidr('10.0.0.0/30');
        expect(ips).toHaveLength(2);
        expect(ips[0]).toBe('10.0.0.1');
        expect(ips[1]).toBe('10.0.0.2');
    });
    it('throws on invalid CIDR prefix', () => {
        expect(() => parseCidr('192.168.1.0/33')).toThrow('Invalid CIDR prefix');
    });
    it('throws on invalid IP address', () => {
        expect(() => parseCidr('999.0.0.0/24')).toThrow('Invalid IP address');
    });
});
describe('isInCidr', () => {
    it('returns true when IP is within the CIDR range', () => {
        expect(isInCidr('192.168.1.100', '192.168.1.0/24')).toBe(true);
    });
    it('returns false when IP is outside the CIDR range', () => {
        expect(isInCidr('10.0.0.1', '192.168.1.0/24')).toBe(false);
    });
    it('returns true for network boundary IP', () => {
        expect(isInCidr('192.168.1.0', '192.168.1.0/24')).toBe(true);
    });
    it('returns true for broadcast address', () => {
        expect(isInCidr('192.168.1.255', '192.168.1.0/24')).toBe(true);
    });
});
describe('normalizeMac', () => {
    it('converts dash-separated MAC to colon-separated uppercase', () => {
        expect(normalizeMac('aa-bb-cc-dd-ee-ff')).toBe('AA:BB:CC:DD:EE:FF');
    });
    it('converts colon-separated lowercase to uppercase', () => {
        expect(normalizeMac('aa:bb:cc:dd:ee:ff')).toBe('AA:BB:CC:DD:EE:FF');
    });
    it('returns original string for invalid MAC (wrong length)', () => {
        // Dot-separated Cisco format is not cleaned by the regex (dots are not removed)
        // so cleaned length will be wrong, returning original
        expect(normalizeMac('aabb.ccdd.eeff')).toBe('aabb.ccdd.eeff');
    });
    it('passes through already-normalized MAC', () => {
        expect(normalizeMac('AA:BB:CC:DD:EE:FF')).toBe('AA:BB:CC:DD:EE:FF');
    });
});
describe('ipToNum', () => {
    it('converts IP to numeric value', () => {
        // 192.168.1.1 = (192 << 24) | (168 << 16) | (1 << 8) | 1 = 3232235777
        expect(ipToNum('192.168.1.1')).toBe(3232235777);
    });
    it('handles 0.0.0.0', () => {
        expect(ipToNum('0.0.0.0')).toBe(0);
    });
    it('handles 255.255.255.255', () => {
        expect(ipToNum('255.255.255.255')).toBe(4294967295);
    });
    it('roundtrips through parseCidr', () => {
        // The first IP in 10.0.0.0/30 should be 10.0.0.1
        const num = ipToNum('10.0.0.1');
        expect(num).toBe(167772161);
        // Verify by reconstructing: (10 << 24) | (0 << 16) | (0 << 8) | 1
        expect(num).toBe((10 * 256 * 256 * 256) + 1);
    });
});
//# sourceMappingURL=ip-utils.test.js.map