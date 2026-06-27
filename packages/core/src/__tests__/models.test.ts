import { describe, it, expect } from "vitest";
import {
  AliasSchema,
  DecimalWeiStringSchema,
  EvmChainConfigSchema,
  KnownErc20ContractSchema,
  LabelSchema,
  NetworkAnnotationSchema,
  TokenAnnotationSchema,
} from "../models.js";

describe("models", () => {
  it("validates Alias", () => {
    const alias = AliasSchema.parse({ name: "BTC", chain: "BTC" });
    expect(alias.name).toBe("BTC");
  });

  it("validates Label with defaults", () => {
    const label = LabelSchema.parse({
      addr: "0x123",
      label: "Test",
      chains: ["ETH"],
      entity: "TestEntity",
    });
    expect(label.tracking).toBe("");
    expect(label.comment).toBeNull();
    expect(label.aliases).toEqual([]);
  });

  it("validates NetworkAnnotation", () => {
    const na = NetworkAnnotationSchema.parse({
      annotation: { binance: "ETH" },
      caip2: "eip155:1",
    });
    expect(na.caip2).toBe("eip155:1");
  });

  it("validates TokenAnnotation", () => {
    const ta = TokenAnnotationSchema.parse({
      annotation: { binance: "USDT" },
      token: "USDT",
    });
    expect(ta.token).toBe("USDT");
  });

  it("validates decimal wei strings", () => {
    expect(DecimalWeiStringSchema.parse("0")).toBe("0");
    expect(DecimalWeiStringSchema.parse("1000000000000000")).toBe("1000000000000000");
    expect(() => DecimalWeiStringSchema.parse("01")).toThrow();
    expect(() => DecimalWeiStringSchema.parse("-1")).toThrow();
    expect(() => DecimalWeiStringSchema.parse("1.5")).toThrow();
  });

  it("validates EVM chain config with nested forwarding policy", () => {
    const chain = EvmChainConfigSchema.parse({
      name: "Ethereum",
      symbol: "ETH",
      code: "ETH",
      caip2: "eip155:1",
      chainId: 1,
      status: "active",
      rpc: ["https://rpc.example.com"],
      forwarding: {
        gasReserveWei: "10000000000000000",
        dustThresholdWei: "1000000000000000",
      },
    });

    expect(chain.forwarding.gasReserveWei).toBe("10000000000000000");
  });

  it("rejects invalid EVM chain config fields", () => {
    expect(() =>
      EvmChainConfigSchema.parse({
        name: "Ethereum",
        symbol: "ETH",
        caip2: "cosmos:osmosis-1",
        chainId: 1,
        status: "active",
        rpc: ["https://rpc.example.com"],
        forwarding: {
          gasReserveWei: "1000",
          dustThresholdWei: "100",
        },
      }),
    ).toThrow();

    expect(() =>
      EvmChainConfigSchema.parse({
        name: "Ethereum",
        symbol: "ETH",
        caip2: "eip155:1",
        chainId: 1,
        status: "active",
        rpc: ["ftp://rpc.example.com"],
        forwarding: {
          gasReserveWei: "1000",
          dustThresholdWei: "100",
        },
      }),
    ).toThrow();

    expect(() =>
      EvmChainConfigSchema.parse({
        name: "Ethereum",
        symbol: "ETH",
        caip2: "eip155:1",
        chainId: 1,
        status: "active",
        rpc: ["https://rpc.example.com"],
      }),
    ).toThrow();
  });

  it("validates known ERC20 contracts", () => {
    const contract = KnownErc20ContractSchema.parse({
      caip2: "eip155:1",
      tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      contractType: "erc20",
      status: "active",
      symbol: "USDC",
      decimals: 6,
      name: "USD Coin",
    });

    expect(contract.symbol).toBe("USDC");
  });

  it("rejects invalid known ERC20 contract fields", () => {
    const contract = {
      caip2: "eip155:1",
      tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      contractType: "erc20",
      status: "active",
      symbol: "USDC",
      decimals: 6,
    };

    expect(() =>
      KnownErc20ContractSchema.parse({ ...contract, caip2: "cosmos:osmosis-1" }),
    ).toThrow();
    expect(() =>
      KnownErc20ContractSchema.parse({
        ...contract,
        tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      }),
    ).toThrow();
    expect(() =>
      KnownErc20ContractSchema.parse({
        ...contract,
        tokenAddress: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow();
    expect(() =>
      KnownErc20ContractSchema.parse({ ...contract, contractType: "erc721" }),
    ).toThrow();
    expect(() =>
      KnownErc20ContractSchema.parse({ ...contract, status: "inactive" }),
    ).toThrow();
    expect(() =>
      KnownErc20ContractSchema.parse({ ...contract, decimals: 256 }),
    ).toThrow();
  });
});
