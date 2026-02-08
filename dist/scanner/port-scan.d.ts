import type { Logger } from '../utils/logger.js';
/**
 * Top 20 most commonly used TCP ports for network scanning
 */
export declare const COMMON_PORTS: number[];
export interface PortScanResult {
    ip_address: string;
    open_ports: number[];
    services: string[];
}
/**
 * Well-known port to service name mapping
 */
export declare const PORT_SERVICES: Record<number, string>;
/**
 * Scan common TCP ports on a host
 *
 * @param ip - Target IP address
 * @param logger - Logger instance
 * @param ports - Ports to scan (defaults to COMMON_PORTS)
 * @param concurrency - Max concurrent connections
 * @param timeout - Per-port timeout in ms
 */
export declare function portScan(ip: string, logger: Logger, ports?: number[], concurrency?: number, timeout?: number): Promise<PortScanResult>;
//# sourceMappingURL=port-scan.d.ts.map