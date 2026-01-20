import winston from 'winston';
import path from 'node:path';

/**
 * Creates Winston logger instance following RULES O-8001, O-8002, O-8003
 * @param {string} logDir - Directory for log files
 * @param {string} level - Log level (error, warn, info, debug)
 * @returns {winston.Logger} Configured Winston logger
 * @example
 * const logger = createLogger('./logs', 'info');
 * logger.info('Server started', { port: 3000 });
 */
export function createLogger(logDir: string, level: string = 'info'): winston.Logger {
  const logger = winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [
      // Error logs: errors only
      new winston.transports.File({
        filename: path.join(logDir, 'error.log'),
        level: 'error',
      }),
      // Combined logs: all levels
      new winston.transports.File({
        filename: path.join(logDir, 'combined.log'),
      }),
      // Console: colorized for development
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        ),
        level: 'warn', // Console shows warn and error only
      }),
    ],
  });

  return logger;
}
