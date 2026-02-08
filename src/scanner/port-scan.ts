import * as net from 'net'
import type { Logger } from '../utils/logger.js'

/**
 * Top 20 most commonly used TCP ports for network scanning
 */
export const COMMON_PORTS = [
  21,    // FTP
  22,    // SSH
  23,    // Telnet
  25,    // SMTP
  53,    // DNS
  80,    // HTTP
  110,   // POP3
  135,   // MSRPC
  139,   // NetBIOS
  143,   // IMAP
  443,   // HTTPS
  445,   // SMB
  993,   // IMAPS
  995,   // POP3S
  1433,  // MSSQL
  3306,  // MySQL
  3389,  // RDP
  5432,  // PostgreSQL
  8080,  // HTTP Alt
  8443,  // HTTPS Alt
]

export interface PortScanResult {
  ip_address: string
  open_ports: number[]
  services: string[]
}

/**
 * Well-known port to service name mapping
 */
export const PORT_SERVICES: Record<number, string> = {
  21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns',
  80: 'http', 110: 'pop3', 135: 'msrpc', 139: 'netbios', 143: 'imap',
  443: 'https', 445: 'smb', 993: 'imaps', 995: 'pop3s', 1433: 'mssql',
  3306: 'mysql', 3389: 'rdp', 5432: 'postgresql', 8080: 'http-alt', 8443: 'https-alt',
  5900: 'vnc', 6379: 'redis', 27017: 'mongodb', 9200: 'elasticsearch',
  161: 'snmp', 162: 'snmptrap', 514: 'syslog', 1883: 'mqtt',
}

/**
 * Check if a single TCP port is open
 */
function checkPort(ip: string, port: number, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(timeout)

    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.on('error', () => {
      socket.destroy()
      resolve(false)
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })

    socket.connect(port, ip)
  })
}

/**
 * Scan common TCP ports on a host
 *
 * @param ip - Target IP address
 * @param logger - Logger instance
 * @param ports - Ports to scan (defaults to COMMON_PORTS)
 * @param concurrency - Max concurrent connections
 * @param timeout - Per-port timeout in ms
 */
export async function portScan(
  ip: string,
  logger: Logger,
  ports: number[] = COMMON_PORTS,
  concurrency = 10,
  timeout = 2000
): Promise<PortScanResult> {
  const openPorts: number[] = []
  const queue = [...ports]

  const workers = Array(Math.min(concurrency, queue.length))
    .fill(null)
    .map(async () => {
      while (queue.length > 0) {
        const port = queue.shift()
        if (port === undefined) break
        const isOpen = await checkPort(ip, port, timeout)
        if (isOpen) {
          openPorts.push(port)
        }
      }
    })

  await Promise.all(workers)

  const services = openPorts
    .map(p => PORT_SERVICES[p])
    .filter(Boolean)

  if (openPorts.length > 0) {
    logger.debug(`Port scan ${ip}: ${openPorts.length} open ports [${openPorts.join(', ')}]`)
  }

  return {
    ip_address: ip,
    open_ports: openPorts.sort((a, b) => a - b),
    services,
  }
}
