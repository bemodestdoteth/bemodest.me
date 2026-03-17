import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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
    JWT_EXPIRES_IN_WEB,
    JWT_EXPIRES_IN_EXTENSION,
    COOKIE_MAX_AGE_MS,
    COOKIE_NAME,
    COOKIE_SAME_SITE,
    SIDECAR_URL,
    DW_TASKS_STREAM,
    DW_STATUS_TTL_S
} = config;
import {
    LabelDeleteBulkSchema,
    DwStatusBodySchema,
    DwDeepDiveTaskSchema,
    AlertRuleSchema,
} from '@bemodest/database';

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
        await dbClient.enrichLabelsWithEntityImages(result, COLLECTION_ENTITES);

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
    if (!validateSignature(req.header('X-Signature'), req.header('X-Timestamp'))) {
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
            projection: { caip2: 1, 'annotation.code': 1, _id: 0 }
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
                caipMap[chain.caip2] = chain.annotation?.code || chain.name;
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
    if (!validateSignature(req.header('X-Signature'), req.header('X-Timestamp'))) {
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
        const networkEncoded = network.replace(':', '/');
        const key = `dw:${exchange}:${networkEncoded}:${ticker.toUpperCase()}`;
        await redis.set(key, status, 'EX', DW_STATUS_TTL_S);

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

    try {
        const redis = getRedisClient();
        const pattern = `dw:*:*:${ticker.toUpperCase()}`;
        const keys = [];
        const stream = redis.scanStream({ match: pattern, count: 100 });
        stream.on('data', chunk => keys.push(...chunk));
        await Promise.race([
            new Promise((resolve, reject) => {
                stream.on('end', resolve);
                stream.on('error', reject);
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('scanStream timeout')), SCAN_TIMEOUT_MS)
            ),
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

/**
 * GET /api/alert-rules
 * Returns all alert rules from MongoDB (enabled and disabled).
 */
export const getAlertRules = async (req, res) => {
    try {
        const dbClient = await getDBClient();
        const rules = await dbClient.readMany(COLLECTION_ALERT_RULES, {}, {
            sort: { created_at: -1 }
        });
        res.status(200).json({ success: true, data: rules });
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
        body = AlertRuleSchema.parse(req.body);
    } catch (err) {
        return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }

    try {
        const now = new Date();
        const dbClient = await getDBClient();
        const result = await dbClient.insertOne(COLLECTION_ALERT_RULES, {
            ...body,
            created_at: now,
            updated_at: now,
        });

        const redis = getRedisClient();
        await redis.xadd(REDIS_SIDECAR_CHANNEL, 'MAXLEN', '~', 1000, '*', 'payload', JSON.stringify({ type: 'alertrules_updated' }));

        res.status(201).json({ success: true, data: { _id: result.insertedId } });
    } catch (err) {
        logger.error(`createAlertRule Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to create alert rule' });
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
        await dbClient.updateOne(
            COLLECTION_ALERT_RULES,
            { _id: new ObjectId(id) },
            { $set: { ...body, updated_at: new Date() } }
        );

        const redis = getRedisClient();
        await redis.xadd(REDIS_SIDECAR_CHANNEL, 'MAXLEN', '~', 1000, '*', 'payload', JSON.stringify({ type: 'alertrules_updated' }));

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`updateAlertRule Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to update alert rule' });
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
        await dbClient.deleteOne(COLLECTION_ALERT_RULES, { _id: new ObjectId(id) });

        // Clear sidecar-side Redis state for this rule
        const redis = getRedisClient();
        await redis.del(`alert:state:${id}`);
        await redis.del(`alert:lock:${id}`);
        await redis.xadd(REDIS_SIDECAR_CHANNEL, 'MAXLEN', '~', 1000, '*', 'payload', JSON.stringify({ type: 'alertrules_updated' }));

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`deleteAlertRule Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to delete alert rule' });
    }
};

/**
 * PATCH /api/alert-rules/:id/reset-webhook
 * Clears webhook_dead flag so the sidecar will retry delivery.
 * Called after the user fixes the destination URL or the target recovers.
 */
export const resetWebhookDead = async (req, res) => {
    const { id } = req.params;

    try {
        const { ObjectId } = await import('mongodb');
        const dbClient = await getDBClient();
        await dbClient.updateOne(
            COLLECTION_ALERT_RULES,
            { _id: new ObjectId(id) },
            { $set: { webhook_dead: false, updated_at: new Date() } }
        );

        const redis = getRedisClient();
        await redis.xadd(REDIS_SIDECAR_CHANNEL, 'MAXLEN', '~', 1000, '*', 'payload', JSON.stringify({ type: 'alertrules_updated' }));

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`resetWebhookDead Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to reset webhook_dead' });
    }
};

/**
 * PATCH /api/alert-rules/:id/mark-dead
 * Internal endpoint — called by the sidecar webhook dispatcher after 3
 * consecutive delivery failures. Not exposed in the public API docs.
 */
export const markWebhookDead = async (req, res) => {
    const { id } = req.params;

    try {
        const { ObjectId } = await import('mongodb');
        const dbClient = await getDBClient();
        await dbClient.updateOne(
            COLLECTION_ALERT_RULES,
            { _id: new ObjectId(id) },
            { $set: { webhook_dead: true, updated_at: new Date() } }
        );

        // Notify UI via Socket.IO
        const io = getIO();
        if (io) io.emit('alertRuleWebhookDead', { rule_id: id });

        res.status(200).json({ success: true });
    } catch (err) {
        logger.error(`markWebhookDead Error: ${err.message}`);
        res.status(500).json({ success: false, message: 'Failed to mark webhook dead' });
    }
};
