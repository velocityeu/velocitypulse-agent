import * as tls from 'tls';
/**
 * Check SSL/TLS certificate for a host.
 * Uses Node.js native tls module - no external dependencies.
 *
 * Returns:
 * - online: valid certificate with > warnDays until expiry
 * - degraded: certificate valid but expiring within warnDays
 * - offline: connection failed or certificate expired
 */
export async function checkSsl(hostname, logger, port = 443, warnDays = 30, timeout = 10000) {
    const startTime = Date.now();
    return new Promise((resolve) => {
        const socket = tls.connect({
            host: hostname,
            port,
            servername: hostname, // SNI
            timeout,
            rejectUnauthorized: false, // We want to inspect even expired certs
        }, () => {
            const responseTime = Date.now() - startTime;
            const cert = socket.getPeerCertificate();
            if (!cert || !cert.valid_to) {
                socket.destroy();
                logger.debug(`SSL ${hostname}:${port}: no certificate`);
                resolve({
                    hostname,
                    port,
                    status: 'offline',
                    response_time_ms: responseTime,
                    error: 'No certificate presented',
                });
                return;
            }
            const expiryDate = new Date(cert.valid_to);
            const now = new Date();
            const daysUntilExpiry = Math.floor((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            // Extract issuer and subject info
            const issuer = cert.issuer
                ? Object.entries(cert.issuer).map(([k, v]) => `${k}=${v}`).join(', ')
                : undefined;
            const subject = cert.subject
                ? (cert.subject.CN || Object.entries(cert.subject).map(([k, v]) => `${k}=${v}`).join(', '))
                : undefined;
            socket.destroy();
            let status;
            if (daysUntilExpiry < 0) {
                status = 'offline'; // Expired
                logger.debug(`SSL ${hostname}:${port}: expired ${Math.abs(daysUntilExpiry)} days ago`);
            }
            else if (daysUntilExpiry <= warnDays) {
                status = 'degraded'; // Expiring soon
                logger.debug(`SSL ${hostname}:${port}: expiring in ${daysUntilExpiry} days`);
            }
            else {
                status = 'online';
                logger.debug(`SSL ${hostname}:${port}: valid, expires in ${daysUntilExpiry} days (${responseTime}ms)`);
            }
            resolve({
                hostname,
                port,
                status,
                response_time_ms: responseTime,
                ssl_expiry_at: expiryDate.toISOString(),
                ssl_issuer: issuer,
                ssl_subject: subject,
                days_until_expiry: daysUntilExpiry,
            });
        });
        socket.on('error', (err) => {
            const responseTime = Date.now() - startTime;
            socket.destroy();
            const errorMsg = err.message;
            logger.debug(`SSL ${hostname}:${port}: error - ${errorMsg}`);
            resolve({
                hostname,
                port,
                status: 'offline',
                response_time_ms: responseTime > timeout ? null : responseTime,
                error: errorMsg,
            });
        });
        socket.on('timeout', () => {
            socket.destroy();
            logger.debug(`SSL ${hostname}:${port}: timeout`);
            resolve({
                hostname,
                port,
                status: 'offline',
                response_time_ms: null,
                error: 'Connection timeout',
            });
        });
    });
}
//# sourceMappingURL=ssl.js.map