import { getRedisClient } from '@bemodest/database';
import { logger } from '@bemodest/utils';

async function diagnose() {
    try {
        const redis = getRedisClient();
        console.log('--- Redis Diagnosis ---');
        const allKeys = await redis.keys('*');
        console.log(`Total keys in Redis: ${allKeys.length}`);
        console.log('Sample keys:', allKeys.slice(0, 20));

        const keys = await redis.keys('dw:*');
        console.log(`Found ${keys.length} dw:* keys:`);
        for (const key of keys) {
            const type = await redis.type(key);
            if (type === 'string') {
                const val = await redis.get(key);
                console.log(`  ${key} -> ${val}`);
            } else {
                console.log(`  ${key} -> [Type: ${type}]`);
            }
        }

        console.log('\n--- Price Hash (lvc:prices) ---');
        const prices = await redis.hgetall('lvc:prices');
        console.log(`Total prices: ${Object.keys(prices).length}`);
        const entries = Object.entries(prices);
        console.log('Sample prices:', entries.slice(0, 20));

        // Specifically check for CFG if it exists
        const cfgPrice = prices['CFG'];
        console.log(`\nCFG Price: ${cfgPrice || 'Not found'}`);

        const tasksType = await redis.type('dw:tasks');
        console.log(`\ndw:tasks Type: ${tasksType}`);
        if (tasksType === 'set') {
            const tasks = await redis.smembers('dw:tasks');
            console.log('dw:tasks:', tasks);
        }

        const activeKeys = await redis.keys('dw:active:*');
        console.log(`\nActive Deep Dive Keys: ${JSON.stringify(activeKeys)}`);

    } catch (err) {
        console.error('Diagnosis failed:', err);
    } finally {
        process.exit(0);
    }
}

diagnose();
