use crate::cache::lvc::LatestValueCache;
use crate::comparison::compare_pair;
use crate::types::Exchange;
use log::debug;
use serde_json::{json, Value};

/// Handle an incoming WebSocket command and return a JSON response
pub fn handle_command(msg: &Value, lvc: &LatestValueCache) -> Value {
    let cmd = match msg.get("cmd").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => return api_error("unknown", "missing 'cmd' field"),
    };

    debug!("[API] command: {}", cmd);

    match cmd {
        "snapshot" => cmd_snapshot(lvc),
        "ticker" => cmd_ticker(msg, lvc),
        "compare" => cmd_compare(msg, lvc),
        "stats" => cmd_stats(lvc),
        _ => api_error(cmd, &format!("unknown command: {}", cmd)),
    }
}

/// Return all latest tickers in the LVC
fn cmd_snapshot(lvc: &LatestValueCache) -> Value {
    let tickers = lvc.snapshot();
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
        _ => None,
    }
}
