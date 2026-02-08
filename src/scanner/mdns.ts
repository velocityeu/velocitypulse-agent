import type { Logger } from '../utils/logger.js'
import type { DiscoveredDevice } from './arp.js'

// Common mDNS service types to query
const MDNS_SERVICE_TYPES = [
  '_http._tcp.local',
  '_https._tcp.local',
  '_printer._tcp.local',
  '_ipp._tcp.local',
  '_ssh._tcp.local',
  '_smb._tcp.local',
  '_googlecast._tcp.local',
  '_airplay._tcp.local',
  '_raop._tcp.local',
  '_workstation._tcp.local',
]

/**
 * Discover devices on the local network using mDNS (multicast DNS).
 * Queries common service types and collects responses.
 *
 * @param logger - Logger instance
 * @param timeout - How long to listen for responses in ms (default 5000)
 * @returns Array of discovered devices
 */
export async function mdnsScan(
  logger: Logger,
  timeout = 5000
): Promise<DiscoveredDevice[]> {
  try {
    const mdns = (await import('multicast-dns')).default
    const instance = mdns()

    const devices = new Map<string, DiscoveredDevice>()

    return new Promise<DiscoveredDevice[]>((resolve) => {
      instance.on('response', (response) => {
        for (const answer of [...response.answers, ...response.additionals]) {
          if (answer.type === 'A' && typeof answer.data === 'string') {
            const ip = answer.data
            const hostname = answer.name.replace(/\.local\.?$/, '')

            if (!devices.has(ip)) {
              devices.set(ip, {
                ip_address: ip,
                hostname,
                discovery_method: 'mdns',
                services: [],
              })
            } else {
              const existing = devices.get(ip)!
              if (!existing.hostname && hostname) {
                existing.hostname = hostname
              }
            }
          }

          // Extract service info from SRV/PTR records
          if (answer.type === 'PTR' && typeof answer.data === 'string') {
            // PTR records point to service instances
            const serviceName = answer.name.replace(/\.local\.?$/, '')
            // We'll associate services with IPs when we get A records
            for (const device of devices.values()) {
              if (answer.data.includes(device.hostname || '')) {
                if (!device.services) device.services = []
                if (!device.services.includes(serviceName)) {
                  device.services.push(serviceName)
                }
              }
            }
          }

          if (answer.type === 'SRV' && typeof answer.data === 'object' && answer.data) {
            const srvData = answer.data as { target?: string; port?: number }
            if (srvData.port) {
              const targetHost = (srvData.target || '').replace(/\.local\.?$/, '')
              for (const device of devices.values()) {
                if (device.hostname === targetHost) {
                  if (!device.open_ports) device.open_ports = []
                  if (!device.open_ports.includes(srvData.port)) {
                    device.open_ports.push(srvData.port)
                  }
                }
              }
            }
          }
        }
      })

      instance.on('error', (err) => {
        logger.warn(`mDNS error: ${err.message}`)
      })

      // Send queries for each service type
      for (const serviceType of MDNS_SERVICE_TYPES) {
        instance.query({
          questions: [{ name: serviceType, type: 'PTR' }],
        })
      }

      // Also query for all workstations
      instance.query({
        questions: [{ name: '_services._dns-sd._udp.local', type: 'PTR' }],
      })

      // Collect responses for the timeout period
      setTimeout(() => {
        instance.destroy()
        const result = Array.from(devices.values())
        logger.info(`mDNS scan found ${result.length} devices`)
        resolve(result)
      }, timeout)
    })
  } catch (err) {
    logger.warn(`mDNS scan failed (multicast may not be supported): ${err}`)
    return []
  }
}
