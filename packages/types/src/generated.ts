export interface AlertDestinationTemplate {
    _id:                   string;
    created_at?:           string;
    enabled?:              boolean;
    kind:                  Kind;
    label:                 string;
    protected?:            boolean;
    supported_alert_types: AlertType[];
    updated_at?:           string;
    url:                   string;
}

export enum Kind {
    BuiltinAPIIngest = "builtin_api_ingest",
    ExternalWebhook = "external_webhook",
}

export enum AlertType {
    Normal = "normal",
    Urgent = "urgent",
}

export interface AlertRule {
    _id:                     string;
    alert_type_rules:        AlertTypeRule[];
    condition:               Condition;
    cooldown_secs:           number;
    created_at?:             string;
    destination_assignments: DestinationAssignment[];
    enabled:                 boolean;
    exchanges:               string[];
    label:                   string;
    minSources?:             number;
    quote:                   string;
    recovery_value:          number;
    scope?:                  Scope;
    ticker:                  string;
    updated_at?:             string;
    value:                   number;
    volumeFloorUsd?:         number;
}

export interface AlertTypeRule {
    alert_type: AlertType;
    operator:   Operator;
    value:      number;
}

export enum Operator {
    Gt = "gt",
    Gte = "gte",
    LTE = "lte",
    Lt = "lt",
}

export enum Condition {
    ChangePct24H = "change_pct_24h",
    ChangePct5M = "change_pct_5m",
    PriceAbove = "price_above",
    PriceBelow = "price_below",
    SpreadPct = "spread_pct",
    VolumeSpike = "volume_spike",
}

export interface DestinationAssignment {
    dead?:           boolean;
    destination_id:  string;
    enabled?:        boolean;
    last_failed_at?: string;
}

export enum Scope {
    Alert = "alert",
    MarketWatch = "market_watch",
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
    base:                    string;
    c:                       number;
    c_krw?:                  number;
    change_24h?:             number;
    exchange:                Exchange;
    funding_interval_hours?: number;
    funding_rate?:           number;
    funding_timestamp_ms?:   number;
    h:                       number;
    h_krw?:                  number;
    ingest_time_us:          number;
    l:                       number;
    l_krw?:                  number;
    liquidity?:              number;
    market_state?:           MarketState;
    next_funding_time_ms?:   number;
    o:                       number;
    o_krw?:                  number;
    quote:                   string;
    raw_base:                string;
    timestamp_ms:            number;
    v_base:                  number;
    v_quote:                 number;
    v_quote_krw?:            number;
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
    HyperliquidF = "hyperliquid_f",
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
    API_PORT?:                      number;
    BATCHING_DURATION_MS?:          number;
    COLLECTION_ALERT_DESTINATIONS?: string;
    DEX_REDIS_CHANNEL?:             string;
    JWT_SECRET:                     string;
    MONGO_DB_NAME?:                 string;
    MONGO_HOST?:                    string;
    MONGO_PASSWORD?:                string;
    MONGO_PORT?:                    string;
    MONGO_URI?:                     string;
    MONGO_USER?:                    string;
    NODE_ENV?:                      NodeEnv;
    PORT?:                          number;
    REDIS_HOST?:                    string;
    REDIS_PASSWORD?:                string;
    REDIS_PORT?:                    string;
    REDIS_URL?:                     string;
    SIDECAR_PORT?:                  number;
    SNAPPER_API_SECRET?:            string;
}

export enum NodeEnv {
    Dev = "dev",
    Prod = "prod",
    Test = "test",
}
