import axios from 'axios';
export class DashboardClient {
    client;
    logger;
    constructor(dashboardUrl, apiKey, logger) {
        this.logger = logger;
        this.client = axios.create({
            baseURL: dashboardUrl,
            timeout: 30000,
            headers: {
                'X-Agent-Key': apiKey,
                'Content-Type': 'application/json',
                'X-Agent-Client': 'VelocityPulse-Agent/1.0',
            },
        });
    }
    /**
     * Send heartbeat to dashboard and get assigned segments
     */
    async heartbeat(version, hostname) {
        this.logger.debug('Sending heartbeat to dashboard');
        const response = await this.client.post('/api/agent/heartbeat', {
            version,
            hostname,
            uptime_seconds: Math.floor(process.uptime()),
        });
        this.logger.debug(`Heartbeat response: ${response.data.segments.length} segments, org: ${response.data.organization_id}`);
        return response.data;
    }
    /**
     * Upload discovered devices from network scan
     */
    async uploadDiscoveredDevices(segmentId, devices) {
        this.logger.debug(`Uploading ${devices.length} discovered devices for segment ${segmentId}`);
        const response = await this.client.post('/api/agent/devices/discovered', {
            segment_id: segmentId,
            scan_timestamp: new Date().toISOString(),
            devices,
        });
        return response.data;
    }
    /**
     * Get list of devices to monitor
     */
    async getDevicesToMonitor() {
        this.logger.debug('Fetching devices to monitor');
        const response = await this.client.get('/api/agent/devices');
        return response.data.devices;
    }
    /**
     * Upload device status reports
     */
    async uploadStatusReports(reports) {
        this.logger.debug(`Uploading ${reports.length} status reports`);
        const response = await this.client.post('/api/agent/devices/status', {
            reports,
        });
        return response.data;
    }
    /**
     * Register an auto-detected network segment with the dashboard
     * Used when agent starts with no segments assigned
     */
    async registerAutoSegment(request) {
        this.logger.info(`Registering auto-detected segment: ${request.name} (${request.cidr})`);
        const response = await this.client.post('/api/agent/segments/register', request);
        return response.data.segment;
    }
    /**
     * Acknowledge command execution to the dashboard
     */
    async acknowledgeCommand(commandId, success, result, error) {
        this.logger.debug(`Acknowledging command ${commandId}: ${success ? 'completed' : 'failed'}`);
        await this.client.post(`/api/agent/commands/${commandId}/ack`, {
            success,
            result,
            error,
        });
    }
    /**
     * Send a pong response to the dashboard
     * Used to respond to ping commands for connectivity testing
     */
    async sendPong(commandId) {
        this.logger.debug('Sending pong to dashboard');
        const response = await this.client.post('/api/agent/ping', {
            agent_timestamp: new Date().toISOString(),
            command_id: commandId,
        });
        return { latency_ms: response.data.latency_ms };
    }
}
//# sourceMappingURL=client.js.map