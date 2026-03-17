export interface AlertRule {
    _id:            string;
    condition:      Condition;
    cooldown_secs:  number;
    created_at?:    Date;
    enabled:        boolean;
    exchanges:      string[];
    label:          string;
    quote:          string;
    recovery_value: number;
    ticker:         string;
    updated_at?:    Date;
    value:          number;
    webhook_dead:   boolean;
    webhook_url:    string;
    [property: string]: any;
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
    [property: string]: any;
}

export enum Type {
    AlertrulesUpdated = "alertrules_updated",
    ExcludelistUpdated = "excludelist_updated",
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
    timestamp_ms:   number;
    v_base:         number;
    v_quote:        number;
    v_quote_krw?:   number;
    [property: string]: any;
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
