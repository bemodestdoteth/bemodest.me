use crate::normalizer::funding::FundingUpdate;
use crate::types::{now_micros, parse_decimal, strip_scale_factor, Exchange, NormalizedTicker};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde_json::Value;

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

    let pct_str = d
        .get("change24h")
        .or_else(|| d.get("price24hPcnt"))
        .and_then(|v| v.as_str())
        .unwrap_or("0");
    let change_24h = parse_decimal(pct_str).and_then(|v| v.to_f64());

    // open price: use open24h/openPrice24h if non-zero, otherwise derive from change pct
    let o_raw = d
        .get("open24h")
        .or_else(|| d.get("openPrice24h"))
        .and_then(|v| v.as_str())
        .unwrap_or("0");
    let o = parse_decimal(o_raw)
        .filter(|v| !v.is_zero())
        .unwrap_or_else(|| {
            // derive: open = close / (1 + change_pct)
            if let Some(pct) = parse_decimal(pct_str) {
                let denom = Decimal::ONE + pct;
                if !denom.is_zero() {
                    c / denom
                } else {
                    c
                }
            } else {
                c
            }
        });

    let h = parse_decimal(
        d.get("high24h")
            .or_else(|| d.get("highPrice24h"))?
            .as_str()?,
    )?;
    let l = parse_decimal(d.get("low24h").or_else(|| d.get("lowPrice24h"))?.as_str()?)?;
    let v_base = parse_decimal(
        d.get("baseVolume")
            .or_else(|| d.get("volume24h"))?
            .as_str()?,
    )?;
    let v_quote = parse_decimal(
        d.get("quoteVolume")
            .or_else(|| d.get("turnover24h"))?
            .as_str()?,
    )?;

    let timestamp_ms = raw.get("ts")?.as_i64()?;

    Some(NormalizedTicker {
        exchange: Exchange::Bitget,
        base: base.clone(),
        raw_base: base,
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
        change_24h,
        liquidity: None,
        funding_rate: None,
        funding_interval_hours: None,
        next_funding_time_ms: None,
        funding_timestamp_ms: None,
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

    let pct_str = d
        .get("change24h")
        .or_else(|| d.get("price24hPcnt"))
        .and_then(|v| v.as_str())
        .unwrap_or("0");
    let change_24h = parse_decimal(pct_str).and_then(|v| v.to_f64());

    // open price: use open24h/openPrice24h if non-zero, otherwise derive from change pct
    let o_raw = d
        .get("open24h")
        .or_else(|| d.get("openPrice24h"))
        .and_then(|v| v.as_str())
        .unwrap_or("0");
    let o = parse_decimal(o_raw)
        .filter(|v| !v.is_zero())
        .unwrap_or_else(|| {
            // derive: open = close / (1 + change_pct)
            if let Some(pct) = parse_decimal(pct_str) {
                let denom = Decimal::ONE + pct;
                if !denom.is_zero() {
                    c / denom
                } else {
                    c
                }
            } else {
                c
            }
        });

    let h = parse_decimal(
        d.get("high24h")
            .or_else(|| d.get("highPrice24h"))?
            .as_str()?,
    )?;
    let l = parse_decimal(d.get("low24h").or_else(|| d.get("lowPrice24h"))?.as_str()?)?;
    let v_base = parse_decimal(
        d.get("baseVolume")
            .or_else(|| d.get("volume24h"))?
            .as_str()?,
    )?;
    let v_quote = parse_decimal(
        d.get("quoteVolume")
            .or_else(|| d.get("turnover24h"))?
            .as_str()?,
    )?;

    let timestamp_ms = raw.get("ts")?.as_i64()?;

    let mut ticker = NormalizedTicker {
        exchange: Exchange::BitgetF,
        base,
        raw_base,
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
        change_24h,
        liquidity: None,
        funding_rate: None,
        funding_interval_hours: None,
        next_funding_time_ms: None,
        funding_timestamp_ms: None,
    };

    parse_bitget_funding(d, timestamp_ms).apply_to(&mut ticker);

    Some(ticker)
}

pub fn merge_bitget_funding(
    raw: &Value,
    mut existing: NormalizedTicker,
) -> Option<NormalizedTicker> {
    let update = parse_bitget_funding(raw, now_micros() / 1000);
    if update == FundingUpdate::default() {
        return None;
    }

    update.apply_to(&mut existing);
    existing.ingest_time_us = now_micros();

    Some(existing)
}

fn parse_bitget_funding(data: &Value, timestamp_ms: i64) -> FundingUpdate {
    let funding_rate = parse_optional_decimal(data, &["fundingRate"]);
    let funding_interval_hours =
        parse_optional_decimal(data, &["fundingRateInterval", "ratePeriod"]);
    let next_funding_time_ms = parse_optional_i64(data, &["nextUpdate", "nextFundingTime"]);
    let funding_timestamp_ms = parse_optional_i64(data, &["ts", "time"]).or_else(|| {
        (funding_rate.is_some()
            || funding_interval_hours.is_some()
            || next_funding_time_ms.is_some())
        .then_some(timestamp_ms)
    });

    FundingUpdate {
        funding_rate,
        funding_interval_hours,
        next_funding_time_ms,
        funding_timestamp_ms,
    }
}

fn parse_optional_decimal(data: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        data.get(*key)
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .and_then(parse_decimal)
            .and_then(|value| value.to_f64())
            .or_else(|| data.get(*key).and_then(|value| value.as_f64()))
    })
}

fn parse_optional_i64(data: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| {
        data.get(*key).and_then(|value| value.as_i64()).or_else(|| {
            data.get(*key)
                .and_then(|value| value.as_str())
                .filter(|value| !value.is_empty())
                .and_then(|value| value.parse::<i64>().ok())
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn btc_futures_ticker() -> NormalizedTicker {
        NormalizedTicker {
            exchange: Exchange::BitgetF,
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
            market_state: None,
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
    fn futures_ticker_parses_funding_fields_when_present() {
        let raw = serde_json::json!({
            "arg": { "instType": "usdt-futures", "topic": "ticker", "symbol": "BTCUSDT" },
            "data": [{
                "lastPr": "105.0",
                "open24h": "100.0",
                "high24h": "110.0",
                "low24h": "90.0",
                "baseVolume": "2.0",
                "quoteVolume": "210.0",
                "fundingRate": "0.0001",
                "fundingRateInterval": "8",
                "nextFundingTime": "1700006400000"
            }],
            "ts": 1700000000000_i64
        });

        let ticker = normalize_bitget_f_ticker(&raw).unwrap();

        assert_eq!(ticker.funding_rate, Some(0.0001));
        assert_eq!(ticker.funding_interval_hours, Some(8.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700006400000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1700000000000));
    }

    #[test]
    fn merge_funding_uses_rest_metadata_fields() {
        let raw = serde_json::json!({
            "fundingRate": "-0.0002",
            "ratePeriod": "4",
            "nextFundingTime": "1700014400000"
        });

        let ticker = merge_bitget_funding(&raw, btc_futures_ticker()).unwrap();

        assert_eq!(ticker.funding_rate, Some(-0.0002));
        assert_eq!(ticker.funding_interval_hours, Some(4.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700014400000));
        assert!(ticker.funding_timestamp_ms.is_some());
    }

    #[test]
    fn merge_funding_ignores_payload_without_funding_fields() {
        let raw = serde_json::json!({ "symbol": "BTCUSDT" });

        assert!(merge_bitget_funding(&raw, btc_futures_ticker()).is_none());
    }
}
