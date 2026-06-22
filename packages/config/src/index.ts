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
const optionalUrl = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().url().optional(),
);

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
  COLLECTION_ALERT_DESTINATIONS: z.string().default('alertDestinations'),
  COLLECTION_ALERT_LOGS: z.string().default('alertLogs'),
  COLLECTION_FUTURES_POSITIONS: z.string().default('futuresPositions'),
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
  PREMIUM_CANDLES_URL: optionalUrl,
  UPBIT_FOREX_URL: optionalUrl,
  KIS_BASE_URL: optionalUrl,
  KIS_API_STORE_DB: z.string().optional(),
  KIS_API_STORE_COLLECTION: z.string().default('APIs'),
  KIS_API_SERVICE_NAME: z.string().default('KIS'),
  KIS_API_ENVIRONMENT: z.string().default('dev'),
  DB_PASSPHRASE: z.string().optional(),
  KIS_WS_URL: optionalUrl,
  KIS_WS_MOCK_URL: optionalUrl,
  KIS_WS_USE_MOCK: z.string().default('false'),
  KIS_WS_ALLOW_INSECURE: z.string().default('false'),
  KIS_NXT_APPROVAL_BASE_URL: optionalUrl,
  HYNIX_SK_HYNIX_SYMBOL: z.string().default('000660'),
  HYNIX_ETF_SYMBOL: z.string().optional(),
  HYNIX_ETF_NAME: z.string().default('KODEX SK하이닉스단일종목레버리지'),
  HYNIX_NXT_TICK_TIMEOUT_MS: z.string().default('800'),
  HYNIX_NXT_TICK_MAX_AGE_MS: z.string().default('10000'),
  BUILTIN_ALERT_INGEST_URL: optionalUrl,
  TELEGRAM_AGENT_DEV_WEBHOOK_BASE_URL: optionalUrl,
  TELEGRAM_AGENT_PROD_WEBHOOK_BASE_URL: optionalUrl,
  PROXY_URL: z.string().optional(),
  INFURA_KEY: z.string().optional(),
  ETHERSCAN_KEY: z.string().optional(),
  STATS_CUTOFF_MS: z.string().default('60000'),
  IMAGE_SIZE_LIMIT_BYTES: z.string().default('1048576'),
  DW_TASKS_STREAM: z.string().default('dw_tasks'),
  DW_STATUS_TTL_S: z.string().default('86400'),
  DEX_POLL_WORKERS: z.string().default('3'),
  DELTA_SPOT_EXCHANGES: z.string().default('binance,bitget,bithumb,bybit,coinbase,coinone,cryptocom,gateio,huobi,kraken,kucoin,mexc,okx,upbit'),
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
  if (process.env.WEBHOOK_URL) {
    throw new Error('Invalid API configuration: WEBHOOK_URL is deprecated; use alert destination templates');
  }

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

