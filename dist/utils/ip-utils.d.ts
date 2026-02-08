/**
 * Parse CIDR notation to get list of IP addresses
 */
export declare function parseCidr(cidr: string): string[];
/**
 * Convert IP address string to number
 */
export declare function ipToNum(ip: string): number;
/**
 * Check if an IP is within a CIDR range
 */
export declare function isInCidr(ip: string, cidr: string): boolean;
/**
 * Normalize MAC address to AA:BB:CC:DD:EE:FF format
 */
export declare function normalizeMac(mac: string): string;
/**
 * Check if a CIDR range overlaps with any local network interface.
 * Used to determine whether to use ARP (local) or ping sweep (remote) for discovery.
 */
export declare function isLocalNetwork(cidr: string): boolean;
/**
 * Expand a CIDR to all usable IP addresses
 */
export declare function expandCidr(cidr: string): string[];
//# sourceMappingURL=ip-utils.d.ts.map