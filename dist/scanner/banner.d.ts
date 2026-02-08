import type { Logger } from '../utils/logger.js';
export interface BannerResult {
    port: number;
    banner: string;
    service?: string;
}
/**
 * Grab the initial banner from an open TCP port.
 * Many services send identification text on connect (SSH, SMTP, FTP, etc.)
 */
export declare function grabBanner(ip: string, port: number, logger: Logger, timeout?: number): Promise<BannerResult | null>;
/**
 * Grab banners from multiple open ports concurrently
 */
export declare function grabBanners(ip: string, ports: number[], logger: Logger, concurrency?: number): Promise<BannerResult[]>;
/**
 * Identify the service from a banner string
 */
export declare function identifyService(banner: string, port: number): string | undefined;
//# sourceMappingURL=banner.d.ts.map