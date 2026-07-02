import type { Redis } from 'ioredis';
import {
    closeRedisClient as closeCoreRedisClient,
    getRedisClient as getCoreRedisClient
} from '@bemodest/core';

export class RedisClient {
    connect(): Redis {
        return getCoreRedisClient();
    }

    async quit(): Promise<void> {
        await closeCoreRedisClient();
    }
}

export const getRedisClient = (): Redis => getCoreRedisClient();

export const closeRedisClient = async (): Promise<void> => {
    await closeCoreRedisClient();
};
