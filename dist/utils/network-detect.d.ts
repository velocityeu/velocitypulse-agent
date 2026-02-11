export interface LocalNetwork {
    interfaceName: string;
    address: string;
    netmask: string;
    cidr: string;
    mac: string;
    family: 'IPv4' | 'IPv6';
    internal: boolean;
}
/**
 * Detect all local network interfaces with IPv4 addresses
 */
export declare function detectLocalNetworks(): LocalNetwork[];
/**
 * Get the primary local network (first non-internal IPv4 interface)
 * Prefers interfaces that look like the main network connection:
 * - Ethernet/WiFi over VPN/Docker/Virtual adapters
 * - Non-link-local addresses (169.254.x.x)
 */
export declare function getPrimaryLocalNetwork(): LocalNetwork | null;
/**
 * Get all unique physical network segments (deduplicated by CIDR).
 * Filters out link-local and virtual/container interfaces.
 */
export declare function getPhysicalLocalNetworks(): LocalNetwork[];
/**
 * Generate a human-readable name for an auto-detected segment
 */
export declare function generateAutoSegmentName(network: LocalNetwork): string;
//# sourceMappingURL=network-detect.d.ts.map