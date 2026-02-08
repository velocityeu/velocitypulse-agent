import type { Logger } from '../utils/logger.js';
export interface SnmpInfo {
    sysName?: string;
    sysDescr?: string;
    sysContact?: string;
    sysLocation?: string;
}
/**
 * Query SNMP system info from a host.
 * Uses the net-snmp package with SNMPv2c and 'public' community string.
 *
 * @param ip - Target IP address
 * @param logger - Logger instance
 * @param community - SNMP community string (default: 'public')
 * @param timeout - Timeout in ms
 */
export declare function querySnmp(ip: string, logger: Logger, community?: string, timeout?: number): Promise<SnmpInfo | null>;
//# sourceMappingURL=snmp.d.ts.map