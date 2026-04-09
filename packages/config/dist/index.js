"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWebConfig = validateWebConfig;
exports.validateApiConfig = validateApiConfig;
exports.encodeDbPassword = encodeDbPassword;
const zod_1 = require("zod");
const types_1 = require("@bemodest/types");
/**
 * Web app environment configuration schema
 */
const WebConfigSchema = types_1.SystemConfigSchema.extend({
    ADMIN_USERNAME: zod_1.z.string().min(1),
    ADMIN_PASSWORD_HASH: zod_1.z.string().min(1),
});
/**
 * API server environment configuration schema
 */
const ApiConfigSchema = types_1.SystemConfigSchema.extend({
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
    COLLECTION_ALERT_LOGS: zod_1.z.string().default('alertLogs'),
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
    PROXY_URL: zod_1.z.string().optional(),
    INFURA_KEY: zod_1.z.string().optional(),
    ETHERSCAN_KEY: zod_1.z.string().optional(),
    STATS_CUTOFF_MS: zod_1.z.string().default('60000'),
    IMAGE_SIZE_LIMIT_BYTES: zod_1.z.string().default('1048576'),
    DW_TASKS_STREAM: zod_1.z.string().default('dw_tasks'),
    DW_STATUS_TTL_S: zod_1.z.string().default('86400'),
    DEX_POLL_WORKERS: zod_1.z.string().default('3'),
});
function transformEnvToConfig(env) {
    const config = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) {
            // Type casting for numeric fields (Schema now uses UPPERCASE)
            if (['PORT', 'API_PORT', 'SIDECAR_PORT', 'BATCHING_DURATION_MS', 'FILTER_MIN_SOURCES'].includes(key)) {
                config[key] = parseInt(value, 10);
            }
            else if (['FILTER_MIN_SPREAD_PCT'].includes(key)) {
                config[key] = parseFloat(value);
            }
            else {
                config[key] = value;
            }
        }
    }
    return config;
}
function validateWebConfig() {
    try {
        return WebConfigSchema.parse(transformEnvToConfig(process.env));
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
            throw new Error(`Invalid web configuration: ${issues}`);
        }
        throw error;
    }
}
function validateApiConfig() {
    try {
        return ApiConfigSchema.parse(transformEnvToConfig(process.env));
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
            throw new Error(`Invalid API configuration: ${issues}`);
        }
        throw error;
    }
}
function encodeDbPassword(password) {
    return encodeURIComponent(password);
}
//# sourceMappingURL=index.js.map