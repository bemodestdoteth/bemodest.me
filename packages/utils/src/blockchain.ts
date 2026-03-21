import { JsonRpcProvider, Contract } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, AccountLayout, MintLayout } from '@solana/spl-token';
import { SuiClient } from '@mysten/sui/client';
import { StargateClient } from '@cosmjs/stargate';
import { getChainTypeFromCAIP2, getEipChainId } from './chains';

const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
];

export async function evmBalanceUsd(
    addr: string,
    caip2Id: string,
    contractAddr: string,
    price: number,
    rpcUrl: string,
    attempt: number = 1
): Promise<number | null> {
    try {
        const chainId = getEipChainId(caip2Id);
        const provider = new JsonRpcProvider(rpcUrl, chainId ?? undefined, { staticNetwork: true });
        const contract = new Contract(contractAddr, ERC20_ABI, provider);
        const [raw, decimals] = await Promise.all([
            contract.balanceOf(addr),
            contract.decimals(),
        ]);
        const amount = Number(raw) / 10 ** Number(decimals);
        return amount * price;
    } catch (err) {
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await evmBalanceUsd(addr, caip2Id, contractAddr, price, rpcUrl, attempt + 1);
        }
        return null;
    }
}

export async function evmNativeBalanceUsd(
    addr: string,
    caip2Id: string,
    price: number,
    rpcUrl: string,
    attempt: number = 1
): Promise<number | null> {
    try {
        const chainId = getEipChainId(caip2Id);
        const provider = new JsonRpcProvider(rpcUrl, chainId ?? undefined, { staticNetwork: true });
        const raw = await provider.getBalance(addr);
        const amount = Number(raw) / 1e18;
        return amount * price;
    } catch (err) {
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await evmNativeBalanceUsd(addr, caip2Id, price, rpcUrl, attempt + 1);
        }
        return null;
    }
}

export async function solanaBalanceUsd(
    addrs: string[],
    contractAddr: string | null,
    price: number,
    rpcUrl: string,
    attempt: number = 1
): Promise<number | null> {
    try {
        const conn = new Connection(rpcUrl, 'confirmed');

        if (!contractAddr) {
            const pubkeys = addrs.map(a => new PublicKey(a));
            const infos = await conn.getMultipleAccountsInfo(pubkeys);
            let total = 0;
            for (const info of infos) {
                if (info) total += Number(info.lamports) / 1e9;
            }
            return total * price;
        }

        const mintPubkey = new PublicKey(contractAddr);
        const atas = addrs.map(a => getAssociatedTokenAddressSync(mintPubkey, new PublicKey(a)));

        // Fetch Mint Data + All ATAs in 1 batch
        const accountKeys = [mintPubkey, ...atas];
        const infos = await conn.getMultipleAccountsInfo(accountKeys);

        const mintInfo = infos[0];
        if (!mintInfo) return 0; // If mint doesn't exist, balances are 0

        const mintData = MintLayout.decode(mintInfo.data);
        const decimals = mintData.decimals;

        let totalRaw = 0n;
        for (let i = 1; i < infos.length; i++) {
            const info = infos[i];
            if (!info || info.data.length === 0) continue; // ATA doesn't exist
            const decoded = AccountLayout.decode(info.data);
            totalRaw += decoded.amount;
        }

        const amount = Number(totalRaw) / Math.pow(10, decimals);
        return amount * price;
    } catch (err: any) {
        console.error("Test error:", err);
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await solanaBalanceUsd(addrs, contractAddr, price, rpcUrl, attempt + 1);
        }
        return null;
    }
}

export async function suiBalanceUsd(
    addr: string,
    coinType: string | null,
    price: number,
    rpcUrl: string,
    attempt: number = 1
): Promise<number | null> {
    try {
        const client = new SuiClient({ url: rpcUrl });
        const bal = await client.getBalance({ owner: addr, coinType: coinType || '0x2::sui::SUI' });
        const amount = Number(bal.totalBalance) / 1e9;
        return amount * price;
    } catch (err) {
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await suiBalanceUsd(addr, coinType, price, rpcUrl, attempt + 1);
        }
        return null;
    }
}

export async function cosmosBalanceUsd(
    addr: string,
    rpcEndpoint: string,
    denom: string | null,
    price: number,
    attempt: number = 1
): Promise<number | null> {
    try {
        const client = await StargateClient.connect(rpcEndpoint);
        const coin = await client.getBalance(addr, denom || 'uosmo');
        await client.disconnect();
        return (Number(coin.amount) / 1e6) * price;
    } catch (err) {
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await cosmosBalanceUsd(addr, rpcEndpoint, denom, price, attempt + 1);
        }
        return null;
    }
}

export async function getBalanceOnChain(
    caip2Id: string,
    addrs: string[],
    contractAddr: string | null,
    price: number,
    rpcUrl: string
): Promise<number | null> {
    const chainType = getChainTypeFromCAIP2(caip2Id);

    // Helper to sum loops sequentially (to preserve internal parallel retries, or we could Promise.all here)
    const sumBalances = async (fetcher: (addr: string) => Promise<number | null>) => {
        const arr = await Promise.all(addrs.map(fetcher));
        let total = 0;
        for (const bal of arr) {
            if (bal === null) return null; // If ONE fails, the whole chain fails logic (match existing behaviour)
            total += bal;
        }
        return total;
    };

    if (chainType === 'evm') {
        if (contractAddr) return await sumBalances(a => evmBalanceUsd(a, caip2Id, contractAddr, price, rpcUrl));
        return await sumBalances(a => evmNativeBalanceUsd(a, caip2Id, price, rpcUrl));
    } else if (chainType === 'solana') {
        return await solanaBalanceUsd(addrs, contractAddr, price, rpcUrl);
    } else if (chainType === 'sui') {
        return await sumBalances(a => suiBalanceUsd(a, contractAddr, price, rpcUrl));
    } else if (chainType === 'cosmos') {
        return await sumBalances(a => cosmosBalanceUsd(a, rpcUrl, contractAddr, price));
    }
    return null;
}
