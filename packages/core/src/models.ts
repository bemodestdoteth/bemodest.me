import { getAddress, isAddress } from "viem";
import { z } from "zod";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export const AliasSchema = z.object({
  name: z.string().describe("Symbol name, e.g. BTC"),
  chain: z.string().describe("Chain code, e.g. BTC"),
});

export type Alias = z.infer<typeof AliasSchema>;

export const LabelSchema = z.object({
  addr: z.string().describe("Wallet address"),
  label: z.string().describe("Human-readable label"),
  chains: z.array(z.string()).describe("List of chain codes"),
  entity: z.string().describe("Entity name, e.g. Binance"),
  tracking: z.union([z.string(), z.boolean()]).default("").describe("Tracking status"),
  comment: z.string().nullable().default(null).describe("Optional comment"),
  aliases: z.array(AliasSchema).default([]).describe("Alternative symbol names"),
});

export type Label = z.infer<typeof LabelSchema>;

const HttpUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "http:" || url.protocol === "https:";
}, "Expected an HTTP(S) URL");

export const DecimalWeiStringSchema = z.string().regex(
  /^(0|[1-9]\d*)$/,
  "Expected a non-negative integer decimal string",
);

export const NetworkAnnotationSchema = z.object({
  annotation: z.record(z.union([z.string(), z.record(z.unknown())])).describe(
    "Exchange-specific network names, e.g. {binance: ETH, kucoin: ERC20}"
  ),
  caip2: z.string().describe("CAIP-2 chain identifier, e.g. eip155:1"),
});

export type NetworkAnnotation = z.infer<typeof NetworkAnnotationSchema>;

export const EvmChainForwardingSchema = z.object({
  gasReserveWei: DecimalWeiStringSchema,
  dustThresholdWei: DecimalWeiStringSchema,
});

export type EvmChainForwarding = z.infer<typeof EvmChainForwardingSchema>;

export const EvmChainConfigSchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1),
  code: z.string().min(1).optional(),
  caip2: z.string().regex(/^eip155:\d+$/),
  chainId: z.number().int().positive(),
  status: z.literal("active"),
  rpc: z.array(HttpUrlSchema).min(1),
  wsRpc: z.array(z.string().url()).optional(),
  blockExplorerPrefix: z.string().optional(),
  forwarding: EvmChainForwardingSchema,
});

export type EvmChainConfig = z.infer<typeof EvmChainConfigSchema>;

export const EvmAddressSchema = z.string().refine((value) => {
  if (!isAddress(value)) return false;
  return value !== ZERO_ADDRESS && value === getAddress(value);
}, "Expected a non-zero checksum EVM address");

export const KnownErc20ContractSchema = z.object({
  caip2: z.string().regex(/^eip155:\d+$/),
  tokenAddress: EvmAddressSchema,
  contractType: z.literal("erc20"),
  status: z.literal("active"),
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(255),
  name: z.string().min(1).optional(),
});

export type KnownErc20Contract = z.infer<typeof KnownErc20ContractSchema>;

export const TokenAnnotationSchema = z.object({
  annotation: z.record(z.union([z.string(), z.record(z.any())])).describe(
    "Exchange-specific token symbols, e.g. {binance: USDT, kucoin: USDT}"
  ),
  token: z.string().describe("Canonical token symbol, e.g. USDT"),
});

export type TokenAnnotation = z.infer<typeof TokenAnnotationSchema>;
