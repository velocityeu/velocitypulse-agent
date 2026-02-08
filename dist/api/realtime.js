import { createClient } from '@supabase/supabase-js';
/**
 * Supabase Realtime client for receiving instant command delivery
 * Falls back to heartbeat polling when realtime is unavailable
 */
export class RealtimeClient {
    client = null;
    channel = null;
    logger;
    options;
    connected = false;
    reconnectTimer = null;
    constructor(options, logger) {
        this.options = options;
        this.logger = logger;
    }
    /**
     * Connect to Supabase Realtime and subscribe to agent commands
     */
    async connect() {
        try {
            this.logger.info('Connecting to Supabase Realtime...');
            // Create Supabase client
            this.client = createClient(this.options.supabaseUrl, this.options.supabaseAnonKey, {
                realtime: {
                    params: {
                        eventsPerSecond: 10,
                    },
                },
            });
            // Subscribe to agent_commands table for this agent
            this.channel = this.client
                .channel(`agent-commands-${this.options.agentId}`)
                .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'agent_commands',
                filter: `agent_id=eq.${this.options.agentId}`,
            }, (payload) => {
                const command = payload.new;
                // Only process pending commands
                if (command.status === 'pending') {
                    this.logger.info(`Realtime command received: ${command.command_type}`);
                    this.options.onCommand(command);
                }
            })
                .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'agent_commands',
                filter: `agent_id=eq.${this.options.agentId}`,
            }, (payload) => {
                const command = payload.new;
                const oldCommand = payload.old;
                // Process if status changed to pending (command retried)
                if (command.status === 'pending' && oldCommand.status !== 'pending') {
                    this.logger.info(`Realtime command retry: ${command.command_type}`);
                    this.options.onCommand(command);
                }
            })
                .subscribe((status) => {
                this.logger.debug(`Realtime subscription status: ${status}`);
                if (status === 'SUBSCRIBED') {
                    this.connected = true;
                    this.options.onConnectionChange?.(true);
                    this.logger.info('Realtime connected - instant command delivery enabled');
                    // Clear reconnect timer
                    if (this.reconnectTimer) {
                        clearTimeout(this.reconnectTimer);
                        this.reconnectTimer = null;
                    }
                }
                else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
                    this.connected = false;
                    this.options.onConnectionChange?.(false);
                    this.logger.warn(`Realtime disconnected: ${status}`);
                    // Schedule reconnect
                    this.scheduleReconnect();
                }
            });
            return true;
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error(`Failed to connect to Realtime: ${errorMsg}`);
            this.scheduleReconnect();
            return false;
        }
    }
    /**
     * Disconnect from Supabase Realtime
     */
    async disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.channel) {
            await this.channel.unsubscribe();
            this.channel = null;
        }
        if (this.client) {
            await this.client.removeAllChannels();
            this.client = null;
        }
        this.connected = false;
        this.options.onConnectionChange?.(false);
        this.logger.info('Realtime disconnected');
    }
    /**
     * Check if connected to Realtime
     */
    isConnected() {
        return this.connected;
    }
    /**
     * Schedule a reconnection attempt
     */
    scheduleReconnect() {
        if (this.reconnectTimer)
            return;
        const delay = 5000; // 5 seconds
        this.logger.debug(`Scheduling Realtime reconnect in ${delay}ms`);
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            if (!this.connected) {
                this.logger.info('Attempting Realtime reconnect...');
                await this.disconnect();
                await this.connect();
            }
        }, delay);
    }
    /**
     * Update credentials (e.g., from heartbeat response)
     */
    async updateCredentials(supabaseUrl, supabaseAnonKey) {
        // Check if credentials changed
        if (this.options.supabaseUrl === supabaseUrl &&
            this.options.supabaseAnonKey === supabaseAnonKey) {
            return;
        }
        this.logger.info('Supabase credentials updated, reconnecting...');
        this.options.supabaseUrl = supabaseUrl;
        this.options.supabaseAnonKey = supabaseAnonKey;
        await this.disconnect();
        await this.connect();
    }
}
//# sourceMappingURL=realtime.js.map