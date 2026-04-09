import { z } from 'zod';
import { SystemConfigSchema } from '@bemodest/types';


/**
 * Web app environment configuration schema
 */
const WebConfigSchema = SystemConfigSchema.extend({
  ADMIN_USERNAME: z.string().min(1),
  ADMIN_PASSWORD_HASH: z.string().min(1),
});

/**
 * API server environment configuration schema
 */
const ApiConfigSchema = SystemConfigSchema.extend({
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
  COLLECTION_ALERT_LOGS: z.string().default('alertLogs'),
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
  PROXY_URL: z.string().optional(),
  INFURA_KEY: z.string().optional(),
  ETHERSCAN_KEY: z.string().optional(),
  STATS_CUTOFF_MS: z.string().default('60000'),
  IMAGE_SIZE_LIMIT_BYTES: z.string().default('1048576'),
  DW_TASKS_STREAM: z.string().default('dw_tasks'),
  DW_STATUS_TTL_S: z.string().default('86400'),
  DEX_POLL_WORKERS: z.string().default('3'),
});

export type WebConfig = z.infer<typeof WebConfigSchema>;
export type ApiConfig = z.infer<typeof ApiConfigSchema>;

function transformEnvToConfig(env: NodeJS.ProcessEnv): Record<string, any> {
  const config: Record<string, any> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      // Type casting for numeric fields (Schema now uses UPPERCASE)
      if (['PORT', 'API_PORT', 'SIDECAR_PORT', 'BATCHING_DURATION_MS', 'FILTER_MIN_SOURCES'].includes(key)) {
        config[key] = parseInt(value, 10);
      } else if (['FILTER_MIN_SPREAD_PCT'].includes(key)) {
        config[key] = parseFloat(value);
      } else {
        config[key] = value;
      }
    }
  }
  return config;
}


export function validateWebConfig(): WebConfig {
  try {
    return WebConfigSchema.parse(transformEnvToConfig(process.env));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Invalid web configuration: ${issues}`);
    }
    throw error;
  }
}

export function validateApiConfig(): ApiConfig {
  try {
    return ApiConfigSchema.parse(transformEnvToConfig(process.env));
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Invalid API configuration: ${issues}`);
    }
    throw error;
  }
}

export function encodeDbPassword(password: string): string {
  return encodeURIComponent(password);
}

