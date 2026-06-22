import { closeDBClient, getDBClient } from '@bemodest/database';
import { validateApiConfig } from '@bemodest/config';

const config = validateApiConfig();
const APPLY = process.argv.includes('--apply');
const BUILTIN_ALERT_DESTINATION_ID = 'builtin-api-ingest';
const BUILTIN_DESTINATION = {
    _id: BUILTIN_ALERT_DESTINATION_ID,
    label: 'Built-in API ingest',
    kind: 'builtin_api_ingest',
    url: config.BUILTIN_ALERT_INGEST_URL ?? `http://127.0.0.1:${config.PORT}/api/alert-events/ingest`,
    enabled: true,
    supported_alert_types: ['normal', 'urgent'],
    protected: true,
};

function slugifyDestinationId(label, usedIds = new Set()) {
    const base = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'destination';
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
        id = `${base}-${suffix}`;
        suffix += 1;
    }
    usedIds.add(id);
    return id;
}

function assertAllowedDestinationUrl(url) {
    const parsed = new URL(url);
    const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (isLoopback && config.NODE_ENV === 'dev' && config.ALERT_DESTINATION_ALLOW_LOOPBACK_IN_DEV === 'true') return;
    if (parsed.hostname.endsWith(config.ALERT_DESTINATION_TAILSCALE_SUFFIX)) return;
    throw new Error(`Alert destination URL must use ${config.ALERT_DESTINATION_TAILSCALE_SUFFIX}`);
}

function addDestinationTemplate(destinations, template, labelConflicts) {
    assertAllowedDestinationUrl(template.url);
    for (const existing of destinations.values()) {
        if (existing.url === template.url && existing._id !== template._id) {
            throw new Error(`Destination URL conflict: ${existing._id} and ${template._id} share ${template.url}`);
        }
        if (existing.label === template.label && existing._id !== template._id) {
            labelConflicts.add(template.label);
        }
    }
    destinations.set(template._id, template);
}

function externalDestinationFromLegacy(destination, usedIds) {
    const id = destination.id || slugifyDestinationId(destination.label || 'External webhook', usedIds);
    usedIds.add(id);
    return {
        _id: id,
        label: destination.label || 'External webhook',
        kind: 'external_webhook',
        url: destination.url,
        enabled: destination.enabled ?? true,
        supported_alert_types: ['normal', 'urgent'],
        protected: false,
    };
}

function defaultAlertTypeRules(rule) {
    return rule.alert_type_rules?.length ? rule.alert_type_rules : [{ alert_type: 'normal', operator: 'gt', value: rule.value }];
}

function collectMigration(rule, globalDestinations, usedIds, labelConflicts) {
    const existing = Array.isArray(rule.alert_destinations) ? rule.alert_destinations : [];
    const assignments = [{ destination_id: BUILTIN_ALERT_DESTINATION_ID, enabled: true, dead: false }];
    globalDestinations.set(BUILTIN_ALERT_DESTINATION_ID, BUILTIN_DESTINATION);

    for (const destination of existing) {
        if (destination.id === BUILTIN_ALERT_DESTINATION_ID) continue;
        const template = externalDestinationFromLegacy(destination, usedIds);
        addDestinationTemplate(globalDestinations, template, labelConflicts);
        assignments.push({
            destination_id: template._id,
            enabled: destination.enabled ?? true,
            dead: destination.dead ?? false,
            ...(destination.last_failed_at ? { last_failed_at: destination.last_failed_at } : {}),
        });
    }

    if (rule.webhook_url) {
        const template = {
            _id: slugifyDestinationId('External webhook', usedIds),
            label: 'External webhook',
            kind: 'external_webhook',
            url: rule.webhook_url,
            enabled: true,
            supported_alert_types: ['normal', 'urgent'],
            protected: false,
        };
        addDestinationTemplate(globalDestinations, template, labelConflicts);
        assignments.push({
            destination_id: template._id,
            enabled: true,
            dead: rule.webhook_dead ?? false,
        });
    }

    return {
        destination_assignments: assignments,
        alert_type_rules: defaultAlertTypeRules(rule),
    };
}

async function upsertDestination(dbClient, destination, now) {
    const current = await dbClient.readOne(config.COLLECTION_ALERT_DESTINATIONS, { _id: destination._id });
    if (current) {
        await dbClient.updateOne(config.COLLECTION_ALERT_DESTINATIONS, { _id: destination._id }, { $set: { ...destination, updated_at: now } });
        return;
    }
    await dbClient.createOne(config.COLLECTION_ALERT_DESTINATIONS, { ...destination, created_at: now, updated_at: now });
}

async function main() {
    const dbClient = await getDBClient();
    const rules = await dbClient.readMany(config.COLLECTION_ALERT_RULES, {
        $or: [
            { alert_destinations: { $exists: true } },
            { webhook_url: { $exists: true } },
            { webhook_dead: { $exists: true } },
            { destination_assignments: { $exists: false } },
            { alert_type_rules: { $exists: false } },
        ],
    });
    const usedIds = new Set([BUILTIN_ALERT_DESTINATION_ID]);
    const destinations = new Map();
    const labelConflicts = new Set();
    const migrations = rules.map(rule => ({ rule, patch: collectMigration(rule, destinations, usedIds, labelConflicts) }));

    console.log(`${APPLY ? 'Applying' : 'Dry run'} alert destination migration for ${rules.length} rules`);
    console.log(`Destination templates: ${destinations.size}`);
    for (const label of labelConflicts) console.warn(`Label conflict: ${label}`);
    if (!APPLY) return;

    const now = new Date().toISOString();
    for (const destination of destinations.values()) {
        await upsertDestination(dbClient, destination, now);
    }
    for (const { rule, patch } of migrations) {
        await dbClient.updateOne(config.COLLECTION_ALERT_RULES, { _id: rule._id }, {
            $set: { ...patch, updated_at: now },
            $unset: { alert_destinations: '', webhook_url: '', webhook_dead: '' },
        });
    }
    console.log(`Migrated ${rules.length} alert rules in active MongoDB`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await closeDBClient();
    });
