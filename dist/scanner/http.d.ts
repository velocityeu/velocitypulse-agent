import type { Logger } from '../utils/logger.js';
export interface HttpResult {
    url: string;
    status: 'online' | 'offline' | 'degraded';
    response_time_ms: number | null;
    status_code?: number;
    error?: string;
}
/**
 * Check HTTP/HTTPS endpoint availability
 */
export declare function checkHttp(url: string, logger: Logger, timeout?: number): Promise<HttpResult>;
/**
 * Check multiple HTTP endpoints concurrently
 */
export declare function checkHttpEndpoints(urls: string[], logger: Logger, concurrency?: number): Promise<HttpResult[]>;
//# sourceMappingURL=http.d.ts.map