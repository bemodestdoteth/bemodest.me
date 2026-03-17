import { JsonRpcProvider, Contract } from 'ethers';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
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
): Promise<number> {
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
        return 0;
    }
}

export async function evmNativeBalanceUsd(
    addr: string,
    caip2Id: string,
    price: number,
    rpcUrl: string,
    attempt: number = 1
): Promise<number> {
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
        return 0;
    }
}

export async function solanaBalanceUsd(
    addr: string,
    contractAddr: string | null,
    price: number,
    rpcUrl: string,
    attempt: number = 1
): Promise<number> {
    try {
        const conn = new Connection(rpcUrl, 'confirmed');
        const ownerPubkey = new PublicKey(addr);
        if (!contractAddr) {
            const lamports = await conn.getBalance(ownerPubkey);
            return (lamports / 1e9) * price;
        }
        const mintPubkey = new PublicKey(contractAddr);
        const ata = await getAssociatedTokenAddress(mintPubkey, ownerPubkey);
        const { value } = await conn.getTokenAccountBalance(ata);
        return (value.uiAmount ?? 0) * price;
    } catch (err) {
        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
            return await solanaBalanceUsd(addr, contractAddr, price, rpcUrl, attempt + 1);
        }
        return 0;
    }
}

export async function suiBalanceUsd(
    addr: string,
    coinType: string | null,
    price: number,
    rpcUrl: string,
    attempt: number = 1
): Promise<number> {
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
        return 0;
    }
}

export async function cosmosBalanceUsd(
    addr: string,
    rpcEndpoint: string,
    denom: string | null,
    price: number,
    attempt: number = 1
): Promise<number> {
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
        return 0;
    }
}

export async function getBalanceOnChain(
    caip2Id: string,
    addr: string,
    contractAddr: string | null,
    price: number,
    rpcUrl: string
): Promise<number> {
    const chainType = getChainTypeFromCAIP2(caip2Id);
    if (chainType === 'evm') {
        if (contractAddr) return await evmBalanceUsd(addr, caip2Id, contractAddr, price, rpcUrl);
        return await evmNativeBalanceUsd(addr, caip2Id, price, rpcUrl);
    } else if (chainType === 'solana') {
        return await solanaBalanceUsd(addr, contractAddr, price, rpcUrl);
    } else if (chainType === 'sui') {
        return await suiBalanceUsd(addr, contractAddr, price, rpcUrl);
    } else if (chainType === 'cosmos') {
        return await cosmosBalanceUsd(addr, rpcUrl, contractAddr, price);
    }
    return 0;
}
