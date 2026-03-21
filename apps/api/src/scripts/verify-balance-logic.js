import { getHotWalletBalances } from '../utils/balance.js';
import { logger, initRpcManager, getRpcUrl } from '@bemodest/utils';
import { getDBClient } from '@bemodest/database';
import { validateApiConfig } from '@bemodest/config';

const config = validateApiConfig();
const { COLLECTION_CHAINS } = config;

async function main() {
    console.log('--- Verifying Hot Wallet Balance Logic ---');

    console.log('Initializing RPC Manager...');
    await initRpcManager({
        fetchChains: async () => {
            const db = await getDBClient();
            return db.readMany(
                COLLECTION_CHAINS,
                { caip2: { $exists: true }, rpc: { $exists: true, $ne: [] } },
                { projection: { caip2: 1, chainId: 1, rpc: 1, _id: 0 } }
            );
        },
        fetchAllowedChainIds: async () => {
            const db = await getDBClient();
            const docs = await db.readMany('geckoTerminalChainList', { chain_identifier: { $type: 'number' } }, { projection: { chain_identifier: 1, _id: 0 } });
            return docs.map(d => d.chain_identifier);
        }
    });

    const ethRpc = getRpcUrl('eip155:1');
    console.log(`[Debug] Ethereum RPC: ${ethRpc || 'NOT FOUND'}`);

    const ticker = 'CFG';
    const exchanges = ['upbit', 'binance', 'bybit'];

    console.log(`Fetching balances for ${ticker} on exchanges: ${exchanges.join(', ')}...`);

    try {
        const result = await getHotWalletBalances(ticker, exchanges);

        if (result && result.success === false) {
            console.error('❌ Failed:', result.message);
            process.exit(1);
        }

        console.log('✅ API Call Successful');
        console.log('Backend Result:', JSON.stringify(result, null, 2));

        if (!Array.isArray(result) || result.length === 0) {
            console.warn('\n⚠️ Warning: No balances found.');
            console.log('Check logs above for [Debug] output from balance.js');
        } else {
            console.log(`\n🎉 Success! Total exchanges with balances: ${result.length}`);
        }

    } catch (err) {
        console.error('❌ Execution Error:', err.stack);
        process.exit(1);
    }
}

main().then(() => {
    console.log('--- Verification Complete ---');
    process.exit(0);
}).catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
});
