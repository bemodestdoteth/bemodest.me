import { z } from 'zod';
/**
 * Web app environment configuration schema
 * @description Validates environment variables for Next.js app following RULES S-3001
 */
declare const WebConfigSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<["dev", "prod", "test"]>>;
    MONGO_USER: z.ZodString;
    MONGO_PASSWORD: z.ZodString;
    MONGO_HOST: z.ZodString;
    MONGO_PORT: z.ZodDefault<z.ZodString>;
    MONGO_DB_NAME: z.ZodString;
    JWT_SECRET: z.ZodString;
    ADMIN_USERNAME: z.ZodString;
    ADMIN_PASSWORD_HASH: z.ZodString;
    PORT: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    NODE_ENV: "dev" | "prod" | "test";
    MONGO_USER: string;
    MONGO_PASSWORD: string;
    MONGO_HOST: string;
    MONGO_PORT: string;
    MONGO_DB_NAME: string;
    JWT_SECRET: string;
    ADMIN_USERNAME: string;
    ADMIN_PASSWORD_HASH: string;
    PORT: string;
}, {
    MONGO_USER: string;
    MONGO_PASSWORD: string;
    MONGO_HOST: string;
    MONGO_DB_NAME: string;
    JWT_SECRET: string;
    ADMIN_USERNAME: string;
    ADMIN_PASSWORD_HASH: string;
    NODE_ENV?: "dev" | "prod" | "test" | undefined;
    MONGO_PORT?: string | undefined;
    PORT?: string | undefined;
}>;
/**
 * API server environment configuration schema
 */
declare const ApiConfigSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<["dev", "prod", "test"]>>;
    PORT: z.ZodDefault<z.ZodString>;
    MONGO_USER: z.ZodString;
    MONGO_PASSWORD: z.ZodString;
    MONGO_HOST: z.ZodString;
    MONGO_PORT: z.ZodDefault<z.ZodString>;
    MONGO_DB_NAME: z.ZodString;
    JWT_SECRET: z.ZodString;
    LOG_LEVEL: z.ZodDefault<z.ZodEnum<["error", "warn", "info", "debug"]>>;
    LOGFILE: z.ZodDefault<z.ZodString>;
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    RATE_LIMIT_WINDOW_MS: z.ZodDefault<z.ZodString>;
    RATE_LIMIT_MAX: z.ZodDefault<z.ZodString>;
    CHROME_EXTENSION_ID: z.ZodOptional<z.ZodString>;
    COLLECTION_ADDRS: z.ZodDefault<z.ZodString>;
    COLLECTION_CHAINS: z.ZodDefault<z.ZodString>;
    COLLECTION_ENTITES: z.ZodDefault<z.ZodString>;
    COLLECTION_COINGECKO_RANK: z.ZodDefault<z.ZodString>;
    COLLECTION_COINGECKO_LIST: z.ZodDefault<z.ZodString>;
    COLLECTION_ALERT_RULES: z.ZodDefault<z.ZodString>;
    COLLECTION_CONTRACT_MAPPINGS: z.ZodDefault<z.ZodString>;
    MONGODB_MAX_TIME_MS: z.ZodDefault<z.ZodString>;
    ADMIN_USERNAME: z.ZodOptional<z.ZodString>;
    ADMIN_PASSWORD_HASH: z.ZodOptional<z.ZodString>;
    JWT_EXPIRES_IN_WEB: z.ZodDefault<z.ZodString>;
    JWT_EXPIRES_IN_EXTENSION: z.ZodDefault<z.ZodString>;
    COOKIE_NAME: z.ZodDefault<z.ZodString>;
    COOKIE_MAX_AGE_MS: z.ZodDefault<z.ZodString>;
    COOKIE_SAME_SITE: z.ZodDefault<z.ZodString>;
    SIDECAR_URL: z.ZodOptional<z.ZodString>;
    SNAPPER_API_SECRET: z.ZodOptional<z.ZodString>;
    PROXY_URL: z.ZodOptional<z.ZodString>;
    REDIS_HOST: z.ZodOptional<z.ZodString>;
    REDIS_PORT: z.ZodDefault<z.ZodString>;
    REDIS_PASSWORD: z.ZodOptional<z.ZodString>;
    INFURA_KEY: z.ZodOptional<z.ZodString>;
    ETHERSCAN_KEY: z.ZodOptional<z.ZodString>;
    STATS_CUTOFF_MS: z.ZodDefault<z.ZodString>;
    IMAGE_SIZE_LIMIT_BYTES: z.ZodDefault<z.ZodString>;
    DW_TASKS_STREAM: z.ZodDefault<z.ZodString>;
    DW_STATUS_TTL_S: z.ZodDefault<z.ZodString>;
    DEX_POLL_WORKERS: z.ZodDefault<z.ZodString>;
    DEX_REDIS_CHANNEL: z.ZodDefault<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    NODE_ENV: "dev" | "prod" | "test";
    MONGO_USER: string;
    MONGO_PASSWORD: string;
    MONGO_HOST: string;
    MONGO_PORT: string;
    MONGO_DB_NAME: string;
    JWT_SECRET: string;
    PORT: string;
    LOG_LEVEL: "error" | "warn" | "info" | "debug";
    LOGFILE: string;
    CORS_ORIGIN: string;
    RATE_LIMIT_WINDOW_MS: string;
    RATE_LIMIT_MAX: string;
    COLLECTION_ADDRS: string;
    COLLECTION_CHAINS: string;
    COLLECTION_ENTITES: string;
    COLLECTION_COINGECKO_RANK: string;
    COLLECTION_COINGECKO_LIST: string;
    COLLECTION_ALERT_RULES: string;
    COLLECTION_CONTRACT_MAPPINGS: string;
    MONGODB_MAX_TIME_MS: string;
    JWT_EXPIRES_IN_WEB: string;
    JWT_EXPIRES_IN_EXTENSION: string;
    COOKIE_NAME: string;
    COOKIE_MAX_AGE_MS: string;
    COOKIE_SAME_SITE: string;
    REDIS_PORT: string;
    STATS_CUTOFF_MS: string;
    IMAGE_SIZE_LIMIT_BYTES: string;
    DW_TASKS_STREAM: string;
    DW_STATUS_TTL_S: string;
    DEX_POLL_WORKERS: string;
    DEX_REDIS_CHANNEL: string;
    ADMIN_USERNAME?: string | undefined;
    ADMIN_PASSWORD_HASH?: string | undefined;
    CHROME_EXTENSION_ID?: string | undefined;
    SIDECAR_URL?: string | undefined;
    SNAPPER_API_SECRET?: string | undefined;
    PROXY_URL?: string | undefined;
    REDIS_HOST?: string | undefined;
    REDIS_PASSWORD?: string | undefined;
    INFURA_KEY?: string | undefined;
    ETHERSCAN_KEY?: string | undefined;
}, {
    MONGO_USER: string;
    MONGO_PASSWORD: string;
    MONGO_HOST: string;
    MONGO_DB_NAME: string;
    JWT_SECRET: string;
    NODE_ENV?: "dev" | "prod" | "test" | undefined;
    MONGO_PORT?: string | undefined;
    ADMIN_USERNAME?: string | undefined;
    ADMIN_PASSWORD_HASH?: string | undefined;
    PORT?: string | undefined;
    LOG_LEVEL?: "error" | "warn" | "info" | "debug" | undefined;
    LOGFILE?: string | undefined;
    CORS_ORIGIN?: string | undefined;
    RATE_LIMIT_WINDOW_MS?: string | undefined;
    RATE_LIMIT_MAX?: string | undefined;
    CHROME_EXTENSION_ID?: string | undefined;
    COLLECTION_ADDRS?: string | undefined;
    COLLECTION_CHAINS?: string | undefined;
    COLLECTION_ENTITES?: string | undefined;
    COLLECTION_COINGECKO_RANK?: string | undefined;
    COLLECTION_COINGECKO_LIST?: string | undefined;
    COLLECTION_ALERT_RULES?: string | undefined;
    COLLECTION_CONTRACT_MAPPINGS?: string | undefined;
    MONGODB_MAX_TIME_MS?: string | undefined;
    JWT_EXPIRES_IN_WEB?: string | undefined;
    JWT_EXPIRES_IN_EXTENSION?: string | undefined;
    COOKIE_NAME?: string | undefined;
    COOKIE_MAX_AGE_MS?: string | undefined;
    COOKIE_SAME_SITE?: string | undefined;
    SIDECAR_URL?: string | undefined;
    SNAPPER_API_SECRET?: string | undefined;
    PROXY_URL?: string | undefined;
    REDIS_HOST?: string | undefined;
    REDIS_PORT?: string | undefined;
    REDIS_PASSWORD?: string | undefined;
    INFURA_KEY?: string | undefined;
    ETHERSCAN_KEY?: string | undefined;
    STATS_CUTOFF_MS?: string | undefined;
    IMAGE_SIZE_LIMIT_BYTES?: string | undefined;
    DW_TASKS_STREAM?: string | undefined;
    DW_STATUS_TTL_S?: string | undefined;
    DEX_POLL_WORKERS?: string | undefined;
    DEX_REDIS_CHANNEL?: string | undefined;
}>;
export type WebConfig = z.infer<typeof WebConfigSchema>;
export type ApiConfig = z.infer<typeof ApiConfigSchema>;
/**
 * Validates and returns web app configuration
 * @returns {WebConfig} Validated configuration object
 * @throws {z.ZodError} If environment variables are invalid
 * @example
 * const config = validateWebConfig();
 * console.log(config.MONGO_HOST);
 */
export declare function validateWebConfig(): WebConfig;
/**
 * Validates and returns API server configuration
 * @returns {ApiConfig} Validated configuration object
 * @throws {z.ZodError} If environment variables are invalid
 * @example
 * const config = validateApiConfig();
 * console.log(config.PORT);
 */
export declare function validateApiConfig(): ApiConfig;
/**
 * Encodes database password for URI following RULES S-3002
 * @param {string} password - Raw password string
 * @returns {string} URL-encoded password
 * @example
 * const encoded = encodeDbPassword('my@pass#word');
 */
export declare function encodeDbPassword(password: string): string;
export {};
