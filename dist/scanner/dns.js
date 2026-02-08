import * as dns from 'dns';
/**
 * Check DNS resolution for a hostname.
 * Uses Node.js native dns module - no external dependencies.
 *
 * Returns:
 * - online: hostname resolves successfully (and matches expected IP if provided)
 * - degraded: hostname resolves but to unexpected IP
 * - offline: DNS resolution failed
 */
export async function checkDns(hostname, logger, expectedIp, timeout = 10000) {
    const startTime = Date.now();
    const resolver = new dns.promises.Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']); // Use well-known DNS servers
    try {
        // Set a timeout using AbortController
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        let addresses;
        try {
            addresses = await dns.promises.resolve4(hostname);
        }
        finally {
            clearTimeout(timer);
        }
        const responseTime = Date.now() - startTime;
        if (!addresses || addresses.length === 0) {
            logger.debug(`DNS ${hostname}: no records found`);
            return {
                hostname,
                status: 'offline',
                response_time_ms: responseTime,
                error: 'No A records found',
            };
        }
        logger.debug(`DNS ${hostname}: resolved to ${addresses.join(', ')} (${responseTime}ms)`);
        // Check expected IP match if provided
        if (expectedIp) {
            const matches = addresses.includes(expectedIp);
            if (!matches) {
                logger.debug(`DNS ${hostname}: expected ${expectedIp}, got ${addresses.join(', ')}`);
                return {
                    hostname,
                    status: 'degraded',
                    response_time_ms: responseTime,
                    resolved_ips: addresses,
                    expected_ip_match: false,
                };
            }
            return {
                hostname,
                status: 'online',
                response_time_ms: responseTime,
                resolved_ips: addresses,
                expected_ip_match: true,
            };
        }
        return {
            hostname,
            status: 'online',
            response_time_ms: responseTime,
            resolved_ips: addresses,
        };
    }
    catch (error) {
        const responseTime = Date.now() - startTime;
        let errorMsg;
        if (error instanceof Error) {
            if (error.message.includes('ENOTFOUND') || error.message.includes('NXDOMAIN')) {
                errorMsg = 'Domain not found';
            }
            else if (error.message.includes('TIMEOUT') || error.message.includes('abort')) {
                errorMsg = 'DNS lookup timeout';
            }
            else if (error.message.includes('SERVFAIL')) {
                errorMsg = 'DNS server failure';
            }
            else {
                errorMsg = error.message;
            }
        }
        else {
            errorMsg = 'Unknown DNS error';
        }
        logger.debug(`DNS ${hostname}: failed - ${errorMsg}`);
        return {
            hostname,
            status: 'offline',
            response_time_ms: responseTime > timeout ? null : responseTime,
            error: errorMsg,
        };
    }
}
//# sourceMappingURL=dns.js.map