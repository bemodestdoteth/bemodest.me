import { JsonRpcProvider, Contract } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { SuiClient } from '@mysten/sui.js/client';
import { StargateClient } from '@cosmjs/stargate';
import { MongoDBClient } from '@bemodest/database';
import logger from '../config/logger.js';
import { getRpcUrl, reportRpcFailure } from './rpc.js';
import { getRedisClient } from './redis.js';
import {
    COLLECTION_ADDRS,
    COLLECTION_CHAINS,
    COLLECTION_CONTRACT_MAPPINGS,
    COLLECTION_COINGECKO_RANK,
} from '../config/env.js';
import { getCaip2ToGeckoTerminalMapping, getCaip2ToCoingeckoMapping } from './helpers.js';

const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
];

function getChainTypeFromCAIP2(caip2Id) {
    const ns = caip2Id.split(':')[0];
    if (ns === 'eip155') return 'evm';
    if (ns === 'solana') return 'solana';
    if (ns === 'sui') return 'sui';
    if (ns === 'cosmos') return 'cosmos';
    if (ns === 'bip122') return 'bitcoin';
    return 'unknown';
}

function getEipChainId(caip2Id) {
    const [ns, chainId] = caip2Id.split(':');
    if (ns === 'eip155') return parseInt(chainId, 10);
    return null;
}

async function evmBalanceUsd(addr, caip2Id, contractAddr, price, attempt = 1) {
    const rpcUrl = getRpcUrl(caip2Id);
    if (!rpcUrl) return 0;
    try {
        const chainId = getEipChainId(caip2Id);
        const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
        const contract = new Contract(contractAddr, ERC20_ABI, provider);
        const [raw, decimals] = await Promise.all([
            contract.balanceOf(addr),
            contract.decimals(),
        ]);
        const amount = Number(raw) / 10 ** Number(decimals);
        return amount * price;
    } catch (err) {
        reportRpcFailure(rpcUrl);
        logger.warn(`[Balance] EVM ${caip2Id} ${addr} (attempt ${attempt}): ${err.message}`);
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await evmBalanceUsd(addr, caip2Id, contractAddr, price, attempt + 1);
        }
        return 0;
    }
}

async function evmNativeBalanceUsd(addr, caip2Id, price, attempt = 1) {
    const rpcUrl = getRpcUrl(caip2Id);
    if (!rpcUrl) return 0;
    try {
        const chainId = getEipChainId(caip2Id);
        const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
        const raw = await provider.getBalance(addr);
        const amount = Number(raw) / 1e18;
        return amount * price;
    } catch (err) {
        reportRpcFailure(rpcUrl);
        logger.warn(`[Balance] EVM native ${caip2Id} ${addr} (attempt ${attempt}): ${err.message}`);
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await evmNativeBalanceUsd(addr, caip2Id, price, attempt + 1);
        }
        return 0;
    }
}

async function solanaBalanceUsd(addr, contractAddr, price, attempt = 1) {
    const rpcUrl = getRpcUrl('solana') || 'https://api.mainnet-beta.solana.com';
    try {
        const conn = new Connection(rpcUrl, 'confirmed');
        const ownerPubkey = new PublicKey(addr);
        if (!contractAddr) {
            // Native SOL
            const lamports = await conn.getBalance(ownerPubkey);
            return (lamports / 1e9) * price;
        }
        const mintPubkey = new PublicKey(contractAddr);
        const ata = await getAssociatedTokenAddress(mintPubkey, ownerPubkey);
        const { value } = await conn.getTokenAccountBalance(ata);
        return (value.uiAmount ?? 0) * price;
    } catch (err) {
        reportRpcFailure(rpcUrl);
        logger.warn(`[Balance] Solana ${addr} (attempt ${attempt}): ${err.message}`);
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await solanaBalanceUsd(addr, contractAddr, price, attempt + 1);
        }
        return 0;
    }
}

async function suiBalanceUsd(addr, coinType, price, attempt = 1) {
    const rpcUrl = getRpcUrl('sui') || 'https://fullnode.mainnet.sui.io';
    try {
        const client = new SuiClient({ url: rpcUrl });
        const bal = await client.getBalance({ owner: addr, coinType: coinType || '0x2::sui::SUI' });
        const amount = Number(bal.totalBalance) / 1e9;
        return amount * price;
    } catch (err) {
        reportRpcFailure(rpcUrl);
        logger.warn(`[Balance] Sui ${addr} (attempt ${attempt}): ${err.message}`);
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await suiBalanceUsd(addr, coinType, price, attempt + 1);
        }
        return 0;
    }
}

async function cosmosBalanceUsd(addr, rpcEndpoint, denom, price, attempt = 1) {
    try {
        const client = await StargateClient.connect(rpcEndpoint);
        const coin = await client.getBalance(addr, denom || 'uosmo');
        await client.disconnect();
        return (Number(coin.amount) / 1e6) * price;
    } catch (err) {
        reportRpcFailure(rpcEndpoint);
        logger.warn(`[Balance] Cosmos ${addr} (attempt ${attempt}): ${err.message}`);
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            const nextRpc = getRpcUrl('osmosis') || 'https://rpc.osmosis.zone';
            return await cosmosBalanceUsd(addr, nextRpc, denom, price, attempt + 1);
        }
        return 0;
    }
}

async function getBalanceOnChain(caip2Id, addr, contractAddr, price) {
    const chainType = getChainTypeFromCAIP2(caip2Id);
    if (chainType === 'evm') {
        if (contractAddr) return await evmBalanceUsd(addr, caip2Id, contractAddr, price);
        return await evmNativeBalanceUsd(addr, caip2Id, price);
    } else if (chainType === 'solana') {
        return await solanaBalanceUsd(addr, contractAddr, price);
    } else if (chainType === 'sui') {
        return await suiBalanceUsd(addr, contractAddr, price);
    } else if (chainType === 'cosmos') {
        const rpcUrl = getRpcUrl(caip2Id) || 'https://rpc.osmosis.zone';
        return await cosmosBalanceUsd(addr, rpcUrl, contractAddr, price);
    }
    return 0;
}

/**
 * Retrieves hot wallet balances for a given ticker and set of exchanges.
 * USES: sidecar LVC prices from Redis and standardises communication via CAIP-2.
 */
export async function getHotWalletBalances(ticker, exchanges) {
    const db = new MongoDBClient();
    const redis = getRedisClient();
    const upperTicker = ticker.toUpperCase();

    try {
        await db.connect();

        // 1. Get CAIP-2 → GeckoTerminal mapping
        const caip2ToGecko = await getCaip2ToGeckoTerminalMapping(db);

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
            const exName = doc.entity?.replace(/\s*Hot$/i, '').toLowerCase();
            return exchangeSet.has(exName);
        });

        // 5. Build balance fetching tasks
        const tasks = [];
        for (const doc of filteredAddrs) {
            const exchange = doc.entity.replace(/\s*Hot$/i, '').toLowerCase();
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
                        usdBalance = await getBalanceOnChain(caip2, doc.addr, contractAddr, price);
                    } catch (err) {
                        logger.error(`[Balance] Fetch error for ${exchange}:${caip2}: ${err.message}`);
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
    } finally {
        await db.close();
    }
}

