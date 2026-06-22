import { z } from 'zod';

export const SystemConfigSchema = z.object({
    // Ports
    PORT: z.number().int().default(3000),
    API_PORT: z.number().int().default(3001),
    SIDECAR_PORT: z.number().int().default(25834),

    // Auth
    JWT_SECRET: z.string().min(32),
    SNAPPER_API_SECRET: z.string().optional(),

    // MongoDB
    MONGO_USER: z.string().optional(),
    MONGO_PASSWORD: z.string().optional(),
    MONGO_HOST: z.string().optional(),
    MONGO_PORT: z.string().default('27017'),
    MONGO_DB_NAME: z.string().optional(),
    MONGO_URI: z.string().optional(),

    // Redis
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.string().default('6380'),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_URL: z.string().optional(),

    // App Logic
    NODE_ENV: z.enum(['dev', 'prod', 'test']).default('dev'),
    DEX_REDIS_CHANNEL: z.string().default('dex_prices'),
    BATCHING_DURATION_MS: z.number().int().default(1000),
    COLLECTION_ALERT_DESTINATIONS: z.string().default('alertDestinations'),
});


export type SystemConfig = z.infer<typeof SystemConfigSchema>;
