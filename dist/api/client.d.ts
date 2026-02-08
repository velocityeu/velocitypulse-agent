import type { Logger } from '../utils/logger.js';
export interface NetworkSegment {
    id: string;
    name: string;
    cidr: string;
    scan_interval_seconds: number;
    segment_type: 'local_scan' | 'remote_monitor';
    is_auto_registered?: boolean;
    interface_name?: string;
}
export interface HeartbeatResponse {
    success: boolean;
    agent_id: string;
    agent_name: string;
    organization_id: string;
    server_time: string;
    segments: NetworkSegment[];
    supabase_url?: string;
    supabase_anon_key?: string;
    latest_agent_version?: string;
    agent_download_url?: string;
    upgrade_available?: boolean;
    pending_commands?: AgentCommand[];
}
export interface AutoSegmentRequest {
    cidr: string;
    name: string;
    interface_name: string;
}
export interface AgentCommand {
    id: string;
    command_type: 'scan_now' | 'scan_segment' | 'update_config' | 'restart' | 'upgrade' | 'ping';
    payload?: Record<string, unknown>;
    status: 'pending' | 'completed' | 'failed';
    created_at: string;
    executed_at?: string;
}
export interface DiscoveredDevice {
    ip_address: string;
    mac_address?: string;
    hostname?: string;
    manufacturer?: string;
    os_hints?: string[];
    device_type?: 'server' | 'workstation' | 'network' | 'printer' | 'iot' | 'unknown';
    open_ports?: number[];
    services?: string[];
    netbios_name?: string;
    snmp_info?: {
        sysName?: string;
        sysDescr?: string;
        sysContact?: string;
        sysLocation?: string;
    };
    upnp_info?: {
        friendlyName?: string;
        deviceType?: string;
        manufacturer?: string;
    };
    discovery_method: 'arp' | 'mdns' | 'ssdp' | 'snmp';
}
export interface DiscoveryResponse {
    success: boolean;
    created: number;
    updated: number;
    unchanged: number;
}
export interface DeviceToMonitor {
    id: string;
    ip_address?: string;
    hostname?: string;
    check_type: 'ping' | 'http' | 'tcp' | 'ssl' | 'dns';
    port?: number | null;
    url?: string;
    is_monitored: boolean;
    check_interval_seconds?: number;
    ssl_expiry_warn_days?: number;
    dns_expected_ip?: string;
    network_segment_id?: string;
}
export interface StatusReport {
    device_id?: string;
    ip_address: string;
    status: 'online' | 'offline' | 'degraded' | 'unknown';
    response_time_ms: number | null;
    check_type: 'ping' | 'http' | 'tcp' | 'ssl' | 'dns';
    checked_at: string;
    error?: string;
    ssl_expiry_at?: string;
    ssl_issuer?: string;
    ssl_subject?: string;
}
export interface StatusResponse {
    success: boolean;
    processed: number;
    errors: string[];
}
export declare class DashboardClient {
    private client;
    private logger;
    constructor(dashboardUrl: string, apiKey: string, logger: Logger);
    /**
     * Send heartbeat to dashboard and get assigned segments
     */
    heartbeat(version: string, hostname: string): Promise<HeartbeatResponse>;
    /**
     * Upload discovered devices from network scan
     */
    uploadDiscoveredDevices(segmentId: string, devices: DiscoveredDevice[]): Promise<DiscoveryResponse>;
    /**
     * Get list of devices to monitor
     */
    getDevicesToMonitor(): Promise<DeviceToMonitor[]>;
    /**
     * Upload device status reports
     */
    uploadStatusReports(reports: StatusReport[]): Promise<StatusResponse>;
    /**
     * Register an auto-detected network segment with the dashboard
     * Used when agent starts with no segments assigned
     */
    registerAutoSegment(request: AutoSegmentRequest): Promise<NetworkSegment>;
    /**
     * Acknowledge command execution to the dashboard
     */
    acknowledgeCommand(commandId: string, success: boolean, result?: Record<string, unknown>, error?: string): Promise<void>;
    /**
     * Send a pong response to the dashboard
     * Used to respond to ping commands for connectivity testing
     */
    sendPong(commandId?: string): Promise<{
        latency_ms?: number;
    }>;
}
//# sourceMappingURL=client.d.ts.map