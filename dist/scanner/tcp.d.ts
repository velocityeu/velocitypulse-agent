import type { Logger } from '../utils/logger.js';
export interface TcpResult {
    ip_address: string;
    port: number;
    status: 'online' | 'offline';
    response_time_ms: number | null;
    error?: string;
}
/**
 * Check if a TCP port is open on a host
 */
export declare function checkTcpPort(ip: string, port: number, logger: Logger, timeout?: number): Promise<TcpResult>;
/**
 * Check multiple TCP ports concurrently
 */
export declare function checkTcpPorts(targets: Array<{
    ip: string;
    port: number;
}>, logger: Logger, concurrency?: number): Promise<TcpResult[]>;
//# sourceMappingURL=tcp.d.ts.map