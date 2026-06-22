import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { getRedisClient, getDBClient } from '@bemodest/database';
import { logger, validateSignature } from '@bemodest/utils';
import { validateApiConfig } from '@bemodest/config';
const config = validateApiConfig();
const {
    JWT_SECRET,
    ADMIN_USERNAME,
    ADMIN_PASSWORD_HASH,
    COLLECTION_ADDRS,
    COLLECTION_CHAINS,
    COLLECTION_COINGECKO_RANK,
    COLLECTION_COINGECKO_LIST,
    COLLECTION_ENTITES,
    COLLECTION_ALERT_RULES,
    COLLECTION_ALERT_DESTINATIONS,
    JWT_EXPIRES_IN_WEB,
    JWT_EXPIRES_IN_EXTENSION,
    COOKIE_MAX_AGE_MS,
    COOKIE_NAME,
    COOKIE_SAME_SITE,
    SIDECAR_URL,
    SNAPPER_API_SECRET,
    DW_TASKS_STREAM,
    DW_STATUS_TTL_S,
    COLLECTION_FUTURES_POSITIONS,
    DELTA_SPOT_EXCHANGES,
} = config;
import {
    LabelDeleteBulkSchema,
    DwStatusBodySchema,
    DwDeepDiveTaskSchema,
} from '@bemodest/types';
import {
    AlertDestinationSchema,
    AlertRuleSchema,
    AlertEventIngestSchema,
} from '@bemodest/types/server';

import { reports, updateClients } from '../utils/sse.js';
import { getIO } from '../socket/state.js';
import { getHotWalletBalances } from '../utils/balance.js';

export const walletList = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 0 } });

        const labelledAddresses = {};
        result.forEach(item => {
            labelledAddresses[item.addr] = {
                chains: item.chains ?? [],
                entity: item.entity,
                entityImage: item.entityImage,
                comment: item.comment,
                label: item.label,
                tracking: item.tracking,
                aliases: item.aliases ?? []
            };
        });

        res.status(200).json({ labelledAddresses });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err.message });
    }
};

export const walletTotal = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 1 } });

        res.status(200).json({ walletTotal: result.length });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err.message });
    }
};

export const walletTracking = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const result = await dbClient.readMany(COLLECTION_ADDRS, { tracking: true }, { projection: { _id: 1 } });

        res.status(200).json({ walletTracking: result.length });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err.message });
    }
};

export const entityTotal = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const result = await dbClient.readMany(COLLECTION_ENTITES, {}, { projection: { _id: 1 } });

        res.status(200).json({ entityTotal: result.length });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err.message });
    }
};

export const entityGet = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const result = await dbClient.readMany(COLLECTION_ENTITES, req.query || {}, { projection: { _id: 0 } });

        result.forEach(item => {
            if (item.image) {
                item.image = dbClient.base64ToDataURI(item.image);
            }
        });

        res.status(200).json({ success: true, data: result });
    } catch (err) {
        logger.error(err);
        res.status(500).json({ success: false, message: err.message, error: err });
    }
};

export const coingeckoGet = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const rankResult = await dbClient.readMany(COLLECTION_COINGECKO_RANK, req.body,
            {
                "projection": { "id": 1, "symbol": 1, "current_price": 1, "market_cap_rank": 1, "price_change_percentage_24h": 1, "_id": 0 },
            }
        );
        const listResult = await dbClient.readMany(COLLECTION_COINGECKO_LIST, req.body,
            {
                "projection": { "id": 1, "platforms": 1, "_id": 0 },
            }
        );

        const geckoMap = new Map();
        listResult.forEach(obj => {
            if (obj.platforms) {
                geckoMap.set(obj.id, obj.platforms);
            }
        });

        const finalResult = [];
        const coingeckoToCAIP2Mapping = await dbClient.getCoingeckoToCAIP2Mapping(COLLECTION_CHAINS);

        rankResult.forEach(obj1 => {
            const platforms = geckoMap.get(obj1.id);

            if (Object.keys(platforms).length > 0) {
                for (const [key, value] of Object.entries(platforms)) {
                    if ((Object.keys(coingeckoToCAIP2Mapping).includes(key)) && (value !== null)) {
                        finalResult.push({
                            id: obj1.id,
                            name: obj1.name,
                            symbol: obj1.symbol,
                            image: obj1.image,
                            current_price: obj1.current_price,
                            market_cap_rank: obj1.market_cap_rank,
                            price_change_percentage_24h: obj1.price_change_percentage_24h,
                            platform: coingeckoToCAIP2Mapping[key],
                            contract: value.contract_address,
                            decimals: value.decimal_place,
                        });
                    }
                }
            }
        });

        res.status(200).json(finalResult);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err });
    }
};

export const coingeckoGetSolana = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const rankResult = await dbClient.readMany(COLLECTION_COINGECKO_RANK, req.body,
            {
                "projection": { "id": 1, "symbol": 1, "current_price": 1, "market_cap_rank": 1, "price_change_percentage_24h": 1, "_id": 0 },
            }
        );
        const listResult = await dbClient.readMany(COLLECTION_COINGECKO_LIST, req.body,
            {
                "projection": { "id": 1, "platforms": 1, "_id": 0 },
            }
        );

        const geckoMap = new Map();
        listResult.forEach(obj => {
            if (obj.platforms) {
                geckoMap.set(obj.id, obj.platforms);
            }
        });

        const finalResult = [];
        const coingeckoToCAIP2Mapping = await dbClient.getCoingeckoToCAIP2Mapping(COLLECTION_CHAINS);
        rankResult.forEach(obj1 => {
            const platforms = geckoMap.get(obj1.id);

            if (Object.keys(platforms).length > 0) {
                for (const [key, value] of Object.entries(platforms)) {
                    if ((Object.keys(coingeckoToCAIP2Mapping).includes(key)) && (value !== null)) {
                        finalResult.push({
                            id: obj1.id,
                            symbol: obj1.symbol,
                            current_price: obj1.current_price,
                            market_cap_rank: obj1.market_cap_rank,
                            price_change_percentage_24h: obj1.price_change_percentage_24h,
                            platform: coingeckoToCAIP2Mapping[key],
                            contract: value.contract_address,
                            decimals: value.decimal_place,
                        });
                    }
                }
            }
        });

        res.status(200).json(finalResult);
    } catch (err) {
        logger.error(err);
        res.status(500).json({ message: err });
    }
};

export const removeFront = async (req, res) => {
    try {
        const validated = LabelDeleteBulkSchema.parse(req.body);
        const dbClient = await getDBClient();

        const addresses = Array.isArray(validated.address) ? validated.address : [validated.address];

        await dbClient.deleteMany(COLLECTION_ADDRS, { addr: { $in: addresses } });

        const result = await dbClient.readMany(COLLECTION_ADDRS, {}, { projection: { _id: 0 } });

        const io = getIO();
        if (io) {
            io.emit('labelUpdate', {
                success: true,
                data: result,
                timestamp: Date.now()
            });
        }

        res.status(200).json({ success: true, message: `Deleted ${addresses.length} addresses` });

    } catch (err) {
        logger.error(`removeFront Error: ${err.message}`);
        res.status(500).json({
            success: false,
            error: {
                code: err.name === 'ZodError' ? 'VALIDATION_ERROR' : 'DELETE_ERROR',
                message: err.message || 'Failed to delete labels'
            }
        });
    }
};

export const getExchSnapperReport = async (req, res) => {
    if (!validateSignature(req.header('X-Signature'), req.header('X-Timestamp'), SNAPPER_API_SECRET)) {
        res.status(401).json({ message: 'Invalid signature.' });
        return;
    }

    const { timestamp, from, status } = req.body;
    if (!timestamp || !from || !status) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const time = new Date(timestamp).getTime();
    if (isNaN(time)) {
        return res.status(400).json({ error: 'Invalid timestamp' });
    }

    if (!reports[from]) {
        reports[from] = [];
    }

    reports[from].push({ timestamp: time, status });
    res.json({ success: true });
    updateClients();
};



// ── Dynamic Excludelist Management ──────────────────────────────────────────

const REDIS_EXCLUDELIST_KEY = 'config:excludelist';
const REDIS_SIDECAR_CHANNEL = 'sidecar:config';

export const getExcludelist = async (req, res) => {
    try {
        const redis = getRedisClient();
        const excludelist = await redis.smembers(REDIS_EXCLUDELIST_KEY);
        // By default, if empty, it might be using EUR from sidecar env, but we just return what's in Redis
        res.status(200).json({ success: true, data: excludelist });
    } catch (err) {
        logger.error(`getExcludelist Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch excludelist' });
    }
};

export const updateExcludelist = async (req, res) => {
    try {
        const { add, remove } = req.body;
        const redis = getRedisClient();

        let updated = false;

        if (Array.isArray(add) && add.length > 0) {
            const uppercaseAdd = add.map(item => item.toUpperCase());
            await redis.sadd(REDIS_EXCLUDELIST_KEY, ...uppercaseAdd);
            updated = true;
        }

        if (Array.isArray(remove) && remove.length > 0) {
            const uppercaseRemove = remove.map(item => item.toUpperCase());
            await redis.srem(REDIS_EXCLUDELIST_KEY, ...uppercaseRemove);
            updated = true;
        }

        if (updated) {
            // Notify sidecar to reload excludelist
            await redis.xadd(REDIS_SIDECAR_CHANNEL, 'MAXLEN', '~', 1000, '*', 'payload', JSON.stringify({ type: 'excludelist_updated' }));
        }

        const newList = await redis.smembers(REDIS_EXCLUDELIST_KEY);
        res.status(200).json({ success: true, data: newList });
    } catch (err) {
        logger.error(`updateExcludelist Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to update excludelist' });
    }
};

// ── Market Metadata ─────────────────────────────────────────────────────────

export const getMarketMetadata = async (req, res) => {
    try {
        const dbClient = await getDBClient();

        // Use 'coingeckoContractMappings' per user instruction
        const docs = await dbClient.readMany('coingeckoContractMappings', {}, {
            projection: { symbol: 1, market_cap: 1, market_cap_rank: 1, _id: 0 }
        });

        const chains = await dbClient.readMany('chains', {}, {
            projection: { caip2: 1, code: 1, _id: 0 }
        });


        const data = {};
        for (const doc of docs) {
            if (doc.symbol) {
                data[doc.symbol.toUpperCase()] = {
                    market_cap: doc.market_cap,
                    market_cap_rank: doc.market_cap_rank
                };
            }
        }

        const caipMap = {};
        for (const chain of chains) {
            if (chain.caip2) {
                caipMap[chain.caip2] = chain.code || chain.name;
            }
        }

        res.status(200).json({ success: true, data, caipMap });
    } catch (err) {
        logger.error(`getMarketMetadata Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch market metadata' });
    }
};

// ── Dynamic Pinlist Management ──────────────────────────────────────────────

const REDIS_PINLIST_KEY = 'config:pinlist';

export const getPinlist = async (req, res) => {
    try {
        const redis = getRedisClient();
        const pinlist = await redis.smembers(REDIS_PINLIST_KEY);
        res.status(200).json({ success: true, data: pinlist });
    } catch (err) {
        logger.error(`getPinlist Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch pinlist' });
    }
};

export const updatePinlist = async (req, res) => {
    try {
        const { add, remove } = req.body;
        const redis = getRedisClient();

        let updated = false;

        if (Array.isArray(add) && add.length > 0) {
            const uppercaseAdd = add.map(item => item.toUpperCase());
            await redis.sadd(REDIS_PINLIST_KEY, ...uppercaseAdd);
            updated = true;
        }

        if (Array.isArray(remove) && remove.length > 0) {
            const uppercaseRemove = remove.map(item => item.toUpperCase());
            await redis.srem(REDIS_PINLIST_KEY, ...uppercaseRemove);
            updated = true;
        }

        if (updated) {
            // Notify sidecar to reload pinlist
            await redis.xadd(REDIS_SIDECAR_CHANNEL, 'MAXLEN', '~', 1000, '*', 'payload', JSON.stringify({ type: 'pinlist_updated' }));
        }

        const newList = await redis.smembers(REDIS_PINLIST_KEY);
        res.status(200).json({ success: true, data: newList });
    } catch (err) {
        logger.error(`updatePinlist Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to update pinlist' });
    }
};

// ── D/W Status ───────────────────────────────────────────────────────────────

export const postDwStatus = async (req, res) => {
    if (!validateSignature(req.header('X-Signature'), req.header('X-Timestamp'), SNAPPER_API_SECRET)) {
        return res.status(401).json({ message: 'Invalid signature.' });
    }

    let body;
    try {
        body = DwStatusBodySchema.parse(req.body);
    } catch (err) {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }

    const { exchange, network, ticker, status } = body;

    try {
        const redis = getRedisClient();
        const upperTicker = ticker.toUpperCase();
        const networkEncoded = network.replace(':', '/');
        const key = `dw:${exchange}:${networkEncoded}:${upperTicker}`;
        await redis.set(key, status, 'EX', DW_STATUS_TTL_S);
        if (!status.startsWith('error:') && network !== 'unknown') {
            await redis.del(`dw:${exchange}:unknown:${upperTicker}`);
        }

        const io = getIO();
        if (io) io.emit('dwStatusUpdate', { exchange, network, ticker: ticker.toUpperCase(), status, ts: Date.now() });

        res.json({ success: true });
    } catch (err) {
        logger.error(`postDwStatus Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};

export const getDwStatus = async (req, res) => {
    const { ticker } = req.query;
    if (!ticker) return res.status(400).json({ error: 'ticker required' });

    const SCAN_TIMEOUT_MS = 10_000;
    const MAX_SCAN_KEYS = 5_000;

    let timeoutId;
    let stream;

    try {
        const redis = getRedisClient();
        const pattern = `dw:*:*:${ticker.toUpperCase()}`;
        const keys = [];
        stream = redis.scanStream({ match: pattern, count: 100 });
        stream.on('data', chunk => {
            keys.push(...chunk);
            if (keys.length > MAX_SCAN_KEYS) {
                stream.destroy(new Error('scanStream key limit exceeded'));
            }
        });
        await Promise.race([
            new Promise((resolve, reject) => {
                stream.on('end', resolve);
                stream.on('error', reject);
            }),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    stream.destroy(new Error('scanStream timeout'));
                    reject(new Error('scanStream timeout'));
                }, SCAN_TIMEOUT_MS);
            }),
        ]);

        if (keys.length === 0) return res.json({ success: true, data: [] });

        const values = await redis.mget(...keys);
        const data = keys.map((key, i) => {
            const [, exchange, networkEncoded] = key.split(':');
            return { exchange, network: networkEncoded.replace('/', ':'), status: values[i] };
        }).filter(d => d.status !== null);

        res.json({ success: true, data });
    } catch (err) {
        logger.error(`getDwStatus Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Internal error' });
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (stream && !stream.destroyed) stream.destroy();
    }
};

export const getDeepDiveBalance = async (req, res) => {
    const { ticker, exchanges } = req.query;
    if (!ticker || !exchanges) return res.status(400).json({ error: 'ticker and exchanges required' });

    const exchangeList = exchanges.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (exchangeList.length === 0) return res.status(400).json({ error: 'No valid exchanges provided' });

    try {
        const data = await getHotWalletBalances(ticker.toUpperCase(), exchangeList);
        return res.json({ success: true, data });
    } catch (err) {
        logger.error(`getDeepDiveBalance Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};

export const postDeepDiveStart = async (req, res) => {
    let body;
    try {
        body = DwDeepDiveTaskSchema.parse(req.body);
    } catch (err) {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }

    const { ticker, exchanges } = body;
    try {
        const redis = getRedisClient();
        await redis.set(`dw:active:${ticker.toUpperCase()}`, 'true', 'EX', 900);
        await redis.xadd(DW_TASKS_STREAM, 'MAXLEN', '~', 1000, '*',
            'action', 'start',
            'ticker', ticker.toUpperCase(),
            'exchanges', JSON.stringify(exchanges)
        );
        res.json({ success: true });
    } catch (err) {
        logger.error(`postDeepDiveStart Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};

export const postDeepDiveStop = async (req, res) => {
    let body;
    try {
        body = DwDeepDiveTaskSchema.parse(req.body);
    } catch (err) {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }

    const { ticker, exchanges } = body;
    try {
        const redis = getRedisClient();
        await redis.del(`dw:active:${ticker.toUpperCase()}`);
        await redis.xadd(DW_TASKS_STREAM, 'MAXLEN', '~', 1000, '*',
            'action', 'stop',
            'ticker', ticker.toUpperCase(),
            'exchanges', JSON.stringify(exchanges)
        );
        res.json({ success: true });
    } catch (err) {
        logger.error(`postDeepDiveStop Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Internal error' });
    }
};

// ── Alert Rules ──────────────────────────────────────────────────────────────

const MARKET_WATCH_SCOPE = 'market_watch';
const BUILTIN_ALERT_DESTINATION_ID = 'builtin-api-ingest';
const BUILTIN_ALERT_DESTINATION_KIND = 'builtin_api_ingest';
const ALERT_EVENT_ID_INDEX = 'unique_alert_event_id';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALERT_TYPES = new Set(['normal', 'urgent']);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
const ALERT_DESTINATION_TAILSCALE_SUFFIX = process.env.ALERT_DESTINATION_TAILSCALE_SUFFIX ?? '.ts.net';
const ALERT_DESTINATION_ALLOW_LOOPBACK_IN_DEV = process.env.ALERT_DESTINATION_ALLOW_LOOPBACK_IN_DEV ?? 'false';

function normalizeAlertRuleScope(rule) {
    return rule.scope ?? 'alert';
}

function builtinAlertIngestUrl() {
    return config.BUILTIN_ALERT_INGEST_URL ?? `http://127.0.0.1:${config.PORT}/api/alert-events/ingest`;
}

function destinationNodePolicyStatus(url) {
    const policy = {
        tailscale_suffix: ALERT_DESTINATION_TAILSCALE_SUFFIX,
        loopback_allowed_in_dev: config.NODE_ENV === 'dev' && ALERT_DESTINATION_ALLOW_LOOPBACK_IN_DEV === 'true',
        node_env: config.NODE_ENV,
    };

    try {
        const parsed = new URL(url);
        const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
        const isTailscale = parsed.protocol === 'https:' && parsed.hostname.endsWith(ALERT_DESTINATION_TAILSCALE_SUFFIX);
        if (isLoopback && policy.loopback_allowed_in_dev) {
            return { url_allowed_by_node_policy: true, node_policy_reason: 'loopback allowed in dev', node_policy: policy };
        }
        if (isTailscale) {
            return { url_allowed_by_node_policy: true, node_policy_reason: `HTTPS host matches ${ALERT_DESTINATION_TAILSCALE_SUFFIX}`, node_policy: policy };
        }
        return {
            url_allowed_by_node_policy: false,
            node_policy_reason: `requires HTTPS ${ALERT_DESTINATION_TAILSCALE_SUFFIX}${config.NODE_ENV === 'dev' ? ' or explicitly allowed loopback' : ''}`,
            node_policy: policy,
        };
    } catch (err) {
        return { url_allowed_by_node_policy: false, node_policy_reason: 'invalid URL', node_policy: policy };
    }
}

function assertAllowedDestinationUrl(url) {
    const parsed = new URL(url);
    const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname);
    const isTailscale = parsed.hostname.endsWith(ALERT_DESTINATION_TAILSCALE_SUFFIX);
    if (isLoopback && config.NODE_ENV === 'dev' && ALERT_DESTINATION_ALLOW_LOOPBACK_IN_DEV === 'true') return;
    if (isTailscale) return;
    throw new Error(`Alert destination URL must use ${ALERT_DESTINATION_TAILSCALE_SUFFIX}${config.NODE_ENV === 'dev' ? ' or explicitly allowed loopback' : ''}`);
}

function hydrateDestinationStatus(destination) {
    return {
        ...destination,
        ...destinationNodePolicyStatus(destination.url),
    };
}

function validateSupportedAlertTypes(destination, alertTypeRules) {
    const assignedTypes = new Set(alertTypeRules.map(rule => rule.alert_type).filter(Boolean));
    for (const alertType of assignedTypes) {
        if (!destination.supported_alert_types.includes(alertType)) {
            throw new Error(`Destination ${destination._id} does not support alert type ${alertType}`);
        }
    }
}

async function resetRuleDestinationDeadState(dbClient, destinationId) {
    const rules = await dbClient.readMany(
        COLLECTION_ALERT_RULES,
        { 'destination_assignments.destination_id': destinationId },
        { projection: { destination_assignments: 1 } }
    );

    for (const rule of rules) {
        const destinationAssignments = (rule.destination_assignments ?? []).map(assignment => (
            assignment.destination_id === destinationId
                ? destinationAssignmentPatch(assignment, { dead: false, last_failed_at: null })
                : assignment
        ));
        await dbClient.updateOne(
            COLLECTION_ALERT_RULES,
            { _id: rule._id },
            { $set: { destination_assignments: destinationAssignments, updated_at: new Date().toISOString() } }
        );
    }
}

function destinationAssignmentPatch(assignment, patch) {
    const next = { ...assignment, ...patch };
    if (patch.last_failed_at === null) delete next.last_failed_at;
    return next;
}

function prepareAlertRuleForWrite(rule, { includeId = false } = {}) {
    const { _id, alert_destinations, ...fields } = rule;
    void alert_destinations;
    return includeId ? { _id, ...fields } : fields;
}

async function readAlertDestinationsById(dbClient) {
    const destinations = await dbClient.readMany(COLLECTION_ALERT_DESTINATIONS, {});
    return new Map(destinations.map(destination => [destination._id, hydrateDestinationStatus(destination)]));
}

async function validateRuleDestinationAssignments(dbClient, rule) {
    const destinationsById = await readAlertDestinationsById(dbClient);
    const assignments = rule.destination_assignments ?? [];
    if (!assignments.some(assignment => assignment.destination_id === BUILTIN_ALERT_DESTINATION_ID)) {
        throw new Error('alert rule requires built-in alert ingest destination');
    }
    for (const assignment of assignments) {
        const destination = destinationsById.get(assignment.destination_id);
        if (!destination) throw new Error(`Unknown alert destination: ${assignment.destination_id}`);
        validateSupportedAlertTypes(destination, rule.alert_type_rules ?? []);
    }
}

function hydrateRuleDestinations(rule, destinationsById) {
    return {
        ...rule,
        destination_assignments: (rule.destination_assignments ?? []).map(assignment => ({
            ...assignment,
            destination: destinationsById.get(assignment.destination_id) ?? null,
        })),
    };
}

function normalizeDestinationForWrite(input, currentDestination) {
    const id = input._id ?? currentDestination?._id;
    if (!id || !SLUG_RE.test(id)) throw new Error('Alert destination _id must be a slug');
    if (input.protected === true) throw new Error('API cannot create or edit protected alert destinations');
    if (input.kind === BUILTIN_ALERT_DESTINATION_KIND) throw new Error('API cannot create built-in alert destinations');
    assertAllowedDestinationUrl(input.url ?? currentDestination?.url);
    return AlertDestinationSchema.parse({
        ...currentDestination,
        ...input,
        _id: id,
        kind: input.kind ?? currentDestination?.kind ?? 'external_webhook',
        enabled: input.enabled ?? currentDestination?.enabled ?? true,
        protected: false,
    });
}

function validateMarketWatchRuleShape(rule) {
    if (normalizeAlertRuleScope(rule) !== MARKET_WATCH_SCOPE) return null;
    if (rule.ticker !== '*') return 'market_watch rule must use ticker "*"';
    if (rule.condition !== 'spread_pct') return 'market_watch rule must use condition "spread_pct"';
    if (!rule.destination_assignments?.some((assignment) => assignment.destination_id === BUILTIN_ALERT_DESTINATION_ID)) {
        return 'market_watch rule requires built-in alert ingest destination';
    }
    return null;
}

async function countOtherMarketWatchRules(dbClient, excludeId) {
    const query = { scope: MARKET_WATCH_SCOPE };
    if (excludeId) query._id = { $ne: excludeId };
    const rules = await dbClient.readMany(COLLECTION_ALERT_RULES, query, { projection: { _id: 1 } });
    return rules.length;
}

function alertRuleIdQuery(id, ObjectId) {
    return ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
}

async function notifyAlertRulesUpdated() {
    const redis = getRedisClient();
    await redis.xadd(REDIS_SIDECAR_CHANNEL, 'MAXLEN', '~', 1000, '*', 'payload', JSON.stringify({ type: 'alertrules_updated' }));
}

/**
 * GET /api/alert-rules
 * Returns all alert rules from MongoDB (enabled and disabled).
 */
export const getAlertDestinations = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const destinations = await dbClient.readMany(COLLECTION_ALERT_DESTINATIONS, {}, { sort: { label: 1 } });
        res.status(200).json({ success: true, data: destinations.map(hydrateDestinationStatus) });
    } catch (err) {
        logger.error(`getAlertDestinations Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch alert destinations' });
    }
};

export const createAlertDestination = async (req, res) => {
    try {
        const now = new Date().toISOString();
        const dbClient = await getDBClient();
        const destination = normalizeDestinationForWrite(req.body);
        await dbClient.createOne(COLLECTION_ALERT_DESTINATIONS, {
            ...destination,
            created_at: now,
            updated_at: now,
        });
        await notifyAlertRulesUpdated();
        res.status(201).json({ success: true, data: destination });
    } catch (err) {
        logger.error(`createAlertDestination Error: ${err.message}`);
        res.status(400).json({ success: false, message: err.message || 'Failed to create alert destination' });
    }
};

export const updateAlertDestination = async (req, res) => {
    const { destinationId } = req.params;
    try {
        const dbClient = await getDBClient();
        const current = (await dbClient.readMany(COLLECTION_ALERT_DESTINATIONS, { _id: destinationId }))[0];
        if (!current) return res.status(404).json({ success: false, message: 'Alert destination not found' });
        if (current.protected) return res.status(400).json({ success: false, message: 'Protected alert destinations are read-only' });
        const destination = normalizeDestinationForWrite({ ...req.body, _id: destinationId }, current);
        await dbClient.updateOne(
            COLLECTION_ALERT_DESTINATIONS,
            { _id: destinationId },
            { $set: { ...destination, updated_at: new Date().toISOString() } }
        );
        if (current.url !== destination.url) {
            await resetRuleDestinationDeadState(dbClient, destinationId);
        }
        await notifyAlertRulesUpdated();
        res.status(200).json({ success: true, data: destination });
    } catch (err) {
        logger.error(`updateAlertDestination Error: ${err.message}`);
        res.status(400).json({ success: false, message: err.message || 'Failed to update alert destination' });
    }
};

export const deleteAlertDestination = async (req, res) => {
    const { destinationId } = req.params;
    try {
        const dbClient = await getDBClient();
        const destination = (await dbClient.readMany(COLLECTION_ALERT_DESTINATIONS, { _id: destinationId }))[0];
        if (!destination) return res.status(404).json({ success: false, message: 'Alert destination not found' });
        if (destination.protected) return res.status(400).json({ success: false, message: 'Protected alert destinations cannot be deleted' });
        const references = await dbClient.readMany(COLLECTION_ALERT_RULES, { 'destination_assignments.destination_id': destinationId }, { projection: { _id: 1 } });
        if (references.length > 0) return res.status(409).json({ success: false, message: 'Alert destination is referenced by alert rules' });
        await dbClient.deleteOne(COLLECTION_ALERT_DESTINATIONS, { _id: destinationId });
        await notifyAlertRulesUpdated();
        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`deleteAlertDestination Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to delete alert destination' });
    }
};

export const getAlertRules = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const rules = await dbClient.readMany(COLLECTION_ALERT_RULES, {}, {
            sort: { created_at: -1 }
        });
        const destinationsById = await readAlertDestinationsById(dbClient);
        res.status(200).json({ success: true, data: rules.map(rule => hydrateRuleDestinations(rule, destinationsById)) });
    } catch (err) {
        logger.error(`getAlertRules Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch alert rules' });
    }
};

/**
 * POST /api/alert-rules
 * Insert a new alert rule. Publishes alertrules_updated so the sidecar reloads.
 */
export const createAlertRule = async (req, res) => {
    let body;
    try {
        body = AlertRuleSchema.parse({ ...req.body, _id: req.body._id ?? randomUUID() });
    } catch (err) {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }

    try {
        const now = new Date().toISOString();
        const dbClient = await getDBClient();
        const nextRule = prepareAlertRuleForWrite(body, { includeId: true });
        await validateRuleDestinationAssignments(dbClient, nextRule);
        const shapeError = validateMarketWatchRuleShape(nextRule);
        if (shapeError) return res.status(400).json({ error: shapeError });
        if (normalizeAlertRuleScope(nextRule) === MARKET_WATCH_SCOPE) {
            const existingCount = await countOtherMarketWatchRules(dbClient);
            if (existingCount > 0) {
                return res.status(409).json({ error: 'Only one market_watch alert rule is allowed' });
            }
        }
        const result = await dbClient.createOne(COLLECTION_ALERT_RULES, {
            ...nextRule,
            created_at: now,
            updated_at: now,
        });

        await notifyAlertRulesUpdated();

        res.status(201).json({ success: true, data: { _id: result.insertedId } });
    } catch (err) {
        logger.error(`createAlertRule Error: ${err.message}`);
        res.status(400).json({ success: false, message: err.message || 'Failed to create alert rule' });
    }
};

/**
 * PATCH /api/alert-rules/:id
 * Update an existing rule by its ObjectId. Publishes alertrules_updated.
 */
export const updateAlertRule = async (req, res) => {
    const { id } = req.params;
    let body;
    try {
        body = AlertRuleSchema.partial().parse(req.body);
    } catch (err) {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }

    try {
        const { ObjectId } = await import('mongodb');
        const dbClient = await getDBClient();
        const idQuery = alertRuleIdQuery(id, ObjectId);
        const currentRules = await dbClient.readMany(COLLECTION_ALERT_RULES, idQuery);
        const currentRule = currentRules[0];
        if (!currentRule) return res.status(404).json({ success: false, message: 'Alert rule not found' });
        const nextRule = prepareAlertRuleForWrite({ ...currentRule, ...body });
        await validateRuleDestinationAssignments(dbClient, nextRule);
        const shapeError = validateMarketWatchRuleShape(nextRule);
        if (shapeError) return res.status(400).json({ error: shapeError });
        if (normalizeAlertRuleScope(nextRule) === MARKET_WATCH_SCOPE) {
            const existingCount = await countOtherMarketWatchRules(dbClient, currentRule._id);
            if (existingCount > 0) {
                return res.status(409).json({ error: 'Only one market_watch alert rule is allowed' });
            }
        }
        await dbClient.updateOne(
            COLLECTION_ALERT_RULES,
            idQuery,
            { $set: { ...nextRule, updated_at: new Date().toISOString() } }
        );

        await notifyAlertRulesUpdated();

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`updateAlertRule Error: ${err.message}`);
        res.status(400).json({ success: false, message: err.message || 'Failed to update alert rule' });
    }
};

/**
 * DELETE /api/alert-rules/:id
 * Delete a rule, clear its Redis alert state, and publish alertrules_updated.
 */
export const deleteAlertRule = async (req, res) => {
    const { id } = req.params;

    try {
        const { ObjectId } = await import('mongodb');
        const dbClient = await getDBClient();
        await dbClient.deleteOne(COLLECTION_ALERT_RULES, alertRuleIdQuery(id, ObjectId));

        const redis = getRedisClient();
        await redis.del(`alert:state:${id}`);
        await redis.del(`alert:lock:${id}`);
        await notifyAlertRulesUpdated();

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`deleteAlertRule Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to delete alert rule' });
    }
};

async function updateDestinationState(ruleId, destinationId, patch) {
    const { ObjectId } = await import('mongodb');
    const dbClient = await getDBClient();
    const idQuery = alertRuleIdQuery(ruleId, ObjectId);
    const rules = await dbClient.readMany(COLLECTION_ALERT_RULES, idQuery, { projection: { destination_assignments: 1 } });
    const rule = rules[0];
    if (!rule) return null;
    if (!rule.destination_assignments?.some((assignment) => assignment.destination_id === destinationId)) return null;
    const assignments = rule.destination_assignments.map((assignment) => (
        assignment.destination_id === destinationId ? destinationAssignmentPatch(assignment, patch) : assignment
    ));
    await dbClient.updateOne(
        COLLECTION_ALERT_RULES,
        idQuery,
        { $set: { destination_assignments: assignments, updated_at: new Date().toISOString() } }
    );
    await notifyAlertRulesUpdated();
    return assignments.find((assignment) => assignment.destination_id === destinationId) ?? null;
}

export const resetAlertDestination = async (req, res) => {
    const { id, destinationId } = req.params;

    try {
        const destination = await updateDestinationState(id, destinationId, { dead: false, last_failed_at: null });
        if (!destination) return res.status(404).json({ success: false, message: 'Alert destination not found' });
        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`resetAlertDestination Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to reset alert destination' });
    }
};

export const markAlertDestinationDead = async (req, res) => {
    if (!validateSignature(req.header('X-Signature'), req.header('X-Timestamp'), SNAPPER_API_SECRET)) {
        return res.status(401).json({ message: 'Invalid signature.' });
    }

    const { id, destinationId } = req.params;
    const lastFailedAt = new Date().toISOString();

    try {
        const destination = await updateDestinationState(id, destinationId, { dead: true, last_failed_at: lastFailedAt });
        if (!destination) return res.status(404).json({ success: false, message: 'Alert destination not found' });

        const io = getIO();
        if (io) io.emit('alertDestinationDead', { rule_id: id, destination_id: destinationId });

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`markAlertDestinationDead Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to mark alert destination dead' });
    }
};

/**
 * POST /api/alert-events/ingest
 * Built-in alert event receiver. Validates signature and logs to MongoDB.
 */
export const postAlertEventIngest = async (req, res) => {
    if (!validateSignature(req.header('X-Signature'), req.header('X-Timestamp'), SNAPPER_API_SECRET)) {
        return res.status(401).json({ message: 'Invalid signature.' });
    }

    let body;
    try {
        body = AlertEventIngestSchema.parse(req.body);
    } catch (err) {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }

    try {
        const dbClient = await getDBClient();
        await dbClient.createIndex(config.COLLECTION_ALERT_LOGS, { alert_event_id: 1 }, { name: ALERT_EVENT_ID_INDEX, unique: true });
        const alertLog = {
            ...body,
            fired_at: new Date(body.triggered_at),
            received_at: new Date(),
        };

        try {
            await dbClient.createOne(config.COLLECTION_ALERT_LOGS, alertLog);
        } catch (err) {
            if (err?.code !== 11000) throw err;
        }

        const io = getIO();
        if (io) {
            io.emit('alertFired', alertLog);
        }

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`postAlertEventIngest Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to log alert event' });
    }
};

/**
 * GET /api/alerts/logs
 * Returns latest alert logs from MongoDB.
 */
export const getAlertLogs = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const dbClient = await getDBClient();
        const logs = await dbClient.readMany(config.COLLECTION_ALERT_LOGS, {}, {
            sort: { received_at: -1 },
            limit
        });

        res.status(200).json({ success: true, data: logs });
    } catch (err) {
        logger.error(`getAlertLogs Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to fetch alert logs' });
    }
};


const DEFAULT_DELTA_RATIOS = {
    danger_ratio: 1.06,
    target_liq_ratio: 1.12,
    reduce_ratio: 1.18,
};

const SUPPORTED_DELTA_SPOT_EXCHANGES = new Set([
    'binance',
    'bitget',
    'bithumb',
    'bybit',
    'coinbase',
    'coinone',
    'cryptocom',
    'gateio',
    'huobi',
    'kraken',
    'kucoin',
    'mexc',
    'okx',
    'upbit',
]);
const DELTA_SPOT_EXCHANGE_LIST = DELTA_SPOT_EXCHANGES
    .split(',')
    .map(exchange => exchange.trim().toLowerCase())
    .filter(Boolean);
const UNSUPPORTED_DELTA_SPOT_EXCHANGES = DELTA_SPOT_EXCHANGE_LIST
    .filter(exchange => !SUPPORTED_DELTA_SPOT_EXCHANGES.has(exchange));
if (UNSUPPORTED_DELTA_SPOT_EXCHANGES.length > 0) {
    throw new Error(`Unsupported delta spot exchange(s): ${UNSUPPORTED_DELTA_SPOT_EXCHANGES.join(', ')}`);
}
const DELTA_SPOT_EXCHANGE_SET = new Set(DELTA_SPOT_EXCHANGE_LIST);

function toOptionalRatio(value, name) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value.trim())) {
        throw new Error(`${name} must be a positive decimal number`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive decimal number`);
    }
    return parsed;
}

function mongoNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'object') {
        if (typeof value.$numberDecimal === 'string') {
            const parsed = Number(value.$numberDecimal);
            return Number.isFinite(parsed) ? parsed : null;
        }
        if (typeof value.toString === 'function') {
            const parsed = Number(value.toString());
            if (Number.isFinite(parsed)) return parsed;
        }
    }
    return null;
}

function ratioValue(doc, name) {
    return toOptionalRatio(mongoNumber(doc?.[name]), name) ?? DEFAULT_DELTA_RATIOS[name];
}

function liquidationRisk(doc) {
    const markPrice = mongoNumber(doc.mark_price);
    const liqPrice = mongoNumber(doc.liq_price);
    if (!Number.isFinite(markPrice) || markPrice <= 0 || !Number.isFinite(liqPrice)) return Number.POSITIVE_INFINITY;
    return Math.abs((liqPrice - markPrice) / markPrice);
}

function spotCoverageRatio(doc) {
    const spotBalance = mongoNumber(doc.spot_balance);
    const positionAmount = Math.abs(mongoNumber(doc.position_amt) ?? Number.NaN);
    if (!Number.isFinite(spotBalance) || !Number.isFinite(positionAmount) || positionAmount <= 0) return null;
    return spotBalance / positionAmount;
}

function positionUsdValue(amount, markPrice) {
    if (!Number.isFinite(amount) || !Number.isFinite(markPrice)) return null;
    return Math.abs(amount) * markPrice;
}

function normalizeSpotExchange(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new Error('spot_exchange must be a supported exchange');
    const normalized = value.trim().toLowerCase();
    if (!DELTA_SPOT_EXCHANGE_SET.has(normalized)) {
        throw new Error(`spot_exchange must be one of: ${DELTA_SPOT_EXCHANGE_LIST.join(', ')}`);
    }
    return normalized;
}

function normalizePositionDocument(doc, spotPrices = new Map()) {
    const positionAmount = mongoNumber(doc.position_amt);
    const markPrice = mongoNumber(doc.mark_price);
    const spotBalance = mongoNumber(doc.spot_balance);
    const spotPrice = spotPrices.get(String(doc.coin ?? '').toUpperCase()) ?? null;
    return {
        exchange: doc.exchange ?? 'binance',
        symbol: doc.symbol,
        coin: doc.coin,
        entry_price: mongoNumber(doc.entry_price),
        mark_price: markPrice,
        liq_price: mongoNumber(doc.liq_price),
        isolated_margin: mongoNumber(doc.isolated_margin),
        position_amt: positionAmount,
        short_position_amount: positionAmount,
        short_position_value: positionUsdValue(positionAmount, markPrice),
        spot_exchange: doc.spot_exchange ?? null,
        spot_balance: spotBalance,
        spot_price: spotPrice,
        spot_balance_value: positionUsdValue(spotBalance, spotPrice),
        spot_balance_updated_at: doc.spot_balance_updated_at ?? null,
        spot_balance_error: doc.spot_balance_error ?? null,
        spot_balance_error_at: doc.spot_balance_error_at ?? null,
        spot_coverage_ratio: spotCoverageRatio(doc),
        spot_exchange_updated_at: doc.spot_exchange_updated_at,
        spot_exchange_updated_by: doc.spot_exchange_updated_by,
        max_withdraw: mongoNumber(doc.max_withdraw),
        liq_deviance: mongoNumber(doc.liq_deviance),
        danger_ratio: ratioValue(doc, 'danger_ratio'),
        target_liq_ratio: ratioValue(doc, 'target_liq_ratio'),
        reduce_ratio: ratioValue(doc, 'reduce_ratio'),
        ratio_updated_at: doc.ratio_updated_at,
        ratio_updated_by: doc.ratio_updated_by,
        updated_at: doc.updated_at,
        position_side: doc.position_side,
        status: doc.status,
        liquidation_risk: liquidationRisk(doc),
    };
}

export const getDeltaSpotExchanges = async (req, res) => {
    return res.json({ success: true, data: DELTA_SPOT_EXCHANGE_LIST });
};

export const getDeltaPositions = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const positions = await dbClient.readMany(
            COLLECTION_FUTURES_POSITIONS,
            { status: 'active' },
        );
        const activeShorts = positions.filter(position => (mongoNumber(position.position_amt) ?? 0) < 0);
        const coins = [...new Set(activeShorts.map(position => String(position.coin ?? '').toLowerCase()).filter(Boolean))];
        const priceDocs = coins.length > 0
            ? await dbClient.readMany(
                COLLECTION_COINGECKO_RANK,
                { symbol: { $in: coins } },
                { projection: { symbol: 1, current_price: 1, _id: 0 } },
            )
            : [];
        const spotPrices = new Map(priceDocs.map(doc => [String(doc.symbol).toUpperCase(), mongoNumber(doc.current_price)]));
        const shorts = activeShorts
            .map(position => normalizePositionDocument(position, spotPrices))
            .sort((a, b) => a.liquidation_risk - b.liquidation_risk || String(a.symbol).localeCompare(String(b.symbol)));
        return res.json({ success: true, data: shorts });
    } catch (error) {
        logger.error('Failed to load delta positions:', error);
        return res.status(500).json({ success: false, error: 'Failed to load delta positions' });
    }
};


export const updateDeltaPositionSpotExchange = async (req, res) => {
    try {
        const { exchange, symbol } = req.params;
        const spotExchange = normalizeSpotExchange(req.body?.spot_exchange);
        const dbClient = await getDBClient();
        const positionQuery = {
            symbol,
            status: 'active',
            ...(exchange === 'binance'
                ? { $or: [{ exchange }, { exchange: { $exists: false } }] }
                : { exchange }),
        };
        const existing = (await dbClient.readMany(
            COLLECTION_FUTURES_POSITIONS,
            positionQuery,
            { limit: 1 },
        ))[0];
        if (!existing || Number(existing.position_amt) >= 0) {
            return res.status(404).json({ success: false, error: 'Active delta position not found' });
        }

        const shouldClearSpotState = spotExchange !== existing.spot_exchange;
        const setFields = {
            spot_exchange: spotExchange,
            spot_exchange_updated_at: new Date(),
            spot_exchange_updated_by: req.user?.userId || 'web',
        };
        const update = shouldClearSpotState
            ? {
                $set: setFields,
                $unset: {
                    spot_balance: '',
                    spot_balance_updated_at: '',
                    spot_balance_error: '',
                    spot_balance_error_at: '',
                },
            }
            : { $set: setFields };

        await dbClient.updateOne(
            COLLECTION_FUTURES_POSITIONS,
            positionQuery,
            update,
        );

        return res.json({ success: true, data: { exchange, symbol, spot_exchange: spotExchange } });
    } catch (error) {
        if (error instanceof Error && error.message.includes('spot_exchange')) {
            return res.status(400).json({ success: false, error: error.message });
        }
        logger.error('Failed to update delta spot exchange:', error);
        return res.status(500).json({ success: false, error: 'Failed to update delta spot exchange' });
    }
};

export const updateDeltaPositionRatios = async (req, res) => {
    try {
        const { exchange, symbol } = req.params;
        const requested = {
            danger_ratio: toOptionalRatio(req.body?.danger_ratio, 'danger_ratio'),
            target_liq_ratio: toOptionalRatio(req.body?.target_liq_ratio, 'target_liq_ratio'),
            reduce_ratio: toOptionalRatio(req.body?.reduce_ratio, 'reduce_ratio'),
        };
        if (Object.values(requested).every(value => value === undefined)) {
            return res.status(400).json({ success: false, error: 'At least one ratio field is required' });
        }

        const dbClient = await getDBClient();
        const positionQuery = {
            symbol,
            status: 'active',
            ...(exchange === 'binance'
                ? { $or: [{ exchange }, { exchange: { $exists: false } }] }
                : { exchange }),
        };
        const existing = (await dbClient.readMany(
            COLLECTION_FUTURES_POSITIONS,
            positionQuery,
            { limit: 1 },
        ))[0];
        if (!existing || Number(existing.position_amt) >= 0) {
            return res.status(404).json({ success: false, error: 'Active delta position not found' });
        }

        const merged = {
            danger_ratio: requested.danger_ratio ?? ratioValue(existing, 'danger_ratio'),
            target_liq_ratio: requested.target_liq_ratio ?? ratioValue(existing, 'target_liq_ratio'),
            reduce_ratio: requested.reduce_ratio ?? ratioValue(existing, 'reduce_ratio'),
        };
        if (!(merged.danger_ratio < merged.target_liq_ratio && merged.target_liq_ratio < merged.reduce_ratio)) {
            return res.status(400).json({
                success: false,
                error: 'margin ratios must satisfy danger_ratio < target_liq_ratio < reduce_ratio',
            });
        }

        await dbClient.updateOne(
            COLLECTION_FUTURES_POSITIONS,
            positionQuery,
            {
                $set: {
                    ...merged,
                    ratio_updated_at: new Date(),
                    ratio_updated_by: req.user?.userId || 'web',
                },
            },
        );

        return res.json({ success: true, data: { exchange, symbol, ...merged } });
    } catch (error) {
        if (error instanceof Error && error.message.includes('must be a positive decimal number')) {
            return res.status(400).json({ success: false, error: error.message });
        }
        logger.error('Failed to update delta ratios:', error);
        return res.status(500).json({ success: false, error: 'Failed to update delta ratios' });
    }
};
