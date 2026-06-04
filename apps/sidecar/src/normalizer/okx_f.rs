use crate::normalizer::funding::FundingUpdate;
use crate::types::{now_micros, parse_decimal, Exchange, NormalizedTicker};
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;

/// Normalize an OKX FUTURES ticker WebSocket push message.
///
/// OKX WS ticker push format:
/// ```json
/// {
///   "arg": { "channel": "sprd-tickers", "sprdId": "BTC-USDT_BTC-USDT-SWAP" },
///   "data": [{
///     "sprdId": "BTC-USDT_BTC-USDT-SWAP",
///     "last": "4",
///     "lastSz": "0.01",
///     "askPx": "19.7",
///     "askSz": "5.79",
///     "bidPx": "5.9",
///     "bidSz": "5.79",
///     "open24h": "-7",
///     "high24h": "19.6",
///     "low24h": "-7",
///     "vol24h": "9.87",
///     "ts": "1715247061026"
///   }]
/// }
/// ```
fn okx_f_inst_parts(raw: &Value) -> Option<(String, String, String)> {
    let data_arr = raw.get("data")?.as_array()?;
    let d = data_arr.first()?;

    let inst_id = raw
        .get("arg")
        .and_then(|a| a.get("instId"))
        .and_then(|v| v.as_str())
        .or_else(|| d.get("instId").and_then(|v| v.as_str()))?;

    // instId format: "BTC-USDT-SWAP"
    let parts: Vec<&str> = inst_id.split('-').collect();
    if parts.len() < 2 {
        return None;
    }

    Some((
        inst_id.to_string(),
        parts[0].to_string(),
        parts[1].to_string(),
    ))
}

pub fn merge_okx_funding(raw: &Value, mut existing: NormalizedTicker) -> Option<NormalizedTicker> {
    let data_arr = raw.get("data")?.as_array()?;
    let d = data_arr.first()?;
    let funding_time_ms = d
        .get("fundingTime")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<i64>().ok())?;
    let next_funding_time_ms = d
        .get("nextFundingTime")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<i64>().ok())?;
    let funding_interval_hours = (next_funding_time_ms - funding_time_ms) as f64 / 3_600_000.0;

    FundingUpdate {
        funding_rate: parse_decimal(d.get("fundingRate")?.as_str()?)?.to_f64(),
        funding_interval_hours: Some(funding_interval_hours),
        next_funding_time_ms: Some(funding_time_ms),
        funding_timestamp_ms: d
            .get("ts")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<i64>().ok()),
    }
    .apply_to(&mut existing);
    existing.ingest_time_us = now_micros();

    Some(existing)
}

pub fn okx_f_symbol(raw: &Value) -> Option<(String, String)> {
    let (_, base, quote) = okx_f_inst_parts(raw)?;
    Some((base, quote))
}

pub fn normalize_okx_f_ticker(raw: &Value) -> Option<NormalizedTicker> {
    let data_arr = raw.get("data")?.as_array()?;
    let d = data_arr.first()?;

    let (_, base, quote) = okx_f_inst_parts(raw)?;

    let c = parse_decimal(d.get("last")?.as_str()?)?;

    let o = d
        .get("open24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .unwrap_or(c);

    let h = d
        .get("high24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .unwrap_or(c);

    let l = d
        .get("low24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .unwrap_or(c);

    // For derivatives (SWAP/FUTURES), volCcy24h is volume in base currency (tokens),
    // while vol24h is volume in contract units.
    let v_base = d
        .get("volCcy24h")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
        .or_else(|| {
            // Fallback: if volCcy24h is missing, try vol24h but this is in contracts
            // and requires contract_val to convert to tokens.
            // Usually volCcy24h is present for all v5 tickers.
            d.get("vol24h")
                .and_then(|v| v.as_str())
                .and_then(parse_decimal)
        })
        .unwrap_or_default();

    // v_quote = v_base (tokens) * current price (USDT)
    let v_quote = v_base * c;

    let timestamp_ms = d
        .get("ts")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    Some(NormalizedTicker {
        exchange: Exchange::OkxF,
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
        funding_rate: None,
        funding_interval_hours: None,
        next_funding_time_ms: None,
        funding_timestamp_ms: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MarketState;

    fn btc_ticker() -> NormalizedTicker {
        NormalizedTicker {
            exchange: Exchange::OkxF,
            base: "BTC".to_string(),
            raw_base: "BTC".to_string(),
            quote: "USDT".to_string(),
            o: 100.0,
            h: 110.0,
            l: 90.0,
            c: 105.0,
            v_base: 1.0,
            v_quote: 105.0,
            timestamp_ms: 1,
            market_state: Some(MarketState::Active),
            ingest_time_us: 1,
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
        }
    }

    #[test]
    fn merge_okx_funding_parses_official_funding_payload() {
        let raw = serde_json::json!({
            "arg": { "channel": "funding-rate", "instId": "BTC-USDT-SWAP" },
            "data": [{
                "fundingRate": "0.0001",
                "fundingTime": "1700000000000",
                "nextFundingTime": "1700028800000",
                "ts": "1699999999000"
            }]
        });

        let ticker = merge_okx_funding(&raw, btc_ticker()).unwrap();

        assert_eq!(ticker.funding_rate, Some(0.0001));
        assert_eq!(ticker.funding_interval_hours, Some(8.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700000000000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1699999999000));
        assert_eq!(
            okx_f_symbol(&raw),
            Some(("BTC".to_string(), "USDT".to_string()))
        );
    }

    #[test]
    fn merge_okx_funding_does_not_fallback_timestamp_to_funding_time() {
        let raw = serde_json::json!({
            "arg": { "channel": "funding-rate", "instId": "BTC-USDT-SWAP" },
            "data": [{
                "fundingRate": "0.0001",
                "fundingTime": "1700000000000",
                "nextFundingTime": "1700028800000",
                "ts": ""
            }]
        });

        let ticker = merge_okx_funding(&raw, btc_ticker()).unwrap();

        assert_eq!(ticker.funding_rate, Some(0.0001));
        assert_eq!(ticker.funding_interval_hours, Some(8.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700000000000));
        assert_eq!(ticker.funding_timestamp_ms, None);
    }
}
