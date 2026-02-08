import type { Logger } from '../utils/logger.js';
import type { DiscoveredDevice } from './arp.js';
/**
 * Discover devices on the local network using SSDP (Simple Service Discovery Protocol).
 * Sends an M-SEARCH for ssdp:all and collects UPnP device responses.
 *
 * @param logger - Logger instance
 * @param timeout - How long to listen for responses in ms (default 5000)
 * @returns Array of discovered devices
 */
export declare function ssdpScan(logger: Logger, timeout?: number): Promise<DiscoveredDevice[]>;
//# sourceMappingURL=ssdp.d.ts.map