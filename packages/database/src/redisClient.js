import Redis from 'ioredis';
import { createLogger } from '@bemodest/utils';

// Initialize shared logger following canonical pattern (RULES O-8001, O-8002)
const logger = createLogger(
  process.env.LOG_DIR || './logs',
  process.env.LOG_LEVEL || 'info'
);

/**
 * Redis client wrapper with connection management and retry strategy
 * @class RedisClient
 */
export class RedisClient {
    /**
     * @param {Object} options - Redis connection options
     */
    constructor(options = {}) {
        this.host = options.host || process.env.REDIS_HOST;
        this.port = options.port || process.env.REDIS_PORT || 6379;
        this.password = options.password || process.env.REDIS_PASSWORD;
        this.client = null;
    }

    /**
     * Initializes the Redis connection
     * @returns {Redis}
     */
    connect() {
        if (this.client) return this.client;

        logger.info(`Connecting to Redis at ${this.host}:${this.port}`);

        this.client = new Redis({
            host: this.host,
            port: this.port,
            password: this.password,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            }
        });

        this.client.on('connect', () => {
            logger.info('Redis client connected');
        });

        this.client.on('error', (err) => {
            logger.error('Redis client error:', err);
        });

        return this.client;
    }

    /**
     * Gracefully closes the Redis connection
     * @returns {Promise<void>}
     */
    async quit() {
        if (this.client) {
            await this.client.quit();
            this.client = null;
            logger.info('Redis connection closed');
        }
    }
}

// Singleton instances for common usage
let sharedRedis = null;

/**
 * Get the shared Redis singleton instance
 * @returns {Redis}
 */
export const getRedisClient = () => {
    if (!sharedRedis) {
        const client = new RedisClient();
        sharedRedis = client.connect();
    }
    return sharedRedis;
};
