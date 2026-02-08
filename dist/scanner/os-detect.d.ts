import type { Logger } from '../utils/logger.js';
export interface OsDetectResult {
    os_hints: string[];
    device_type: 'server' | 'workstation' | 'network' | 'printer' | 'iot' | 'unknown';
}
/**
 * Detect OS and device type using TTL analysis and open port heuristics.
 *
 * TTL-based detection:
 *   - TTL ~128 (97-128): Windows
 *   - TTL ~64 (33-64): Linux/macOS/Unix
 *   - TTL ~255 (241-255): Network equipment (Cisco, etc.)
 *   - TTL ~32 (1-32): Older/embedded devices
 *
 * Port-based hints:
 *   - 3389 open: Windows (RDP)
 *   - 22 open + no 3389: Linux/Unix
 *   - 631 open: Printer (IPP)
 *   - 161 open: SNMP (network equipment likely)
 *   - 80/443 only: IoT/appliance
 */
export declare function detectOs(ip: string, logger: Logger, openPorts?: number[], services?: string[]): Promise<OsDetectResult>;
//# sourceMappingURL=os-detect.d.ts.map