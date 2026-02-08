import type { Logger } from '../utils/logger.js'
import type { DiscoveredDevice } from './arp.js'

/**
 * Discover devices on the local network using SSDP (Simple Service Discovery Protocol).
 * Sends an M-SEARCH for ssdp:all and collects UPnP device responses.
 *
 * @param logger - Logger instance
 * @param timeout - How long to listen for responses in ms (default 5000)
 * @returns Array of discovered devices
 */
export async function ssdpScan(
  logger: Logger,
  timeout = 5000
): Promise<DiscoveredDevice[]> {
  try {
    const { Client } = await import('node-ssdp')
    const client = new Client()

    const devices = new Map<string, DiscoveredDevice>()

    return new Promise<DiscoveredDevice[]>((resolve) => {
      client.on('response', (headers, statusCode, rinfo) => {
        const ip = rinfo.address

        if (!devices.has(ip)) {
          devices.set(ip, {
            ip_address: ip,
            discovery_method: 'ssdp',
          })
        }

        const device = devices.get(ip)!

        // Extract UPnP info from headers
        const server = headers.SERVER || headers.server
        if (server && typeof server === 'string') {
          if (!device.os_hints) device.os_hints = []
          if (!device.os_hints.includes(server)) {
            device.os_hints.push(server)
          }
        }

        const location = headers.LOCATION || headers.location
        if (location && typeof location === 'string') {
          // Optionally fetch UPnP description XML for richer metadata
          fetchUpnpDescription(location, device, logger).catch(() => {
            // Non-fatal: UPnP description fetch is best-effort
          })
        }
      })

      // Send SSDP search
      client.search('ssdp:all')

      // Collect responses for the timeout period
      setTimeout(() => {
        client.stop()
        const result = Array.from(devices.values())
        logger.info(`SSDP scan found ${result.length} devices`)
        resolve(result)
      }, timeout)
    })
  } catch (err) {
    logger.warn(`SSDP scan failed: ${err}`)
    return []
  }
}

/**
 * Fetch UPnP device description XML and extract friendly name and manufacturer.
 * Best-effort - failures are silently ignored.
 */
async function fetchUpnpDescription(
  url: string,
  device: DiscoveredDevice,
  logger: Logger
): Promise<void> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)

    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (!response.ok) return

    const xml = await response.text()

    // Extract friendlyName
    const friendlyNameMatch = xml.match(/<friendlyName>([^<]+)<\/friendlyName>/)
    const manufacturerMatch = xml.match(/<manufacturer>([^<]+)<\/manufacturer>/)
    const deviceTypeMatch = xml.match(/<deviceType>([^<]+)<\/deviceType>/)

    if (friendlyNameMatch || manufacturerMatch || deviceTypeMatch) {
      device.upnp_info = {
        friendlyName: friendlyNameMatch?.[1],
        manufacturer: manufacturerMatch?.[1],
        deviceType: deviceTypeMatch?.[1],
      }

      // Use friendlyName as hostname if we don't have one
      if (!device.hostname && friendlyNameMatch?.[1]) {
        device.hostname = friendlyNameMatch[1]
      }

      // Use UPnP manufacturer
      if (!device.manufacturer && manufacturerMatch?.[1]) {
        device.manufacturer = manufacturerMatch[1]
      }
    }
  } catch {
    // Silently ignore UPnP description fetch failures
  }
}
