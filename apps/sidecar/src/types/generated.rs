// Example code that deserializes and serializes the model.
// extern crate serde;
// #[macro_use]
// extern crate serde_derive;
// extern crate serde_json;
//
// use generated_module::AlertRule;
//
// fn main() {
//     let json = r#"{"answer": 42}"#;
//     let model: AlertRule = serde_json::from_str(&json).unwrap();
// }

use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertRule {
    #[serde(rename = "_id")]
    pub id: String,

    pub condition: Condition,

    pub cooldown_secs: i64,

    pub created_at: Option<String>,

    pub enabled: bool,

    pub exchanges: Vec<String>,

    pub label: String,

    pub quote: String,

    pub recovery_value: f64,

    pub ticker: String,

    pub updated_at: Option<String>,

    pub value: f64,

    pub webhook_dead: Option<bool>,

    pub webhook_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Condition {
    #[serde(rename = "change_pct_5m")]
    ChangePct5M,

    #[serde(rename = "price_above")]
    PriceAbove,

    #[serde(rename = "price_below")]
    PriceBelow,

    #[serde(rename = "spread_pct")]
    SpreadPct,

    #[serde(rename = "volume_spike")]
    VolumeSpike,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarConfigPayload {
    #[serde(rename = "type")]
    pub sidecar_config_payload_type: Type,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Type {
    #[serde(rename = "alertrules_updated")]
    AlertrulesUpdated,

    #[serde(rename = "excludelist_updated")]
    ExcludelistUpdated,

    #[serde(rename = "market_cache_updated")]
    MarketCacheUpdated,

    #[serde(rename = "pinlist_updated")]
    PinlistUpdated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedTicker {
    pub base: String,

    pub c: f64,

    pub c_krw: Option<f64>,

    pub exchange: Exchange,

    pub h: f64,

    pub h_krw: Option<f64>,

    pub ingest_time_us: i64,

    pub l: f64,

    pub l_krw: Option<f64>,

    pub liquidity: Option<f64>,

    pub market_state: Option<MarketState>,

    pub o: f64,

    pub o_krw: Option<f64>,

    pub quote: String,

    pub raw_base: String,

    pub timestamp_ms: i64,

    pub v_base: f64,

    pub v_quote: f64,

    pub v_quote_krw: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Exchange {
    Binance,

    #[serde(rename = "binance_f")]
    BinanceF,

    Bitget,

    #[serde(rename = "bitget_f")]
    BitgetF,

    Bithumb,

    Bybit,

    #[serde(rename = "bybit_f")]
    BybitF,

    Coinbase,

    Dex,

    Gateio,

    Kraken,

    Kucoin,

    Okx,

    #[serde(rename = "okx_f")]
    OkxF,

    Upbit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MarketState {
    Active,

    Preview,

    Suspended,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct SystemConfig {
    pub api_port: Option<i64>,

    pub batching_duration_ms: Option<i64>,

    pub dex_redis_channel: Option<String>,

    pub filter_min_sources: Option<i64>,

    pub filter_min_spread_pct: Option<f64>,

    pub jwt_secret: String,

    pub mongo_db_name: Option<String>,

    pub mongo_host: Option<String>,

    pub mongo_password: Option<String>,

    pub mongo_port: Option<String>,

    pub mongo_uri: Option<String>,

    pub mongo_user: Option<String>,

    pub node_env: Option<NodeEnv>,

    pub port: Option<i64>,

    pub redis_host: Option<String>,

    pub redis_password: Option<String>,

    pub redis_port: Option<String>,

    pub redis_url: Option<String>,

    pub sidecar_port: Option<i64>,

    pub snapper_api_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeEnv {
    Dev,

    Prod,

    Test,
}
