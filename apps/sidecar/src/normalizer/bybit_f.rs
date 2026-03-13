use crate::types::ticker::{
    Exchange, NormalizedTicker,
    parse_decimal, parse_binance_symbol, now_micros, strip_scale_factor,
};
use serde_json::Value;

/// Normalize a single Bybit Futures linear ticker WebSocket message into [`NormalizedTicker`].
///
/// Bybit futures WS ticker payload:`
/// {
///   "topic": "tickers.BTCUSDT",
///   "type": "snapshot",
///   "data": {
///     "symbol": "BTCUSDT",
///     "lastPrice": "21109.77",
///     "highPrice24h": "21426.99",
///     "lowPrice24h": "20575",
///     "prevPrice24h": "20704.93",
///     "volume24h": "6780.866843",
///     "turnover24h": "141946527.2",
///     ...
///   },
///   "ts": 1673853746003,
/// }
pub fn normalize_bybit_f_ticker(raw: &Value, existing: Option<NormalizedTicker>) -> Option<NormalizedTicker> {
    let msg_type = raw.get("type")?.as_str()?;
    let topic = raw.get("topic")?.as_str()?;
    let symbol = topic.strip_prefix("tickers.")?;
    let (raw_base, quote) = parse_binance_symbol(symbol)?;

    // Strip 1000x-style scale factor (e.g. "1000SHIB" -> "SHIB", divisor=1000)
    let (base, scale) = strip_scale_factor(&raw_base);

    let data = raw.get("data")?;
    let timestamp_ms = raw.get("ts")?.as_i64()?;

    if msg_type == "snapshot" {
        let o = parse_decimal(data.get("prevPrice24h")?.as_str()?)? / scale;
        let h = parse_decimal(data.get("highPrice24h")?.as_str()?)? / scale;
        let l = parse_decimal(data.get("lowPrice24h")?.as_str()?)? / scale;
        let c = parse_decimal(data.get("lastPrice")?.as_str()?)? / scale;
        let v_base = parse_decimal(data.get("volume24h")?.as_str()?)?;
        let v_quote = parse_decimal(data.get("turnover24h")?.as_str()?)?;

        Some(NormalizedTicker {
            exchange: Exchange::BybitFutures,
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
        })
    } else if msg_type == "delta" {
        if let Some(mut ticker) = existing {
            if let Some(val) = data.get("prevPrice24h").and_then(|v| v.as_str()).and_then(parse_decimal) { ticker.o = val / scale; }
            if let Some(val) = data.get("highPrice24h").and_then(|v| v.as_str()).and_then(parse_decimal) { ticker.h = val / scale; }
            if let Some(val) = data.get("lowPrice24h").and_then(|v| v.as_str()).and_then(parse_decimal) { ticker.l = val / scale; }
            if let Some(val) = data.get("lastPrice").and_then(|v| v.as_str()).and_then(parse_decimal) { ticker.c = val / scale; }
            if let Some(val) = data.get("volume24h").and_then(|v| v.as_str()).and_then(parse_decimal) { ticker.v_base = val; }
            if let Some(val) = data.get("turnover24h").and_then(|v| v.as_str()).and_then(parse_decimal) { ticker.v_quote = val; }
            
            ticker.timestamp_ms = timestamp_ms;
            ticker.ingest_time_us = now_micros();
            Some(ticker)
        } else {
            None // Missed the snapshot, cannot apply delta
        }
    } else {
        None
    }
}
