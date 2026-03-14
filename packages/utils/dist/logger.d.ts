import winston from 'winston';
/**
 * Creates Winston logger instance following RULES O-8001, O-8002, O-8003
 * @param {string} logDir - Directory for log files
 * @param {string} level - Log level (error, warn, info, debug)
 * @returns {winston.Logger} Configured Winston logger
 * @example
 * const logger = createLogger('./logs', 'info');
 * logger.info('Server started', { port: 3000 });
 */
export declare function createLogger(logDir: string, level?: string): winston.Logger;
export declare const logger: winston.Logger;
export default logger;
