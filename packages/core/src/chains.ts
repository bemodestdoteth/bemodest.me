import { createPublicClient, defineChain, fallback, http } from "viem";
import type { Chain, PublicClient, Transport } from "viem";
import type { Document } from "mongodb";
import { MongoDBClient } from "./db.js";
import { EvmChainConfigSchema } from "./models.js";
import type { EvmChainConfig } from "./models.js";

export class ChainConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainConfigError";
  }
}

export class ChainConfigNotFoundError extends ChainConfigError {
  constructor(message: string) {
    super(message);
    this.name = "ChainConfigNotFoundError";
  }
}

export class ChainConfigDataError extends ChainConfigError {
  constructor(message: string) {
    super(message);
    this.name = "ChainConfigDataError";
  }
}

export interface EvmChainConfigLookup {
  caip2?: string;
  chainId?: number;
  code?: string;
}

function lookupEntry(input: EvmChainConfigLookup): ["caip2" | "chainId" | "code", string | number] {
  const entries = [
    ["caip2", input.caip2],
    ["chainId", input.chainId],
    ["code", input.code],
  ].filter((entry): entry is ["caip2" | "chainId" | "code", string | number] =>
    entry[1] !== undefined,
  );

  if (entries.length !== 1) {
    throw new ChainConfigDataError(
      "Exactly one chain lookup identifier is required: caip2, chainId, or code.",
    );
  }
  return entries[0];
}

function parseEvmChainConfig(document: Document): EvmChainConfig {
  const result = EvmChainConfigSchema.safeParse(document);
  if (!result.success) {
    throw new ChainConfigDataError(result.error.message);
  }
  return result.data;
}

export async function getEvmChainConfig(
  input: EvmChainConfigLookup,
): Promise<EvmChainConfig> {
  const [lookupKey, lookupValue] = lookupEntry(input);
  const client = new MongoDBClient();
  await client.connect();

  const query: Record<string, unknown> = {
    status: "active",
    caip2: { $regex: "^eip155:" },
    [lookupKey]: lookupValue,
  };

  const documents = await client.readDocument("chains", query, null, null, 2);

  if (documents.length === 0) {
    throw new ChainConfigNotFoundError(
      `No active EVM chain config found for ${lookupKey}=${lookupValue}.`,
    );
  }

  if (documents.length > 1) {
    throw new ChainConfigDataError(
      `Multiple active EVM chain configs found for ${lookupKey}=${lookupValue}.`,
    );
  }

  return parseEvmChainConfig(documents[0]);
}

export function defineEvmViemChain(config: EvmChainConfig): Chain {
  const explorerUrl = config.blockExplorerPrefix?.replace(/\/address\/?$/, "");

  return defineChain({
    id: config.chainId,
    name: config.name,
    nativeCurrency: {
      decimals: 18,
      name: config.symbol,
      symbol: config.symbol,
    },
    rpcUrls: {
      default: {
        http: [...config.rpc],
        webSocket: config.wsRpc && config.wsRpc.length > 0 ? [...config.wsRpc] : undefined,
      },
    },
    blockExplorers: explorerUrl
      ? {
          default: {
            name: `${config.name} Explorer`,
            url: explorerUrl,
          },
        }
      : undefined,
  });
}

export function createEvmRpcFallbackTransport(config: EvmChainConfig): Transport {
  return fallback(config.rpc.map((rpcUrl) => http(rpcUrl)));
}

export function createEvmPublicClient(config: EvmChainConfig): PublicClient {
  return createPublicClient({
    chain: defineEvmViemChain(config),
    transport: createEvmRpcFallbackTransport(config),
  });
}
