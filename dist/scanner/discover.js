import { isLocalNetwork, isInCidr } from '../utils/ip-utils.js';
import { arpScan, populateArpCache } from './arp.js';
import { pingSweep } from './ping-sweep.js';
import { mdnsScan } from './mdns.js';
import { ssdpScan } from './ssdp.js';
import { portScan, PORT_SERVICES } from './port-scan.js';
import { grabBanners, identifyService } from './banner.js';
import { detectOs } from './os-detect.js';
import { querySnmp } from './snmp.js';
/**
 * Merge discovered devices from multiple sources, deduplicating by IP.
 * Prioritizes richer data: MAC from ARP, hostname from mDNS, UPnP info from SSDP.
 */
function mergeDiscoveredDevices(...deviceArrays) {
    const merged = new Map();
    for (const devices of deviceArrays) {
        for (const device of devices) {
            const existing = merged.get(device.ip_address);
            if (!existing) {
                merged.set(device.ip_address, { ...device });
            }
            else {
                // Merge fields, preferring non-empty values
                if (device.mac_address && !existing.mac_address)
                    existing.mac_address = device.mac_address;
                if (device.hostname && !existing.hostname)
                    existing.hostname = device.hostname;
                if (device.manufacturer && !existing.manufacturer)
                    existing.manufacturer = device.manufacturer;
                if (device.upnp_info && !existing.upnp_info)
                    existing.upnp_info = device.upnp_info;
                if (device.netbios_name && !existing.netbios_name)
                    existing.netbios_name = device.netbios_name;
                if (device.snmp_info && !existing.snmp_info)
                    existing.snmp_info = device.snmp_info;
                // Merge arrays
                if (device.os_hints?.length) {
                    existing.os_hints = [...new Set([...(existing.os_hints || []), ...device.os_hints])];
                }
                if (device.open_ports?.length) {
                    existing.open_ports = [...new Set([...(existing.open_ports || []), ...device.open_ports])];
                }
                if (device.services?.length) {
                    existing.services = [...new Set([...(existing.services || []), ...device.services])];
                }
            }
        }
    }
    return Array.from(merged.values());
}
/**
 * Enrich discovered devices with port scanning, banner grabbing, OS detection, and SNMP.
 * Runs enrichment in batches to avoid overwhelming the network.
 */
async function enrichDevices(devices, logger, options = {}) {
    const { enablePortScan = true, enableSnmp = true } = options;
    if (devices.length === 0)
        return devices;
    logger.info(`Enriching ${devices.length} devices (ports=${enablePortScan}, snmp=${enableSnmp})`);
    // Process devices in batches of 5 to avoid network congestion
    const BATCH_SIZE = 5;
    for (let i = 0; i < devices.length; i += BATCH_SIZE) {
        const batch = devices.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (device) => {
            const ip = device.ip_address;
            try {
                // Port scan
                if (enablePortScan) {
                    const scanResult = await portScan(ip, logger);
                    if (scanResult.open_ports.length > 0) {
                        device.open_ports = [...new Set([...(device.open_ports || []), ...scanResult.open_ports])];
                        // Derive service names from ports
                        const portServices = scanResult.open_ports
                            .map(p => PORT_SERVICES[p])
                            .filter((s) => !!s);
                        // Banner grab on open ports for more detail
                        const banners = await grabBanners(ip, scanResult.open_ports, logger);
                        const bannerServices = banners
                            .map(b => identifyService(b.banner, b.port))
                            .filter((s) => !!s);
                        device.services = [...new Set([
                                ...(device.services || []),
                                ...portServices,
                                ...bannerServices,
                            ])];
                    }
                }
                // OS detection (uses TTL + port heuristics)
                const osResult = await detectOs(ip, logger, device.open_ports, device.services);
                if (osResult.os_hints.length > 0) {
                    device.os_hints = [...new Set([...(device.os_hints || []), ...osResult.os_hints])];
                }
                if (osResult.device_type !== 'unknown') {
                    device.device_type = osResult.device_type;
                }
                // SNMP query
                if (enableSnmp) {
                    const snmpInfo = await querySnmp(ip, logger);
                    if (snmpInfo) {
                        device.snmp_info = snmpInfo;
                        // Use SNMP sysName as hostname if we don't have one
                        if (!device.hostname && snmpInfo.sysName) {
                            device.hostname = snmpInfo.sysName;
                        }
                    }
                }
            }
            catch (error) {
                logger.debug(`Enrichment error for ${ip}: ${error instanceof Error ? error.message : 'unknown'}`);
            }
        }));
    }
    logger.info(`Enrichment complete for ${devices.length} devices`);
    return devices;
}
/**
 * Unified device discovery function that selects the appropriate method
 * based on whether the target network is local or remote.
 *
 * For local networks (directly connected):
 * - Uses ARP scanning + mDNS + SSDP in parallel (fast, provides MAC, hostname, UPnP info)
 * - Then enriches with port scan, banner grab, OS detect, SNMP
 *
 * For remote networks (across routers):
 * - Uses ICMP ping sweep only (mDNS/SSDP are link-local protocols)
 * - Then enriches with port scan, banner grab, OS detect, SNMP
 *
 * @param cidr - The CIDR range to scan (e.g., "192.168.1.0/24")
 * @param logger - Logger instance for output
 * @param pingConcurrency - Concurrency for ping sweep (default 50)
 * @returns Array of discovered devices
 */
export async function discoverDevices(cidr, logger, pingConcurrency = 50) {
    const isLocal = isLocalNetwork(cidr);
    let devices;
    if (isLocal) {
        logger.info(`Segment ${cidr} is LOCAL - using ARP + mDNS + SSDP discovery`);
        // Populate ARP cache first
        await populateArpCache(cidr, logger);
        // Small delay for ARP cache to populate
        await new Promise(resolve => setTimeout(resolve, 2000));
        // Run ARP + mDNS + SSDP in parallel
        const [arpDevices, mdnsDevices, ssdpDevices] = await Promise.all([
            arpScan(cidr, logger),
            mdnsScan(logger),
            ssdpScan(logger),
        ]);
        logger.info(`Discovery results - ARP: ${arpDevices.length}, mDNS: ${mdnsDevices.length}, SSDP: ${ssdpDevices.length}`);
        // Filter mDNS/SSDP results to only include IPs within the target CIDR
        const filteredMdns = mdnsDevices.filter(d => isInCidr(d.ip_address, cidr));
        const filteredSsdp = ssdpDevices.filter(d => isInCidr(d.ip_address, cidr));
        if (filteredMdns.length !== mdnsDevices.length || filteredSsdp.length !== ssdpDevices.length) {
            logger.info(`After CIDR filter - mDNS: ${filteredMdns.length}, SSDP: ${filteredSsdp.length}`);
        }
        devices = mergeDiscoveredDevices(arpDevices, filteredMdns, filteredSsdp);
    }
    else {
        logger.info(`Segment ${cidr} is REMOTE - using ping sweep`);
        logger.info(`Note: MAC address and manufacturer info not available for remote networks`);
        devices = await pingSweep(cidr, logger, pingConcurrency);
    }
    // Enrich all discovered devices with port scan, banners, OS detection, SNMP
    return enrichDevices(devices, logger);
}
//# sourceMappingURL=discover.js.map