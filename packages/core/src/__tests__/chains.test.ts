import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "mongodb";
import {
  ChainConfigDataError,
  ChainConfigNotFoundError,
  createEvmPublicClient,
  defineEvmViemChain,
  getEvmChainConfig,
  MongoDBClient,
} from "../index.js";

const validChain: Document = {
  name: "Ethereum",
  symbol: "ETH",
  code: "ETH",
  caip2: "eip155:1",
  chainId: 1,
  status: "active",
  rpc: ["https://rpc-one.example.com", "https://rpc-two.example.com"],
  wsRpc: ["wss://rpc-one.example.com"],
  blockExplorerPrefix: "https://etherscan.io/address/",
  forwarding: {
    gasReserveWei: "10000000000000000",
    dustThresholdWei: "1000000000000000",
  },
};

describe("chains", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.MONGO_USERNAME = "user";
    process.env.MONGO_PASSWORD = "pass";
    process.env.MONGO_HOST = "localhost";
    process.env.MONGO_PORT = "27017";
    process.env.MONGO_DB_NAME = "codys-dev";
  });

  it("resolves an active EVM chain config by CAIP-2", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    const readDocument = vi
      .spyOn(MongoDBClient.prototype, "readDocument")
      .mockResolvedValue([validChain]);

    const chain = await getEvmChainConfig({ caip2: "eip155:1" });

    expect(readDocument).toHaveBeenCalledWith(
      "chains",
      {
        status: "active",
        caip2: "eip155:1",
      },
      null,
      null,
      2,
    );
    expect(chain.chainId).toBe(1);
    expect(chain.forwarding.dustThresholdWei).toBe("1000000000000000");
  });

  it("resolves with chainId and code query contracts", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    const readDocument = vi
      .spyOn(MongoDBClient.prototype, "readDocument")
      .mockResolvedValue([validChain]);

    await getEvmChainConfig({ chainId: 1 });
    await getEvmChainConfig({ code: "ETH" });

    expect(readDocument).toHaveBeenNthCalledWith(
      1,
      "chains",
      {
        status: "active",
        caip2: { $regex: "^eip155:" },
        chainId: 1,
      },
      null,
      null,
      2,
    );
    expect(readDocument).toHaveBeenNthCalledWith(
      2,
      "chains",
      {
        status: "active",
        caip2: { $regex: "^eip155:" },
        code: "ETH",
      },
      null,
      null,
      2,
    );
  });

  it("requires exactly one lookup identifier", async () => {
    await expect(getEvmChainConfig({})).rejects.toThrow(ChainConfigDataError);
    await expect(
      getEvmChainConfig({ caip2: "eip155:1", chainId: 1 }),
    ).rejects.toThrow(ChainConfigDataError);
  });

  it("throws when no config matches", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([]);

    await expect(getEvmChainConfig({ caip2: "eip155:1" })).rejects.toThrow(
      ChainConfigNotFoundError,
    );
  });

  it("throws when duplicate configs match", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([
      validChain,
      validChain,
    ]);

    await expect(getEvmChainConfig({ caip2: "eip155:1" })).rejects.toThrow(
      ChainConfigDataError,
    );
  });

  it("throws when config is non-EVM or missing forwarding policy", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([
      {
        ...validChain,
        caip2: "cosmos:osmosis-1",
        forwarding: undefined,
      },
    ]);

    await expect(getEvmChainConfig({ code: "OSMO" })).rejects.toThrow(
      ChainConfigDataError,
    );
  });

  it("defines a viem chain from DB-provided config", () => {
    const chain = defineEvmViemChain(validChain as ReturnType<typeof validConfig>);

    expect(chain.id).toBe(1);
    expect(chain.rpcUrls.default.http).toEqual(validChain.rpc);
    expect(chain.blockExplorers?.default.url).toBe("https://etherscan.io");
  });

  it("creates a public client without adding static fallback URLs", () => {
    const client = createEvmPublicClient(validConfig());

    expect(client.chain?.id).toBe(1);
    expect(client.transport.type).toBe("fallback");
  });
});

function validConfig() {
  return {
    name: "Ethereum",
    symbol: "ETH",
    code: "ETH",
    caip2: "eip155:1",
    chainId: 1,
    status: "active" as const,
    rpc: ["https://rpc-one.example.com", "https://rpc-two.example.com"],
    wsRpc: ["wss://rpc-one.example.com"],
    blockExplorerPrefix: "https://etherscan.io/address/",
    forwarding: {
      gasReserveWei: "10000000000000000",
      dustThresholdWei: "1000000000000000",
    },
  };
}
