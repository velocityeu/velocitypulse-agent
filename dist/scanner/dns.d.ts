import type { Logger } from '../utils/logger.js';
export interface DnsResult {
    hostname: string;
    status: 'online' | 'offline' | 'degraded';
    response_time_ms: number | null;
    resolved_ips?: string[];
    expected_ip_match?: boolean;
    error?: string;
}
/**
 * Check DNS resolution for a hostname.
 * Uses Node.js native dns module - no external dependencies.
 *
 * Returns:
 * - online: hostname resolves successfully (and matches expected IP if provided)
 * - degraded: hostname resolves but to unexpected IP
 * - offline: DNS resolution failed
 */
export declare function checkDns(hostname: string, logger: Logger, expectedIp?: string, timeout?: number): Promise<DnsResult>;
//# sourceMappingURL=dns.d.ts.map