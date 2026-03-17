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
 */
export async function getHotWalletBalances(ticker, exchanges) {
    const db = await getDBClient();
    const redis = getRedisClient();
    const upperTicker = ticker.toUpperCase();

    try {
        // 1. Get CAIP-2 → GeckoTerminal mapping
        const caip2ToGecko = await db.getCaip2ToGeckoTerminalMapping(COLLECTION_CHAINS);

        // 2. Fetch Price: Priority is LVC (Redis) -> Fallback to COINGECKO_RANK (Mongo)
        const lvcPrice = await redis.hget('lvc:prices', upperTicker);
        let price = lvcPrice ? parseFloat(lvcPrice) : 0;

        if (!price) {
            const coingeckoDoc = await db.readOne(COLLECTION_COINGECKO_RANK, { symbol: upperTicker });
            price = coingeckoDoc?.current_price || 0;
        }

        if (!price) {
            return { success: false, message: `Price not found for ticker: ${ticker}` };
        }

        // 3. Resolve contract addresses via coingeckoContractMappings
        const mappingDoc = await db.readOne(COLLECTION_CONTRACT_MAPPINGS, { symbol: upperTicker });
        if (!mappingDoc || !mappingDoc.contracts) {
            return { success: false, message: `Contract mapping not found for ticker: ${ticker}` };
        }

        // Map GeckoTerminal Net -> Contract Address
        const netToAddr = mappingDoc.contracts;

        // 4. Fetch Hot Wallets
        const hotFilter = { entity: { $regex: /Hot$/i } };
        const allHotAddrs = await db.readMany(COLLECTION_ADDRS, hotFilter, {
            projection: { _id: 0, addr: 1, chains: 1, entity: 1 }
        });

        const exchangeSet = new Set(exchanges.map(e => e.toLowerCase()));
        const filteredAddrs = allHotAddrs.filter(doc => {
            const exName = doc.entity?.replace(/\s*Hot$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
            return exchangeSet.has(exName);
        });

        // 5. Build balance fetching tasks
        const tasks = [];
        for (const doc of filteredAddrs) {
            const exchange = doc.entity.replace(/\s*Hot$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
            for (const caip2 of (doc.chains ?? [])) {
                // Find corresponding GeckoTerminal network to get the contract address
                const gtNet = caip2ToGecko[caip2];
                if (!gtNet) continue;

                const contractAddr = netToAddr[gtNet] || null;

                tasks.push((async () => {
                    // Check dwStatus in Redis
                    const caip2Encoded = caip2.replace(':', '/');
                    const dwKey = `dw:${exchange}:${caip2Encoded}:${upperTicker}`;
                    const dwStatus = await redis.get(dwKey);

                    // Skip if no active deposit/withdrawal session
                    if (!dwStatus) return null;

                    let usdBalance = 0;
                    try {
                        const rpcUrl = getRpcUrl(caip2);
                        if (!rpcUrl) return null;

                        usdBalance = await sharedGetBalanceOnChain(caip2, doc.addr, contractAddr, price, rpcUrl);
                    } catch (err) {
                        logger.error(`[Balance] Fetch error for ${exchange}:${caip2}: ${err.message}`);
                        if (err.message.includes('RPC')) {
                            const rpcUrl = getRpcUrl(caip2);
                            if (rpcUrl) reportRpcFailure(rpcUrl);
                        }
                    }

                    return { exchange, chain: caip2, usdBalance, dwStatus };
                })());
            }
        }

        const taskResults = await Promise.allSettled(tasks);

        // 6. Group by exchange
        const byExchange = {};
        for (const res of taskResults) {
            if (res.status !== 'fulfilled' || !res.value) continue;
            const { exchange, chain, usdBalance, dwStatus } = res.value;
            if (!byExchange[exchange]) byExchange[exchange] = { chains: [], usdTotal: 0 };
            byExchange[exchange].chains.push({ chain, usdBalance, dwStatus });
            byExchange[exchange].usdTotal += usdBalance;
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
