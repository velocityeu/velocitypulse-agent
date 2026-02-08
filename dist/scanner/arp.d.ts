import type { Logger } from '../utils/logger.js';
export interface DiscoveredDevice {
    ip_address: string;
    mac_address?: string;
    hostname?: string;
    manufacturer?: string;
    os_hints?: string[];
    device_type?: 'server' | 'workstation' | 'network' | 'printer' | 'iot' | 'unknown';
    open_ports?: number[];
    services?: string[];
    netbios_name?: string;
    snmp_info?: {
        sysName?: string;
        sysDescr?: string;
        sysContact?: string;
        sysLocation?: string;
    };
    upnp_info?: {
        friendlyName?: string;
        deviceType?: string;
        manufacturer?: string;
    };
    discovery_method: 'arp' | 'mdns' | 'ssdp' | 'snmp';
}
/**
 * Get manufacturer name from MAC address using OUI database
 */
export declare function getManufacturer(mac: string): string | undefined;
/**
 * Scan ARP table for devices in the specified CIDR range
 */
export declare function arpScan(cidr: string, logger: Logger): Promise<DiscoveredDevice[]>;
/**
 * Trigger ARP cache population by pinging the broadcast address or scanning IPs
 * This helps discover more devices before reading the ARP table
 */
export declare function populateArpCache(cidr: string, logger: Logger): Promise<void>;
//# sourceMappingURL=arp.d.ts.map