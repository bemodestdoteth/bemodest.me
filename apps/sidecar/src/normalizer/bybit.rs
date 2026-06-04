use crate::types::{now_micros, parse_decimal, Exchange, ExchangeExt, NormalizedTicker};
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;

/// Normalize a single Bybit spot ticker WebSocket message into [`NormalizedTicker`].
///
/// Bybit spot WS ticker payload (per-symbol subscription, `type = snapshot|delta`):
/// ```json
/// {
///   "topic": "tickers.BTCUSDT",
///   "ts": 1673853746003,
///   "type": "snapshot",
///   "cs": 2588407389,
///   "data": {
///     "symbol":       "BTCUSDT",
///     "lastPrice":    "21109.77",    // close
///     "highPrice24h": "21426.99",    // high
///     "lowPrice24h":  "20575",       // low
///     "prevPrice24h": "20704.93",    // open (previous 24h price)
///     "volume24h":    "6780.866843", // base volume
///     "turnover24h":  "141946527.2", // quote volume (USDT)
///   }
/// }
/// ```
///
/// Delta messages may omit unchanged fields; returns `None` if any required
/// price field is missing.
pub fn normalize_bybit_ticker(raw: &Value) -> Option<NormalizedTicker> {
    let data = raw.get("data")?;

    let symbol = data.get("symbol")?.as_str()?;
    let (base, quote) = Exchange::Bybit.parse_symbol(symbol)?;

    let o = parse_decimal(data.get("prevPrice24h")?.as_str()?)?
        .to_f64()
        .unwrap_or(0.0);
    let h = parse_decimal(data.get("highPrice24h")?.as_str()?)?
        .to_f64()
        .unwrap_or(0.0);
    let l = parse_decimal(data.get("lowPrice24h")?.as_str()?)?
        .to_f64()
        .unwrap_or(0.0);
    let c = parse_decimal(data.get("lastPrice")?.as_str()?)?
        .to_f64()
        .unwrap_or(0.0);
    let v_base = parse_decimal(data.get("volume24h")?.as_str()?)?
        .to_f64()
        .unwrap_or(0.0);
    let v_quote = parse_decimal(data.get("turnover24h")?.as_str()?)?
        .to_f64()
        .unwrap_or(0.0);

    // `ts` is the exchange timestamp in milliseconds
    let timestamp_ms = raw.get("ts")?.as_i64()?;

    let ticker = NormalizedTicker {
        exchange: Exchange::Bybit,
        base: base.clone(),
        raw_base: base,
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
        change_24h: None,
        liquidity: None,
        funding_rate: None,
        funding_interval_hours: None,
        next_funding_time_ms: None,
        funding_timestamp_ms: None,
    };
    Some(ticker)
}
