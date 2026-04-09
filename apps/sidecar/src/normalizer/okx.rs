use crate::types::{
    Exchange, NormalizedTicker,
    parse_decimal, now_micros,
};
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;

/// Normalize an OKX SPOT ticker WebSocket push message.
///
/// OKX WS ticker push format:
/// ```json
/// {
///   "arg": { "channel": "tickers", "instId": "BTC-USDT" },
///   "data": [{
///     "instType": "SPOT",
///     "instId":   "BTC-USDT",
///     "last":     "9999.99",
///     "lastSz":   "0.1",
///     "askPx":    "9999.99",
///     "askSz":    "11",
///     "bidPx":    "8888.88",
///     "bidSz":    "5",
///     "open24h":  "9000",
///     "high24h":  "10000",
///     "low24h":   "8888.88",
///     "vol24h":   "2222",      // base-currency volume
///     "volCcy24h":"2222",      // quote-currency volume
///     "ts":       "1597026383085"
///   }]
/// }
/// ```
pub fn normalize_okx_ticker(raw: &Value) -> Option<NormalizedTicker> {
    // Must have "data" array (event-type frames like subscribe ack won't)
    let data_arr = raw.get("data")?.as_array()?;
    let d = data_arr.first()?;

    // Derive base/quote from instId in the arg envelope
    let inst_id = raw
        .get("arg")
        .and_then(|a| a.get("instId"))
        .and_then(|v| v.as_str())
        // Fall back to instId inside data element
        .or_else(|| d.get("instId").and_then(|v| v.as_str()))?;

    // instId format: "BTC-USDT"
    let parts: Vec<&str> = inst_id.split('-').collect();
    if parts.len() != 2 {
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

    // vol24h is base-currency volume
    let v_base = d.get("vol24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .unwrap_or_default();

    // volCcy24h is quote-currency volume
    let v_quote = d.get("volCcy24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .unwrap_or(v_base * c);

    let timestamp_ms = d.get("ts")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    Some(NormalizedTicker {
        exchange: Exchange::Okx,
        base: base.clone(),
        raw_base: base,
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
        change_24h: None,
        liquidity: None,
    })
}
