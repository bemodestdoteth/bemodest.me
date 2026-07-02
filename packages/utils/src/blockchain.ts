import { createPublicClient, defineChain, formatEther, formatUnits, http, parseAbi } from "viem";
import type { Address, Chain } from "viem";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  AccountLayout,
  MintLayout,
} from "@solana/spl-token";
import { SuiClient } from "@mysten/sui/client";
import { StargateClient } from "@cosmjs/stargate";
import { getChainTypeFromCAIP2, getEipChainId } from "./chains";

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

function defineRpcChain(chainId: number, rpcUrl: string): Chain {
  return defineChain({
    id: chainId,
    name: `EIP-155 ${chainId}`,
    nativeCurrency: {
      decimals: 18,
      name: "Ether",
      symbol: "ETH",
    },
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
    },
  });
}

function createEvmClient(caip2Id: string, rpcUrl: string) {
  const chainId = getEipChainId(caip2Id);
  return createPublicClient({
    chain: chainId === null ? undefined : defineRpcChain(chainId, rpcUrl),
    transport: http(rpcUrl),
  });
}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
}

export async function evmBalanceUsd(
  addr: string,
  caip2Id: string,
  contractAddr: string,
  price: number,
  rpcUrl: string,
  attempt: number = 1,
): Promise<number | null> {
  try {
    const client = createEvmClient(caip2Id, rpcUrl);
    const [raw, decimals] = await Promise.all([
      client.readContract({
        address: contractAddr as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [addr as Address],
      }),
      client.readContract({
        address: contractAddr as Address,
        abi: ERC20_ABI,
        functionName: "decimals",
      }),
    ]);
    return Number(formatUnits(raw, decimals)) * price;
  } catch {
    if (attempt < 3) {
      await retryDelay(attempt);
      return await evmBalanceUsd(
        addr,
        caip2Id,
        contractAddr,
        price,
        rpcUrl,
        attempt + 1,
      );
    }
    return null;
  }
}

export async function evmNativeBalanceUsd(
  addr: string,
  caip2Id: string,
  price: number,
  rpcUrl: string,
  attempt: number = 1,
): Promise<number | null> {
  try {
    const client = createEvmClient(caip2Id, rpcUrl);
    const raw = await client.getBalance({ address: addr as Address });
    return Number(formatEther(raw)) * price;
  } catch {
    if (attempt < 3) {
      await retryDelay(attempt);
      return await evmNativeBalanceUsd(
        addr,
        caip2Id,
        price,
        rpcUrl,
        attempt + 1,
      );
    }
    return null;
  }
}

export async function solanaBalanceUsd(
  addrs: string[],
  contractAddr: string | null,
  price: number,
  rpcUrl: string,
  attempt: number = 1,
): Promise<number | null> {
  try {
    console.log(
      `[solanaBalanceUsd] Attempt ${attempt} | addresses: ${addrs.length} | contract: ${contractAddr} | rpc: ${rpcUrl}`,
    );
    const conn = new Connection(rpcUrl, "confirmed");

    if (!contractAddr) {
      console.log(`[solanaBalanceUsd] Fetching native SOL balances`);
      const pubkeys = addrs.map((a) => new PublicKey(a));
      const infos = await conn.getMultipleAccountsInfo(pubkeys);
      let total = 0;
      for (let i = 0; i < infos.length; i++) {
        const info = infos[i];
        if (info) {
          const sol = Number(info.lamports) / 1e9;
          console.log(
            `[solanaBalanceUsd] Native balance for ${addrs[i]}: ${sol} SOL`,
          );
          total += sol;
        } else {
          console.log(
            `[solanaBalanceUsd] Native balance for ${addrs[i]}: No account info`,
          );
        }
      }
      console.log(
        `[solanaBalanceUsd] Total native value: ${total * price} USD`,
      );
      return total * price;
    }

    console.log(
      `[solanaBalanceUsd] Fetching SPL token balances for contract ${contractAddr}`,
    );
    const mintPubkey = new PublicKey(contractAddr);
    const atas = addrs.map((a) =>
      getAssociatedTokenAddressSync(mintPubkey, new PublicKey(a), true),
    );

    // Fetch Mint Data + All ATAs in 1 batch
    const accountKeys = [mintPubkey, ...atas];
    const infos = await conn.getMultipleAccountsInfo(accountKeys);

    const mintInfo = infos[0];
    if (!mintInfo) {
      console.log(
        `[solanaBalanceUsd] Mint account does not exist. Returning 0.`,
      );
      return 0; // If mint doesn't exist, balances are 0
    }

    const mintData = MintLayout.decode(mintInfo.data);
    const decimals = mintData.decimals;
    console.log(
      `[solanaBalanceUsd] Token ${contractAddr} has ${decimals} decimals`,
    );

    let totalRaw = 0n;
    for (let i = 1; i < infos.length; i++) {
      const info = infos[i];
      const owner = addrs[i - 1];
      const ata = atas[i - 1];
      if (!info || info.data.length === 0) {
        console.log(
          `[solanaBalanceUsd] ATA ${ata.toBase58()} for owner ${owner} does not exist`,
        );
        continue; // ATA doesn't exist
      }
      const decoded = AccountLayout.decode(info.data);
      console.log(
        `[solanaBalanceUsd] Balance for owner ${owner} (ATA ${ata.toBase58()}): ${decoded.amount} raw`,
      );
      totalRaw += decoded.amount;
    }

    const amount = Number(totalRaw) / Math.pow(10, decimals);
    console.log(
      `[solanaBalanceUsd] Total SPL token amount: ${amount} | Total value: ${amount * price} USD`,
    );
    return amount * price;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[solanaBalanceUsd] Error on attempt %d (rpc: %s): %s", attempt, rpcUrl, message);
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      return await solanaBalanceUsd(
        addrs,
        contractAddr,
        price,
        rpcUrl,
        attempt + 1,
      );
    }
    return null;
  }
}

export async function suiBalanceUsd(
  addr: string,
  coinType: string | null,
  price: number,
  rpcUrl: string,
  attempt: number = 1,
): Promise<number | null> {
  try {
    const client = new SuiClient({ url: rpcUrl });
    const bal = await client.getBalance({
      owner: addr,
      coinType: coinType || "0x2::sui::SUI",
    });
    const amount = Number(bal.totalBalance) / 1e9;
    return amount * price;
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
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
  attempt: number = 1,
): Promise<number | null> {
  try {
    const client = await StargateClient.connect(rpcEndpoint);
    const coin = await client.getBalance(addr, denom || "uosmo");
    await client.disconnect();
    return (Number(coin.amount) / 1e6) * price;
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      return await cosmosBalanceUsd(
        addr,
        rpcEndpoint,
        denom,
        price,
        attempt + 1,
      );
    }
    return null;
  }
}

export async function getBalanceOnChain(
  caip2Id: string,
  addrs: string[],
  contractAddr: string | null,
  price: number,
  rpcUrl: string,
): Promise<number | null> {
  console.log(
    `[getBalanceOnChain] Start | caip2: ${caip2Id} | addresses: ${addrs.length} | contract: ${contractAddr}`,
  );
  const chainType = getChainTypeFromCAIP2(caip2Id);
  console.log(`[getBalanceOnChain] Resolved chainType: ${chainType}`);

  // Helper to sum loops sequentially (to preserve internal parallel retries, or we could Promise.all here)
  const sumBalances = async (
    fetcher: (addr: string) => Promise<number | null>,
  ) => {
    console.log(
      `[sumBalances] Fetching balances for ${addrs.length} addresses`,
    );
    const arr = await Promise.all(addrs.map(fetcher));
    let total = 0;
    for (let i = 0; i < arr.length; i++) {
      const bal = arr[i];
      if (bal === null) {
        console.log(
          `[sumBalances] Failed to fetch balance for address: ${addrs[i]}. Returning null for all.`,
        );
        return null; // If ONE fails, the whole chain fails logic (match existing behaviour)
      }
      console.log(`[sumBalances] Balance for ${addrs[i]}: ${bal} USD`);
      total += bal;
    }
    console.log(`[sumBalances] Total across all addresses: ${total} USD`);
    return total;
  };

  if (chainType === "evm") {
    if (contractAddr)
      return await sumBalances((a) =>
        evmBalanceUsd(a, caip2Id, contractAddr, price, rpcUrl),
      );
    return await sumBalances((a) =>
      evmNativeBalanceUsd(a, caip2Id, price, rpcUrl),
    );
  } else if (chainType === "solana") {
    const solTotal = await solanaBalanceUsd(addrs, contractAddr, price, rpcUrl);
    console.log(
      `[getBalanceOnChain] solanaBalanceUsd returned: ${solTotal} USD`,
    );
    return solTotal;
  } else if (chainType === "sui") {
    return await sumBalances((a) =>
      suiBalanceUsd(a, contractAddr, price, rpcUrl),
    );
  } else if (chainType === "cosmos") {
    return await sumBalances((a) =>
      cosmosBalanceUsd(a, rpcUrl, contractAddr, price),
    );
  }
  console.log(
    `[getBalanceOnChain] Unknown chainType ${chainType}. Returning null.`,
  );
  return null;
}
