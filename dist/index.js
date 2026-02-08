import os from 'os';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { VERSION, PRODUCT_NAME } from './utils/version.js';
import { DashboardClient } from './api/client.js';
import { checkSsl } from './scanner/ssl.js';
import { checkDns } from './scanner/dns.js';
import { discoverDevices } from './scanner/discover.js';
import { pingHost } from './scanner/ping.js';
import { checkTcpPort } from './scanner/tcp.js';
import { checkHttp } from './scanner/http.js';
import { getPrimaryLocalNetwork, generateAutoSegmentName } from './utils/network-detect.js';
import { AgentUIServer } from './ui/server.js';
import { RealtimeClient } from './api/realtime.js';
import { performUpgrade } from './upgrade/upgrader.js';
import { shouldAutoUpgrade } from './utils/version.js';
// UI Server port (can be configured via env)
const UI_PORT = parseInt(process.env.AGENT_UI_PORT || '3001', 10);
// Track consecutive failures for status hysteresis
const deviceFailureCounts = new Map();
const lastKnownStatus = new Map();
/**
 * Prune device tracking maps to only active devices
 * This prevents memory leaks without resetting all hysteresis state
 */
function pruneDeviceTracking(activeKeys, logger) {
    let removedCount = 0;
    for (const key of deviceFailureCounts.keys()) {
        if (!activeKeys.has(key)) {
            deviceFailureCounts.delete(key);
            lastKnownStatus.delete(key);
            removedCount++;
        }
    }
    if (removedCount > 0) {
        logger.debug(`Pruned ${removedCount} device tracking entries`);
    }
}
async function main() {
    console.log(`
+============================================+
|     ${PRODUCT_NAME} v${VERSION}             |
|     Network Discovery & Monitoring         |
+============================================+
`);
    // Load configuration
    const config = loadConfig();
    const logger = createLogger(config.logLevel, config.logDir);
    logger.info(`Starting ${PRODUCT_NAME} v${VERSION}`);
    logger.info(`Agent name: ${config.agentName}`);
    logger.info(`Dashboard URL: ${config.dashboardUrl}`);
    // Create dashboard client
    const client = new DashboardClient(config.dashboardUrl, config.apiKey, logger);
    // Create UI server
    const uiServer = new AgentUIServer(UI_PORT, logger, {
        agentName: config.agentName,
        dashboardUrl: config.dashboardUrl,
        version: VERSION,
    });
    // Track segment scan states
    const segmentStates = new Map();
    // Track discovered devices for UI
    const discoveredDevices = new Map();
    // Agent state
    let agentId = null;
    let organizationId = null;
    let isRunning = true;
    // Realtime client for instant command delivery
    let realtimeClient = null;
    /**
     * Setup or update realtime client when we have credentials
     */
    async function setupRealtimeClient(supabaseUrl, supabaseAnonKey, currentAgentId) {
        if (!config.enableRealtime) {
            logger.debug('Realtime disabled in config');
            return;
        }
        if (!supabaseUrl || !supabaseAnonKey) {
            logger.debug('Missing Supabase credentials for realtime');
            return;
        }
        // Create new client if needed
        if (!realtimeClient) {
            realtimeClient = new RealtimeClient({
                supabaseUrl,
                supabaseAnonKey,
                agentId: currentAgentId,
                onCommand: (command) => {
                    logger.info(`Realtime command: ${command.command_type}`);
                    uiServer.addLog('info', `Realtime command: ${command.command_type}`);
                    // Convert to AgentCommand format and process
                    const agentCommand = {
                        id: command.id,
                        command_type: command.command_type,
                        payload: command.payload,
                        status: command.status,
                        created_at: command.created_at,
                    };
                    processCommands([agentCommand]).catch(err => {
                        logger.error(`Realtime command error: ${err instanceof Error ? err.message : 'Unknown'}`);
                    });
                },
                onConnectionChange: (connected) => {
                    if (connected) {
                        uiServer.addLog('info', 'Realtime connected');
                    }
                    else {
                        uiServer.addLog('warn', 'Realtime disconnected');
                    }
                },
            }, logger);
            await realtimeClient.connect();
        }
        else {
            // Update credentials if changed
            await realtimeClient.updateCredentials(supabaseUrl, supabaseAnonKey);
        }
    }
    // Graceful shutdown
    const shutdown = async () => {
        logger.info('Shutting down...');
        isRunning = false;
        if (realtimeClient) {
            await realtimeClient.disconnect();
        }
        await uiServer.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    /**
     * Heartbeat loop - maintains connection with dashboard
     */
    async function heartbeatLoop() {
        const hostname = os.hostname();
        let retryDelay = 2000;
        while (isRunning) {
            try {
                const response = await client.heartbeat(VERSION, hostname);
                agentId = response.agent_id;
                organizationId = response.organization_id;
                logger.debug(`Heartbeat OK - Agent: ${agentId}, Org: ${organizationId}`);
                // Update segments
                const currentSegmentIds = new Set(response.segments.map(s => s.id));
                // Remove old segments
                for (const [id] of segmentStates) {
                    if (!currentSegmentIds.has(id)) {
                        logger.info(`Segment removed: ${id}`);
                        segmentStates.delete(id);
                    }
                }
                // Add/update segments
                for (const segment of response.segments) {
                    if (!segmentStates.has(segment.id)) {
                        logger.info(`Segment added: ${segment.name} (${segment.cidr})`);
                        segmentStates.set(segment.id, {
                            segment,
                            lastScan: 0,
                            scanning: false,
                        });
                    }
                    else {
                        const state = segmentStates.get(segment.id);
                        state.segment = segment;
                    }
                }
                // Update UI with connection status and segments
                uiServer.updateConnection(true, agentId, organizationId);
                uiServer.updateSegments(Array.from(segmentStates.values()).map(s => ({
                    id: s.segment.id,
                    name: s.segment.name,
                    cidr: s.segment.cidr,
                    lastScan: s.lastScan ? new Date(s.lastScan).toISOString() : null,
                    deviceCount: Array.from(discoveredDevices.values()).filter(d => d.id.startsWith(s.segment.id)).length,
                    scanning: s.scanning,
                })));
                uiServer.addLog('info', `Heartbeat OK - ${response.segments.length} segment(s)`);
                // Check for upgrade and update UI
                if (response.upgrade_available && response.latest_agent_version) {
                    logger.info(`Upgrade available: ${VERSION} -> ${response.latest_agent_version}`);
                    uiServer.updateVersionInfo(response.latest_agent_version, true);
                }
                else {
                    uiServer.updateVersionInfo(null, false);
                }
                // Process pending commands
                if (response.pending_commands && response.pending_commands.length > 0) {
                    logger.info(`Received ${response.pending_commands.length} pending command(s)`);
                    // Process commands asynchronously to not block heartbeat
                    processCommands(response.pending_commands).catch(err => {
                        logger.error(`Command processing error: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    });
                }
                // Setup/update realtime client with credentials from heartbeat
                if (response.supabase_url && response.supabase_anon_key && agentId) {
                    setupRealtimeClient(response.supabase_url, response.supabase_anon_key, agentId);
                }
                // Reset retry delay on success
                retryDelay = 2000;
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                logger.warn(`Heartbeat failed: ${errorMsg}`);
                // Update UI with disconnected status
                uiServer.updateConnection(false);
                uiServer.addLog('warn', `Heartbeat failed: ${errorMsg}`);
                // Exponential backoff
                retryDelay = Math.min(retryDelay * 2, 60000);
            }
            // Wait before next heartbeat (max 60 seconds, configurable)
            await new Promise(resolve => setTimeout(resolve, Math.min(config.heartbeatInterval, 60000)));
        }
    }
    /**
     * Scan loop - discovers devices on network segments
     */
    async function scanLoop() {
        while (isRunning) {
            const now = Date.now();
            for (const [id, state] of segmentStates) {
                const { segment, lastScan, scanning } = state;
                const scanInterval = segment.scan_interval_seconds * 1000;
                // Skip if already scanning or not due yet
                if (scanning || (now - lastScan) < scanInterval) {
                    continue;
                }
                // Mark as scanning
                state.scanning = true;
                state.lastScan = now;
                logger.info(`Scanning segment: ${segment.name} (${segment.cidr})`);
                uiServer.updateSegmentScanning(segment.id, true);
                uiServer.addLog('info', `Scanning ${segment.name} (${segment.cidr})`);
                try {
                    const devices = await discoverDevices(segment.cidr, logger);
                    logger.info(`Discovered ${devices.length} devices in ${segment.name}`);
                    // Update UI with discovered devices (key by IP for consistent lookups)
                    for (const device of devices) {
                        const deviceKey = device.ip_address;
                        const existing = discoveredDevices.get(deviceKey);
                        const deviceInfo = {
                            id: deviceKey,
                            name: device.hostname || device.ip_address,
                            ip: device.ip_address,
                            mac: device.mac_address,
                            status: existing?.status || 'unknown',
                            responseTime: existing?.responseTime,
                            lastCheck: existing?.lastCheck,
                        };
                        discoveredDevices.set(deviceKey, deviceInfo);
                    }
                    uiServer.updateDevices(Array.from(discoveredDevices.values()));
                    if (devices.length > 0) {
                        const response = await client.uploadDiscoveredDevices(segment.id, devices);
                        logger.debug(`Upload result: ${response.created} created, ${response.updated} updated`);
                        uiServer.addLog('info', `Discovered ${devices.length} devices (${response.created} new, ${response.updated} updated)`);
                    }
                }
                catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    logger.error(`Scan failed for ${segment.name}: ${errorMsg}`);
                    uiServer.addLog('error', `Scan failed: ${errorMsg}`);
                }
                finally {
                    state.scanning = false;
                    uiServer.updateSegmentScanning(segment.id, false);
                }
            }
            // Short sleep between scan checks
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    /**
     * Multi-protocol probe - tries ping, then common ports if ping fails
     * Returns online if ANY method succeeds
     */
    async function multiProbe(ip) {
        // Common ports to try if ping fails
        const PROBE_PORTS = [
            { port: 80, name: 'HTTP' },
            { port: 443, name: 'HTTPS' },
            { port: 22, name: 'SSH' },
            { port: 3389, name: 'RDP' },
            { port: 445, name: 'SMB' },
            { port: 53, name: 'DNS' },
        ];
        // Try ping first
        const pingResult = await pingHost(ip, logger);
        if (pingResult.status === 'online') {
            return { status: 'online', responseTime: pingResult.response_time_ms, method: 'ping' };
        }
        // Ping failed - try TCP ports in parallel
        logger.debug(`Ping failed for ${ip}, trying TCP ports...`);
        const portChecks = PROBE_PORTS.map(async ({ port, name }) => {
            try {
                const result = await checkTcpPort(ip, port, logger);
                if (result.status === 'online') {
                    return { status: 'online', responseTime: result.response_time_ms, method: name };
                }
            }
            catch {
                // Port check failed, continue
            }
            return null;
        });
        const results = await Promise.all(portChecks);
        const successResult = results.find(r => r !== null);
        if (successResult) {
            logger.debug(`${ip} responded on ${successResult.method}`);
            return successResult;
        }
        return { status: 'offline', responseTime: null, method: 'none' };
    }
    /**
     * Status check loop - monitors device health
     * Checks ALL discovered devices, not just dashboard-monitored ones
     */
    async function statusCheckLoop() {
        while (isRunning) {
            try {
                // Get devices from dashboard for reporting
                const dashboardDevices = await client.getDevicesToMonitor();
                const dashboardDeviceMap = new Map(dashboardDevices.filter(d => d.ip_address).map(d => [d.ip_address, d]));
                // Get all locally discovered devices
                const allDevices = Array.from(discoveredDevices.values());
                if (allDevices.length === 0) {
                    logger.debug('No devices to monitor');
                    await new Promise(resolve => setTimeout(resolve, config.statusCheckInterval));
                    continue;
                }
                logger.debug(`Checking status of ${allDevices.length} discovered devices`);
                const reports = [];
                const activeKeys = new Set();
                for (const device of allDevices) {
                    const deviceKey = device.ip;
                    if (!deviceKey || deviceKey === '---')
                        continue;
                    // Skip broadcast addresses
                    if (deviceKey.endsWith('.255') || deviceKey.endsWith('.0')) {
                        device.status = 'offline';
                        uiServer.updateDeviceStatus(deviceKey, 'offline', undefined);
                        continue;
                    }
                    activeKeys.add(deviceKey);
                    let status = 'unknown';
                    let responseTime = null;
                    let checkMethod = 'ping';
                    try {
                        // Use multi-protocol probing for all devices
                        const probeResult = await multiProbe(deviceKey);
                        status = probeResult.status;
                        responseTime = probeResult.responseTime;
                        checkMethod = probeResult.method;
                    }
                    catch (err) {
                        status = 'offline';
                        logger.debug(`Probe error for ${deviceKey}: ${err instanceof Error ? err.message : 'Unknown'}`);
                    }
                    // Apply hysteresis for status changes
                    const previousStatus = lastKnownStatus.get(deviceKey);
                    const failureCount = deviceFailureCounts.get(deviceKey) || 0;
                    if (status === 'offline' && previousStatus === 'online') {
                        if (failureCount < config.statusFailureThreshold) {
                            deviceFailureCounts.set(deviceKey, failureCount + 1);
                            status = 'online'; // Keep as online until threshold reached
                        }
                    }
                    else if (status === 'online') {
                        deviceFailureCounts.set(deviceKey, 0);
                    }
                    lastKnownStatus.set(deviceKey, status);
                    // Update UI
                    device.status = status;
                    device.responseTime = responseTime ?? undefined;
                    device.lastCheck = new Date().toISOString();
                    uiServer.updateDeviceStatus(deviceKey, status, responseTime ?? undefined);
                    // If device is in dashboard, report status back
                    const dashboardDevice = dashboardDeviceMap.get(deviceKey);
                    if (dashboardDevice) {
                        reports.push({
                            device_id: dashboardDevice.id,
                            ip_address: deviceKey,
                            status,
                            response_time_ms: responseTime,
                            check_type: dashboardDevice.check_type || 'ping',
                            checked_at: new Date().toISOString(),
                        });
                    }
                }
                // Update UI with all devices
                uiServer.updateDevices(Array.from(discoveredDevices.values()));
                // Prune old device tracking entries
                pruneDeviceTracking(activeKeys, logger);
                // Upload status reports for dashboard-tracked devices
                if (reports.length > 0) {
                    const response = await client.uploadStatusReports(reports);
                    logger.debug(`Status upload: ${response.processed} processed`);
                }
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                logger.error(`Status check failed: ${errorMsg}`);
            }
            await new Promise(resolve => setTimeout(resolve, config.statusCheckInterval));
        }
    }
    // Track last check time per device for remote monitoring
    const remoteDeviceLastCheck = new Map();
    /**
     * Remote monitor loop - checks devices in remote_monitor segments
     * Uses per-device check intervals and routes to appropriate scanner
     */
    async function remoteMonitorLoop() {
        // Wait for initial heartbeat
        await new Promise(resolve => setTimeout(resolve, 10000));
        while (isRunning) {
            try {
                // Find remote_monitor segments
                const remoteSegments = Array.from(segmentStates.values())
                    .filter(s => s.segment.segment_type === 'remote_monitor');
                if (remoteSegments.length === 0) {
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    continue;
                }
                // Get all devices to monitor
                const allDevices = await client.getDevicesToMonitor();
                const remoteSegmentIds = new Set(remoteSegments.map(s => s.segment.id));
                // Filter to devices in remote segments
                const remoteDevices = allDevices.filter(d => d.network_segment_id && remoteSegmentIds.has(d.network_segment_id));
                if (remoteDevices.length === 0) {
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    continue;
                }
                const now = Date.now();
                const reports = [];
                for (const device of remoteDevices) {
                    const interval = (device.check_interval_seconds || 60) * 1000;
                    const lastCheck = remoteDeviceLastCheck.get(device.id) || 0;
                    if (now - lastCheck < interval)
                        continue;
                    remoteDeviceLastCheck.set(device.id, now);
                    const target = device.hostname || device.ip_address;
                    if (!target)
                        continue;
                    try {
                        let status = 'unknown';
                        let responseTime = null;
                        let sslExpiryAt;
                        let sslIssuer;
                        let sslSubject;
                        switch (device.check_type) {
                            case 'ssl': {
                                const port = device.port || 443;
                                const result = await checkSsl(target, logger, port, device.ssl_expiry_warn_days || 30);
                                status = result.status;
                                responseTime = result.response_time_ms;
                                sslExpiryAt = result.ssl_expiry_at;
                                sslIssuer = result.ssl_issuer;
                                sslSubject = result.ssl_subject;
                                break;
                            }
                            case 'dns': {
                                const result = await checkDns(target, logger, device.dns_expected_ip);
                                status = result.status;
                                responseTime = result.response_time_ms;
                                break;
                            }
                            case 'http': {
                                const url = device.url || `https://${target}`;
                                const result = await checkHttp(url, logger);
                                status = result.status;
                                responseTime = result.response_time_ms;
                                break;
                            }
                            case 'tcp': {
                                const port = device.port || 443;
                                const result = await checkTcpPort(target, port, logger);
                                status = result.status;
                                responseTime = result.response_time_ms;
                                break;
                            }
                            case 'ping':
                            default: {
                                const result = await pingHost(target, logger);
                                status = result.status;
                                responseTime = result.response_time_ms;
                                break;
                            }
                        }
                        reports.push({
                            device_id: device.id,
                            ip_address: device.ip_address || target,
                            status,
                            response_time_ms: responseTime,
                            check_type: device.check_type,
                            checked_at: new Date().toISOString(),
                            ssl_expiry_at: sslExpiryAt,
                            ssl_issuer: sslIssuer,
                            ssl_subject: sslSubject,
                        });
                        logger.debug(`Remote check ${target} (${device.check_type}): ${status}`);
                    }
                    catch (err) {
                        logger.error(`Remote check failed for ${target}: ${err instanceof Error ? err.message : 'Unknown'}`);
                    }
                }
                // Upload status reports
                if (reports.length > 0) {
                    const response = await client.uploadStatusReports(reports);
                    logger.debug(`Remote monitor: ${response.processed} reports uploaded`);
                }
                // Prune stale entries
                const activeIds = new Set(remoteDevices.map(d => d.id));
                for (const id of remoteDeviceLastCheck.keys()) {
                    if (!activeIds.has(id))
                        remoteDeviceLastCheck.delete(id);
                }
            }
            catch (error) {
                logger.error(`Remote monitor error: ${error instanceof Error ? error.message : 'Unknown'}`);
            }
            // Short sleep between iterations
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    /**
     * Auto-scan - detect and register local network if no segments assigned
     */
    async function autoScanCheck() {
        // Wait for first heartbeat
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (!config.enableAutoScan) {
            return;
        }
        // Check if we have any segments
        if (segmentStates.size === 0) {
            logger.info('No segments assigned - attempting auto-detection');
            const localNetwork = getPrimaryLocalNetwork();
            if (localNetwork) {
                const segmentName = generateAutoSegmentName(localNetwork);
                logger.info(`Detected local network: ${segmentName}`);
                try {
                    const segment = await client.registerAutoSegment({
                        cidr: localNetwork.cidr,
                        name: segmentName,
                        interface_name: localNetwork.interfaceName,
                    });
                    logger.info(`Auto-registered segment: ${segment.name}`);
                    segmentStates.set(segment.id, {
                        segment,
                        lastScan: 0,
                        scanning: false,
                    });
                }
                catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    logger.warn(`Failed to register auto-segment: ${errorMsg}`);
                }
            }
            else {
                logger.warn('Could not detect local network for auto-scan');
            }
        }
    }
    /**
     * Process commands received from the dashboard
     */
    async function processCommands(commands) {
        for (const command of commands) {
            if (command.status !== 'pending')
                continue;
            logger.info(`Processing command: ${command.command_type} (${command.id})`);
            try {
                switch (command.command_type) {
                    case 'ping': {
                        // Respond with pong and latency
                        const result = await client.sendPong(command.id);
                        logger.info(`Ping response sent, latency: ${result.latency_ms}ms`);
                        // Pong acknowledgement is handled by the ping endpoint
                        break;
                    }
                    case 'scan_now': {
                        // Trigger immediate scan of all segments
                        logger.info('Executing scan_now command');
                        let segmentsScanned = 0;
                        let devicesFound = 0;
                        for (const [, state] of segmentStates) {
                            if (state.scanning)
                                continue;
                            state.scanning = true;
                            try {
                                const devices = await discoverDevices(state.segment.cidr, logger);
                                devicesFound += devices.length;
                                if (devices.length > 0) {
                                    await client.uploadDiscoveredDevices(state.segment.id, devices);
                                }
                                segmentsScanned++;
                            }
                            finally {
                                state.scanning = false;
                            }
                        }
                        await client.acknowledgeCommand(command.id, true, {
                            segments_scanned: segmentsScanned,
                            devices_found: devicesFound,
                        });
                        logger.info(`scan_now completed: ${segmentsScanned} segments, ${devicesFound} devices`);
                        break;
                    }
                    case 'scan_segment': {
                        // Scan a specific segment
                        const segmentId = command.payload?.segment_id;
                        if (!segmentId) {
                            await client.acknowledgeCommand(command.id, false, undefined, 'segment_id required');
                            break;
                        }
                        const state = segmentStates.get(segmentId);
                        if (!state) {
                            await client.acknowledgeCommand(command.id, false, undefined, 'Segment not found');
                            break;
                        }
                        if (state.scanning) {
                            await client.acknowledgeCommand(command.id, false, undefined, 'Segment already scanning');
                            break;
                        }
                        state.scanning = true;
                        try {
                            const devices = await discoverDevices(state.segment.cidr, logger);
                            if (devices.length > 0) {
                                await client.uploadDiscoveredDevices(segmentId, devices);
                            }
                            await client.acknowledgeCommand(command.id, true, {
                                segment_id: segmentId,
                                devices_found: devices.length,
                            });
                            logger.info(`scan_segment completed: ${devices.length} devices found`);
                        }
                        finally {
                            state.scanning = false;
                        }
                        break;
                    }
                    case 'restart': {
                        // Acknowledge first, then restart
                        logger.info('Executing restart command');
                        await client.acknowledgeCommand(command.id, true, { restarting: true });
                        // Give time for acknowledgment to be sent
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        logger.info('Restarting agent...');
                        process.exit(0); // Rely on process manager (systemd/pm2) to restart
                        break;
                    }
                    case 'upgrade': {
                        const targetVersion = command.payload?.target_version;
                        const downloadUrl = command.payload?.download_url;
                        logger.info(`Upgrade requested: ${VERSION} -> ${targetVersion}`);
                        if (!targetVersion || !downloadUrl) {
                            await client.acknowledgeCommand(command.id, false, undefined, 'target_version and download_url required');
                            break;
                        }
                        // Check if auto-upgrade is allowed for this version
                        if (!config.enableAutoUpgrade) {
                            logger.warn('Auto-upgrade is disabled. Set ENABLE_AUTO_UPGRADE=true to allow.');
                            await client.acknowledgeCommand(command.id, true, {
                                current_version: VERSION,
                                target_version: targetVersion,
                                message: 'Auto-upgrade disabled - manual upgrade required',
                            });
                            break;
                        }
                        if (!shouldAutoUpgrade(targetVersion, VERSION, config.autoUpgradeOnMinor)) {
                            logger.warn(`Auto-upgrade policy blocks ${VERSION} -> ${targetVersion}`);
                            await client.acknowledgeCommand(command.id, true, {
                                current_version: VERSION,
                                target_version: targetVersion,
                                message: 'Upgrade blocked by policy (major version change)',
                            });
                            break;
                        }
                        // Acknowledge before starting (upgrade may exit the process)
                        await client.acknowledgeCommand(command.id, true, {
                            current_version: VERSION,
                            target_version: targetVersion,
                            message: 'Upgrade starting...',
                        });
                        // Perform the upgrade (this may exit the process)
                        const result = await performUpgrade(targetVersion, downloadUrl, logger);
                        if (!result.success) {
                            logger.error(`Upgrade failed: ${result.message}`);
                            // Process didn't exit, so the upgrade failed before the swap
                        }
                        break;
                    }
                    case 'update_config': {
                        const updates = command.payload ?? {};
                        const applied = {};
                        if (typeof updates.heartbeatInterval === 'number' && updates.heartbeatInterval >= 10) {
                            config.heartbeatInterval = updates.heartbeatInterval * 1000;
                            applied.heartbeatInterval = updates.heartbeatInterval;
                        }
                        if (typeof updates.statusCheckInterval === 'number' && updates.statusCheckInterval >= 5) {
                            config.statusCheckInterval = updates.statusCheckInterval * 1000;
                            applied.statusCheckInterval = updates.statusCheckInterval;
                        }
                        if (typeof updates.statusFailureThreshold === 'number' && updates.statusFailureThreshold >= 0) {
                            config.statusFailureThreshold = updates.statusFailureThreshold;
                            applied.statusFailureThreshold = updates.statusFailureThreshold;
                        }
                        if (typeof updates.logLevel === 'string' && ['debug', 'info', 'warn', 'error'].includes(updates.logLevel)) {
                            config.logLevel = updates.logLevel;
                            applied.logLevel = updates.logLevel;
                        }
                        if (typeof updates.enableAutoScan === 'boolean') {
                            config.enableAutoScan = updates.enableAutoScan;
                            applied.enableAutoScan = updates.enableAutoScan;
                        }
                        if (typeof updates.autoScanInterval === 'number' && updates.autoScanInterval >= 30) {
                            config.autoScanInterval = updates.autoScanInterval;
                            applied.autoScanInterval = updates.autoScanInterval;
                        }
                        logger.info(`Config updated: ${JSON.stringify(applied)}`);
                        await client.acknowledgeCommand(command.id, true, { applied });
                        break;
                    }
                    default:
                        logger.warn(`Unknown command type: ${command.command_type}`);
                        await client.acknowledgeCommand(command.id, false, undefined, `Unknown command: ${command.command_type}`);
                }
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                logger.error(`Command ${command.command_type} failed: ${errorMsg}`);
                try {
                    await client.acknowledgeCommand(command.id, false, undefined, errorMsg);
                }
                catch {
                    logger.error(`Failed to acknowledge command failure: ${command.id}`);
                }
            }
        }
    }
    // Start the UI server
    await uiServer.start();
    // Listen for commands from the UI
    uiServer.getIO().on('connection', (socket) => {
        socket.on('command', async (cmd) => {
            logger.info(`UI command received: ${cmd.type}`);
            uiServer.addLog('info', `UI command: ${cmd.type}`);
            try {
                switch (cmd.type) {
                    case 'scan_now': {
                        // Trigger immediate scan of all segments
                        let segmentsScanned = 0;
                        let devicesFound = 0;
                        for (const [, state] of segmentStates) {
                            if (state.scanning)
                                continue;
                            state.scanning = true;
                            uiServer.updateSegmentScanning(state.segment.id, true);
                            try {
                                const devices = await discoverDevices(state.segment.cidr, logger);
                                devicesFound += devices.length;
                                // Update UI with discovered devices (key by IP for consistent lookups)
                                for (const device of devices) {
                                    const deviceKey = device.ip_address;
                                    const existing = discoveredDevices.get(deviceKey);
                                    const deviceInfo = {
                                        id: deviceKey,
                                        name: device.hostname || device.ip_address,
                                        ip: device.ip_address,
                                        mac: device.mac_address,
                                        status: existing?.status || 'unknown',
                                        responseTime: existing?.responseTime,
                                        lastCheck: existing?.lastCheck,
                                    };
                                    discoveredDevices.set(deviceKey, deviceInfo);
                                }
                                uiServer.updateDevices(Array.from(discoveredDevices.values()));
                                if (devices.length > 0) {
                                    await client.uploadDiscoveredDevices(state.segment.id, devices);
                                }
                                segmentsScanned++;
                            }
                            finally {
                                state.scanning = false;
                                uiServer.updateSegmentScanning(state.segment.id, false);
                            }
                        }
                        uiServer.addLog('info', `Scan complete: ${segmentsScanned} segments, ${devicesFound} devices`);
                        break;
                    }
                    case 'ping': {
                        // Ping dashboard
                        const result = await client.sendPong();
                        uiServer.addLog('info', `Ping response: ${result.latency_ms}ms`);
                        break;
                    }
                    default:
                        uiServer.addLog('warn', `Unknown UI command: ${cmd.type}`);
                }
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                uiServer.addLog('error', `Command failed: ${errorMsg}`);
            }
        });
    });
    // Start all loops
    logger.info('Starting agent loops...');
    // Run autoScanCheck once
    autoScanCheck();
    // Start concurrent loops
    Promise.all([
        heartbeatLoop(),
        scanLoop(),
        statusCheckLoop(),
        remoteMonitorLoop(),
    ]).catch(error => {
        logger.error(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
    });
}
// Start the agent
main().catch(error => {
    console.error('Failed to start agent:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map