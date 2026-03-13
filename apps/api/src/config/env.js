import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

// General App Config
export const NODE_ENV = process.env.NODE_ENV || 'dev';
export const PORT = process.env.PORT || 3001;
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const LOG_FILE = process.env.LOGFILE || './logs/api.log';
export const CORS_ORIGIN_ALLOWED = process.env.CORS_ORIGIN_ALLOWED || 'http://localhost:25833';
export const CHROME_EXTENSION_ID = process.env.CHROME_EXTENSION_ID;

// Database Collections
export const COLLECTION_ADDRS = process.env.COLLECTION_ADDRS || 'labelAddrs';
export const COLLECTION_CHAINS = process.env.COLLECTION_CHAINS || 'chains';
export const COLLECTION_ENTITES = process.env.COLLECTION_ENTITES || 'labelEntities';
export const COLLECTION_COINGECKO_RANK = process.env.COLLECTION_COINGECKO_RANK || 'coingeckoTop2000';
export const COLLECTION_COINGECKO_LIST = process.env.COLLECTION_COINGECKO_LIST || 'coingeckoCoinList';
export const COLLECTION_ALERT_RULES = process.env.COLLECTION_ALERT_RULES || 'alertRules';
export const COLLECTION_CONTRACT_MAPPINGS = process.env.COLLECTION_CONTRACT_MAPPINGS || 'coingeckoContractMappings';
export const MONGODB_MAX_TIME_MS = Number(process.env.MONGODB_MAX_TIME_MS) || 30000;


// Auth Config
export const JWT_SECRET = process.env.JWT_SECRET;
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
export const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
export const JWT_EXPIRES_IN_WEB = process.env.JWT_EXPIRES_IN_WEB || '7d';
export const JWT_EXPIRES_IN_EXTENSION = process.env.JWT_EXPIRES_IN_EXTENSION || '30d';
export const COOKIE_NAME = process.env.COOKIE_NAME || 'auth-token';
export const COOKIE_MAX_AGE_MS = Number(process.env.COOKIE_MAX_AGE_MS) || 604800000;
export const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE || 'lax';

// External Services
export const SIDECAR_URL = process.env.SIDECAR_URL;
export const SNAPPER_API_SECRET = process.env.SNAPPER_API_SECRET;
export const PROXY_URL = process.env.PROXY_URL;

// Redis Config
export const REDIS_HOST = process.env.REDIS_HOST;
export const REDIS_PORT = Number(process.env.REDIS_PORT) || 6380;
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

// Specific Limits/Constants
export const INFURA_KEY = process.env.INFURA_KEY;
export const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY;
export const STATS_CUTOFF_MS = Number(process.env.STATS_CUTOFF_MS) || 60000;
export const IMAGE_SIZE_LIMIT_BYTES = Number(process.env.IMAGE_SIZE_LIMIT_BYTES) || 1048576;
export const DW_TASKS_STREAM = process.env.DW_TASKS_STREAM || 'dw:tasks';
export const DW_STATUS_TTL_S = Number(process.env.DW_STATUS_TTL_S) || 86400;

// DEX Poller Config
export const DEX_POLL_WORKERS = Number(process.env.DEX_POLL_WORKERS) || 3;
export const DEX_REDIS_CHANNEL = process.env.DEX_REDIS_CHANNEL || 'dex_price_updates';




