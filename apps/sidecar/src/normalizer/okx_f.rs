use crate::types::{
    Exchange, NormalizedTicker,
    parse_decimal, now_micros,
};
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;

/// Normalize an OKX FUTURES ticker WebSocket push message.
///
/// OKX WS ticker push format:
/// ```json
/// {
///   "arg": { "channel": "sprd-tickers", "sprdId": "BTC-USDT_BTC-USDT-SWAP" },
///   "data": [{
///     "sprdId": "BTC-USDT_BTC-USDT-SWAP",
///     "last": "4",
///     "lastSz": "0.01",
///     "askPx": "19.7",
///     "askSz": "5.79",
///     "bidPx": "5.9",
///     "bidSz": "5.79",
///     "open24h": "-7",
///     "high24h": "19.6",
///     "low24h": "-7",
///     "vol24h": "9.87",
///     "ts": "1715247061026"
///   }]
/// }
/// ```
pub fn normalize_okx_f_ticker(raw: &Value) -> Option<NormalizedTicker> {
    let data_arr = raw.get("data")?.as_array()?;
    let d = data_arr.first()?;

    let inst_id = raw
        .get("arg")
        .and_then(|a| a.get("instId"))
        .and_then(|v| v.as_str())
        .or_else(|| d.get("instId").and_then(|v| v.as_str()))?;

    // instId format: "BTC-USDT-SWAP"
    let parts: Vec<&str> = inst_id.split('-').collect();
    if parts.len() < 2 {
        return None;
    }
    
    let base = parts[0].to_string();
    let quote = parts[1].to_string();

    let c = parse_decimal(d.get("last")?.as_str()?)?;

    let o = d.get("open24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .unwrap_or(c);

    let h = d.get("high24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .unwrap_or(c);

    let l = d.get("low24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .unwrap_or(c);

    // For derivatives (SWAP/FUTURES), volCcy24h is volume in base currency (tokens),
    // while vol24h is volume in contract units.
    let v_base = d.get("volCcy24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .or_else(|| {
            // Fallback: if volCcy24h is missing, try vol24h but this is in contracts 
            // and requires contract_val to convert to tokens. 
            // Usually volCcy24h is present for all v5 tickers.
            d.get("vol24h").and_then(|v| v.as_str()).and_then(parse_decimal)
        })
        .unwrap_or_default();

    // v_quote = v_base (tokens) * current price (USDT)
    let v_quote = v_base * c;

    let timestamp_ms = d.get("ts")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    Some(NormalizedTicker {
        exchange: Exchange::OkxF,
        base,
        quote,
        o: o.to_f64().unwrap_or(0.0),
        h: h.to_f64().unwrap_or(0.0),
        l: l.to_f64().unwrap_or(0.0),
        c: c.to_f64().unwrap_or(0.0),
        v_base: v_base.to_f64().unwrap_or(0.0),
        v_quote: v_quote.to_f64().unwrap_or(0.0),
        timestamp_ms,
        market_state: None,
        ingest_time_us: now_micros(),
        o_krw: None,
        h_krw: None,
        l_krw: None,
        c_krw: None,
        v_quote_krw: None,
        liquidity: None,
    })
}
