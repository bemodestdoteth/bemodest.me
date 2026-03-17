use crate::types::{Exchange, NormalizedTicker, now_micros};
use serde_json::Value;
use rust_decimal::Decimal;
use rust_decimal::prelude::FromStr;
use chrono::Utc;

/// Normalize a single Kraken WebSocket v2 ticker data item into [`NormalizedTicker`].
///
/// Kraken WS v2 ticker payload (snapshot or update):
/// ```json
/// {
///   "channel": "ticker",
///   "type": "snapshot",
///   "data": [{
///     "symbol": "XBT/USD",
///     "bid": 27000.0,
///     "ask": 27001.0,
///     "last": 27000.5,
///     "volume": 123.45,
///     "vwap": 26990.0,
///     "low": 26800.0,
///     "high": 27200.0,
///     "change": 200.0,
///     "change_pct": 0.75
///   }]
/// }
/// ```
///
/// Returns `None` if the message is not a ticker channel or any required field is missing.
pub fn normalize_kraken_ticker(raw: &Value) -> Option<Vec<NormalizedTicker>> {
    // Only handle ticker channel messages
    if raw.get("channel")?.as_str()? != "ticker" {
        return None;
    }

    let msg_type = raw.get("type")?.as_str()?;
    if msg_type != "snapshot" && msg_type != "update" {
        return None;
    }

    let data = raw.get("data")?.as_array()?;
    let mut tickers = Vec::with_capacity(data.len());

    for item in data {
        if let Some(ticker) = normalize_ticker_item(item) {
            tickers.push(ticker);
        }
    }

    if tickers.is_empty() {
        None
    } else {
        Some(tickers)
    }
}

fn normalize_ticker_item(item: &Value) -> Option<NormalizedTicker> {
    // "XBT/USD" → base="XBT", quote="USD"
    let symbol = item.get("symbol")?.as_str()?;
    let (raw_base, quote) = parse_kraken_symbol(symbol)?;

    // Normalize Kraken-specific aliases (XBT→BTC, XDG→DOGE, etc.)
    let base = normalize_base(&raw_base);

    let c = parse_f64_field(item, "last")?;
    let h = parse_f64_field(item, "high")?;
    let l = parse_f64_field(item, "low")?;
    let v_base = parse_f64_field(item, "volume")?;
    // vwap is the most reliable open-equivalent Kraken provides at L1
    let o = parse_f64_field(item, "vwap").unwrap_or(c);

    let v_quote = c * v_base;

    let timestamp_ms = Utc::now().timestamp_millis();

    Some(NormalizedTicker {
        exchange: Exchange::Kraken,
        base,
        quote,
        o,
        h,
        l,
        c,
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
        liquidity: None,
    })
}

/// Parse Kraken symbol format: "XBT/USD" → ("XBT", "USD")
fn parse_kraken_symbol(symbol: &str) -> Option<(String, String)> {
    let mut parts = symbol.splitn(2, '/');
    let base = parts.next()?.trim().to_string();
    let quote = parts.next()?.trim().to_string();
    if base.is_empty() || quote.is_empty() {
        return None;
    }
    Some((base, quote))
}

/// Map Kraken-specific asset codes to canonical names.
fn normalize_base(base: &str) -> String {
    match base {
        "XBT" => "BTC".to_string(),
        "XDG" => "DOGE".to_string(),
        "XLM" => "XLM".to_string(), // kept as-is
        "XRP" => "XRP".to_string(), // kept as-is
        other => other.to_string(),
    }
}

fn parse_f64_field(item: &Value, key: &str) -> Option<f64> {
    let v = item.get(key)?;
    if let Some(f) = v.as_f64() {
        Some(f)
    } else if let Some(s) = v.as_str() {
        s.parse::<f64>().ok()
    } else {
        None
    }
}
