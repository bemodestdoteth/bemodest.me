use crate::normalizer::funding::FundingUpdate;
use crate::types::{now_micros, parse_decimal, Exchange, ExchangeExt, NormalizedTicker};
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;

pub fn normalize_hyperliquid_f_ticker(raw: &Value) -> Option<Vec<NormalizedTicker>> {
    let channel = raw.get("channel")?.as_str()?;
    if channel != "activeAssetCtx" {
        return None;
    }

    let data = raw.get("data")?;
    let raw_base = data.get("coin")?.as_str()?;
    let ctx = data.get("ctx")?;
    let timestamp_ms = chrono::Utc::now().timestamp_millis();
    let (base, quote) = Exchange::HyperliquidF.parse_symbol(raw_base)?;
    let c = parse_decimal(
        ctx.get("markPx")
            .or_else(|| ctx.get("midPx"))
            .or_else(|| ctx.get("oraclePx"))?
            .as_str()?,
    )?;
    let o = ctx
        .get("prevDayPx")
        .and_then(|value| value.as_str())
        .and_then(parse_decimal)
        .unwrap_or(c);
    let h = c.max(o);
    let l = c.min(o);
    let v_base = ctx
        .get("dayBaseVlm")
        .and_then(|value| value.as_str())
        .and_then(parse_decimal)
        .unwrap_or_default();
    let v_quote = ctx
        .get("dayNtlVlm")
        .and_then(|value| value.as_str())
        .and_then(parse_decimal)
        .unwrap_or_else(|| v_base * c);

    let mut ticker = NormalizedTicker {
        exchange: Exchange::HyperliquidF,
        base,
        raw_base: raw_base.to_string(),
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
    };

    let funding_rate = ctx.get("funding").and_then(|value| {
        value
            .as_str()
            .and_then(parse_decimal)
            .and_then(|value| value.to_f64())
            .or_else(|| value.as_f64())
    });

    FundingUpdate {
        funding_rate,
        funding_interval_hours: funding_rate.map(|_| 1.0),
        next_funding_time_ms: funding_rate.map(|_| ((timestamp_ms / 3_600_000) + 1) * 3_600_000),
        funding_timestamp_ms: funding_rate.map(|_| timestamp_ms),
    }
    .apply_to(&mut ticker);

    Some(vec![ticker])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_active_asset_context() {
        let raw = serde_json::json!({
            "channel": "activeAssetCtx",
            "data": {
                "coin": "BTC",
                "ctx": {
                    "prevDayPx": "80934.0",
                    "dayNtlVlm": "2047457724.105479002",
                    "oraclePx": "80610.0",
                    "markPx": "80574.0",
                    "midPx": "80573.5",
                    "dayBaseVlm": "25177.68437",
                    "funding": "0.0000125"
                }
            }
        });

        let tickers = normalize_hyperliquid_f_ticker(&raw).unwrap();

        assert_eq!(tickers.len(), 1);
        assert_eq!(tickers[0].exchange, Exchange::HyperliquidF);
        assert_eq!(tickers[0].base, "BTC");
        assert_eq!(tickers[0].raw_base, "BTC");
        assert_eq!(tickers[0].quote, "USDC");
        assert_eq!(tickers[0].o, 80934.0);
        assert_eq!(tickers[0].c, 80574.0);
        assert_eq!(tickers[0].h, 80934.0);
        assert_eq!(tickers[0].l, 80574.0);
        assert_eq!(tickers[0].v_base, 25177.68437);
        assert_eq!(tickers[0].v_quote, 2047457724.105479);
        assert_eq!(tickers[0].funding_rate, Some(0.0000125));
        assert!(tickers[0].funding_timestamp_ms.is_some());
        assert_eq!(tickers[0].funding_interval_hours, Some(1.0));
        assert!(tickers[0].next_funding_time_ms.unwrap() > tickers[0].timestamp_ms);
    }

    #[test]
    fn ignores_other_channels() {
        let raw = serde_json::json!({
            "channel": "subscriptionResponse",
            "data": { "method": "subscribe" }
        });

        assert!(normalize_hyperliquid_f_ticker(&raw).is_none());
    }
}
