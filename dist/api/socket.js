import { io } from 'socket.io-client';
export class SocketClient {
    socket = null;
    logger;
    options;
    connectionState = 'disconnected';
    reconnectAttempts = 0;
    maxReconnectAttempts = 10;
    authPayload = null;
    constructor(options, logger) {
        this.options = options;
        this.logger = logger;
    }
    /**
     * Connect to the dashboard Socket.IO server
     */
    connect() {
        return new Promise((resolve, reject) => {
            if (this.socket?.connected) {
                if (this.authPayload) {
                    resolve(this.authPayload);
                    return;
                }
            }
            this.setConnectionState('connecting');
            // Parse dashboard URL and construct WebSocket URL
            const baseUrl = this.options.dashboardUrl.replace(/\/$/, '');
            this.logger.info(`Connecting to Socket.IO at ${baseUrl}/agent`);
            this.socket = io(`${baseUrl}/agent`, {
                path: '/socket.io',
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 30000,
                timeout: 20000,
            });
            // Connection events
            this.socket.on('connect', () => {
                this.logger.info('Socket connected, authenticating...');
                this.setConnectionState('connected');
                this.reconnectAttempts = 0;
                // Authenticate
                const authPayload = {
                    apiKey: this.options.apiKey,
                    version: this.options.version,
                    hostname: this.options.hostname,
                };
                this.socket.emit('authenticate', authPayload, (response) => {
                    if ('code' in response) {
                        // Error response
                        this.logger.error(`Authentication failed: ${response.message}`);
                        reject(new Error(response.message));
                        this.disconnect();
                    }
                    else {
                        // Success response
                        this.logger.info(`Authenticated as ${response.agent_name}`);
                        this.setConnectionState('authenticated');
                        this.authPayload = response;
                        resolve(response);
                    }
                });
            });
            this.socket.on('disconnect', (reason) => {
                this.logger.warn(`Socket disconnected: ${reason}`);
                this.setConnectionState('disconnected');
                this.authPayload = null;
            });
            this.socket.on('connect_error', (error) => {
                this.reconnectAttempts++;
                this.logger.warn(`Socket connection error (attempt ${this.reconnectAttempts}): ${error.message}`);
                if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                    reject(new Error('Max reconnection attempts reached'));
                }
            });
            // Server events
            this.socket.on('segments:updated', (payload) => {
                this.logger.info(`Received segment update: ${payload.segments.length} segments`);
                this.options.onSegmentsUpdated?.(payload.segments);
            });
            this.socket.on('command', (payload) => {
                this.logger.info(`Received command: ${payload.command_type}`);
                this.options.onCommand?.(payload);
            });
            this.socket.on('ping', () => {
                this.logger.debug('Received ping, sending pong');
                this.socket?.emit('pong');
            });
            this.socket.on('error', (payload) => {
                this.logger.error(`Socket error: ${payload.code} - ${payload.message}`);
            });
        });
    }
    /**
     * Disconnect from the server
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
            this.authPayload = null;
            this.setConnectionState('disconnected');
        }
    }
    /**
     * Check if connected and authenticated
     */
    isConnected() {
        return this.connectionState === 'authenticated' && this.socket?.connected === true;
    }
    /**
     * Get current connection state
     */
    getConnectionState() {
        return this.connectionState;
    }
    /**
     * Send heartbeat
     */
    sendHeartbeat(version, hostname) {
        if (!this.isConnected()) {
            this.logger.debug('Cannot send heartbeat: not connected');
            return;
        }
        const payload = {
            version,
            hostname,
            uptime_seconds: Math.floor(process.uptime()),
        };
        this.socket.emit('heartbeat', payload);
    }
    /**
     * Send status reports
     */
    sendStatusReports(reports) {
        if (!this.isConnected()) {
            this.logger.debug('Cannot send status reports: not connected');
            return;
        }
        this.socket.emit('status:report', { reports });
    }
    /**
     * Send discovery reports
     */
    sendDiscoveryReport(segmentId, devices) {
        if (!this.isConnected()) {
            this.logger.debug('Cannot send discovery report: not connected');
            return;
        }
        const payload = {
            segment_id: segmentId,
            scan_timestamp: new Date().toISOString(),
            devices,
        };
        this.socket.emit('discovery:report', payload);
    }
    /**
     * Acknowledge command execution
     */
    acknowledgeCommand(commandId, status, error) {
        if (!this.isConnected()) {
            this.logger.debug('Cannot acknowledge command: not connected');
            return;
        }
        const payload = {
            command_id: commandId,
            status,
            error,
            executed_at: new Date().toISOString(),
        };
        this.socket.emit('command:ack', payload);
    }
    /**
     * Set connection state and notify listener
     */
    setConnectionState(state) {
        this.connectionState = state;
        this.options.onConnectionStateChange?.(state);
    }
}
//# sourceMappingURL=socket.js.map