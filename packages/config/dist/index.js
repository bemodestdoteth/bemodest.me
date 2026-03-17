"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWebConfig = validateWebConfig;
exports.validateApiConfig = validateApiConfig;
exports.encodeDbPassword = encodeDbPassword;
const zod_1 = require("zod");
/**
 * Web app environment configuration schema
 * @description Validates environment variables for Next.js app following RULES S-3001
 */
const WebConfigSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['dev', 'prod', 'test']).default('dev'),
    MONGO_USER: zod_1.z.string().min(1),
    MONGO_PASSWORD: zod_1.z.string().min(1),
    MONGO_HOST: zod_1.z.string().min(1),
    MONGO_PORT: zod_1.z.string().default('27017'),
    MONGO_DB_NAME: zod_1.z.string().min(1),
    JWT_SECRET: zod_1.z.string().min(32),
    ADMIN_USERNAME: zod_1.z.string().min(1),
    ADMIN_PASSWORD_HASH: zod_1.z.string().min(1),
    PORT: zod_1.z.string().default('3000'),
});
/**
 * API server environment configuration schema
 */
const ApiConfigSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['dev', 'prod', 'test']).default('dev'),
    PORT: zod_1.z.string().default('3001'),
    MONGO_USER: zod_1.z.string().min(1),
    MONGO_PASSWORD: zod_1.z.string().min(1),
    MONGO_HOST: zod_1.z.string().min(1),
    MONGO_PORT: zod_1.z.string().default('27017'),
    MONGO_DB_NAME: zod_1.z.string().min(1),
    JWT_SECRET: zod_1.z.string().min(32),
    LOG_LEVEL: zod_1.z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    LOGFILE: zod_1.z.string().default('./logs/api.log'),
    CORS_ORIGIN: zod_1.z.string().default('http://localhost:25833'),
    RATE_LIMIT_WINDOW_MS: zod_1.z.string().default('900000'),
    RATE_LIMIT_MAX: zod_1.z.string().default('100'),
    CHROME_EXTENSION_ID: zod_1.z.string().optional(),
    COLLECTION_ADDRS: zod_1.z.string().default('labelAddrs'),
    COLLECTION_CHAINS: zod_1.z.string().default('chains'),
    COLLECTION_ENTITES: zod_1.z.string().default('labelEntities'),
    COLLECTION_COINGECKO_RANK: zod_1.z.string().default('coingeckoTop2000'),
    COLLECTION_COINGECKO_LIST: zod_1.z.string().default('coingeckoCoinList'),
    COLLECTION_ALERT_RULES: zod_1.z.string().default('alertRules'),
    COLLECTION_CONTRACT_MAPPINGS: zod_1.z.string().default('coingeckoContractMappings'),
    MONGODB_MAX_TIME_MS: zod_1.z.string().default('30000'),
    ADMIN_USERNAME: zod_1.z.string().optional(),
    ADMIN_PASSWORD_HASH: zod_1.z.string().optional(),
    JWT_EXPIRES_IN_WEB: zod_1.z.string().default('7d'),
    JWT_EXPIRES_IN_EXTENSION: zod_1.z.string().default('30d'),
    COOKIE_NAME: zod_1.z.string().default('auth-token'),
    COOKIE_MAX_AGE_MS: zod_1.z.string().default('604800000'),
    COOKIE_SAME_SITE: zod_1.z.string().default('lax'),
    SIDECAR_URL: zod_1.z.string().optional(),
    SNAPPER_API_SECRET: zod_1.z.string().optional(),
    PROXY_URL: zod_1.z.string().optional(),
    REDIS_HOST: zod_1.z.string().optional(),
    REDIS_PORT: zod_1.z.string().default('6380'),
    REDIS_PASSWORD: zod_1.z.string().optional(),
    INFURA_KEY: zod_1.z.string().optional(),
    ETHERSCAN_KEY: zod_1.z.string().optional(),
    STATS_CUTOFF_MS: zod_1.z.string().default('60000'),
    IMAGE_SIZE_LIMIT_BYTES: zod_1.z.string().default('1048576'),
    DW_TASKS_STREAM: zod_1.z.string().default('dw_tasks'),
    DW_STATUS_TTL_S: zod_1.z.string().default('86400'),
    DEX_POLL_WORKERS: zod_1.z.string().default('3'),
    DEX_REDIS_CHANNEL: zod_1.z.string().default('dex_price_updates'),
});
/**
 * Validates and returns web app configuration
 * @returns {WebConfig} Validated configuration object
 * @throws {z.ZodError} If environment variables are invalid
 * @example
 * const config = validateWebConfig();
 * console.log(config.MONGO_HOST);
 */
function validateWebConfig() {
    try {
        return WebConfigSchema.parse(process.env);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
            throw new Error(`Invalid web configuration: ${issues}`);
        }
        throw error;
    }
}
/**
 * Validates and returns API server configuration
 * @returns {ApiConfig} Validated configuration object
 * @throws {z.ZodError} If environment variables are invalid
 * @example
 * const config = validateApiConfig();
 * console.log(config.PORT);
 */
function validateApiConfig() {
    try {
        return ApiConfigSchema.parse(process.env);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
            throw new Error(`Invalid API configuration: ${issues}`);
        }
        throw error;
    }
}
/**
 * Encodes database password for URI following RULES S-3002
 * @param {string} password - Raw password string
 * @returns {string} URL-encoded password
 * @example
 * const encoded = encodeDbPassword('my@pass#word');
 */
function encodeDbPassword(password) {
    return encodeURIComponent(password);
}
