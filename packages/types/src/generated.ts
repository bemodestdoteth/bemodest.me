export interface AlertRule {
    _id:            string;
    condition:      Condition;
    cooldown_secs:  number;
    created_at?:    string;
    enabled:        boolean;
    exchanges:      string[];
    label:          string;
    quote:          string;
    recovery_value: number;
    ticker:         string;
    updated_at?:    string;
    value:          number;
    webhook_dead?:  boolean;
    webhook_url:    string;
}

export enum Condition {
    ChangePct5M = "change_pct_5m",
    PriceAbove = "price_above",
    PriceBelow = "price_below",
    SpreadPct = "spread_pct",
    VolumeSpike = "volume_spike",
}

export interface SidecarConfigPayload {
    type: Type;
}

export enum Type {
    AlertrulesUpdated = "alertrules_updated",
    ExcludelistUpdated = "excludelist_updated",
    MarketCacheUpdated = "market_cache_updated",
    PinlistUpdated = "pinlist_updated",
}

export interface NormalizedTicker {
    base:           string;
    c:              number;
    c_krw?:         number;
    exchange:       Exchange;
    h:              number;
    h_krw?:         number;
    ingest_time_us: number;
    l:              number;
    l_krw?:         number;
    liquidity?:     number;
    market_state?:  MarketState;
    o:              number;
    o_krw?:         number;
    quote:          string;
    raw_base:       string;
    timestamp_ms:   number;
    v_base:         number;
    v_quote:        number;
    v_quote_krw?:   number;
}

export enum Exchange {
    Binance = "binance",
    BinanceF = "binance_f",
    Bitget = "bitget",
    BitgetF = "bitget_f",
    Bithumb = "bithumb",
    Bybit = "bybit",
    BybitF = "bybit_f",
    Coinbase = "coinbase",
    Dex = "dex",
    Gateio = "gateio",
    Kraken = "kraken",
    Kucoin = "kucoin",
    Okx = "okx",
    OkxF = "okx_f",
    Upbit = "upbit",
}

export enum MarketState {
    Active = "Active",
    Preview = "Preview",
    Suspended = "Suspended",
}

export interface SystemConfig {
    API_PORT?:              number;
    BATCHING_DURATION_MS?:  number;
    DEX_REDIS_CHANNEL?:     string;
    FILTER_MIN_SOURCES?:    number;
    FILTER_MIN_SPREAD_PCT?: number;
    JWT_SECRET:             string;
    MONGO_DB_NAME?:         string;
    MONGO_HOST?:            string;
    MONGO_PASSWORD?:        string;
    MONGO_PORT?:            string;
    MONGO_URI?:             string;
    MONGO_USER?:            string;
    NODE_ENV?:              NodeEnv;
    PORT?:                  number;
    REDIS_HOST?:            string;
    REDIS_PASSWORD?:        string;
    REDIS_PORT?:            string;
    REDIS_URL?:             string;
    SIDECAR_PORT?:          number;
    SNAPPER_API_SECRET?:    string;
}

export enum NodeEnv {
    Dev = "dev",
    Prod = "prod",
    Test = "test",
}
