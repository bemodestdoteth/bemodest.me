use crate::types::ticker::{
    Exchange, MarketState, NormalizedTicker,
    parse_decimal, parse_korean_symbol, now_micros,
};
use serde_json::Value;
use std::str::FromStr;
use rust_decimal::Decimal;
use rust_decimal::prelude::FromPrimitive;

/// Normalize a single Upbit/Bithumb ticker object into NormalizedTicker.
///
/// Pass `krw_per_usd = Some(rate)` to convert KRW-quoted OHLCV fields to USD.
/// The original KRW values are always preserved in `*_krw` fields for KRW pairs.
/// If the forex rate is unavailable (`None`), `o/h/l/c/v_quote` remain in KRW.
///
/// Upbit/Bithumb ticker format (SIMPLE mode):
/// {
///   "ty": "ticker",
///   "cd": "KRW-BTC",      // Code (quote-base format)
///   "op": "16800000",     // Opening price
///   "hp": "17100000",     // High price
///   "lp": "16700000",     // Low price
///   "tp": "16950000",     // Trade price (close)
///   "pcp": "16800000",   // Prev closing price
///   "c": "RISE",          // Change (RISE/EVEN/FALL)
///   "cp": "150000",       // Change price
///   "scp": "150000",      // Signed change price
///   "cr": "0.00892857",   // Change rate
///   "scr": "0.00892857",  // Signed change rate
///   "tv": "0.01234567",   // Trade volume
///   "atv": "1234.56",     // Acc trade volume (base)
///   "atv24h": "2345.67",  // Acc trade volume 24h
///   "atp": "20000000000", // Acc trade price (quote)
///   "atp24h": "30000000000", // Acc trade price 24h
///   "tdt": "20231231",    // Trade date (KST)
///   "ttm": "235959",      // Trade time (KST)
///   "tms": 1672531199000, // Trade timestamp (ms)
///   "ab": "ASK",          // Ask/Bid
///   "aav": "100.0",       // Acc ask volume
///   "abv": "100.0",       // Acc bid volume
///   "h52wp": "70000000",  // 52 week high
///   "h52wdt": "2023-01-01",
///   "l52wp": "15000000",  // 52 week low
///   "l52wdt": "2023-06-01",
///   "ms": "ACTIVE",       // Market state
///   "mw": "NONE",         // Market warning
///   "its": false,         // Is trading suspended
///   "dd": null,           // Delisting date
///   "st": "SNAPSHOT"      // Stream type
/// }
pub fn normalize_upbit_ticker(
    raw: &Value,
    exchange: Exchange,
    krw_per_usd: Option<f64>,
    btc_krw: Option<Decimal>,
) -> Option<NormalizedTicker> {
    let code = raw.get("cd")?.as_str()?;
    let (base, quote) = parse_korean_symbol(code)?;

    // Upbit uses numeric values, not strings
    let o_raw = extract_decimal(raw, "op")?;
    let h_raw = extract_decimal(raw, "hp")?;
    let l_raw = extract_decimal(raw, "lp")?;
    let c_raw = extract_decimal(raw, "tp")?; // Trade price = close
    let v_base = extract_decimal(raw, "atv24h")?;
    let v_quote_raw = extract_decimal(raw, "atp24h")?;
    let timestamp_ms = raw.get("tms")?.as_i64()?;

    // Parse market state
    let market_state = raw
        .get("ms")
        .and_then(|v| v.as_str())
        .and_then(|s| MarketState::from_str(s).ok());

    // For KRW pairs: preserve originals and optionally convert to USD
    let (o, h, l, c, v_quote, o_krw, h_krw, l_krw, c_krw, v_quote_krw) = if quote == "KRW" {
        match krw_per_usd.and_then(|r| Decimal::from_f64(r)) {
            Some(rate) if !rate.is_zero() => (
                o_raw / rate,
                h_raw / rate,
                l_raw / rate,
                c_raw / rate,
                v_quote_raw / rate,
                Some(o_raw),
                Some(h_raw),
                Some(l_raw),
                Some(c_raw),
                Some(v_quote_raw),
            ),
            // Rate unavailable — keep KRW values in the primary fields
            _ => (
                o_raw, h_raw, l_raw, c_raw, v_quote_raw,
                Some(o_raw),
                Some(h_raw),
                Some(l_raw),
                Some(c_raw),
                Some(v_quote_raw),
            ),
        }
    } else if quote == "BTC" {
        // BTC-denominated pair: convert to KRW via BTC/KRW price, then to USD
        match btc_krw {
            Some(btc_krw_price) if !btc_krw_price.is_zero() => {
                let o_k = o_raw * btc_krw_price;
                let h_k = h_raw * btc_krw_price;
                let l_k = l_raw * btc_krw_price;
                let c_k = c_raw * btc_krw_price;
                let v_k = v_quote_raw * btc_krw_price;
                match krw_per_usd.and_then(|r| Decimal::from_f64(r)) {
                    Some(rate) if !rate.is_zero() => (
                        o_k / rate,
                        h_k / rate,
                        l_k / rate,
                        c_k / rate,
                        v_k / rate,
                        Some(o_k),
                        Some(h_k),
                        Some(l_k),
                        Some(c_k),
                        Some(v_k),
                    ),
                    // Forex unavailable — expose KRW values as primary
                    _ => (
                        o_k, h_k, l_k, c_k, v_k,
                        Some(o_k),
                        Some(h_k),
                        Some(l_k),
                        Some(c_k),
                        Some(v_k),
                    ),
                }
            }
            // BTC/KRW price unavailable — keep BTC-denominated values as-is, no KRW fields
            _ => (o_raw, h_raw, l_raw, c_raw, v_quote_raw, None, None, None, None, None),
        }
    } else {
        // Non-KRW, non-BTC pair: no conversion, no KRW originals
        (o_raw, h_raw, l_raw, c_raw, v_quote_raw, None, None, None, None, None)
    };

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
        market_state,
        ingest_time_us: now_micros(),
        o_krw,
        h_krw,
        l_krw,
        c_krw,
        v_quote_krw,
    })
}

/// Extract a decimal from a JSON value that might be a number or string
fn extract_decimal(raw: &Value, key: &str) -> Option<Decimal> {
    let val = raw.get(key)?;

    if let Some(s) = val.as_str() {
        parse_decimal(s)
    } else if let Some(n) = val.as_i64() {
        Some(Decimal::from(n))
    } else if let Some(n) = val.as_f64() {
        Decimal::from_f64_retain(n)
    } else {
        None
    }
}
