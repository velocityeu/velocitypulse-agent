import express from 'express';
import os from 'os';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { BUILD_ID } from '../utils/version.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class AgentUIServer {
    app;
    httpServer;
    io;
    logger;
    state;
    port;
    healthInterval = null;
    startedAt;
    constructor(port, logger, initialState = {}) {
        this.port = port;
        this.logger = logger;
        this.startedAt = new Date().toISOString();
        this.app = express();
        this.httpServer = createServer(this.app);
        this.io = new SocketIOServer(this.httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        });
        const mem = process.memoryUsage();
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
        };
        this.setupRoutes();
        this.setupSocketIO();
        this.startHealthUpdates();
    }
    setupRoutes() {
        // Serve static files from public directory
        const publicPath = path.join(__dirname, 'public');
        this.app.use(express.static(publicPath));
        // API endpoints
        this.app.get('/api/status', (_req, res) => {
            res.json(this.state);
        });
        // Trigger manual scan
        this.app.post('/api/scan', (_req, res) => {
            this.io.emit('command', { type: 'scan_now' });
            res.json({ success: true, message: 'Scan triggered' });
        });
        // Trigger ping to dashboard
        this.app.post('/api/ping', (_req, res) => {
            this.io.emit('command', { type: 'ping' });
            res.json({ success: true, message: 'Ping sent' });
        });
        // Fallback to index.html for SPA routing
        this.app.get('/{*path}', (_req, res) => {
            res.sendFile(path.join(publicPath, 'index.html'));
        });
    }
    setupSocketIO() {
        this.io.on('connection', (socket) => {
            this.logger.debug(`UI client connected: ${socket.id}`);
            // Send current state on connect
            socket.emit('state', this.state);
            socket.on('disconnect', () => {
                this.logger.debug(`UI client disconnected: ${socket.id}`);
            });
            // Handle command requests from UI
            socket.on('command', (cmd) => {
                this.logger.info(`UI command: ${cmd.type}`);
                // Emit to all clients so the main agent loop can pick it up
                this.io.emit('command', cmd);
            });
        });
    }
    // Update methods called from the main agent loop
    updateConnection(connected, agentId, organizationId) {
        this.state.connected = connected;
        if (agentId)
            this.state.agentId = agentId;
        if (organizationId)
            this.state.organizationId = organizationId;
        this.state.lastHeartbeat = new Date().toISOString();
        this.io.emit('connection', {
            connected,
            agentId: this.state.agentId,
            organizationId: this.state.organizationId,
            lastHeartbeat: this.state.lastHeartbeat,
        });
    }
    updateSegments(segments) {
        this.state.segments = segments;
        this.io.emit('segments', segments);
    }
    updateSegmentScanning(segmentId, scanning) {
        const segment = this.state.segments.find(s => s.id === segmentId);
        if (segment) {
            segment.scanning = scanning;
            if (!scanning) {
                segment.lastScan = new Date().toISOString();
            }
        }
        this.state.scanning = this.state.segments.some(s => s.scanning);
        this.io.emit('segments', this.state.segments);
        this.io.emit('scanning', this.state.scanning);
    }
    updateDevices(devices) {
        this.state.devices = devices;
        this.io.emit('devices', devices);
    }
    addDevice(device) {
        const existing = this.state.devices.findIndex(d => d.id === device.id);
        if (existing >= 0) {
            this.state.devices[existing] = device;
        }
        else {
            this.state.devices.push(device);
        }
        this.io.emit('devices', this.state.devices);
    }
    updateDeviceStatus(deviceId, status, responseTime) {
        const device = this.state.devices.find(d => d.id === deviceId);
        if (device) {
            device.status = status;
            device.responseTime = responseTime;
            device.lastCheck = new Date().toISOString();
            this.io.emit('device_status', { id: deviceId, status, responseTime });
        }
    }
    updateVersionInfo(latest, updateAvailable) {
        this.state.versionInfo = {
            current: this.state.version,
            latest,
            updateAvailable,
        };
        this.io.emit('version_info', this.state.versionInfo);
    }
    updateConfig(config) {
        this.state.config = { ...this.state.config, ...config };
        this.io.emit('config_update', this.state.config);
    }
    startHealthUpdates() {
        // Update health stats every 5 seconds
        this.healthInterval = setInterval(() => {
            const mem = process.memoryUsage();
            this.state.health = {
                uptime: process.uptime(),
                memoryUsedMB: Math.round(mem.rss / 1024 / 1024),
                memoryTotalMB: Math.round(os.totalmem() / 1024 / 1024),
                cpuUsage: Math.round(os.loadavg()[0] * 100) / 100,
                startedAt: this.startedAt,
            };
            this.io.emit('health', this.state.health);
        }, 5000);
    }
    addLog(level, message) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
        };
        // Keep last 100 logs
        this.state.logs.unshift(entry);
        if (this.state.logs.length > 100) {
            this.state.logs = this.state.logs.slice(0, 100);
        }
        this.io.emit('log', entry);
    }
    // Start the server
    async start() {
        return new Promise((resolve) => {
            this.httpServer.listen(this.port, () => {
                this.logger.info(`Agent UI available at http://localhost:${this.port}`);
                resolve();
            });
        });
    }
    // Stop the server
    async stop() {
        if (this.healthInterval) {
            clearInterval(this.healthInterval);
            this.healthInterval = null;
        }
        return new Promise((resolve, reject) => {
            this.io.close();
            this.httpServer.close((err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    // Get Socket.IO instance for external event handling
    getIO() {
        return this.io;
    }
}
//# sourceMappingURL=server.js.map