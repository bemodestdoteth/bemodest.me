import { validateApiConfig } from '@bemodest/config';

// Validate configuration at startup
const config = validateApiConfig();

// General App Config
export const NODE_ENV = config.NODE_ENV;
export const PORT = Number(config.PORT);
export const LOG_LEVEL = config.LOG_LEVEL;
export const LOG_FILE = config.LOGFILE;
export const CORS_ORIGIN_ALLOWED = config.CORS_ORIGIN;
export const CHROME_EXTENSION_ID = config.CHROME_EXTENSION_ID;

// Database Collections
export const COLLECTION_ADDRS = config.COLLECTION_ADDRS;
export const COLLECTION_CHAINS = config.COLLECTION_CHAINS;
export const COLLECTION_ENTITES = config.COLLECTION_ENTITES;
export const COLLECTION_COINGECKO_RANK = config.COLLECTION_COINGECKO_RANK;
export const COLLECTION_COINGECKO_LIST = config.COLLECTION_COINGECKO_LIST;
export const COLLECTION_ALERT_RULES = config.COLLECTION_ALERT_RULES;
export const COLLECTION_CONTRACT_MAPPINGS = config.COLLECTION_CONTRACT_MAPPINGS;
export const MONGODB_MAX_TIME_MS = Number(config.MONGODB_MAX_TIME_MS);

// Auth Config
export const JWT_SECRET = config.JWT_SECRET;
export const ADMIN_USERNAME = config.ADMIN_USERNAME;
export const ADMIN_PASSWORD_HASH = config.ADMIN_PASSWORD_HASH;
export const JWT_EXPIRES_IN_WEB = config.JWT_EXPIRES_IN_WEB;
export const JWT_EXPIRES_IN_EXTENSION = config.JWT_EXPIRES_IN_EXTENSION;
export const COOKIE_NAME = config.COOKIE_NAME;
export const COOKIE_MAX_AGE_MS = Number(config.COOKIE_MAX_AGE_MS);
export const COOKIE_SAME_SITE = config.COOKIE_SAME_SITE;

// External Services
export const SIDECAR_URL = config.SIDECAR_URL;
export const SNAPPER_API_SECRET = config.SNAPPER_API_SECRET;
export const PROXY_URL = config.PROXY_URL;

// Redis Config
export const REDIS_HOST = config.REDIS_HOST;
export const REDIS_PORT = Number(config.REDIS_PORT);
export const REDIS_PASSWORD = config.REDIS_PASSWORD;

// Specific Limits/Constants
export const INFURA_KEY = config.INFURA_KEY;
export const ETHERSCAN_KEY = config.ETHERSCAN_KEY;
export const STATS_CUTOFF_MS = Number(config.STATS_CUTOFF_MS);
export const IMAGE_SIZE_LIMIT_BYTES = Number(config.IMAGE_SIZE_LIMIT_BYTES);
export const DW_TASKS_STREAM = config.DW_TASKS_STREAM;
export const DW_STATUS_TTL_S = Number(config.DW_STATUS_TTL_S);

// DEX Poller Config
export const DEX_POLL_WORKERS = Number(config.DEX_POLL_WORKERS);
export const DEX_REDIS_CHANNEL = config.DEX_REDIS_CHANNEL;
