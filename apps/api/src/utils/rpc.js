import logger from '../config/logger.js';
import { MongoDBClient } from '@bemodest/database';
import { COLLECTION_CHAINS } from '../config/env.js';
import { interpolateSecrets } from '@bemodest/utils';

const rpcMap = new Map();       // key: CAIP-2 ID → { urls: string[], idx: number }
const chainIdToCAIP2 = new Map(); // numeric chainId → CAIP-2 ID

// failure tracking: url → { failCount, cooldownUntil }
const failureMap = new Map();

const FAIL_THRESHOLD = 3;
const FAIL_WINDOW_MS = 60_000;
const COOLDOWN_MS = 120_000;

function isOnCooldown(url) {
    const entry = failureMap.get(url);
    if (!entry) return false;
    if (entry.cooldownUntil && Date.now() < entry.cooldownUntil) return true;
    return false;
}

/**
 * @param {string} url
 */
export function reportRpcFailure(url) {
    const now = Date.now();
    const entry = failureMap.get(url) || { failCount: 0, windowStart: now, cooldownUntil: 0 };

    // Reset window if expired
    if (now - entry.windowStart > FAIL_WINDOW_MS) {
        entry.failCount = 0;
        entry.windowStart = now;
    }

    entry.failCount += 1;
    if (entry.failCount >= FAIL_THRESHOLD) {
        entry.cooldownUntil = now + COOLDOWN_MS;
        logger.warn(`[RPC] ${url} on cooldown until ${new Date(entry.cooldownUntil).toISOString()}`);
    }

    failureMap.set(url, entry);

    // Prune expired entries
    for (const [k, v] of failureMap.entries()) {
        if (v.cooldownUntil < now && now - v.windowStart > FAIL_WINDOW_MS) {
            failureMap.delete(k);
        }
    }
}

/**
 * @param {string|number} caip2Id - CAIP-2 ID OR numeric chainId
 * @returns {string|null}
 */
export function getRpcUrl(caip2Id) {
    if (typeof caip2Id === 'number') {
        caip2Id = chainIdToCAIP2.get(caip2Id);
        if (!caip2Id) return null;
    }

    const entry = rpcMap.get(caip2Id);
    if (!entry || entry.urls.length === 0) return null;

    const len = entry.urls.length;
    for (let i = 0; i < len; i++) {
        const url = entry.urls[(entry.idx + i) % len];
        if (!isOnCooldown(url)) {
            entry.idx = (entry.idx + i + 1) % len;
            return url;
        }
    }
    // all on cooldown — return first as last resort
    return entry.urls[0];
}

export async function initRpcManager() {
    try {
        const db = new MongoDBClient();
        await db.connect();
        const docs = await db.readMany(
            COLLECTION_CHAINS,
            { caip2: { $exists: true }, rpc: { $exists: true, $ne: [] } },
            { projection: { caip2: 1, chainId: 1, rpc: 1, _id: 0 } }
        );
        await db.close();

        for (const doc of docs) {
            const caip2 = doc.caip2;

            if (doc.chainId != null && !chainIdToCAIP2.has(doc.chainId)) {
                chainIdToCAIP2.set(doc.chainId, caip2);
            }

            const urls = interpolateSecrets(doc.rpc ?? [])
                .filter(u => typeof u === 'string' && u.startsWith('http'));

            if (urls.length) {
                rpcMap.set(caip2, { urls: [...new Set(urls)], idx: 0 });
            }
        }
        logger.info(`[RPC] Seeded ${docs.length} chain(s) from codys.chains`);
    } catch (err) {
        logger.error(`[RPC] codys.chains seed failed: ${err.message}`);
    }

    // Load valid EVM chain IDs from geckoTerminalChainList
    let allowedChainIds = null;
    try {
        const db = new MongoDBClient();
        await db.connect();
        const docs = await db.readMany('geckoTerminalChainList', { chain_identifier: { $type: 'number' } }, { projection: { chain_identifier: 1, _id: 0 } });
        await db.close();
        allowedChainIds = new Set(docs.map(d => d.chain_identifier));
        logger.info(`[RPC] Loaded ${allowedChainIds.size} allowed chain IDs from geckoTerminalChainList`);
    } catch (err) {
        logger.warn(`[RPC] Could not load geckoTerminalChainList: ${err.message}`);
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const resp = await fetch('https://chainlist.org/rpcs.json', { signal: controller.signal });
        clearTimeout(timeout);

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const list = await resp.json();

        for (const chainObj of list) {
            const chainId = chainObj.chainId;

            // Scope to chains known by geckoTerminalChainList (when available)
            if (allowedChainIds && !allowedChainIds.has(chainId)) continue;

            const caip2 = chainIdToCAIP2.get(chainId);
            if (!caip2) continue;

            // Take only top 3 operational RPCs
            const remoteUrls = (chainObj.rpc || [])
                .map(r => (typeof r === 'string' ? r : r?.url))
                .filter(u => u && u.startsWith('http') && !u.includes('${'))
                .slice(0, 3);

            if (remoteUrls.length > 0) {
                const entry = rpcMap.get(caip2) || { urls: [], idx: 0 };
                // Merge: put remote urls first, keep DB as fallback
                const merged = [...new Set([...remoteUrls, ...entry.urls])];
                rpcMap.set(caip2, { urls: merged, idx: 0 });
            }
        }

        logger.info('[RPC] chainlist.org RPCs loaded (capped at 3 per chain)');
    } catch (err) {
        logger.warn(`[RPC] chainlist fetch failed: ${err.message}`);
    }
}

