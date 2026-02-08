import winston from 'winston';
export type Logger = winston.Logger;
export declare function createLogger(level?: string, logDir?: string): Logger;
/**
 * Get the default log directory path
 */
export declare function getLogDirectory(customDir?: string): string;
//# sourceMappingURL=logger.d.ts.map