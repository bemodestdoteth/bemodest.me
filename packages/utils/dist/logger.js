"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
const winston_1 = __importDefault(require("winston"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Creates Winston logger instance following RULES O-8001, O-8002, O-8003
 * @param {string} logDir - Directory for log files
 * @param {string} level - Log level (error, warn, info, debug)
 * @returns {winston.Logger} Configured Winston logger
 * @example
 * const logger = createLogger('./logs', 'info');
 * logger.info('Server started', { port: 3000 });
 */
function createLogger(logDir, level = 'info') {
    const logger = winston_1.default.createLogger({
        level,
        format: winston_1.default.format.combine(winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.json()),
        transports: [
            // Error logs: errors only
            new winston_1.default.transports.File({
                filename: node_path_1.default.join(logDir, 'error.log'),
                level: 'error',
            }),
            // Combined logs: all levels
            new winston_1.default.transports.File({
                filename: node_path_1.default.join(logDir, 'combined.log'),
            }),
            // Console: colorized for development
            new winston_1.default.transports.Console({
                format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple()),
                level: 'warn', // Console shows warn and error only
            }),
        ],
    });
    return logger;
}
exports.logger = createLogger(process.env.LOG_DIR || './logs', process.env.LOG_LEVEL || 'info');
exports.default = exports.logger;
