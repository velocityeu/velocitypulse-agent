import type { Logger } from '../utils/logger.js';
export interface AgentCommand {
    id: string;
    agent_id: string;
    command_type: 'scan_now' | 'scan_segment' | 'update_config' | 'restart' | 'upgrade' | 'ping';
    payload?: Record<string, unknown>;
    status: 'pending' | 'completed' | 'failed';
    created_at: string;
    executed_at?: string;
}
export interface RealtimeClientOptions {
    supabaseUrl: string;
    supabaseAnonKey: string;
    agentId: string;
    onCommand: (command: AgentCommand) => void;
    onConnectionChange?: (connected: boolean) => void;
}
/**
 * Supabase Realtime client for receiving instant command delivery
 * Falls back to heartbeat polling when realtime is unavailable
 */
export declare class RealtimeClient {
    private client;
    private channel;
    private logger;
    private options;
    private connected;
    private reconnectTimer;
    constructor(options: RealtimeClientOptions, logger: Logger);
    /**
     * Connect to Supabase Realtime and subscribe to agent commands
     */
    connect(): Promise<boolean>;
    /**
     * Disconnect from Supabase Realtime
     */
    disconnect(): Promise<void>;
    /**
     * Check if connected to Realtime
     */
    isConnected(): boolean;
    /**
     * Schedule a reconnection attempt
     */
    private scheduleReconnect;
    /**
     * Update credentials (e.g., from heartbeat response)
     */
    updateCredentials(supabaseUrl: string, supabaseAnonKey: string): Promise<void>;
}
//# sourceMappingURL=realtime.d.ts.map