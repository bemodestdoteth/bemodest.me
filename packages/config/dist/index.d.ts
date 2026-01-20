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
    CORS_ORIGIN: z.ZodDefault<z.ZodString>;
    RATE_LIMIT_WINDOW_MS: z.ZodDefault<z.ZodString>;
    RATE_LIMIT_MAX: z.ZodDefault<z.ZodString>;
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
    CORS_ORIGIN: string;
    RATE_LIMIT_WINDOW_MS: string;
    RATE_LIMIT_MAX: string;
}, {
    MONGO_USER: string;
    MONGO_PASSWORD: string;
    MONGO_HOST: string;
    MONGO_DB_NAME: string;
    JWT_SECRET: string;
    NODE_ENV?: "dev" | "prod" | "test" | undefined;
    MONGO_PORT?: string | undefined;
    PORT?: string | undefined;
    LOG_LEVEL?: "error" | "warn" | "info" | "debug" | undefined;
    CORS_ORIGIN?: string | undefined;
    RATE_LIMIT_WINDOW_MS?: string | undefined;
    RATE_LIMIT_MAX?: string | undefined;
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
