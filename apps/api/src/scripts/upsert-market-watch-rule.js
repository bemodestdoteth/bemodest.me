import { closeDBClient, closeRedisClient, getDBClient, getRedisClient } from '@bemodest/database';
import { validateApiConfig } from '@bemodest/config';

const config = validateApiConfig();
const RULE_ID = 'market-watch-global-visibility';
const REDIS_SIDECAR_CHANNEL = 'sidecar:config';
const BUILTIN_ALERT_DESTINATION_ID = 'builtin-api-ingest';
const DEV_NEW_ENTRY_DESTINATION_ID = 'telegram-agent-dev-new-entry';
const DEV_PRICE_SPIKE_DESTINATION_ID = 'telegram-agent-dev-price-spike';
const PROD_NEW_ENTRY_DESTINATION_ID = 'telegram-agent-prod-new-entry';
const PROD_PRICE_SPIKE_DESTINATION_ID = 'telegram-agent-prod-price-spike';
const STALE_EXTERNAL_WEBHOOK_DESTINATION_ID = 'external-webhook';

function requireWebhookBaseUrl(name, value) {
    if (!value) {
        throw new Error(`Missing required API configuration: ${name}`);
    }
    return value.replace(/\/$/, '');
}

const devWebhookBaseUrl = requireWebhookBaseUrl(
    'TELEGRAM_AGENT_DEV_WEBHOOK_BASE_URL',
    config.TELEGRAM_AGENT_DEV_WEBHOOK_BASE_URL
);
const prodWebhookBaseUrl = requireWebhookBaseUrl(
    'TELEGRAM_AGENT_PROD_WEBHOOK_BASE_URL',
    config.TELEGRAM_AGENT_PROD_WEBHOOK_BASE_URL
);

const builtinDestination = {
    _id: BUILTIN_ALERT_DESTINATION_ID,
    label: 'Built-in API ingest',
    kind: 'builtin_api_ingest',
    url: config.BUILTIN_ALERT_INGEST_URL ?? `http://127.0.0.1:${config.PORT}/api/alert-events/ingest`,
    enabled: true,
    supported_alert_types: ['normal', 'urgent'],
    protected: true,
};

const telegramDestinations = [
    {
        _id: DEV_NEW_ENTRY_DESTINATION_ID,
        label: 'Telegram agent dev new-entry',
        kind: 'external_webhook',
        url: `${devWebhookBaseUrl}/hooks/new-entry`,
        enabled: true,
        supported_alert_types: ['normal', 'urgent'],
        protected: false,
    },
    {
        _id: DEV_PRICE_SPIKE_DESTINATION_ID,
        label: 'Telegram agent dev price-spike',
        kind: 'external_webhook',
        url: `${devWebhookBaseUrl}/hooks/price-spike`,
        enabled: true,
        supported_alert_types: ['normal', 'urgent'],
        protected: false,
    },
    {
        _id: PROD_NEW_ENTRY_DESTINATION_ID,
        label: 'Telegram agent prod new-entry',
        kind: 'external_webhook',
        url: `${prodWebhookBaseUrl}/hooks/new-entry`,
        enabled: false,
        supported_alert_types: ['normal', 'urgent'],
        protected: false,
    },
    {
        _id: PROD_PRICE_SPIKE_DESTINATION_ID,
        label: 'Telegram agent prod price-spike',
        kind: 'external_webhook',
        url: `${prodWebhookBaseUrl}/hooks/price-spike`,
        enabled: false,
        supported_alert_types: ['normal', 'urgent'],
        protected: false,
    },
];

const defaultDestinationAssignments = [
    {
        destination_id: BUILTIN_ALERT_DESTINATION_ID,
        enabled: true,
        dead: false,
    },
    {
        destination_id: DEV_NEW_ENTRY_DESTINATION_ID,
        enabled: true,
        dead: false,
    },
];

const ruleBase = {
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
    value: 5,
    volumeFloorUsd: 30000,
    alert_type_rules: [{ alert_type: 'normal', operator: 'gt', value: 5 }],
};

function preserveAssignmentState(existingAssignments = []) {
    const existingById = new Map(existingAssignments.map((assignment) => [assignment.destination_id, assignment]));
    return defaultDestinationAssignments.map((assignment) => {
        const existing = existingById.get(assignment.destination_id);
        if (!existing) return assignment;
        return {
            ...assignment,
            enabled: existing.enabled ?? assignment.enabled,
            dead: existing.dead ?? assignment.dead,
            ...(existing.last_failed_at ? { last_failed_at: existing.last_failed_at } : {}),
        };
    });
}

async function upsertDestination(dbClient, destination, now) {
    const existingDestination = await dbClient.readOne(config.COLLECTION_ALERT_DESTINATIONS, { _id: destination._id });
    if (existingDestination) {
        const { enabled, ...destinationUpdate } = destination;
        await dbClient.updateOne(
            config.COLLECTION_ALERT_DESTINATIONS,
            { _id: destination._id },
            { $set: { ...destinationUpdate, updated_at: now } }
        );
        return;
    }
    await dbClient.createOne(config.COLLECTION_ALERT_DESTINATIONS, { ...destination, created_at: now, updated_at: now });
}

async function main() {
    const dbClient = await getDBClient();
    const now = new Date().toISOString();

    await upsertDestination(dbClient, builtinDestination, now);
    for (const destination of telegramDestinations) {
        await upsertDestination(dbClient, destination, now);
    }
    await dbClient.deleteOne(config.COLLECTION_ALERT_DESTINATIONS, { _id: STALE_EXTERNAL_WEBHOOK_DESTINATION_ID });

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
    const rule = {
        ...ruleBase,
        destination_assignments: preserveAssignmentState(existing?.destination_assignments),
    };
    if (existing) {
        await dbClient.updateOne(
            config.COLLECTION_ALERT_RULES,
            { _id: RULE_ID },
            { $set: { ...rule, updated_at: now }, $unset: { alert_destinations: '', webhook_url: '', webhook_dead: '' } }
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
