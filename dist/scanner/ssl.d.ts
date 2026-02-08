import type { Logger } from '../utils/logger.js';
export interface SslResult {
    hostname: string;
    port: number;
    status: 'online' | 'offline' | 'degraded';
    response_time_ms: number | null;
    ssl_expiry_at?: string;
    ssl_issuer?: string;
    ssl_subject?: string;
    days_until_expiry?: number;
    error?: string;
}
/**
 * Check SSL/TLS certificate for a host.
 * Uses Node.js native tls module - no external dependencies.
 *
 * Returns:
 * - online: valid certificate with > warnDays until expiry
 * - degraded: certificate valid but expiring within warnDays
 * - offline: connection failed or certificate expired
 */
export declare function checkSsl(hostname: string, logger: Logger, port?: number, warnDays?: number, timeout?: number): Promise<SslResult>;
//# sourceMappingURL=ssl.d.ts.map