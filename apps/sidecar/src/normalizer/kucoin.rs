use crate::types::{now_micros, parse_decimal, Exchange, NormalizedTicker};
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;

/// Normalize a KuCoin SPOT ticker WebSocket message.
///
/// KuCoin WS ticker format:
/// ```json
/// {
///   "type": "message",
///   "topic": "/market/ticker:BTC-USDT",
///   "subject": "trade.ticker",
///   "data": {
///     "sequence":    "1545896669105",
///     "price":       "0.9073",    // last trade price
///     "size":        "0.7068",    // last trade size (base)
///     "bestAsk":     "0.9075",
///     "bestAskSize": "0.9018",
///     "bestBid":     "0.9072",
///     "bestBidSize": "8.9731",
///     "time":        1734680491498  // epoch ms
///   }
/// }
/// ```
///
/// Note: price, size, bestAsk, bestBid are the only reliable fields;
/// no 24h OHLCV is provided in the standard ticker stream.
/// `o`, `h`, `l` are set to `c` (last price) as the best approximation.
pub fn normalize_kucoin_ticker(raw: &Value) -> Option<NormalizedTicker> {
    // Only handle ticker messages
    let msg_type = raw.get("type")?.as_str()?;
    if msg_type != "message" {
        return None;
    }

    let topic = raw.get("topic")?.as_str()?;
    // topic format: "/market/ticker:BTC-USDT"
    let symbol = topic.strip_prefix("/market/ticker:")?;
    let parts: Vec<&str> = symbol.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    let base = parts[0].to_string();
    let quote = parts[1].to_string();

    let d = raw.get("data")?;

    let c = parse_decimal(d.get("price")?.as_str()?)?;

    // No 24h OHLCV in standard ticker stream — use last price as stand-in
    let o = c;
    let h = c;
    let l = c;

    // Last trade size in base currency
    let v_base = d
        .get("size")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .and_then(|v| v.to_f64())
        .unwrap_or(0.0);

    let v_quote = v_base * c.to_f64().unwrap_or(0.0);

    // Timestamp from "time" field (milliseconds)
    let timestamp_ms = d
        .get("time")
        .and_then(|v| v.as_i64())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    Some(NormalizedTicker {
        exchange: Exchange::Kucoin,
        base: base.clone(),
        raw_base: base,
        quote,
        o: o.to_f64().unwrap_or(0.0),
        h: h.to_f64().unwrap_or(0.0),
        l: l.to_f64().unwrap_or(0.0),
        c: c.to_f64().unwrap_or(0.0),
        v_base,
        v_quote,
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
