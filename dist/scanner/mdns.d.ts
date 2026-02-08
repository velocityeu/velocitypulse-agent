import type { Logger } from '../utils/logger.js';
import type { DiscoveredDevice } from './arp.js';
/**
 * Discover devices on the local network using mDNS (multicast DNS).
 * Queries common service types and collects responses.
 *
 * @param logger - Logger instance
 * @param timeout - How long to listen for responses in ms (default 5000)
 * @returns Array of discovered devices
 */
export declare function mdnsScan(logger: Logger, timeout?: number): Promise<DiscoveredDevice[]>;
//# sourceMappingURL=mdns.d.ts.map