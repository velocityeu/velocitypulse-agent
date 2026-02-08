import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import path from 'path'

export type Logger = winston.Logger

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    const msg = stack || message
    return `${timestamp} [${level.toUpperCase()}] ${msg}`
  })
)

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`
  })
)

export function createLogger(level: string = 'info', logDir: string = './logs'): Logger {
  const transports: winston.transport[] = [
    // Console transport with colors
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // Daily rotating file transport
    new DailyRotateFile({
      dirname: logDir,
      filename: 'velocitypulse-agent-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '7d',
      format: logFormat,
      zippedArchive: true,
    }),
  ]

  return winston.createLogger({
    level,
    format: logFormat,
    transports,
    exitOnError: false,
  })
}

/**
 * Get the default log directory path
 */
export function getLogDirectory(customDir?: string): string {
  if (customDir) {
    return path.resolve(customDir)
  }
  return path.resolve(process.cwd(), 'logs')
}
