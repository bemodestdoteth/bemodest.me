/**
 * Interface representing basic logging methods.
 * Matches common winston.Logger methods used in the codebase.
 */
export interface GenericLogger {
    error: (message: string, ...args: unknown[]) => void;
    warn: (message: string, ...args: unknown[]) => void;
    info: (message: string, ...args: unknown[]) => void;
    debug: (message: string, ...args: unknown[]) => void;
}
/**
 * Creates a logger instance.
 * In Node.js, it creates a Winston logger following RULES O-8001, O-8002, O-8003.
 * In Browser environments, it creates a simplified console-based logger.
 *
 * @param {string} logDir - Directory for log files (Node.js only)
 * @param {string} level - Log level (error, warn, info, debug)
 * @returns {GenericLogger} Configured logger instance
 */
export declare function createLogger(logDir: string, level?: string): GenericLogger;
export declare const logger: GenericLogger;
