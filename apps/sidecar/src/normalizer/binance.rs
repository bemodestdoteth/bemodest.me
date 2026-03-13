use crate::types::ticker::{
    Exchange, NormalizedTicker, MarketState,
    parse_decimal, parse_binance_symbol, now_micros, strip_scale_factor,
};
use serde_json::Value;

/// Normalize a single Binance miniTicker object into NormalizedTicker
/// 
/// Binance miniTicker format:
/// {
///   "e": "24hrMiniTicker",
///   "E": 1672515782136,  // Event time
///   "s": "BTCUSDT",      // Symbol
///   "c": "16950.00",     // Close price
///   "o": "16800.00",     // Open price
///   "h": "17100.00",     // High price
///   "l": "16700.00",     // Low price
///   "v": "1234.56",      // Total traded base asset volume
///   "q": "20000000.00"   // Total traded quote asset volume
/// }
pub fn normalize_binance_ticker(raw: &Value, exchange: Exchange) -> Option<NormalizedTicker> {
    let symbol = raw.get("s")?.as_str()?;
    let (raw_base, quote) = parse_binance_symbol(symbol)?;

    // For futures, strip any 1000x-style scale factor (e.g. "1000SHIB" -> "SHIB", divisor=1000)
    let (base, scale) = if exchange == Exchange::BinanceFutures {
        strip_scale_factor(&raw_base)
    } else {
        (raw_base, rust_decimal::Decimal::ONE)
    };

    let o = parse_decimal(raw.get("o")?.as_str()?)? / scale;
    let h = parse_decimal(raw.get("h")?.as_str()?)? / scale;
    let l = parse_decimal(raw.get("l")?.as_str()?)? / scale;
    let c = parse_decimal(raw.get("c")?.as_str()?)? / scale;
    let v_base = parse_decimal(raw.get("v")?.as_str()?)?;
    let v_quote = parse_decimal(raw.get("q")?.as_str()?)?;
    let timestamp_ms = raw.get("E")?.as_i64()?;

    Some(NormalizedTicker {
        exchange,
        base,
        quote,
        o,
        h,
        l,
        c,
        v_base,
        v_quote,
        timestamp_ms,
        market_state: Some(MarketState::Active), // Binance doesn't provide this
        ingest_time_us: now_micros(),
        o_krw: None,
        h_krw: None,
        l_krw: None,
        c_krw: None,
        v_quote_krw: None,
    })
}

/// Normalize an array of Binance miniTicker objects
pub fn normalize_binance_ticker_array(raw: &Value, exchange: Exchange) -> Vec<NormalizedTicker> {
    match raw.as_array() {
        Some(arr) => arr
            .iter()
            .filter_map(|item| normalize_binance_ticker(item, exchange))
            .collect(),
        None => Vec::new(),
    }
}
