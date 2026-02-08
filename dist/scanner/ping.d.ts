import type { Logger } from '../utils/logger.js';
export interface PingResult {
    ip_address: string;
    status: 'online' | 'offline';
    response_time_ms: number | null;
    error?: string;
}
/**
 * Ping a single IP address and return the result
 */
export declare function pingHost(ip: string, logger: Logger): Promise<PingResult>;
/**
 * Ping multiple hosts concurrently with a concurrency limit
 */
export declare function pingHosts(ips: string[], logger: Logger, concurrency?: number): Promise<PingResult[]>;
//# sourceMappingURL=ping.d.ts.map