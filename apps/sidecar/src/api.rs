use crate::cache::lvc::LatestValueCache;
use crate::comparison::compare_pair;
use crate::config::Config;
use crate::types::Exchange;
use log::debug;
use serde_json::{json, Value};

/// Handle an incoming WebSocket command and return a JSON response
pub fn handle_command(msg: &Value, lvc: &LatestValueCache, config: &Config) -> Value {
    let cmd = match msg.get("cmd").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return api_error("unknown", "missing 'cmd' field"),
    };

    debug!("[API] command: {}", cmd);

    match cmd {
        "snapshot" => cmd_snapshot(msg, lvc, config),
        "ticker" => cmd_ticker(msg, lvc),
        "compare" => cmd_compare(msg, lvc),
        "stats" => cmd_stats(lvc),
        _ => api_error(cmd, &format!("unknown command: {}", cmd)),
    }
}

/// Return latest tickers in the LVC. Defaults to Market Watch visible tickers;
/// authenticated callers may request `{ "scope": "all" }` for full debug state.
fn cmd_snapshot(msg: &Value, lvc: &LatestValueCache, config: &Config) -> Value {
    let tickers = if msg.get("scope").and_then(|v| v.as_str()) == Some("all") {
        lvc.snapshot()
    } else {
        config
            .visibility
            .filter_tickers(lvc.snapshot(), &config.pinlist)
    };
    json!({
        "type": "api",
        "cmd": "snapshot",
        "data": {
            "count": tickers.len(),
            "tickers": tickers
        }
    })
}

/// Return a single ticker by exchange/base/quote
fn cmd_ticker(msg: &Value, lvc: &LatestValueCache) -> Value {
    let exchange_str = match msg.get("exchange").and_then(|v| v.as_str()) {
        Some(e) => e,
        None => return api_error("ticker", "missing 'exchange' field"),
    };
    let base = match msg.get("base").and_then(|v| v.as_str()) {
        Some(b) => b,
        None => return api_error("ticker", "missing 'base' field"),
    };
    let quote = match msg.get("quote").and_then(|v| v.as_str()) {
        Some(q) => q,
        None => return api_error("ticker", "missing 'quote' field"),
    };

    let exchange = match parse_exchange(exchange_str) {
        Some(e) => e,
        None => return api_error("ticker", &format!("unknown exchange: {}", exchange_str)),
    };

    match lvc.get(&exchange, base, quote) {
        Some(ticker) => json!({
            "type": "api",
            "cmd": "ticker",
            "data": ticker
        }),
        None => json!({
            "type": "api",
            "cmd": "ticker",
            "data": null
        }),
    }
}

/// Compare prices across exchanges for a pair
fn cmd_compare(msg: &Value, lvc: &LatestValueCache) -> Value {
    let base = match msg.get("base").and_then(|v| v.as_str()) {
        Some(b) => b,
        None => return api_error("compare", "missing 'base' field"),
    };
    let quote = match msg.get("quote").and_then(|v| v.as_str()) {
        Some(q) => q,
        None => return api_error("compare", "missing 'quote' field"),
    };

    match compare_pair(lvc, base, quote) {
        Some(comparison) => json!({
            "type": "api",
            "cmd": "compare",
            "data": comparison
        }),
        None => json!({
            "type": "api",
            "cmd": "compare",
            "data": null
        }),
    }
}

/// Return LVC stats
fn cmd_stats(lvc: &LatestValueCache) -> Value {
    json!({
        "type": "api",
        "cmd": "stats",
        "data": {
            "lvc_entries": lvc.len()
        }
    })
}

/// Build an error response
fn api_error(cmd: &str, error: &str) -> Value {
    json!({
        "type": "api_error",
        "cmd": cmd,
        "error": error
    })
}

fn parse_exchange(s: &str) -> Option<Exchange> {
    match s.to_lowercase().as_str() {
        "binance" => Some(Exchange::Binance),
        "binance_f" | "binance_futures" => Some(Exchange::BinanceF),
        "upbit" => Some(Exchange::Upbit),
        "bithumb" => Some(Exchange::Bithumb),
        "bybit" => Some(Exchange::Bybit),
        "bybit_f" | "bybit_futures" => Some(Exchange::BybitF),
        "gateio" | "gate" => Some(Exchange::Gateio),
        "bitget" => Some(Exchange::Bitget),
        "bitget_f" | "bitget_futures" => Some(Exchange::BitgetF),
        "coinbase" => Some(Exchange::Coinbase),
        "kraken" => Some(Exchange::Kraken),
        "kucoin" => Some(Exchange::Kucoin),
        "okx" => Some(Exchange::Okx),
        "okx_f" | "okx_futures" => Some(Exchange::OkxF),
        "hyperliquid_f" | "hyperliquid_futures" => Some(Exchange::HyperliquidF),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::VisibilityCache;
    use crate::types::{NormalizedTicker, SystemConfig, SystemConfigJwtSecret, SystemConfigNodeEnv};
    use std::collections::HashSet;
    use std::str::FromStr;
    use std::sync::{Arc, RwLock};

    fn test_config() -> Config {
        let jwt_secret = "x".repeat(32);

        Config {
            inner: SystemConfig {
                port: 3000,
                api_port: 3001,
                sidecar_port: 25834,
                jwt_secret: SystemConfigJwtSecret::from_str(&jwt_secret).unwrap(),
                snapper_api_secret: None,
                mongo_uri: None,
                redis_url: Some("redis://127.0.0.1:6380".to_string()),
                dex_redis_channel: "dex_prices".to_string(),
                batching_duration_ms: 1000,
                collection_alert_destinations: "alertDestinations".to_string(),
                mongo_user: None,
                mongo_password: None,
                mongo_host: None,
                mongo_port: "27017".to_string(),
                mongo_db_name: None,
                redis_host: None,
                redis_port: "6380".to_string(),
                redis_password: None,
                node_env: SystemConfigNodeEnv::Dev,
            },
            port: 25834,
            api_port: 3001,
            jwt_secret,
            mongo_uri: None,
            redis_url: "redis://127.0.0.1:6380".to_string(),
            dex_redis_channel: "dex_prices".to_string(),
            batch_duration_ms: 1000,
            webhook_secret: String::new(),
            forex_update_interval_sec: 60,
            market_cache_update_interval_sec: 1800,
            korean_market_cache_update_interval_sec: 60,
            alert_destination_tailscale_suffix: ".ts.net".to_string(),
            alert_destination_allow_loopback_in_dev: false,
            excludelist: Arc::new(RwLock::new(HashSet::new())),
            pinlist: Arc::new(RwLock::new(HashSet::new())),
            visibility: Arc::new(VisibilityCache::new()),
        }
    }

    fn skhx_ticker() -> NormalizedTicker {
        NormalizedTicker {
            exchange: Exchange::HyperliquidF,
            base: "xyz:SKHX".to_string(),
            raw_base: "xyz:SKHX".to_string(),
            quote: "USDC".to_string(),
            o: 1580.0,
            h: 1590.0,
            l: 1570.0,
            c: 1582.5,
            v_base: 1.0,
            v_quote: 1582.5,
            timestamp_ms: 1781500000000,
            market_state: None,
            ingest_time_us: 1,
            o_krw: None,
            h_krw: None,
            l_krw: None,
            c_krw: None,
            v_quote_krw: None,
            change_24h: None,
            liquidity: None,
            funding_rate: None,
            funding_interval_hours: None,
            next_funding_time_ms: None,
            funding_timestamp_ms: None,
        }
    }

    #[test]
    fn handle_command_accepts_hyperliquid_futures_ticker() {
        let lvc = LatestValueCache::new();
        lvc.upsert(skhx_ticker());
        let response = handle_command(
            &json!({
                "cmd": "ticker",
                "exchange": "hyperliquid_f",
                "base": "xyz:SKHX",
                "quote": "USDC"
            }),
            &lvc,
            &test_config(),
        );

        assert_ne!(response.get("type").and_then(Value::as_str), Some("api_error"));
        assert_eq!(response.get("type").and_then(Value::as_str), Some("api"));
        assert_eq!(response["data"]["base"], "xyz:SKHX");
        assert!(!response.to_string().contains("unknown exchange"));
    }

    #[test]
    fn parse_exchange_accepts_hyperliquid_futures_alias() {
        assert_eq!(
            parse_exchange("hyperliquid_futures"),
            Some(Exchange::HyperliquidF)
        );
    }
}
