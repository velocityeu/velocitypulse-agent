import { Server as SocketIOServer } from 'socket.io';
import type { Logger } from '../utils/logger.js';
export interface HealthStats {
    uptime: number;
    memoryUsedMB: number;
    memoryTotalMB: number;
    cpuUsage: number;
    startedAt: string;
}
export interface VersionInfo {
    current: string;
    latest: string | null;
    updateAvailable: boolean;
}
export interface AgentUIState {
    agentId: string | null;
    agentName: string;
    organizationId: string | null;
    dashboardUrl: string;
    version: string;
    connected: boolean;
    lastHeartbeat: string | null;
    segments: SegmentInfo[];
    devices: DeviceInfo[];
    logs: LogEntry[];
    scanning: boolean;
    health: HealthStats;
    versionInfo: VersionInfo;
}
export interface SegmentInfo {
    id: string;
    name: string;
    cidr: string;
    lastScan: string | null;
    deviceCount: number;
    scanning: boolean;
}
export interface DeviceInfo {
    id: string;
    name: string;
    ip: string;
    mac?: string;
    status: 'online' | 'offline' | 'degraded' | 'unknown';
    responseTime?: number;
    lastCheck?: string;
}
export interface LogEntry {
    timestamp: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    message: string;
}
export declare class AgentUIServer {
    private app;
    private httpServer;
    private io;
    private logger;
    private state;
    private port;
    private healthInterval;
    private startedAt;
    constructor(port: number, logger: Logger, initialState?: Partial<AgentUIState>);
    private setupRoutes;
    private setupSocketIO;
    updateConnection(connected: boolean, agentId?: string, organizationId?: string): void;
    updateSegments(segments: SegmentInfo[]): void;
    updateSegmentScanning(segmentId: string, scanning: boolean): void;
    updateDevices(devices: DeviceInfo[]): void;
    addDevice(device: DeviceInfo): void;
    updateDeviceStatus(deviceId: string, status: DeviceInfo['status'], responseTime?: number): void;
    updateVersionInfo(latest: string | null, updateAvailable: boolean): void;
    private startHealthUpdates;
    addLog(level: LogEntry['level'], message: string): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    getIO(): SocketIOServer;
}
//# sourceMappingURL=server.d.ts.map