use crate::normalizer::funding::FundingUpdate;
use crate::types::{
    now_micros, parse_decimal, strip_scale_factor, Exchange, ExchangeExt, NormalizedTicker,
};
use rust_decimal::prelude::ToPrimitive;
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
pub fn normalize_bybit_f_ticker(
    raw: &Value,
    existing: Option<NormalizedTicker>,
) -> Option<NormalizedTicker> {
    let msg_type = raw.get("type")?.as_str()?;
    let topic = raw.get("topic")?.as_str()?;
    let symbol = topic.strip_prefix("tickers.")?;
    let (raw_base, quote) = Exchange::BybitF.parse_symbol(symbol)?;

    // Strip 1000x-style scale factor (e.g. "1000SHIB" -> "SHIB", divisor=1000)
    let (base, scale) = strip_scale_factor(&raw_base);

    let data = raw.get("data")?;
    let timestamp_ms = raw.get("ts")?.as_i64()?;
    let funding_update = parse_bybit_funding(data, timestamp_ms, existing.as_ref());

    if msg_type == "snapshot" {
        let o = (parse_decimal(data.get("prevPrice24h")?.as_str()?)? / scale)
            .to_f64()
            .unwrap_or(0.0);
        let h = (parse_decimal(data.get("highPrice24h")?.as_str()?)? / scale)
            .to_f64()
            .unwrap_or(0.0);
        let l = (parse_decimal(data.get("lowPrice24h")?.as_str()?)? / scale)
            .to_f64()
            .unwrap_or(0.0);
        let c = (parse_decimal(data.get("lastPrice")?.as_str()?)? / scale)
            .to_f64()
            .unwrap_or(0.0);
        let v_base = parse_decimal(data.get("volume24h")?.as_str()?)?
            .to_f64()
            .unwrap_or(0.0);
        let v_quote = parse_decimal(data.get("turnover24h")?.as_str()?)?
            .to_f64()
            .unwrap_or(0.0);

        let mut ticker = NormalizedTicker {
            exchange: Exchange::BybitF,
            base,
            raw_base: raw_base.to_string(),
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
        funding_update.apply_to(&mut ticker);
        Some(ticker)
    } else if msg_type == "delta" {
        if let Some(mut ticker) = existing {
            if let Some(val) = data
                .get("prevPrice24h")
                .and_then(|v| v.as_str())
                .and_then(parse_decimal)
            {
                ticker.o = (val / scale).to_f64().unwrap_or(ticker.o);
            }
            if let Some(val) = data
                .get("highPrice24h")
                .and_then(|v| v.as_str())
                .and_then(parse_decimal)
            {
                ticker.h = (val / scale).to_f64().unwrap_or(ticker.h);
            }
            if let Some(val) = data
                .get("lowPrice24h")
                .and_then(|v| v.as_str())
                .and_then(parse_decimal)
            {
                ticker.l = (val / scale).to_f64().unwrap_or(ticker.l);
            }
            if let Some(val) = data
                .get("lastPrice")
                .and_then(|v| v.as_str())
                .and_then(parse_decimal)
            {
                ticker.c = (val / scale).to_f64().unwrap_or(ticker.c);
            }
            if let Some(val) = data
                .get("volume24h")
                .and_then(|v| v.as_str())
                .and_then(parse_decimal)
            {
                ticker.v_base = val.to_f64().unwrap_or(ticker.v_base);
            }
            if let Some(val) = data
                .get("turnover24h")
                .and_then(|v| v.as_str())
                .and_then(parse_decimal)
            {
                ticker.v_quote = val.to_f64().unwrap_or(ticker.v_quote);
            }

            funding_update.apply_to(&mut ticker);
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

fn parse_bybit_funding(
    data: &Value,
    timestamp_ms: i64,
    existing: Option<&NormalizedTicker>,
) -> FundingUpdate {
    let mut update = existing
        .map(FundingUpdate::from_existing)
        .unwrap_or_default();

    if let Some(rate) = data
        .get("fundingRate")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .and_then(parse_decimal)
        .and_then(|v| v.to_f64())
    {
        update.funding_rate = Some(rate);
        update.funding_timestamp_ms = Some(timestamp_ms);
    } else if update.funding_rate.is_some() {
        update.funding_timestamp_ms = Some(timestamp_ms);
    }

    if let Some(hours) = data
        .get("fundingIntervalHour")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<f64>().ok())
    {
        update.funding_interval_hours = Some(hours);
    }

    if let Some(next_funding_time_ms) = data
        .get("nextFundingTime")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<i64>().ok())
    {
        update.next_funding_time_ms = Some(next_funding_time_ms);
    }

    update
}

#[cfg(test)]
mod tests {
    use super::*;

    fn btc_ticker() -> NormalizedTicker {
        NormalizedTicker {
            exchange: Exchange::BybitF,
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
            funding_rate: Some(0.0001),
            funding_interval_hours: Some(8.0),
            next_funding_time_ms: Some(1700006400000),
            funding_timestamp_ms: Some(1700000000000),
        }
    }

    #[test]
    fn snapshot_parses_official_funding_fields() {
        let raw = serde_json::json!({
            "topic": "tickers.BTCUSDT",
            "type": "snapshot",
            "ts": 1760325052630_i64,
            "data": {
                "symbol": "BTCUSDT",
                "lastPrice": "66666.60",
                "prevPrice24h": "79206.20",
                "highPrice24h": "79266.30",
                "lowPrice24h": "65076.90",
                "turnover24h": "4936790807.6521",
                "volume24h": "73191.3870",
                "fundingIntervalHour": "8",
                "nextFundingTime": "1760342400000",
                "fundingRate": "-0.005"
            }
        });

        let ticker = normalize_bybit_f_ticker(&raw, None).unwrap();

        assert_eq!(ticker.funding_rate, Some(-0.005));
        assert_eq!(ticker.funding_interval_hours, Some(8.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1760342400000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1760325052630));
    }

    #[test]
    fn delta_preserves_existing_funding_when_fields_are_blank() {
        let raw = serde_json::json!({
            "topic": "tickers.BTCUSDT",
            "type": "delta",
            "ts": 1760325060000_i64,
            "data": {
                "symbol": "BTCUSDT",
                "lastPrice": "106.0",
                "fundingIntervalHour": "",
                "nextFundingTime": "",
                "fundingRate": ""
            }
        });

        let ticker = normalize_bybit_f_ticker(&raw, Some(btc_ticker())).unwrap();

        assert_eq!(ticker.c, 106.0);
        assert_eq!(ticker.funding_rate, Some(0.0001));
        assert_eq!(ticker.funding_interval_hours, Some(8.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700006400000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1760325060000));
    }
}
