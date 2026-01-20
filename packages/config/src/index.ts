import { z } from 'zod';

/**
 * Web app environment configuration schema
 * @description Validates environment variables for Next.js app following RULES S-3001
 */
const WebConfigSchema = z.object({
  NODE_ENV: z.enum(['dev', 'prod', 'test']).default('dev'),
  MONGO_USER: z.string().min(1),
  MONGO_PASSWORD: z.string().min(1),
  MONGO_HOST: z.string().min(1),
  MONGO_PORT: z.string().default('27017'),
  MONGO_DB_NAME: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD_HASH: z.string().min(1),
  PORT: z.string().default('3000'),
});

/**
 * API server environment configuration schema
 */
const ApiConfigSchema = z.object({
  NODE_ENV: z.enum(['dev', 'prod', 'test']).default('dev'),
  PORT: z.string().default('3001'),
  MONGO_USER: z.string().min(1),
  MONGO_PASSWORD: z.string().min(1),
  MONGO_HOST: z.string().min(1),
  MONGO_PORT: z.string().default('27017'),
  MONGO_DB_NAME: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:25833'),
  RATE_LIMIT_WINDOW_MS: z.string().default('900000'),
  RATE_LIMIT_MAX: z.string().default('100'),
});

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
export function validateWebConfig(): WebConfig {
  try {
    return WebConfigSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
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
export function validateApiConfig(): ApiConfig {
  try {
    return ApiConfigSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
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
export function encodeDbPassword(password: string): string {
  return encodeURIComponent(password);
}
