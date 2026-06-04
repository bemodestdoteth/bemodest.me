import { closeDBClient, closeRedisClient, getDBClient, getRedisClient } from '@bemodest/database';
import { validateApiConfig } from '@bemodest/config';

const config = validateApiConfig();
const RULE_ID = 'market-watch-global-visibility';
const REDIS_SIDECAR_CHANNEL = 'sidecar:config';
const DEFAULT_WEBHOOK_URL = config.WEBHOOK_URL ?? `http://127.0.0.1:${config.PORT}/api/alerts/fired`;

const rule = {
    _id: RULE_ID,
    scope: 'market_watch',
    condition: 'spread_pct',
    cooldown_secs: 300,
    enabled: true,
    exchanges: [],
    label: 'Market Watch Global Visibility',
    minSources: 2,
    quote: 'USDT',
    recovery_value: 0,
    ticker: '*',
    value: 10,
    volumeFloorUsd: 30000,
    webhook_dead: false,
    webhook_url: DEFAULT_WEBHOOK_URL,
};

async function main() {
    const dbClient = await getDBClient();
    const now = new Date().toISOString();

    await dbClient.createIndex(
        config.COLLECTION_ALERT_RULES,
        { scope: 1 },
        {
            name: 'unique_market_watch_scope',
            unique: true,
            partialFilterExpression: { scope: 'market_watch' },
        }
    );

    const existing = await dbClient.readOne(config.COLLECTION_ALERT_RULES, { _id: RULE_ID });
    if (existing) {
        await dbClient.updateOne(
            config.COLLECTION_ALERT_RULES,
            { _id: RULE_ID },
            { $set: { ...rule, updated_at: now } }
        );
    } else {
        await dbClient.createOne(config.COLLECTION_ALERT_RULES, {
            ...rule,
            created_at: now,
            updated_at: now,
        });
    }

    const redis = getRedisClient();
    await redis.xadd(
        REDIS_SIDECAR_CHANNEL,
        'MAXLEN',
        '~',
        1000,
        '*',
        'payload',
        JSON.stringify({ type: 'alertrules_updated' })
    );

    console.log(`Upserted ${RULE_ID}`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeRedisClient();
        await closeDBClient();
    });
