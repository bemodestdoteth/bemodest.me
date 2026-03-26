import { getRedisClient, getDBClient } from '@bemodest/database';
import { logger } from '@bemodest/utils';
import { getRpcUrl, reportRpcFailure } from '@bemodest/utils';
import { validateApiConfig } from '@bemodest/config';
const config = validateApiConfig();
const {
    COLLECTION_ADDRS,
    COLLECTION_CONTRACT_MAPPINGS,
    COLLECTION_COINGECKO_RANK,
    COLLECTION_CHAINS
} = config;
// Removed shadow import
import { getBalanceOnChain as sharedGetBalanceOnChain } from '@bemodest/utils';

/**
 * Retrieves hot wallet balances for a given ticker and set of exchanges.
 * USES: sidecar LVC prices from Redis and standardises communication via CAIP-2.
 * Deduplicates: multiple hot wallet addresses on the same (exchange, chain) are summed.
 */
export async function getHotWalletBalances(ticker, exchanges) {
    const db = await getDBClient();
    const redis = getRedisClient();
    const upperTicker = ticker.toUpperCase();
    const lowerTicker = ticker.toLowerCase();

    try {
        // 1. Get CAIP-2 → GeckoTerminal mapping
        const caip2ToGecko = await db.getCaip2ToGeckoTerminalMapping(COLLECTION_CHAINS);

        // 2. Fetch Price: Priority is LVC (Redis) -> Fallback to COINGECKO_RANK (Mongo)
        const lvcPrice = await redis.hget('lvc:prices', upperTicker);
        let price = lvcPrice ? parseFloat(lvcPrice) : 0;

        if (!price) {
            const coingeckoDoc = await db.readOne(COLLECTION_COINGECKO_RANK, { symbol: lowerTicker });
            price = coingeckoDoc?.current_price || 0;
        }

        if (!price) {
            return { success: false, message: `Price not found for ticker: ${ticker}` };
        }

        // 3. Resolve contract addresses via coingeckoContractMappings
        const mappingDoc = await db.readOne(COLLECTION_CONTRACT_MAPPINGS, { symbol: lowerTicker });
        if (!mappingDoc || !mappingDoc.contracts) {
            return { success: false, message: `Contract mapping not found for ticker: ${ticker}` };
        }

        // Map GeckoTerminal Net -> Contract Address
        const netToAddr = mappingDoc.contracts;

        // 4. Fetch Hot Wallets (include label and comment for filtering)
        const hotFilter = { entity: { $regex: /Hot$/i } };
        const allHotAddrs = await db.readMany(COLLECTION_ADDRS, hotFilter, {
            projection: { _id: 0, addr: 1, chains: 1, entity: 1, label: 1, comment: 1 }
        });

        const exchangeSet = new Set(exchanges.map(e => e.toLowerCase()));

        // Filter by exchange first, then skip deprecated wallets
        const hotByExchange = {};
        for (const doc of allHotAddrs) {
            const exName = doc.entity?.replace(/\s*Hot$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!exchangeSet.has(exName)) continue;
            if (/deprecated/i.test(doc.comment || '')) continue;
            if (!hotByExchange[exName]) hotByExchange[exName] = [];
            hotByExchange[exName].push(doc);
        }

        // For each exchange: prefer wallets labelled with (TICKER); fall back to all
        const tickerPattern = new RegExp(`\\(${upperTicker}\\)`, 'i');
        const filteredAddrs = [];
        for (const [ex, addrs] of Object.entries(hotByExchange)) {
            const labelled = addrs.filter(d => tickerPattern.test(d.label || ''));
            if (labelled.length > 0) {
                logger.debug(`[Balance] ${upperTicker} ${ex} - using ${labelled.length} labelled wallets`);
                filteredAddrs.push(...labelled);
            } else {
                logger.debug(`[Balance] ${upperTicker} ${ex} - using ALL ${addrs.length} hot wallets`);
                filteredAddrs.push(...addrs);
            }
        }

        // Log a single summary line: how many addresses per exchange were found
        const addrCountByExchange = {};
        for (const doc of filteredAddrs) {
            const ex = doc.entity.replace(/\s*Hot$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
            addrCountByExchange[ex] = (addrCountByExchange[ex] || 0) + 1;
        }
        logger.debug(`[Balance] ${upperTicker} — hot wallet addresses found: ${JSON.stringify(addrCountByExchange)}`);

        // 5. Build tasks grouped by (exchange, chain, contractAddr) to avoid duplicates.
        //    Multiple addresses on the same chain are fetched concurrently and summed.
        // Map: `${exchange}:${caip2}` -> { exchange, caip2, contractAddr, addrs[], dwStatus }
        const taskMap = new Map();

        for (const doc of filteredAddrs) {
            const exchange = doc.entity.replace(/\s*Hot$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');

            for (const caip2 of (doc.chains ?? [])) {
                const gtNet = caip2ToGecko[caip2];
                if (!gtNet) {
                    if (caip2.includes('solana') || caip2.includes('sui') || caip2.includes('aptos')) {
                        logger.debug(`[Balance] ${upperTicker} SKIP CAIP2 ${caip2}: Not found in caip2ToGecko mapping!`);
                    }
                    continue;
                }

                // Pre-filter: only process if the token exists on this chain according to Gecko mappings
                if (!(gtNet in netToAddr)) {
                    continue;
                }

                const contractAddr = netToAddr[gtNet] || null;
                const key = `${exchange}:${caip2}`;

                if (!taskMap.has(key)) {
                    taskMap.set(key, { exchange, caip2, contractAddr, addrs: [], dwStatus: null });
                }
                taskMap.get(key).addrs.push(doc.addr);
            }
        }

        // 6. Execute one task per (exchange, chain): check DW status, then sum across all addresses
        const tasks = Array.from(taskMap.values()).map(async ({ exchange, caip2, contractAddr, addrs }) => {
            // Check dwStatus in Redis
            const caip2Encoded = caip2.replace(':', '/');
            const dwKey = `dw:${exchange}:${caip2Encoded}:${upperTicker}`;
            const dwStatus = await redis.get(dwKey);
            logger.debug(`[Balance] ${upperTicker} ${exchange}:${caip2} dwStatus: ${dwStatus}`);

            // Skip if no active deposit/withdrawal session
            if (!dwStatus) {
                logger.debug(`[Balance] ${upperTicker} ${exchange}:${caip2} SKIP: dwStatus missing for key ${dwKey}`);
                return null;
            }

            const rpcUrl = getRpcUrl(caip2);
            if (!rpcUrl) {
                logger.debug(`[Balance] ${upperTicker} ${exchange}:${caip2} SKIP: rpcUrl is missing for caip2 ${caip2}`);
                return null;
            }

            // Fetch balance from ALL addresses on this chain in one call
            let usdBalance = await sharedGetBalanceOnChain(caip2, addrs, contractAddr, price, rpcUrl).catch(err => {
                logger.error(`[Balance] Fetch error for ${exchange}:${caip2} addrs=${addrs.length}: ${err.message}`);
                if (err.message?.includes('RPC')) reportRpcFailure(rpcUrl);
                return null;
            });

            logger.debug(`[Balance] ${upperTicker} ${exchange}:${caip2} — ${addrs.length} addr(s), balance: ${usdBalance !== null ? `$${usdBalance.toFixed(2)}` : 'FAILED'}`);

            return { exchange, chain: caip2, usdBalance, dwStatus };
        });


        const taskResults = await Promise.allSettled(tasks);

        // 7. Group by exchange — one entry per (exchange, chain)
        const byExchange = {};
        for (const res of taskResults) {
            if (res.status !== 'fulfilled' || !res.value) continue;
            const { exchange, chain, usdBalance, dwStatus } = res.value;
            if (!byExchange[exchange]) byExchange[exchange] = { chains: [], usdTotal: 0 };
            byExchange[exchange].chains.push({ chain, usdBalance, dwStatus });
            byExchange[exchange].usdTotal += (usdBalance ?? 0);
        }

        // Finalise result
        return Object.entries(byExchange)
            .map(([exchange, data]) => ({ exchange, ...data }))
            .sort((a, b) => a.exchange.localeCompare(b.exchange));

    } catch (err) {
        logger.error(`[Balance] getHotWalletBalances error: ${err.message}`);
        return { success: false, message: 'Internal server error' };
    }
}
