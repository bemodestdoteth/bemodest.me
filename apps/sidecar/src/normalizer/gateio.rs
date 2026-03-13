use crate::types::ticker::{
    Exchange, NormalizedTicker,
    parse_decimal, now_micros,
};
use serde_json::Value;
use rust_decimal::Decimal;

pub fn normalize_gateio_ticker(raw: &Value) -> Option<NormalizedTicker> {
    let result = raw.get("result")?;

    let symbol = result.get("currency_pair")?.as_str()?;
    let parts: Vec<&str> = symbol.split('_').collect();
    if parts.len() != 2 {
        return None;
    }
    let base = parts[0].to_string();
    let quote = parts[1].to_string();

    let c = parse_decimal(result.get("last")?.as_str()?)?;
    let change_str = result.get("change_percentage")?.as_str()?;
    let change_pct = parse_decimal(change_str)?;
    
    let one_hundred = Decimal::from(100);
    let denom = one_hundred + change_pct;
    let o = if !denom.is_zero() {
        (c * one_hundred) / denom
    } else {
        c
    };

    let h = parse_decimal(result.get("high_24h")?.as_str()?)?;
    let l = parse_decimal(result.get("low_24h")?.as_str()?)?;
    let v_base = parse_decimal(result.get("base_volume")?.as_str()?)?;
    let v_quote = parse_decimal(result.get("quote_volume")?.as_str()?)?;

    let timestamp_ms = raw.get("time_ms")?.as_i64()?;

    Some(NormalizedTicker {
        exchange: Exchange::Gateio,
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
}
