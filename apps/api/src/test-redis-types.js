import { getRedisClient } from '@bemodest/database';

async function main() {
    const redis = getRedisClient();
    console.log('--- Checking D/W Redis Keys ---');
    const keys = await redis.keys('dw:*');
    for (const key of keys) {
        const type = await redis.type(key);
        const val = type === 'string' ? await redis.get(key) : '[complex]';
        console.log(`KEY: ${key} | TYPE: ${type} | VAL: ${val}`);
    }
}

main().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
