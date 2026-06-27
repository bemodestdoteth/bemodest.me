import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "mongodb";
import {
  KnownContractDataError,
  KnownContractNotFoundError,
  MongoDBClient,
  validateKnownErc20TokenAddress,
} from "../index.js";

const knownUsdc: Document = {
  caip2: "eip155:1",
  tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  contractType: "erc20",
  status: "active",
  symbol: "USDC",
  decimals: 6,
  name: "USD Coin",
};

describe("contracts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.MONGO_USERNAME = "user";
    process.env.MONGO_PASSWORD = "pass";
    process.env.MONGO_HOST = "localhost";
    process.env.MONGO_PORT = "27017";
    process.env.MONGO_DB_NAME = "codys-dev";
  });

  it("validates a known ERC20 token address by CAIP-2", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    const readDocument = vi
      .spyOn(MongoDBClient.prototype, "readDocument")
      .mockResolvedValue([knownUsdc]);

    const contract = await validateKnownErc20TokenAddress({
      caip2: "eip155:1",
      tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    });

    expect(readDocument).toHaveBeenCalledWith(
      "knownContracts",
      {
        status: "active",
        contractType: "erc20",
        caip2: "eip155:1",
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      },
      null,
      null,
      2,
    );
    expect(contract.symbol).toBe("USDC");
    expect(contract.tokenAddress).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  it("rejects malformed lookup inputs before querying Mongo", async () => {
    const readDocument = vi.spyOn(MongoDBClient.prototype, "readDocument");

    await expect(
      validateKnownErc20TokenAddress({
        caip2: "cosmos:osmosis-1",
        tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      }),
    ).rejects.toThrow(KnownContractDataError);
    await expect(
      validateKnownErc20TokenAddress({
        caip2: "eip155:1",
        tokenAddress: "not-an-address",
      }),
    ).rejects.toThrow(KnownContractDataError);
    await expect(
      validateKnownErc20TokenAddress({
        caip2: "eip155:1",
        tokenAddress: "0x0000000000000000000000000000000000000000",
      }),
    ).rejects.toThrow(KnownContractDataError);

    expect(readDocument).not.toHaveBeenCalled();
  });

  it("throws when no known contract matches", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([]);

    await expect(
      validateKnownErc20TokenAddress({
        caip2: "eip155:1",
        tokenAddress: knownUsdc.tokenAddress as string,
      }),
    ).rejects.toThrow(KnownContractNotFoundError);
  });

  it("throws when duplicate known contracts match", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([
      knownUsdc,
      knownUsdc,
    ]);

    await expect(
      validateKnownErc20TokenAddress({
        caip2: "eip155:1",
        tokenAddress: knownUsdc.tokenAddress as string,
      }),
    ).rejects.toThrow(KnownContractDataError);
  });

  it("throws when Mongo returns a malformed known contract", async () => {
    vi.spyOn(MongoDBClient.prototype, "connect").mockResolvedValue(undefined);
    vi.spyOn(MongoDBClient.prototype, "readDocument").mockResolvedValue([
      {
        ...knownUsdc,
        tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      },
    ]);

    await expect(
      validateKnownErc20TokenAddress({
        caip2: "eip155:1",
        tokenAddress: knownUsdc.tokenAddress as string,
      }),
    ).rejects.toThrow(KnownContractDataError);
  });
});
