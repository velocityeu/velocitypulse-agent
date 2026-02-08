import { type DiscoveredDevice } from './arp.js';
import type { Logger } from '../utils/logger.js';
export type { DiscoveredDevice };
/**
 * Unified device discovery function that selects the appropriate method
 * based on whether the target network is local or remote.
 *
 * For local networks (directly connected):
 * - Uses ARP scanning + mDNS + SSDP in parallel (fast, provides MAC, hostname, UPnP info)
 * - Then enriches with port scan, banner grab, OS detect, SNMP
 *
 * For remote networks (across routers):
 * - Uses ICMP ping sweep only (mDNS/SSDP are link-local protocols)
 * - Then enriches with port scan, banner grab, OS detect, SNMP
 *
 * @param cidr - The CIDR range to scan (e.g., "192.168.1.0/24")
 * @param logger - Logger instance for output
 * @param pingConcurrency - Concurrency for ping sweep (default 50)
 * @returns Array of discovered devices
 */
export declare function discoverDevices(cidr: string, logger: Logger, pingConcurrency?: number): Promise<DiscoveredDevice[]>;
//# sourceMappingURL=discover.d.ts.map