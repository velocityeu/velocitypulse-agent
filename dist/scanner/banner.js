import * as net from 'net';
/**
 * Grab the initial banner from an open TCP port.
 * Many services send identification text on connect (SSH, SMTP, FTP, etc.)
 */
export async function grabBanner(ip, port, logger, timeout = 3000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let data = '';
        socket.setTimeout(timeout);
        socket.on('connect', () => {
            // Some services need a nudge - send HTTP-like probe for HTTP ports
            if ([80, 8080, 8443, 443].includes(port)) {
                socket.write('HEAD / HTTP/1.0\r\nHost: localhost\r\n\r\n');
            }
        });
        socket.on('data', (chunk) => {
            data += chunk.toString('utf-8');
            // Read up to 512 bytes
            if (data.length >= 512) {
                socket.destroy();
            }
        });
        const finish = () => {
            socket.removeAllListeners();
            socket.destroy();
            if (!data) {
                resolve(null);
                return;
            }
            // Clean the banner - first line, trimmed
            const banner = data.split('\n')[0].trim().substring(0, 256);
            const service = identifyService(banner, port);
            logger.debug(`Banner ${ip}:${port}: ${banner.substring(0, 80)}`);
            resolve({
                port,
                banner,
                service,
            });
        };
        socket.on('end', finish);
        socket.on('timeout', finish);
        socket.on('error', () => {
            socket.destroy();
            resolve(null);
        });
        socket.connect(port, ip);
    });
}
/**
 * Grab banners from multiple open ports concurrently
 */
export async function grabBanners(ip, ports, logger, concurrency = 5) {
    const results = [];
    const queue = [...ports];
    const workers = Array(Math.min(concurrency, queue.length))
        .fill(null)
        .map(async () => {
        while (queue.length > 0) {
            const port = queue.shift();
            if (port === undefined)
                break;
            const result = await grabBanner(ip, port, logger);
            if (result)
                results.push(result);
        }
    });
    await Promise.all(workers);
    return results;
}
/**
 * Identify the service from a banner string
 */
export function identifyService(banner, port) {
    const lower = banner.toLowerCase();
    if (lower.startsWith('ssh-'))
        return 'ssh';
    if (lower.includes('220') && (lower.includes('ftp') || port === 21))
        return 'ftp';
    if (lower.includes('220') && (lower.includes('smtp') || lower.includes('mail') || port === 25))
        return 'smtp';
    if (lower.startsWith('http/'))
        return 'http';
    if (lower.includes('mysql'))
        return 'mysql';
    if (lower.includes('postgresql') || lower.includes('postgres'))
        return 'postgresql';
    if (lower.includes('redis'))
        return 'redis';
    if (lower.includes('mongodb') || lower.includes('mongo'))
        return 'mongodb';
    if (lower.includes('microsoft') && lower.includes('sql'))
        return 'mssql';
    if (lower.includes('imap'))
        return 'imap';
    if (lower.includes('pop3') || lower.includes('+ok'))
        return 'pop3';
    if (lower.includes('telnet'))
        return 'telnet';
    if (lower.includes('vnc'))
        return 'vnc';
    if (lower.includes('apache') || lower.includes('nginx') || lower.includes('server:'))
        return 'http';
    return undefined;
}
//# sourceMappingURL=banner.js.map