use crate::types::{
    Exchange, NormalizedTicker,
    parse_decimal, now_micros, strip_scale_factor,
};
use serde_json::Value;
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;

/// Normalise a Bitget spot ticker message.
///
/// Expected shape:
/// ```json
/// {
///   "action": "snapshot",
///   "arg": { "instType": "spot", "symbol": "BTCUSDT", "topic": "ticker" },
///   "data": [{
///     "lastPrice": "100000",
///     "openPrice24h": "0",
///     "highPrice24h": "100000",
///     "lowPrice24h": "98200",
///     "volume24h": "37.722858",
///     "turnover24h": "3750302.979626",
///     "price24hPcnt": "0.01833",
///     ...
///   }],
///   "ts": 1736371332162
/// }
/// ```
pub fn normalize_bitget_ticker(raw: &Value) -> Option<NormalizedTicker> {
    let arg = raw.get("arg")?;
    let symbol = arg.get("instId").or_else(|| arg.get("symbol"))?.as_str()?;
    let quote = "USDT";
    if !symbol.ends_with(quote) {
        return None;
    }
    let base = symbol[..symbol.len() - quote.len()].to_string();

    let data = raw.get("data")?.as_array()?;
    let d = data.first()?;

    let c = parse_decimal(d.get("lastPr").or_else(|| d.get("lastPrice"))?.as_str()?)?;

    // open price: use open24h/openPrice24h if non-zero, otherwise derive from change pct
    let o_raw = d.get("open24h").or_else(|| d.get("openPrice24h")).and_then(|v| v.as_str()).unwrap_or("0");
    let o = parse_decimal(o_raw).filter(|v| !v.is_zero()).unwrap_or_else(|| {
        // derive: open = close / (1 + change_pct)
        let pct_str = d.get("change24h").or_else(|| d.get("price24hPcnt")).and_then(|v| v.as_str()).unwrap_or("0");
        if let Some(pct) = parse_decimal(pct_str) {
            let denom = Decimal::ONE + pct;
            if !denom.is_zero() { c / denom } else { c }
        } else { c }
    });

    let h = parse_decimal(d.get("high24h").or_else(|| d.get("highPrice24h"))?.as_str()?)?;
    let l = parse_decimal(d.get("low24h").or_else(|| d.get("lowPrice24h"))?.as_str()?)?;
    let v_base = parse_decimal(d.get("baseVolume").or_else(|| d.get("volume24h"))?.as_str()?)?;
    let v_quote = parse_decimal(d.get("quoteVolume").or_else(|| d.get("turnover24h"))?.as_str()?)?;

    let timestamp_ms = raw.get("ts")?.as_i64()?;

    Some(NormalizedTicker {
        exchange: Exchange::Bitget,
        base,
        quote: quote.to_string(),
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

pub fn normalize_bitget_f_ticker(raw: &Value) -> Option<NormalizedTicker> {
    let arg = raw.get("arg")?;
    let symbol = arg.get("instId").or_else(|| arg.get("symbol"))?.as_str()?;
    let quote = "USDT";
    if !symbol.ends_with(quote) {
        return None;
    }
    let raw_base = symbol[..symbol.len() - quote.len()].to_string();
    let (base, factor) = strip_scale_factor(&raw_base);

    let data = raw.get("data")?.as_array()?;
    let d = data.first()?;

    let c = parse_decimal(d.get("lastPr").or_else(|| d.get("lastPrice"))?.as_str()?)?;

    // open price: use open24h/openPrice24h if non-zero, otherwise derive from change pct
    let o_raw = d.get("open24h").or_else(|| d.get("openPrice24h")).and_then(|v| v.as_str()).unwrap_or("0");
    let o = parse_decimal(o_raw).filter(|v| !v.is_zero()).unwrap_or_else(|| {
        // derive: open = close / (1 + change_pct)
        let pct_str = d.get("change24h").or_else(|| d.get("price24hPcnt")).and_then(|v| v.as_str()).unwrap_or("0");
        if let Some(pct) = parse_decimal(pct_str) {
            let denom = Decimal::ONE + pct;
            if !denom.is_zero() { c / denom } else { c }
        } else { c }
    });

    let h = parse_decimal(d.get("high24h").or_else(|| d.get("highPrice24h"))?.as_str()?)?;
    let l = parse_decimal(d.get("low24h").or_else(|| d.get("lowPrice24h"))?.as_str()?)?;
    let v_base = parse_decimal(d.get("baseVolume").or_else(|| d.get("volume24h"))?.as_str()?)?;
    let v_quote = parse_decimal(d.get("quoteVolume").or_else(|| d.get("turnover24h"))?.as_str()?)?;

    let timestamp_ms = raw.get("ts")?.as_i64()?;

    Some(NormalizedTicker {
        exchange: Exchange::BitgetF,
        base,
        quote: quote.to_string(),
        o: (o / factor).to_f64().unwrap_or(0.0),
        h: (h / factor).to_f64().unwrap_or(0.0),
        l: (l / factor).to_f64().unwrap_or(0.0),
        c: (c / factor).to_f64().unwrap_or(0.0),
        v_base: (v_base * factor).to_f64().unwrap_or(0.0),
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
