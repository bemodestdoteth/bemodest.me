use log::{error, info, trace};
use rust_decimal::prelude::ToPrimitive;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use crate::cache::lvc::LatestValueCache;
use crate::cache::{MarketCache, TokenAnnotationCache};
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::binance::{merge_binance_funding, normalize_binance_ticker_array};
use crate::normalizer::funding::FundingUpdate;
use crate::types::{parse_decimal, strip_scale_factor, Exchange as ExchangeType, ExchangeExt};

pub const TICKER_STREAM_URL: &str =
    "wss://fstream.binance.com/market/stream?streams=!miniTicker@arr/!markPrice@arr@1s";

pub fn handle_message(
    text: &str,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) {
    if let Ok(mut json_val) = serde_json::from_str::<Value>(text) {
        let data_content = if let Some(inner_data) = json_val.get_mut("data") {
            inner_data.take()
        } else {
            json_val.clone()
        };

        if data_content
            .get("e")
            .and_then(|event| event.as_str())
            .map(|event| event == "markPriceUpdate")
            .unwrap_or(false)
        {
            handle_funding_update(&data_content, batcher, tac, config, lvc);
            return;
        }

        if let Some(items) = data_content.as_array() {
            for item in items {
                if item
                    .get("e")
                    .and_then(|event| event.as_str())
                    .map(|event| event == "markPriceUpdate")
                    .unwrap_or(false)
                {
                    handle_funding_update(item, batcher, tac, config, lvc);
                }
            }
        }

        let normalized = normalize_binance_ticker_array(&data_content, ExchangeType::BinanceF);
        for ticker in normalized {
            let _ = apply_ticker(ticker, batcher, tac, config, lvc);
        }
    }
}

fn apply_ticker(
    mut ticker: crate::types::NormalizedTicker,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) -> bool {
    if config
        .excludelist
        .read()
        .unwrap()
        .iter()
        .any(|ex| ticker.base.starts_with(ex))
    {
        return false;
    }

    ticker.base = tac.resolve_ticker_base(&ticker.exchange, &ticker.raw_base, &ticker.base);
    if let Some(existing) = lvc.get(&ticker.exchange, &ticker.base, &ticker.quote) {
        ticker.funding_rate = existing.funding_rate;
        ticker.funding_interval_hours = existing.funding_interval_hours;
        ticker.next_funding_time_ms = existing.next_funding_time_ms;
        ticker.funding_timestamp_ms = existing.funding_timestamp_ms;
    }

    trace!(
        "[BinanceF] Normalized: {}/{} c={}",
        ticker.base,
        ticker.quote,
        ticker.c
    );
    let payload = serde_json::json!({
        "type": "normalized_ticker",
        "source": ticker.exchange.to_string(),
        "data": &ticker
    });
    batcher.push(ticker.base.clone(), ticker.quote.clone(), payload);
    lvc.upsert(ticker);
    true
}

pub async fn backfill_missing_markets(
    market_cache: &Arc<MarketCache>,
    lvc: &Arc<LatestValueCache>,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    tx: tokio::sync::broadcast::Sender<String>,
) {
    let markets = market_cache.get_binance_f_markets().await;
    if markets.is_empty() {
        return;
    }

    let market_symbols: HashSet<String> = markets.into_iter().collect();

    let client = reqwest::Client::new();
    let url = "https://fapi.binance.com/fapi/v1/ticker/24hr";
    let response = match client.get(url).send().await {
        Ok(resp) => resp,
        Err(e) => {
            error!("[BinanceF] Backfill ticker request failed: {}", e);
            return;
        }
    };

    let status = response.status();
    if !status.is_success() {
        error!(
            "[BinanceF] Backfill ticker request returned HTTP {}",
            status
        );
        return;
    }

    let raw = match response.json::<Value>().await {
        Ok(raw) => raw,
        Err(e) => {
            error!("[BinanceF] Backfill ticker decode failed: {}", e);
            return;
        }
    };

    let Some(arr) = raw.as_array() else {
        error!("[BinanceF] Backfill ticker response was not an array");
        return;
    };

    let now_ms = chrono::Utc::now().timestamp_millis();
    let items: Vec<Value> = arr
        .iter()
        .filter(|item| {
            item.get("symbol")
                .and_then(|s| s.as_str())
                .map(|symbol| market_symbols.contains(symbol))
                .unwrap_or(false)
        })
        .map(|item| {
            serde_json::json!({
                "e": "24hrMiniTicker",
                "E": item.get("closeTime").and_then(|v| v.as_i64()).unwrap_or(now_ms),
                "s": item.get("symbol").and_then(|v| v.as_str()).unwrap_or_default(),
                "c": item.get("lastPrice").and_then(|v| v.as_str()).unwrap_or("0"),
                "o": item.get("openPrice").and_then(|v| v.as_str()).unwrap_or("0"),
                "h": item.get("highPrice").and_then(|v| v.as_str()).unwrap_or("0"),
                "l": item.get("lowPrice").and_then(|v| v.as_str()).unwrap_or("0"),
                "v": item.get("volume").and_then(|v| v.as_str()).unwrap_or("0"),
                "q": item.get("quoteVolume").and_then(|v| v.as_str()).unwrap_or("0")
            })
        })
        .collect();

    if items.is_empty() {
        return;
    }

    let mut batcher = TickerBatcher::new(tx, "binance_f".to_string(), config.clone());
    let mut applied_count = 0usize;
    for ticker in normalize_binance_ticker_array(&Value::Array(items), ExchangeType::BinanceF) {
        if apply_ticker(ticker, &mut batcher, tac, config, lvc) {
            applied_count += 1;
        }
    }
    let funding_count =
        backfill_funding_data(&client, &market_symbols, &mut batcher, tac, config, lvc).await;
    batcher.flush();

    info!(
        "[BinanceF] Refreshed {}/{} market(s), funding for {} market(s)",
        applied_count,
        market_symbols.len(),
        funding_count
    );
}

async fn backfill_funding_data(
    client: &reqwest::Client,
    market_symbols: &HashSet<String>,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) -> usize {
    let url = "https://fapi.binance.com/fapi/v1/premiumIndex";
    let response = match client.get(url).send().await {
        Ok(resp) => resp,
        Err(e) => {
            error!("[BinanceF] Backfill funding request failed: {}", e);
            return 0;
        }
    };

    let status = response.status();
    if !status.is_success() {
        error!(
            "[BinanceF] Backfill funding request returned HTTP {}",
            status
        );
        return 0;
    }

    let raw = match response.json::<Value>().await {
        Ok(raw) => raw,
        Err(e) => {
            error!("[BinanceF] Backfill funding decode failed: {}", e);
            return 0;
        }
    };

    let Some(arr) = raw.as_array() else {
        error!("[BinanceF] Backfill funding response was not an array");
        return 0;
    };

    let interval_hours = fetch_funding_interval_hours(client, market_symbols).await;

    let mut applied_count = 0usize;
    for item in arr {
        if item
            .get("symbol")
            .and_then(|s| s.as_str())
            .map(|symbol| market_symbols.contains(symbol))
            .unwrap_or(false)
            && apply_funding_backfill(item, &interval_hours, batcher, tac, config, lvc)
        {
            applied_count += 1;
        }
    }
    applied_count
}

async fn fetch_funding_interval_hours(
    client: &reqwest::Client,
    market_symbols: &HashSet<String>,
) -> HashMap<String, f64> {
    let url = "https://fapi.binance.com/fapi/v1/fundingInfo";
    let response = match client.get(url).send().await {
        Ok(resp) => resp,
        Err(e) => {
            error!("[BinanceF] Backfill funding info request failed: {}", e);
            return HashMap::new();
        }
    };

    let status = response.status();
    if !status.is_success() {
        error!(
            "[BinanceF] Backfill funding info request returned HTTP {}",
            status
        );
        return HashMap::new();
    }

    let raw = match response.json::<Value>().await {
        Ok(raw) => raw,
        Err(e) => {
            error!("[BinanceF] Backfill funding info decode failed: {}", e);
            return HashMap::new();
        }
    };

    let Some(arr) = raw.as_array() else {
        error!("[BinanceF] Backfill funding info response was not an array");
        return HashMap::new();
    };

    arr.iter()
        .filter_map(|item| {
            let symbol = item.get("symbol")?.as_str()?;
            if !market_symbols.contains(symbol) {
                return None;
            }
            let hours = item
                .get("fundingIntervalHours")
                .and_then(|v| v.as_f64())
                .or_else(|| {
                    item.get("fundingIntervalHours")
                        .and_then(|v| v.as_str())
                        .and_then(|v| v.parse::<f64>().ok())
                })?;
            Some((symbol.to_string(), hours))
        })
        .collect()
}

fn apply_funding_backfill(
    data: &Value,
    interval_hours: &HashMap<String, f64>,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) -> bool {
    let Some(symbol) = data.get("symbol").and_then(|s| s.as_str()) else {
        return false;
    };
    let Some((raw_base, quote)) = ExchangeType::BinanceF.parse_symbol(symbol) else {
        return false;
    };
    let (scaled_base, _) = strip_scale_factor(&raw_base);
    let base = tac.resolve_ticker_base(&ExchangeType::BinanceF, &raw_base, &scaled_base);

    if config
        .excludelist
        .read()
        .unwrap()
        .iter()
        .any(|ex| base.starts_with(ex))
    {
        return false;
    }

    let Some(mut ticker) = lvc.get(&ExchangeType::BinanceF, &base, &quote) else {
        return false;
    };
    let Some(funding_rate) = data
        .get("lastFundingRate")
        .and_then(|v| v.as_str())
        .and_then(parse_decimal)
    else {
        return false;
    };
    let Some(next_funding_time_ms) = data.get("nextFundingTime").and_then(|v| v.as_i64()) else {
        return false;
    };
    let Some(funding_timestamp_ms) = data.get("time").and_then(|v| v.as_i64()) else {
        return false;
    };

    FundingUpdate {
        funding_rate: funding_rate.to_f64(),
        funding_interval_hours: Some(interval_hours.get(symbol).copied().unwrap_or(8.0)),
        next_funding_time_ms: Some(next_funding_time_ms),
        funding_timestamp_ms: Some(funding_timestamp_ms),
    }
    .apply_to(&mut ticker);
    ticker.ingest_time_us = crate::types::now_micros();

    let payload = serde_json::json!({
        "type": "normalized_ticker",
        "source": ticker.exchange.to_string(),
        "data": &ticker
    });
    batcher.push(ticker.base.clone(), ticker.quote.clone(), payload);
    lvc.upsert(ticker);
    true
}

fn handle_funding_update(
    data: &Value,
    _batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) {
    let Some(symbol) = data.get("s").and_then(|s| s.as_str()) else {
        return;
    };
    let Some((raw_base, quote)) = ExchangeType::BinanceF.parse_symbol(symbol) else {
        return;
    };
    let (scaled_base, _) = strip_scale_factor(&raw_base);
    let base = tac.resolve_ticker_base(&ExchangeType::BinanceF, &raw_base, &scaled_base);

    if config
        .excludelist
        .read()
        .unwrap()
        .iter()
        .any(|ex| base.starts_with(ex))
    {
        return;
    }

    let Some(existing) = lvc.get(&ExchangeType::BinanceF, &base, &quote) else {
        return;
    };
    let Some(ticker) = merge_binance_funding(data, existing) else {
        return;
    };

    lvc.upsert(ticker);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::VisibilityCache;
    use crate::types::{
        MarketState, NormalizedTicker, SystemConfig, SystemConfigJwtSecret, SystemConfigNodeEnv,
    };
    use std::collections::HashSet;
    use std::str::FromStr;
    use std::sync::RwLock;
    use tokio::sync::broadcast;

    fn test_config() -> Arc<Config> {
        let jwt_secret = "x".repeat(32);

        Arc::new(Config {
            inner: SystemConfig {
                port: 3000,
                api_port: 3001,
                sidecar_port: 25834,
                jwt_secret: SystemConfigJwtSecret::from_str(&jwt_secret).unwrap(),
                snapper_api_secret: None,
                mongo_uri: None,
                redis_url: Some("redis://127.0.0.1:6380".to_string()),
                dex_redis_channel: "dex_prices".to_string(),
                batching_duration_ms: 1000,
                collection_alert_destinations: "alertDestinations".to_string(),
                mongo_user: None,
                mongo_password: None,
                mongo_host: None,
                mongo_port: "27017".to_string(),
                mongo_db_name: None,
                redis_host: None,
                redis_port: "6380".to_string(),
                redis_password: None,
                node_env: SystemConfigNodeEnv::Dev,
            },
            port: 25834,
            api_port: 3001,
            jwt_secret,
            mongo_uri: None,
            redis_url: "redis://127.0.0.1:6380".to_string(),
            dex_redis_channel: "dex_prices".to_string(),
            batch_duration_ms: 1000,
            webhook_secret: String::new(),
            forex_update_interval_sec: 60,
            market_cache_update_interval_sec: 1800,
            korean_market_cache_update_interval_sec: 60,
            alert_destination_tailscale_suffix: ".ts.net".to_string(),
            alert_destination_allow_loopback_in_dev: false,
            excludelist: Arc::new(RwLock::new(HashSet::new())),
            pinlist: Arc::new(RwLock::new(HashSet::new())),
            visibility: Arc::new(VisibilityCache::new()),
        })
    }

    fn btc_ticker() -> NormalizedTicker {
        NormalizedTicker {
            exchange: ExchangeType::BinanceF,
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
    fn handle_message_applies_mark_price_updates_inside_array_payloads() {
        let lvc = Arc::new(LatestValueCache::new());
        lvc.upsert(btc_ticker());
        let tac = Arc::new(TokenAnnotationCache::new());
        let config = test_config();
        let (tx, _) = broadcast::channel(4);
        let mut batcher = TickerBatcher::new(tx, "binance_f".to_string(), config.clone());
        let message = serde_json::json!({
            "stream": "!markPrice@arr@1s",
            "data": [
                {
                    "e": "markPriceUpdate",
                    "E": 1700000000000_i64,
                    "s": "BTCUSDT",
                    "p": "105.0",
                    "i": "105.0",
                    "P": "105.0",
                    "r": "0.0001",
                    "T": 1700006400000_i64
                }
            ]
        });

        handle_message(&message.to_string(), &mut batcher, &tac, &config, &lvc);

        let ticker = lvc.get(&ExchangeType::BinanceF, "BTC", "USDT").unwrap();
        assert_eq!(ticker.funding_rate, Some(0.0001));
        assert_eq!(ticker.funding_interval_hours, Some(8.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700006400000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1700000000000));
    }

    #[test]
    fn mark_price_update_does_not_overwrite_buffered_mini_ticker_price() {
        let lvc = Arc::new(LatestValueCache::new());
        lvc.upsert(btc_ticker());
        let tac = Arc::new(TokenAnnotationCache::new());
        let config = test_config();
        config.visibility.replace(
            vec![crate::cache::visibility::VisibilityPair {
                base: "BTC".to_string(),
                quote: "USDT".to_string(),
                spread_pct: 0.0,
                threshold: 0.0,
                pinned: false,
                rule_id: Some("test".to_string()),
            }],
            true,
        );
        let (tx, mut rx) = broadcast::channel(4);
        let mut batcher = TickerBatcher::new(tx, "binance_f".to_string(), config.clone());
        let mini_ticker = serde_json::json!({
            "stream": "!miniTicker@arr",
            "data": [
                {
                    "e": "24hrMiniTicker",
                    "E": 1700000000000_i64,
                    "s": "BTCUSDT",
                    "c": "101.0",
                    "o": "100.0",
                    "h": "102.0",
                    "l": "99.0",
                    "v": "1.0",
                    "q": "101.0"
                }
            ]
        });
        let mark_price = serde_json::json!({
            "stream": "!markPrice@arr@1s",
            "data": [
                {
                    "e": "markPriceUpdate",
                    "E": 1700000000100_i64,
                    "s": "BTCUSDT",
                    "p": "100.0",
                    "i": "100.0",
                    "P": "100.0",
                    "r": "0.0001",
                    "T": 1700006400000_i64
                }
            ]
        });

        handle_message(&mini_ticker.to_string(), &mut batcher, &tac, &config, &lvc);
        handle_message(&mark_price.to_string(), &mut batcher, &tac, &config, &lvc);
        batcher.flush();

        let message = rx.try_recv().unwrap();
        let payload: Value = serde_json::from_str(&message).unwrap();
        let price = payload["data"][0]["data"]["c"].as_f64().unwrap();
        assert_eq!(price, 101.0);
        let cached = lvc.get(&ExchangeType::BinanceF, "BTC", "USDT").unwrap();
        assert_eq!(cached.funding_rate, Some(0.0001));
    }

    #[test]
    fn apply_funding_backfill_merges_premium_index_into_existing_ticker() {
        let lvc = Arc::new(LatestValueCache::new());
        lvc.upsert(btc_ticker());
        let tac = Arc::new(TokenAnnotationCache::new());
        let config = test_config();
        let (tx, _) = broadcast::channel(4);
        let mut batcher = TickerBatcher::new(tx, "binance_f".to_string(), config.clone());
        let funding = serde_json::json!({
            "symbol": "BTCUSDT",
            "lastFundingRate": "0.00012345",
            "nextFundingTime": 1700006400000_i64,
            "time": 1700000000000_i64
        });

        let interval_hours = HashMap::from([("BTCUSDT".to_string(), 4.0)]);

        assert!(apply_funding_backfill(
            &funding,
            &interval_hours,
            &mut batcher,
            &tac,
            &config,
            &lvc
        ));

        let ticker = lvc.get(&ExchangeType::BinanceF, "BTC", "USDT").unwrap();
        assert_eq!(ticker.c, 105.0);
        assert_eq!(ticker.funding_rate, Some(0.00012345));
        assert_eq!(ticker.funding_interval_hours, Some(4.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700006400000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1700000000000));
    }
}
