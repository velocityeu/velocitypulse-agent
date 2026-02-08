import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
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
export async function detectOs(ip, logger, openPorts, services) {
    const hints = [];
    let deviceType = 'unknown';
    // Step 1: TTL-based detection via ping
    const ttl = await getTtl(ip, logger);
    if (ttl !== null) {
        if (ttl >= 97 && ttl <= 128) {
            hints.push('Windows');
            deviceType = 'workstation';
        }
        else if (ttl >= 33 && ttl <= 64) {
            hints.push('Linux/Unix');
            deviceType = 'server';
        }
        else if (ttl >= 241 && ttl <= 255) {
            hints.push('Network Equipment');
            deviceType = 'network';
        }
        else if (ttl >= 1 && ttl <= 32) {
            hints.push('Embedded/IoT');
            deviceType = 'iot';
        }
    }
    // Step 2: Port-based refinement
    const ports = new Set(openPorts || []);
    const svcList = new Set(services || []);
    if (ports.has(3389)) {
        if (!hints.includes('Windows'))
            hints.push('Windows');
        deviceType = 'workstation';
    }
    if (ports.has(22) && !ports.has(3389)) {
        if (!hints.some(h => h.includes('Linux')))
            hints.push('Linux/Unix');
        deviceType = deviceType === 'unknown' ? 'server' : deviceType;
    }
    // Printer detection
    if (ports.has(631) || ports.has(9100) || svcList.has('ipp')) {
        hints.push('Printer');
        deviceType = 'printer';
    }
    // Network equipment
    if (ports.has(161) && !ports.has(22) && !ports.has(3389)) {
        if (!hints.includes('Network Equipment'))
            hints.push('Network Equipment');
        deviceType = 'network';
    }
    // Server indicators
    if (ports.has(80) || ports.has(443)) {
        if (ports.has(3306) || ports.has(5432) || ports.has(27017) || ports.has(6379)) {
            hints.push('Database Server');
            deviceType = 'server';
        }
        else if (ports.has(25) || ports.has(587) || ports.has(993)) {
            hints.push('Mail Server');
            deviceType = 'server';
        }
    }
    // macOS hint - Bonjour + SSH but no SMB typically
    if (svcList.has('ssh') && svcList.has('http') && !ports.has(445) && !ports.has(3389)) {
        if (hints.some(h => h.includes('Linux/Unix'))) {
            // Could be macOS - add it as a possibility
            hints.push('macOS (possible)');
        }
    }
    logger.debug(`OS detect ${ip}: hints=[${hints.join(', ')}], type=${deviceType}`);
    return { os_hints: hints, device_type: deviceType };
}
/**
 * Get TTL from ping response
 */
async function getTtl(ip, logger) {
    try {
        const isWindows = process.platform === 'win32';
        const cmd = isWindows
            ? `ping -n 1 -w 2000 ${ip}`
            : `ping -c 1 -W 2 ${ip}`;
        const { stdout } = await execAsync(cmd, { timeout: 5000 });
        // Parse TTL from output
        // Windows: "Reply from x.x.x.x: bytes=32 time=1ms TTL=128"
        // Linux: "64 bytes from x.x.x.x: icmp_seq=1 ttl=64 time=0.5 ms"
        const ttlMatch = stdout.match(/ttl[=:]?\s*(\d+)/i);
        if (ttlMatch) {
            return parseInt(ttlMatch[1], 10);
        }
        return null;
    }
    catch {
        logger.debug(`TTL detection failed for ${ip}`);
        return null;
    }
}
//# sourceMappingURL=os-detect.js.map