use crate::types::{
    Exchange, NormalizedTicker,
    parse_decimal, now_micros,
};
use serde_json::Value;
use rust_decimal::prelude::ToPrimitive;

/// Normalize a single Coinbase Exchange WebSocket ticker message into [`NormalizedTicker`].
///
/// Coinbase ticker_batch WS payload (one message per symbol trade):
/// ```json
/// {
///   "type": "ticker",
///   "sequence": 37475248783,
///   "product_id": "ETH-USD",
///   "price": "1285.22",
///   "open_24h": "1310.79",
///   "volume_24h": "245532.79",
///   "low_24h": "1280.52",
///   "high_24h": "1313.80",
///   "volume_30d": "9788783.60",
///   "best_bid": "1285.04",
///   "best_ask": "1285.27",
///   "side": "buy",
///   "time": "2022-10-19T23:28:22.061769Z",
///   "trade_id": 370843401,
///   "last_size": "11.43"
/// }
/// ```
///
/// Returns `None` if any required field is missing or unparseable.
pub fn normalize_coinbase_ticker(raw: &Value) -> Option<NormalizedTicker> {
    // Only handle ticker messages
    if raw.get("type")?.as_str()? != "ticker" {
        return None;
    }

    // product_id is "BASE-QUOTE", e.g. "ETH-USD"
    let product_id = raw.get("product_id")?.as_str()?;
    let (base, quote) = parse_coinbase_product_id(product_id)?;

    let c = parse_decimal(raw.get("price")?.as_str()?)?;
    let o = parse_decimal(raw.get("open_24h")?.as_str()?)?;
    let h = parse_decimal(raw.get("high_24h")?.as_str()?)?;
    let l = parse_decimal(raw.get("low_24h")?.as_str()?)?;
    let v_base = parse_decimal(raw.get("volume_24h")?.as_str()?)?;

    // Quote volume: price * base volume
    let v_quote = c * v_base;

    // Parse ISO8601 timestamp from "time" field; fall back to now
    let timestamp_ms = raw
        .get("time")
        .and_then(|t| t.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    Some(NormalizedTicker {
        exchange: Exchange::Coinbase,
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
        liquidity: None,
    })
}

/// Parse Coinbase product_id format: "ETH-USD" → ("ETH", "USD")
fn parse_coinbase_product_id(product_id: &str) -> Option<(String, String)> {
    let mut parts = product_id.splitn(2, '-');
    let base = parts.next()?;
    let quote = parts.next()?;
    if base.is_empty() || quote.is_empty() {
        return None;
    }
    Some((base.to_string(), quote.to_string()))
}
