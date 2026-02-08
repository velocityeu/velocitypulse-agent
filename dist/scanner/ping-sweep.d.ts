import type { Logger } from '../utils/logger.js';
import type { DiscoveredDevice } from './arp.js';
/**
 * Discover devices on a remote network segment using ICMP ping sweep.
 *
 * This is used when the target network is not directly connected to the agent.
 * ARP only works for local segments, but ping sweep can reach remote networks
 * as long as ICMP is allowed through firewalls.
 *
 * Limitations:
 * - No MAC address discovery (Layer 2 info not available across routers)
 * - No manufacturer detection (requires MAC address)
 * - Slower than ARP (must ping each IP individually)
 * - Some devices may not respond to ICMP even if online
 */
export declare function pingSweep(cidr: string, logger: Logger, concurrency?: number): Promise<DiscoveredDevice[]>;
//# sourceMappingURL=ping-sweep.d.ts.map