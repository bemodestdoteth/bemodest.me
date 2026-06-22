use crate::cache::lvc::LatestValueCache;
use crate::cache::MarketCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::bitget::{merge_bitget_funding, normalize_bitget_f_ticker};
use crate::types::{strip_scale_factor, Exchange as ExchangeType, ExchangeExt};
use log::{error, info, warn};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

pub const TICKER_STREAM_URL: &str = "wss://ws.bitget.com/v3/ws/public";
const SUBSCRIBE_BATCH_SIZE: usize = 100;
pub const PING_INTERVAL_SECONDS: u64 = 25;

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) {
    let mut waited = 0u64;
    loop {
        let symbols = market_cache.get_bitget_f_markets().await;
        if !symbols.is_empty() {
            info!(
                "[BitgetFExchange] Market cache ready with {} base coins",
                symbols.len()
            );
            break;
        }
        if waited >= 30_000 {
            warn!("[BitgetFExchange] Market cache still empty after 30s, proceeding anyway");
            break;
        }
        sleep(Duration::from_millis(500)).await;
        waited += 500;
    }
}

pub fn handle_message(
    text: &str,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) {
    if text.trim() == "pong" {
        return;
    }
    if let Ok(raw) = serde_json::from_str::<Value>(text) {
        if raw.get("event").is_some() {
            return;
        }
        let arg = match raw.get("arg") {
            Some(a) => a,
            None => return,
        };
        let channel = arg
            .get("channel")
            .or_else(|| arg.get("topic"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if channel != "ticker" {
            return;
        }

        if let Some(ticker) = normalize_bitget_f_ticker(&raw) {
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
        if ticker.funding_rate.is_none() {
            ticker.funding_rate = existing.funding_rate;
        }
        if ticker.funding_interval_hours.is_none() {
            ticker.funding_interval_hours = existing.funding_interval_hours;
        }
        if ticker.next_funding_time_ms.is_none() {
            ticker.next_funding_time_ms = existing.next_funding_time_ms;
        }
        if ticker.funding_timestamp_ms.is_none() {
            ticker.funding_timestamp_ms = existing.funding_timestamp_ms;
        }
    }

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
    let markets = market_cache.get_bitget_f_markets().await;
    if markets.is_empty() {
        return;
    }

    let market_symbols: HashSet<String> = markets
        .into_iter()
        .map(|base| format!("{}USDT", base))
        .collect();
    let client = reqwest::Client::new();
    let mut batcher = TickerBatcher::new(tx, "bitget_f".to_string(), config.clone());
    let funding_count =
        backfill_funding_data(&client, &market_symbols, &mut batcher, tac, config, lvc).await;
    batcher.flush();

    info!(
        "[BitgetFExchange] Refreshed funding for {}/{} market(s)",
        funding_count,
        market_symbols.len()
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
    let mut applied_count = 0usize;

    for symbol in market_symbols {
        let rate_url = format!(
            "https://api.bitget.com/api/v3/market/current-fund-rate?symbol={symbol}&productType=USDT-FUTURES"
        );
        let time_url = format!(
            "https://api.bitget.com/api/v2/mix/market/funding-time?symbol={symbol}&productType=USDT-FUTURES"
        );

        let Some(rate_raw) =
            fetch_funding_json(client, symbol, &rate_url, "current funding rate").await
        else {
            continue;
        };
        let Some(time_raw) = fetch_funding_json(client, symbol, &time_url, "funding time").await
        else {
            continue;
        };

        if apply_funding_backfill(symbol, &rate_raw, &time_raw, batcher, tac, config, lvc) {
            applied_count += 1;
        }
    }

    applied_count
}

async fn fetch_funding_json(
    client: &reqwest::Client,
    symbol: &str,
    url: &str,
    label: &str,
) -> Option<Value> {
    let response = match client.get(url).send().await {
        Ok(resp) => resp,
        Err(e) => {
            error!(
                "[BitgetFExchange] Backfill {} request failed for {}: {}",
                label, symbol, e
            );
            return None;
        }
    };

    let status = response.status();
    if !status.is_success() {
        error!(
            "[BitgetFExchange] Backfill {} request for {} returned HTTP {}",
            label, symbol, status
        );
        return None;
    }

    match response.json::<Value>().await {
        Ok(raw) => Some(raw),
        Err(e) => {
            error!(
                "[BitgetFExchange] Backfill {} decode failed for {}: {}",
                label, symbol, e
            );
            None
        }
    }
}

fn apply_funding_backfill(
    symbol: &str,
    rate_raw: &Value,
    time_raw: &Value,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) -> bool {
    let Some((raw_base, quote)) = ExchangeType::BitgetF.parse_symbol(symbol) else {
        return false;
    };
    let (scaled_base, _) = strip_scale_factor(&raw_base);
    let base = tac.resolve_ticker_base(&ExchangeType::BitgetF, &raw_base, &scaled_base);

    if config
        .excludelist
        .read()
        .unwrap()
        .iter()
        .any(|ex| base.starts_with(ex))
    {
        return false;
    }

    let Some(existing) = lvc.get(&ExchangeType::BitgetF, &base, &quote) else {
        return false;
    };
    let Some(rate_data) = funding_data(rate_raw) else {
        return false;
    };
    let Some(time_data) = funding_data(time_raw) else {
        return false;
    };
    let Some(ticker) = merge_bitget_funding(time_data, existing) else {
        return false;
    };
    let Some(ticker) = merge_bitget_funding(rate_data, ticker) else {
        return false;
    };

    let payload = serde_json::json!({
        "type": "normalized_ticker",
        "source": ticker.exchange.to_string(),
        "data": &ticker
    });
    batcher.push(ticker.base.clone(), ticker.quote.clone(), payload);
    lvc.upsert(ticker);
    true
}

fn funding_data(raw: &Value) -> Option<&Value> {
    raw.get("data")
        .and_then(|data| {
            data.as_array()
                .and_then(|data| data.first())
                .or_else(|| data.as_object().map(|_| data))
        })
        .or_else(|| raw.as_object().map(|_| raw))
}

pub async fn subscription_factory(
    market_cache: Arc<MarketCache>,
) -> Option<Vec<serde_json::Value>> {
    let base_coins = market_cache.get_bitget_f_markets().await;
    if base_coins.is_empty() {
        return None;
    }
    let args: Vec<Value> = base_coins
        .iter()
        .map(|base| {
            serde_json::json!({
                "instType": "usdt-futures",
                "topic": "ticker",
                "symbol": format!("{}USDT", base)
            })
        })
        .collect();

    let mut msgs = Vec::new();
    for chunk in args.chunks(SUBSCRIBE_BATCH_SIZE) {
        msgs.push(serde_json::json!({
            "op": "subscribe",
            "args": chunk
        }));
    }
    Some(msgs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::VisibilityCache;
    use crate::types::{
        NormalizedTicker, SystemConfig, SystemConfigJwtSecret, SystemConfigNodeEnv,
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
            exchange: ExchangeType::BitgetF,
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
    fn handle_message_preserves_existing_funding_when_ticker_has_no_funding() {
        let lvc = Arc::new(LatestValueCache::new());
        lvc.upsert(btc_ticker());
        let tac = Arc::new(TokenAnnotationCache::new());
        let config = test_config();
        let (tx, _) = broadcast::channel(4);
        let mut batcher = TickerBatcher::new(tx, "bitget_f".to_string(), config.clone());
        let message = serde_json::json!({
            "arg": { "instType": "usdt-futures", "topic": "ticker", "symbol": "BTCUSDT" },
            "data": [{
                "lastPr": "106.0",
                "open24h": "100.0",
                "high24h": "110.0",
                "low24h": "90.0",
                "baseVolume": "2.0",
                "quoteVolume": "212.0"
            }],
            "ts": 1700000100000_i64
        });

        handle_message(&message.to_string(), &mut batcher, &tac, &config, &lvc);

        let ticker = lvc.get(&ExchangeType::BitgetF, "BTC", "USDT").unwrap();
        assert_eq!(ticker.c, 106.0);
        assert_eq!(ticker.funding_rate, Some(0.0001));
        assert_eq!(ticker.funding_interval_hours, Some(8.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700006400000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1700000000000));
    }

    #[test]
    fn apply_funding_backfill_merges_rest_metadata_into_existing_ticker() {
        let lvc = Arc::new(LatestValueCache::new());
        lvc.upsert(btc_ticker());
        let tac = Arc::new(TokenAnnotationCache::new());
        let config = test_config();
        let (tx, _) = broadcast::channel(4);
        let mut batcher = TickerBatcher::new(tx, "bitget_f".to_string(), config.clone());
        let rate_raw = serde_json::json!({
            "data": {
                "fundingRate": "-0.0002",
                "fundingRateInterval": "4",
                "nextUpdate": "1700014400000"
            }
        });
        let time_raw = serde_json::json!({
            "data": [{
                "ratePeriod": "4",
                "nextFundingTime": "1700014400000"
            }]
        });

        assert!(apply_funding_backfill(
            "BTCUSDT",
            &rate_raw,
            &time_raw,
            &mut batcher,
            &tac,
            &config,
            &lvc
        ));

        let ticker = lvc.get(&ExchangeType::BitgetF, "BTC", "USDT").unwrap();
        assert_eq!(ticker.funding_rate, Some(-0.0002));
        assert_eq!(ticker.funding_interval_hours, Some(4.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700014400000));
        assert!(ticker.funding_timestamp_ms.is_some());
    }
}
