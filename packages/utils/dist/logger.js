"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
const isBrowser = typeof window !== 'undefined' || typeof self !== 'undefined';
/**
 * Creates a logger instance.
 * In Node.js, it creates a Winston logger following RULES O-8001, O-8002, O-8003.
 * In Browser environments, it creates a simplified console-based logger.
 *
 * @param {string} logDir - Directory for log files (Node.js only)
 * @param {string} level - Log level (error, warn, info, debug)
 * @returns {GenericLogger} Configured logger instance
 */
function createLogger(logDir, level = 'info') {
    if (isBrowser) {
        return {
            error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
            warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
            info: (msg, ...args) => console.info(`[INFO] ${msg}`, ...args),
            debug: (msg, ...args) => console.debug(`[DEBUG] ${msg}`, ...args),
        };
    }
    // Node-only imports
    // Using dynamic require or similar if needed, but since this is compiled with TS/Vite,
    // we can use standard imports if we ensure they don't leak to browser bundle or use aliases.
    // However, Vite's build error suggests we need to be careful.
    // A safer way is to use a separate file for Node logger or guard imports if possible.
    // Since we are fixing a build that ALREADY fails because of these imports, 
    // we must ensure they are NOT at the top level if we want to avoid the error.
    // For simplicity and immediate fix of the build error:
    // We'll use a dynamic import approach if supported, or just return the console logger 
    // if winston is missing (which it will be in the browser if not bundled).
    try {
        // In many build tools, even inside a try-catch, static imports are tracked.
        // However, if we are in Node, we expect winston and path to be available.
        // If we are in Vite (browser), we've already returned above.
        // NOTE: This file is currently being imported by the extension via Vite.
        // To fix the extension build, we MUST remove the top-level imports that Vite is trying to resolve.
        // We'll use require here because it's more resilient in some build configurations,
        // though for ESM we might need to be more clever.
        // But since the error specifically mentioned vite failing to resolve 'fs' for winston,
        // we need to hide winston from the browser build.
        // Actually, the best way for Vite is to use define to mock modules or alias them.
        // But changing the code to not import them at top level is safer.
        const winston = require('winston');
        const path = require('node:path');
        return winston.createLogger({
            level,
            format: winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.errors({ stack: true }), winston.format.json()),
            transports: [
                new winston.transports.File({
                    filename: path.join(logDir, 'error.log'),
                    level: 'error',
                }),
                new winston.transports.File({
                    filename: path.join(logDir, 'combined.log'),
                }),
                new winston.transports.Console({
                    format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
                    level: level,
                }),
            ],
        });
    }
    catch (e) {
        // Fallback if Node modules are missing (e.g. some hybrid envs)
        return {
            error: (msg, ...args) => console.error(msg, ...args),
            warn: (msg, ...args) => console.warn(msg, ...args),
            info: (msg, ...args) => console.info(msg, ...args),
            debug: (msg, ...args) => console.debug(msg, ...args),
        };
    }
}
exports.logger = createLogger((typeof process !== 'undefined' && process.env.LOG_DIR) || './logs', (typeof process !== 'undefined' && process.env.LOG_LEVEL) || 'info');
