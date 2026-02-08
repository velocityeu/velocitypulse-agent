import type { Logger } from '../utils/logger.js';
interface AgentStatusReportPayload {
    reports: Array<{
        device_id?: string;
        ip_address: string;
        status: 'online' | 'offline' | 'degraded' | 'unknown';
        response_time_ms: number | null;
        check_type: 'ping' | 'http' | 'tcp';
        checked_at: string;
        error?: string;
    }>;
}
interface AgentDiscoveryReportPayload {
    segment_id: string;
    scan_timestamp: string;
    devices: Array<{
        ip_address: string;
        mac_address?: string;
        hostname?: string;
        manufacturer?: string;
        device_type?: string;
        discovery_method: 'arp' | 'mdns' | 'ssdp' | 'snmp';
    }>;
}
interface ServerAuthenticatedPayload {
    agent_id: string;
    agent_name: string;
    organization_id: string;
    segments: Array<{
        id: string;
        name: string;
        cidr: string;
        scan_interval_seconds: number;
        is_enabled: boolean;
    }>;
    latest_agent_version?: string;
    agent_download_url?: string;
    upgrade_available?: boolean;
}
interface ServerSegmentsUpdatedPayload {
    segments: Array<{
        id: string;
        name: string;
        cidr: string;
        scan_interval_seconds: number;
        is_enabled: boolean;
    }>;
}
interface ServerCommandPayload {
    command_id: string;
    command_type: 'scan_now' | 'scan_segment' | 'update_config' | 'restart' | 'upgrade' | 'ping';
    payload?: Record<string, unknown>;
}
export type SocketConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticated';
export interface SocketClientOptions {
    dashboardUrl: string;
    apiKey: string;
    version: string;
    hostname: string;
    onSegmentsUpdated?: (segments: ServerSegmentsUpdatedPayload['segments']) => void;
    onCommand?: (command: ServerCommandPayload) => void;
    onConnectionStateChange?: (state: SocketConnectionState) => void;
}
export declare class SocketClient {
    private socket;
    private logger;
    private options;
    private connectionState;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private authPayload;
    constructor(options: SocketClientOptions, logger: Logger);
    /**
     * Connect to the dashboard Socket.IO server
     */
    connect(): Promise<ServerAuthenticatedPayload>;
    /**
     * Disconnect from the server
     */
    disconnect(): void;
    /**
     * Check if connected and authenticated
     */
    isConnected(): boolean;
    /**
     * Get current connection state
     */
    getConnectionState(): SocketConnectionState;
    /**
     * Send heartbeat
     */
    sendHeartbeat(version: string, hostname: string): void;
    /**
     * Send status reports
     */
    sendStatusReports(reports: AgentStatusReportPayload['reports']): void;
    /**
     * Send discovery reports
     */
    sendDiscoveryReport(segmentId: string, devices: AgentDiscoveryReportPayload['devices']): void;
    /**
     * Acknowledge command execution
     */
    acknowledgeCommand(commandId: string, status: 'completed' | 'failed', error?: string): void;
    /**
     * Set connection state and notify listener
     */
    private setConnectionState;
}
export {};
//# sourceMappingURL=socket.d.ts.map