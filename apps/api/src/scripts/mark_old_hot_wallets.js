import { validateApiConfig } from '@bemodest/config';
const { COLLECTION_ADDRS } = validateApiConfig();
import { createPublicClient, defineChain, formatEther, http } from 'viem';
import { MongoDBClient } from '@bemodest/database';
import { logger } from '@bemodest/utils';
import { initRpcManager, getRpcUrl, reportRpcFailure } from '../utils/rpc.js';

// ─── Parameters ────────────────────────────────────────────────────────────────
const ENTITY = process.env.TARGET_ENTITY || 'Upbit Hot';
const CHAIN_FILTER = process.env.TARGET_CHAIN || 'eip155:8453';
const CUTOFF_DATE = process.env.CUTOFF_DATE || '2025-12-01';
const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_LIMIT = parseInt(process.env.TARGET_LIMIT || '0', 10);
const ETHERSCAN_KEY = process.env.ETHERSCAN_API_KEY || '';
const ETHERSCAN_BASE = 'https://api.etherscan.io/v2/api';

// ─── Constants ─────────────────────────────────────────────────────────────────
const CUTOFF_TIMESTAMP_S = Math.floor(new Date(CUTOFF_DATE).getTime() / 1_000);
const ETHERSCAN_DELAY_MS = 250; // ~4 req/s — well within free-tier 5 req/s limit
const MAX_ETH_RPC_ATTEMPTS = 3;
const RPC_TIMEOUT_MS = 5_000;

function targetChainId() {
    const raw = CHAIN_FILTER.split(':')[1];
    const chainId = Number.parseInt(raw || '1', 10);
    return Number.isFinite(chainId) ? chainId : 1;
}

function defineTargetChain(rpcUrl) {
    const chainId = targetChainId();
    return defineChain({
        id: chainId,
        name: `EIP-155 ${chainId}`,
        nativeCurrency: {
            decimals: 18,
            name: 'Ether',
            symbol: 'ETH',
        },
        rpcUrls: {
            default: {
                http: [rpcUrl],
            },
        },
    });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** @param {number} ms */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fetches the ETH balance (in ETH) for an address via ethers provider.
 * Retries up to MAX_ETH_RPC_ATTEMPTS with exponential backoff (S-3006).
 * @param {string} addr
 * @param {number} [attempt]
 * @returns {Promise<number>}
 */
async function fetchEthBalance(addr, attempt = 1) {
    const rpcUrl = getRpcUrl(CHAIN_FILTER);
    if (!rpcUrl) {
        logger.warn(`[Balance] No RPC available for ${CHAIN_FILTER}`);
        return 0;
    }
    try {
        const client = createPublicClient({
            chain: defineTargetChain(rpcUrl),
            transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS }),
        });
        const raw = await client.getBalance({ address: addr });
        return Number(formatEther(raw));
    } catch (/** @type {any} */ err) {
        reportRpcFailure(rpcUrl);

        let msg = err.message;
        if (err.code === 'TIMEOUT') msg = 'Connection timeout';
        else if (err.message?.includes('certificate has expired')) msg = 'SSL certificate expired';
        else if (err.message?.includes('getaddrinfo ENOTFOUND')) msg = 'DNS lookup failed';

        logger.warn(`[Balance] ${addr} (attempt ${attempt}) via ${rpcUrl}: ${msg}`);

        if (attempt < MAX_ETH_RPC_ATTEMPTS) {
            await sleep(1_000 * Math.pow(2, attempt - 1));
            return fetchEthBalance(addr, attempt + 1);
        }
        return 0;
    }
}

/**
 * Returns Unix timestamp (seconds) of the most recent normal tx for `addr`,
 * or 0 if none found. Uses Etherscan txlist API (rate-limited to ~4 req/s).
 * @param {string} addr
 * @returns {Promise<number>}
 */
async function fetchLastTxTimestamp(addr) {
    const chainId = CHAIN_FILTER.split(':')[1] || '1';
    const params = new URLSearchParams({
        chainid: chainId,
        module: 'account',
        action: 'txlist',
        address: addr,
        sort: 'desc',
        page: '1',
        offset: '1',
        ...(ETHERSCAN_KEY && { apikey: ETHERSCAN_KEY }),
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
        const resp = await fetch(`${ETHERSCAN_BASE}?${params}`, { signal: controller.signal });
        clearTimeout(timeout);

        if (!resp.ok) throw new TypeError(`HTTP ${resp.status}`);
        const json = /** @type {{status: string, result: Array<{timeStamp: string}>}} */ (await resp.json());

        if (json.status === '1' && Array.isArray(json.result) && json.result.length > 0) {
            return parseInt(json.result[0].timeStamp, 10);
        }
        return 0;
    } catch (/** @type {any} */ err) {
        clearTimeout(timeout);
        logger.warn(`[Etherscan] ${addr}: ${err.message}`);
        return 0;
    }
}

/**
 * Rewrites a label name to insert `(old)` between the coin symbol and number.
 * e.g. "Upbit: (ANKR) 1" → "Upbit: (ANKR) (old) 1"
 * @param {string} label
 * @returns {string}
 */
function transformLabel(label) {
    // Pattern: "(SYMBOL) <number>" at end, insert "(old) " before the number
    return label.replace(/\(([^)]+)\)\s+(\d+)$/, '($1) (old) $2');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    if (DRY_RUN) logger.info('[DryRun] Dry-run mode enabled — no writes will occur');

    logger.info(`[Config] entity="${ENTITY}" chain="${CHAIN_FILTER}" cutoff="${CUTOFF_DATE}"`);

    await initRpcManager();

    const db = new MongoDBClient();
    await db.connect();

    const docs = await db.readMany(
        COLLECTION_ADDRS,
        { entity: ENTITY, chains: CHAIN_FILTER },
        {
            projection: { _id: 1, addr: 1, label: 1, comment: 1 },
            ...(TARGET_LIMIT > 0 && { limit: TARGET_LIMIT })
        }
    );

    logger.info(`[Query] Found ${docs.length} document(s) for entity="${ENTITY}" chain="${CHAIN_FILTER}"`);

    let processed = 0;
    let marked = 0;

    for (const doc of docs) {
        processed++;

        // --- Skip already processed wallets ---
        if (doc.label?.includes('(old)') || doc.comment?.includes('deprecated')) {
            logger.info(`[${processed}/${docs.length}] ${doc.addr} | ALREADY PROCESSED — skipping`);
            continue;
        }

        const balance = await fetchEthBalance(doc.addr);
        logger.info(`[${processed}/${docs.length}] ${doc.addr} | label="${doc.label}" | balance=${balance.toFixed(6)} ETH`);

        await sleep(ETHERSCAN_DELAY_MS);
        const lastTxTs = await fetchLastTxTimestamp(doc.addr);

        const isInactive = lastTxTs === 0 || lastTxTs < CUTOFF_TIMESTAMP_S;
        const lastTxStr = lastTxTs > 0 ? new Date(lastTxTs * 1_000).toISOString() : 'never';

        if (!isInactive) {
            logger.info(`  → active (last tx: ${lastTxStr}) — skipping`);
            continue;
        }

        logger.info(`  → inactive (last tx: ${lastTxStr}) — marking deprecated`);

        const newLabel = transformLabel(doc.label);
        const newComment = doc.comment
            ? (doc.comment.includes('deprecated') ? doc.comment : `${doc.comment}, deprecated`)
            : 'deprecated';

        if (DRY_RUN) {
            logger.info(`  [DryRun] label: "${doc.label}" → "${newLabel}"`);
            logger.info(`  [DryRun] comment: "${doc.comment}" → "${newComment}"`);
        } else {
            await db.updateOne(
                COLLECTION_ADDRS,
                { _id: doc._id },
                { $set: { label: newLabel, comment: newComment } }
            );
            logger.info(`  ✓ Updated _id=${doc._id}`);
        }

        marked++;
    }

    await db.close();

    logger.info(`[Done] processed=${processed} marked=${marked} dryRun=${DRY_RUN}`);
}

main().catch(err => {
    logger.error(`Unhandled error: ${err.message}`);
    process.exit(1);
});
