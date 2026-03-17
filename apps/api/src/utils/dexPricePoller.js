import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getRedisClient, getDBClient } from '@bemodest/database';
import { logger } from '@bemodest/utils';
import {
    COLLECTION_CONTRACT_MAPPINGS,
    DEX_POLL_WORKERS,
    DEX_REDIS_CHANNEL,
    PROXY_URL,
} from '../config/env.js';

const GECKOTERMINAL_BASE_URL = 'https://api.geckoterminal.com/api/v2/networks';
// Removed shadow import
const MAX_ADDRESSES_PER_REQUEST = 30;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_FACTOR = 2;
const INITIAL_RETRY_DELAY_MS = 1000;
const WORKER_POLL_DELAY_MS = 6000;

// Created once; undefined means direct (no proxy)
const PROXY_AGENT = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;

/**
 * Fetches GeckoTerminal multi-token data for a single batched network request.
 * Implements exponential backoff (S-3006).
 * @param {string} network
 * @param {string[]} addresses - max 30
 * @returns {Promise<object[]>}
 */
async function fetchNetworkTokens(network, addresses) {
    const url = `${GECKOTERMINAL_BASE_URL}/${network}/tokens/multi/${addresses.join(',')}`;
    let lastError;
    let delayMs = INITIAL_RETRY_DELAY_MS;

    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120_000);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                agent: PROXY_AGENT,
                headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            });
            clearTimeout(timeoutId);

            if (response.status === 429 || response.status >= 500) {
                throw new Error(`HTTP ${response.status}`);
            }
            if (!response.ok) {
                logger.warn(`[DexPoller] Non-retryable HTTP ${response.status} network=${network}`);
                return [];
            }
            const json = await response.json();
            return json.data ?? [];
        } catch (err) {
            clearTimeout(timeoutId);
            lastError = err;
            logger.warn(`[DexPoller] Attempt ${attempt}/${MAX_RETRY_ATTEMPTS} network=${network}: ${err.message}`);
            if (attempt < MAX_RETRY_ATTEMPTS) {
                await new Promise(r => setTimeout(r, delayMs));
                delayMs *= RETRY_BACKOFF_FACTOR;
            }
        }
    }

    logger.error(`[DexPoller] Retries exhausted network=${network}: ${lastError?.message}`);
    return [];
}

/**
 * Resolves canonical base symbol from GeckoTerminal token attributes.
 * Priority: coingecko_id lookup → address lookup → raw symbol (W-prefix stripped).
 * @param {object} attrs - GeckoTerminal token attributes
 * @param {string} network
 * @param {Map<string, string>} idToSymbol  - coingecko_id → uppercase symbol
 * @param {Map<string, string>} addrToSymbol - `network:address` → uppercase symbol
 * @returns {string}
 */
function resolveBaseSymbol(attrs, network, idToSymbol, addrToSymbol) {
    const coingeckoId = attrs.coingecko_coin_id ?? '';
    if (coingeckoId && idToSymbol.has(coingeckoId)) {
        return idToSymbol.get(coingeckoId).toUpperCase();
    }

    const addr = (attrs.address ?? '').toLowerCase();
    const addrKey = `${network}:${addr}`;
    if (addrToSymbol.has(addrKey)) {
        return addrToSymbol.get(addrKey).toUpperCase();
    }

    const raw = (attrs.symbol ?? '').toUpperCase();
    return raw.startsWith('W') && raw.length > 1 ? raw.slice(1) : raw;
}

/**
 * Normalizes a GeckoTerminal token into a NormalizedTicker-compatible JSON string.
 * @param {object} token
 * @param {string} network - GeckoTerminal network code
 * @param {Map<string, string>} idToSymbol
 * @param {Map<string, string>} addrToSymbol
 * @param {string} caip2Id - standardized network ID
 * @returns {string|null}
 */
function normalizeToken(token, network, idToSymbol, addrToSymbol, caip2Id) {
    const attrs = token?.attributes;
    if (!attrs?.price_usd) return null;

    const base = resolveBaseSymbol(attrs, network, idToSymbol, addrToSymbol);
    const now = Date.now();

    return JSON.stringify({
        type: 'normalized_ticker',
        source: `dex_${caip2Id.replace(':', '_')}`, // Standardized source identifier
        data: {
            base,
            quote: 'USD',
            o: attrs.price_usd,
            h: attrs.price_usd,
            l: attrs.price_usd,
            c: attrs.price_usd,
            v_base: '0',
            v_quote: attrs.volume_usd?.h24 ?? '0',
            liquidity: attrs.total_reserve_in_usd ?? '0',
            timestamp_ms: now,
            market_state: 'Active',
            ingest_time_us: now * 1_000,
        },
    });
}

/**
 * Worker function that continuously fetches tokens from a task generator.
 * @param {number} workerId
 * @param {Generator<{network: string, batch: string[]}>} generator
 * @param {Map<string, string>} idToSymbol
 * @param {Map<string, string>} addrToSymbol
 * @param {import('ioredis').Redis} redis
 * @returns {Promise<void>}
 */
async function workerLoop(workerId, generator, idToSymbol, addrToSymbol, redis, gtToCaip2) {
    logger.info(`[DexPoller] Worker ${workerId} started`);
    for (const task of generator) {
        try {
            const { network, batch } = task;
            const caip2Id = gtToCaip2[network] || network; // Fallback to raw GT net if no map
            const tokens = await fetchNetworkTokens(network, batch);

            for (const token of tokens) {
                const msg = normalizeToken(token, network, idToSymbol, addrToSymbol, caip2Id);
                if (!msg) continue;
                try {
                    await redis.publish(DEX_REDIS_CHANNEL, msg);
                } catch (pubErr) {
                    logger.error(`[DexPoller] Worker ${workerId} Redis publish error: ${pubErr.message}`);
                }
            }
            // Respect API rate limits
            await new Promise(r => setTimeout(r, WORKER_POLL_DELAY_MS));
        } catch (err) {
            logger.error(`[DexPoller] Worker ${workerId} cycle error: ${err.message}`);
            await new Promise(r => setTimeout(r, WORKER_POLL_DELAY_MS));
        }
    }
    logger.info(`[DexPoller] Worker ${workerId} exited`);
}

/**
 * Creates an infinite generator of polling tasks.
 * @param {Map<string, string[]>} networkToAddresses
 * @returns {Generator<{network: string, batch: string[]}>}
 */
function* getTaskGenerator(networkToAddresses) {
    if (networkToAddresses.size === 0) {
        logger.warn(`[DexPoller] No networks to poll. Task generator is empty.`);
        return;
    }
    while (true) {
        for (const [network, addresses] of networkToAddresses.entries()) {
            for (let i = 0; i < addresses.length; i += MAX_ADDRESSES_PER_REQUEST) {
                yield { network, batch: addresses.slice(i, i + MAX_ADDRESSES_PER_REQUEST) };
            }
        }
    }
}

/**
 * Loads coingeckoContractMappings and builds per-network address pools.
 * Every network address from every coin is included.
 * @returns {Promise<{
 *   networkToAddresses: Map<string, string[]>,
 *   idToSymbol: Map<string, string>,
 *   addrToSymbol: Map<string, string>
 * }>}
 */
async function loadContractMappings() {
    const db = await getDBClient();
    const docs = await db.readMany(COLLECTION_CONTRACT_MAPPINGS, {}, {
        projection: { id: 1, symbol: 1, contracts: 1, _id: 0 },
    });

    /** @type {Map<string, string[]>} */
    const networkToAddresses = new Map();
    /** @type {Map<string, string>} */
    const idToSymbol = new Map();
    /** @type {Map<string, string>} */
    const addrToSymbol = new Map();

    for (const doc of docs) {
        if (!doc.id || !doc.symbol || !doc.contracts) continue;
        idToSymbol.set(doc.id, doc.symbol);

        for (const [network, address] of Object.entries(doc.contracts)) {
            if (!address || typeof address !== 'string') continue;
            // Pool addresses per network across all coins
            if (!networkToAddresses.has(network)) networkToAddresses.set(network, []);
            networkToAddresses.get(network).push(address);
            // Address-level fallback lookup: network:address → symbol
            addrToSymbol.set(`${network}:${address.toLowerCase()}`, doc.symbol);
        }
    }

    logger.info(
        `[DexPoller] Loaded ${docs.length} coins across ${networkToAddresses.size} network(s)`
    );
    return { networkToAddresses, idToSymbol, addrToSymbol };
}

/**
 * Initializes and starts the DEX price poller.
 * Uses concurrent workers pulling from a shared task generator.
 * @returns {Promise<void>}
 */
export async function initDexPricePoller() {
    logger.info(`[DexPoller] Starting (proxy=${PROXY_URL ? 'active' : 'none'}, workers=${DEX_POLL_WORKERS})`);

    let networkToAddresses, idToSymbol, addrToSymbol;
    try {
        ({ networkToAddresses, idToSymbol, addrToSymbol } = await loadContractMappings());
    } catch (err) {
        logger.error(`[DexPoller] Failed to load mappings: ${err.message}`);
        return;
    }

    const db = await getDBClient();
    const redis = getRedisClient();
    const generator = getTaskGenerator(networkToAddresses);

    // Build reverse map: GT Network -> CAIP-2
    const caip2ToGT = await db.getCaip2ToGeckoTerminalMapping(COLLECTION_CHAINS);

    const gtToCaip2 = {};
    for (const [caip2, gt] of Object.entries(caip2ToGT)) {
        gtToCaip2[gt] = caip2;
    }

    const workers = [];
    for (let i = 1; i <= DEX_POLL_WORKERS; i++) {
        workers.push(workerLoop(i, generator, idToSymbol, addrToSymbol, redis, gtToCaip2));
    }

    await Promise.allSettled(workers);
}
