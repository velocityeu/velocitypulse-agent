import { io, Socket } from 'socket.io-client'
import type { Logger } from '../utils/logger.js'

// ==============================================
// Socket.IO Event Types (matching server)
// ==============================================

interface AgentAuthenticatePayload {
  apiKey: string
  version: string
  hostname: string
}

interface AgentHeartbeatPayload {
  version: string
  hostname: string
  uptime_seconds: number
}

interface AgentStatusReportPayload {
  reports: Array<{
    device_id?: string
    ip_address: string
    status: 'online' | 'offline' | 'degraded' | 'unknown'
    response_time_ms: number | null
    check_type: 'ping' | 'http' | 'tcp'
    checked_at: string
    error?: string
  }>
}

interface AgentDiscoveryReportPayload {
  segment_id: string
  scan_timestamp: string
  devices: Array<{
    ip_address: string
    mac_address?: string
    hostname?: string
    manufacturer?: string
    device_type?: string
    discovery_method: 'arp' | 'mdns' | 'ssdp' | 'snmp'
  }>
}

interface AgentCommandAckPayload {
  command_id: string
  status: 'completed' | 'failed'
  error?: string
  executed_at: string
}

interface ServerAuthenticatedPayload {
  agent_id: string
  agent_name: string
  organization_id: string
  segments: Array<{
    id: string
    name: string
    cidr: string
    scan_interval_seconds: number
    is_enabled: boolean
  }>
  latest_agent_version?: string
  agent_download_url?: string
  upgrade_available?: boolean
}

interface ServerSegmentsUpdatedPayload {
  segments: Array<{
    id: string
    name: string
    cidr: string
    scan_interval_seconds: number
    is_enabled: boolean
  }>
}

interface ServerCommandPayload {
  command_id: string
  command_type: 'scan_now' | 'scan_segment' | 'update_config' | 'restart' | 'upgrade' | 'ping'
  payload?: Record<string, unknown>
}

interface ServerErrorPayload {
  code: string
  message: string
}

// ==============================================
// Socket Client
// ==============================================

export type SocketConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated'

export interface SocketClientOptions {
  dashboardUrl: string
  apiKey: string
  version: string
  hostname: string
  onSegmentsUpdated?: (segments: ServerSegmentsUpdatedPayload['segments']) => void
  onCommand?: (command: ServerCommandPayload) => void
  onConnectionStateChange?: (state: SocketConnectionState) => void
}

export class SocketClient {
  private socket: Socket | null = null
  private logger: Logger
  private options: SocketClientOptions
  private connectionState: SocketConnectionState = 'disconnected'
  private reconnectAttempts = 0
  private maxReconnectAttempts = 10
  private authPayload: ServerAuthenticatedPayload | null = null

  constructor(options: SocketClientOptions, logger: Logger) {
    this.options = options
    this.logger = logger
  }

  /**
   * Connect to the dashboard Socket.IO server
   */
  connect(): Promise<ServerAuthenticatedPayload> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        if (this.authPayload) {
          resolve(this.authPayload)
          return
        }
      }

      this.setConnectionState('connecting')

      // Parse dashboard URL and construct WebSocket URL
      const baseUrl = this.options.dashboardUrl.replace(/\/$/, '')

      this.logger.info(`Connecting to Socket.IO at ${baseUrl}/agent`)

      this.socket = io(`${baseUrl}/agent`, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: this.maxReconnectAttempts,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        timeout: 20000,
      })

      // Connection events
      this.socket.on('connect', () => {
        this.logger.info('Socket connected, authenticating...')
        this.setConnectionState('connected')
        this.reconnectAttempts = 0

        // Authenticate
        const authPayload: AgentAuthenticatePayload = {
          apiKey: this.options.apiKey,
          version: this.options.version,
          hostname: this.options.hostname,
        }

        this.socket!.emit('authenticate', authPayload, (response: ServerAuthenticatedPayload | ServerErrorPayload) => {
          if ('code' in response) {
            // Error response
            this.logger.error(`Authentication failed: ${response.message}`)
            reject(new Error(response.message))
            this.disconnect()
          } else {
            // Success response
            this.logger.info(`Authenticated as ${response.agent_name}`)
            this.setConnectionState('authenticated')
            this.authPayload = response
            resolve(response)
          }
        })
      })

      this.socket.on('disconnect', (reason) => {
        this.logger.warn(`Socket disconnected: ${reason}`)
        this.setConnectionState('disconnected')
        this.authPayload = null
      })

      this.socket.on('connect_error', (error) => {
        this.reconnectAttempts++
        this.logger.warn(`Socket connection error (attempt ${this.reconnectAttempts}): ${error.message}`)

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          reject(new Error('Max reconnection attempts reached'))
        }
      })

      // Server events
      this.socket.on('segments:updated', (payload: ServerSegmentsUpdatedPayload) => {
        this.logger.info(`Received segment update: ${payload.segments.length} segments`)
        this.options.onSegmentsUpdated?.(payload.segments)
      })

      this.socket.on('command', (payload: ServerCommandPayload) => {
        this.logger.info(`Received command: ${payload.command_type}`)
        this.options.onCommand?.(payload)
      })

      this.socket.on('ping', () => {
        this.logger.debug('Received ping, sending pong')
        this.socket?.emit('pong')
      })

      this.socket.on('error', (payload: ServerErrorPayload) => {
        this.logger.error(`Socket error: ${payload.code} - ${payload.message}`)
      })
    })
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
      this.authPayload = null
      this.setConnectionState('disconnected')
    }
  }

  /**
   * Check if connected and authenticated
   */
  isConnected(): boolean {
    return this.connectionState === 'authenticated' && this.socket?.connected === true
  }

  /**
   * Get current connection state
   */
  getConnectionState(): SocketConnectionState {
    return this.connectionState
  }

  /**
   * Send heartbeat
   */
  sendHeartbeat(version: string, hostname: string): void {
    if (!this.isConnected()) {
      this.logger.debug('Cannot send heartbeat: not connected')
      return
    }

    const payload: AgentHeartbeatPayload = {
      version,
      hostname,
      uptime_seconds: Math.floor(process.uptime()),
    }

    this.socket!.emit('heartbeat', payload)
  }

  /**
   * Send status reports
   */
  sendStatusReports(reports: AgentStatusReportPayload['reports']): void {
    if (!this.isConnected()) {
      this.logger.debug('Cannot send status reports: not connected')
      return
    }

    this.socket!.emit('status:report', { reports })
  }

  /**
   * Send discovery reports
   */
  sendDiscoveryReport(segmentId: string, devices: AgentDiscoveryReportPayload['devices']): void {
    if (!this.isConnected()) {
      this.logger.debug('Cannot send discovery report: not connected')
      return
    }

    const payload: AgentDiscoveryReportPayload = {
      segment_id: segmentId,
      scan_timestamp: new Date().toISOString(),
      devices,
    }

    this.socket!.emit('discovery:report', payload)
  }

  /**
   * Acknowledge command execution
   */
  acknowledgeCommand(commandId: string, status: 'completed' | 'failed', error?: string): void {
    if (!this.isConnected()) {
      this.logger.debug('Cannot acknowledge command: not connected')
      return
    }

    const payload: AgentCommandAckPayload = {
      command_id: commandId,
      status,
      error,
      executed_at: new Date().toISOString(),
    }

    this.socket!.emit('command:ack', payload)
  }

  /**
   * Set connection state and notify listener
   */
  private setConnectionState(state: SocketConnectionState): void {
    this.connectionState = state
    this.options.onConnectionStateChange?.(state)
  }
}
