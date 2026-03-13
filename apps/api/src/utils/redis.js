import Redis from 'ioredis';
import logger from '../config/logger.js';
import { REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } from '../config/env.js';

let redisClient = null;

export const initRedis = () => {
    if (redisClient) return redisClient;

    logger.info(`Connecting to Redis at ${REDIS_HOST}:${REDIS_PORT}`);

    redisClient = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD,
        retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
        }
    });

    redisClient.on('connect', () => {
        logger.info('Redis client connected');
    });

    redisClient.on('error', (err) => {
        logger.error('Redis client error:', err);
    });

    return redisClient;
};

export const getRedisClient = () => {
    if (!redisClient) {
        return initRedis();
    }
    return redisClient;
};
