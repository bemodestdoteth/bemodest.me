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
  LOGFILE: z.string().default('./logs/api.log'),
  CORS_ORIGIN: z.string().default('http://localhost:25833'),
  RATE_LIMIT_WINDOW_MS: z.string().default('900000'),
  RATE_LIMIT_MAX: z.string().default('100'),
  CHROME_EXTENSION_ID: z.string().optional(),
  COLLECTION_ADDRS: z.string().default('labelAddrs'),
  COLLECTION_CHAINS: z.string().default('chains'),
  COLLECTION_ENTITES: z.string().default('labelEntities'),
  COLLECTION_COINGECKO_RANK: z.string().default('coingeckoTop2000'),
  COLLECTION_COINGECKO_LIST: z.string().default('coingeckoCoinList'),
  COLLECTION_ALERT_RULES: z.string().default('alertRules'),
  COLLECTION_CONTRACT_MAPPINGS: z.string().default('coingeckoContractMappings'),
  MONGODB_MAX_TIME_MS: z.string().default('30000'),
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  JWT_EXPIRES_IN_WEB: z.string().default('7d'),
  JWT_EXPIRES_IN_EXTENSION: z.string().default('30d'),
  COOKIE_NAME: z.string().default('auth-token'),
  COOKIE_MAX_AGE_MS: z.string().default('604800000'),
  COOKIE_SAME_SITE: z.string().default('lax'),
  SIDECAR_URL: z.string().optional(),
  SNAPPER_API_SECRET: z.string().optional(),
  PROXY_URL: z.string().optional(),
  REDIS_HOST: z.string().optional(),
  REDIS_PORT: z.string().default('6380'),
  REDIS_PASSWORD: z.string().optional(),
  INFURA_KEY: z.string().optional(),
  ETHERSCAN_KEY: z.string().optional(),
  STATS_CUTOFF_MS: z.string().default('60000'),
  IMAGE_SIZE_LIMIT_BYTES: z.string().default('1048576'),
  DW_TASKS_STREAM: z.string().default('dw_tasks'),
  DW_STATUS_TTL_S: z.string().default('86400'),
  DEX_POLL_WORKERS: z.string().default('3'),
  DEX_REDIS_CHANNEL: z.string().default('dex_prices'),
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
