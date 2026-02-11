import express from 'express'
import os from 'os'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import path from 'path'
import { fileURLToPath } from 'url'
import type { Logger } from '../utils/logger.js'
import { BUILD_ID } from '../utils/version.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface HealthStats {
  uptime: number // seconds
  memoryUsedMB: number
  memoryTotalMB: number
  cpuUsage: number // percentage (0-100)
  startedAt: string
}

export interface VersionInfo {
  current: string
  latest: string | null
  updateAvailable: boolean
}

export interface AgentConfig {
  scanIntervals: Record<string, number> // segmentId -> seconds
  enabledSegments: string[] // segment IDs
  pingTimeoutMs: number
  discoveryMethods: string[] // arp, ping, mdns, ssdp
}

export interface AgentUIState {
  agentId: string | null
  agentName: string
  organizationId: string | null
  dashboardUrl: string
  version: string
  buildId: string
  connected: boolean
  lastHeartbeat: string | null
  segments: SegmentInfo[]
  devices: DeviceInfo[]
  logs: LogEntry[]
  scanning: boolean
  health: HealthStats
  versionInfo: VersionInfo
  config: AgentConfig
}

export interface SegmentInfo {
  id: string
  name: string
  cidr: string
  lastScan: string | null
  deviceCount: number
  scanning: boolean
}

export interface DeviceInfo {
  id: string
  name: string
  ip: string
  mac?: string
  status: 'online' | 'offline' | 'degraded' | 'unknown'
  responseTime?: number
  lastCheck?: string
}

export interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
}

export class AgentUIServer {
  private app: express.Application
  private httpServer: ReturnType<typeof createServer>
  private io: SocketIOServer
  private logger: Logger
  private state: AgentUIState
  private port: number
  private healthInterval: ReturnType<typeof setInterval> | null = null
  private startedAt: string

  constructor(port: number, logger: Logger, initialState: Partial<AgentUIState> = {}) {
    this.port = port
    this.logger = logger
    this.startedAt = new Date().toISOString()
    this.app = express()
    this.httpServer = createServer(this.app)
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    })

    const mem = process.memoryUsage()
    this.state = {
      agentId: null,
      agentName: 'VelocityPulse Agent',
      organizationId: null,
      dashboardUrl: '',
      version: '1.0.0',
      buildId: BUILD_ID,
      connected: false,
      lastHeartbeat: null,
      segments: [],
      devices: [],
      logs: [],
      scanning: false,
      health: {
        uptime: process.uptime(),
        memoryUsedMB: Math.round(mem.rss / 1024 / 1024),
        memoryTotalMB: Math.round(os.totalmem() / 1024 / 1024),
        cpuUsage: 0,
        startedAt: this.startedAt,
      },
      versionInfo: {
        current: initialState.version || '1.0.0',
        latest: null,
        updateAvailable: false,
      },
      config: {
        scanIntervals: {},
        enabledSegments: [],
        pingTimeoutMs: 2000,
        discoveryMethods: ['arp', 'ping'],
      },
      ...initialState,
    }

    this.setupRoutes()
    this.setupSocketIO()
    this.startHealthUpdates()
  }

  private setupRoutes(): void {
    // Serve static files from public directory
    const publicPath = path.join(__dirname, 'public')
    this.app.use(express.static(publicPath))

    // API endpoints
    this.app.get('/api/status', (_req, res) => {
      res.json(this.state)
    })

    // Trigger manual scan
    this.app.post('/api/scan', (_req, res) => {
      this.io.emit('command', { type: 'scan_now' })
      res.json({ success: true, message: 'Scan triggered' })
    })

    // Trigger ping to dashboard
    this.app.post('/api/ping', (_req, res) => {
      this.io.emit('command', { type: 'ping' })
      res.json({ success: true, message: 'Ping sent' })
    })

    // Fallback to index.html for SPA routing
    this.app.get('*', (_req, res) => {
      res.sendFile(path.join(publicPath, 'index.html'))
    })
  }

  private setupSocketIO(): void {
    this.io.on('connection', (socket) => {
      this.logger.debug(`UI client connected: ${socket.id}`)

      // Send current state on connect
      socket.emit('state', this.state)

      socket.on('disconnect', () => {
        this.logger.debug(`UI client disconnected: ${socket.id}`)
      })

      // Handle command requests from UI
      socket.on('command', (cmd: { type: string; payload?: unknown }) => {
        this.logger.info(`UI command: ${cmd.type}`)
        // Emit to all clients so the main agent loop can pick it up
        this.io.emit('command', cmd)
      })
    })
  }

  // Update methods called from the main agent loop

  updateConnection(connected: boolean, agentId?: string, organizationId?: string): void {
    this.state.connected = connected
    if (agentId) this.state.agentId = agentId
    if (organizationId) this.state.organizationId = organizationId
    this.state.lastHeartbeat = new Date().toISOString()
    this.io.emit('connection', {
      connected,
      agentId: this.state.agentId,
      organizationId: this.state.organizationId,
      lastHeartbeat: this.state.lastHeartbeat,
    })
  }

  updateSegments(segments: SegmentInfo[]): void {
    this.state.segments = segments
    this.io.emit('segments', segments)
  }

  updateSegmentScanning(segmentId: string, scanning: boolean): void {
    const segment = this.state.segments.find(s => s.id === segmentId)
    if (segment) {
      segment.scanning = scanning
      if (!scanning) {
        segment.lastScan = new Date().toISOString()
      }
    }
    this.state.scanning = this.state.segments.some(s => s.scanning)
    this.io.emit('segments', this.state.segments)
    this.io.emit('scanning', this.state.scanning)
  }

  updateDevices(devices: DeviceInfo[]): void {
    this.state.devices = devices
    this.io.emit('devices', devices)
  }

  addDevice(device: DeviceInfo): void {
    const existing = this.state.devices.findIndex(d => d.id === device.id)
    if (existing >= 0) {
      this.state.devices[existing] = device
    } else {
      this.state.devices.push(device)
    }
    this.io.emit('devices', this.state.devices)
  }

  updateDeviceStatus(deviceId: string, status: DeviceInfo['status'], responseTime?: number): void {
    const device = this.state.devices.find(d => d.id === deviceId)
    if (device) {
      device.status = status
      device.responseTime = responseTime
      device.lastCheck = new Date().toISOString()
      this.io.emit('device_status', { id: deviceId, status, responseTime })
    }
  }

  updateVersionInfo(latest: string | null, updateAvailable: boolean): void {
    this.state.versionInfo = {
      current: this.state.version,
      latest,
      updateAvailable,
    }
    this.io.emit('version_info', this.state.versionInfo)
  }

  updateConfig(config: Partial<AgentConfig>): void {
    this.state.config = { ...this.state.config, ...config }
    this.io.emit('config_update', this.state.config)
  }

  private startHealthUpdates(): void {
    // Update health stats every 5 seconds
    this.healthInterval = setInterval(() => {
      const mem = process.memoryUsage()
      this.state.health = {
        uptime: process.uptime(),
        memoryUsedMB: Math.round(mem.rss / 1024 / 1024),
        memoryTotalMB: Math.round(os.totalmem() / 1024 / 1024),
        cpuUsage: Math.round(os.loadavg()[0] * 100) / 100,
        startedAt: this.startedAt,
      }
      this.io.emit('health', this.state.health)
    }, 5000)
  }

  addLog(level: LogEntry['level'], message: string): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    }

    // Keep last 100 logs
    this.state.logs.unshift(entry)
    if (this.state.logs.length > 100) {
      this.state.logs = this.state.logs.slice(0, 100)
    }

    this.io.emit('log', entry)
  }

  // Start the server
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        this.logger.info(`Agent UI available at http://localhost:${this.port}`)
        resolve()
      })
    })
  }

  // Stop the server
  async stop(): Promise<void> {
    if (this.healthInterval) {
      clearInterval(this.healthInterval)
      this.healthInterval = null
    }
    return new Promise((resolve, reject) => {
      this.io.close()
      this.httpServer.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  // Get Socket.IO instance for external event handling
  getIO(): SocketIOServer {
    return this.io
  }
}
