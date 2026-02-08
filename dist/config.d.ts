export interface Config {
    dashboardUrl: string;
    apiKey: string;
    agentName: string;
    heartbeatInterval: number;
    statusCheckInterval: number;
    statusFailureThreshold: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    logDir: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    enableRealtime: boolean;
    enableAutoScan: boolean;
    autoScanInterval: number;
    enableAutoUpgrade: boolean;
    autoUpgradeOnMinor: boolean;
}
export declare function loadConfig(): Config;
//# sourceMappingURL=config.d.ts.map