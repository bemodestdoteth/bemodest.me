import { z } from 'zod';

export const ExchangeEnum = z.enum([
    'binance',
    'binance_f',
    'upbit',
    'bithumb',
    'bybit',
    'bybit_f',
    'gateio',
    'bitget',
    'bitget_f',
    'coinbase',
    'kraken',
    'kucoin',
    'okx',
    'okx_f',
    'dex'
]);

export const MarketStateEnum = z.enum([
    'Preview',
    'Active',
    'Suspended'
]);

export const NormalizedTickerSchema = z.object({
    exchange: ExchangeEnum,
    base: z.string(),
    raw_base: z.string(),
    quote: z.string(),
    o: z.number(),
    h: z.number(),
    l: z.number(),
    c: z.number(),
    v_base: z.number(),
    v_quote: z.number(),
    liquidity: z.number().optional(),
    timestamp_ms: z.number().int(),
    market_state: MarketStateEnum.optional(),
    ingest_time_us: z.number().int(),
    o_krw: z.number().optional(),
    h_krw: z.number().optional(),
    l_krw: z.number().optional(),
    c_krw: z.number().optional(),
    v_quote_krw: z.number().optional(),
});

export type NormalizedTicker = z.infer<typeof NormalizedTickerSchema>;
