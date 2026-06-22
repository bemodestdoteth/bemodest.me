use crate::cache::lvc::LatestValueCache;
use crate::cache::MarketCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::okx_f::{merge_okx_funding, normalize_okx_f_ticker, okx_f_symbol};
use log::{info, warn};
use serde_json::Value;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

pub const WS_URL: &str = "wss://ws.okx.com:8443/ws/v5/public";
pub const MAX_SYMBOLS_PER_CONN: usize = 300;
const SUBSCRIBE_BATCH_SIZE: usize = 100;
pub const PING_INTERVAL_SECS: u64 = 25;

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) -> Vec<String> {
    let mut waited = 0u64;
    loop {
        let markets = market_cache.get_okx_f_markets().await;
        if !markets.is_empty() {
            info!(
                "[OkxFExchange] Market cache ready with {} symbols",
                markets.len()
            );
            return markets;
        }
        if waited >= 30_000 {
            warn!("[OkxFExchange] Market cache still empty after 30s, proceeding anyway");
            return vec![];
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
        if raw
            .get("arg")
            .and_then(|arg| arg.get("channel"))
            .and_then(|channel| channel.as_str())
            .map(|channel| channel == "funding-rate")
            .unwrap_or(false)
        {
            handle_funding_update(&raw, batcher, tac, config, lvc);
            return;
        }
        if let Some(mut ticker) = normalize_okx_f_ticker(&raw) {
            if config
                .excludelist
                .read()
                .unwrap()
                .iter()
                .any(|ex| ticker.base.starts_with(ex))
            {
                return;
            }
            ticker.base = tac.resolve_ticker_base(&ticker.exchange, &ticker.raw_base, &ticker.base);
            if let Some(existing) = lvc.get(&ticker.exchange, &ticker.base, &ticker.quote) {
                ticker.funding_rate = existing.funding_rate;
                ticker.funding_interval_hours = existing.funding_interval_hours;
                ticker.next_funding_time_ms = existing.next_funding_time_ms;
                ticker.funding_timestamp_ms = existing.funding_timestamp_ms;
            }
            let payload = serde_json::json!({
                "type": "normalized_ticker",
                "source": ticker.exchange.to_string(),
                "data": &ticker
            });
            batcher.push(ticker.base.clone(), ticker.quote.clone(), payload);
            lvc.upsert(ticker);
        }
    } else {
        warn!("[OkxFExchange] Received non-JSON message: {}", text);
    }
}

fn handle_funding_update(
    raw: &Value,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) {
    let Some((raw_base, quote)) = okx_f_symbol(raw) else {
        return;
    };
    let base = tac.resolve_ticker_base(&crate::types::Exchange::OkxF, &raw_base, &raw_base);

    if config
        .excludelist
        .read()
        .unwrap()
        .iter()
        .any(|ex| base.starts_with(ex))
    {
        return;
    }

    let Some(existing) = lvc.get(&crate::types::Exchange::OkxF, &base, &quote) else {
        return;
    };
    let Some(ticker) = merge_okx_funding(raw, existing) else {
        return;
    };

    let payload = serde_json::json!({
        "type": "normalized_ticker",
        "source": ticker.exchange.to_string(),
        "data": &ticker
    });
    batcher.push(ticker.base.clone(), ticker.quote.clone(), payload);
    lvc.upsert(ticker);
}

pub async fn subscription_factory(
    symbols: Vec<String>,
    shard_idx: usize,
) -> Option<Vec<serde_json::Value>> {
    if symbols.is_empty() {
        return None;
    }
    let mut msgs = Vec::new();
    for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
        let args: Vec<Value> = chunk
            .iter()
            .flat_map(|inst_id| {
                [
                    serde_json::json!({"channel": "tickers", "instId": inst_id}),
                    serde_json::json!({"channel": "funding-rate", "instId": inst_id}),
                ]
            })
            .collect();

        msgs.push(serde_json::json!({
            "id": format!("{}", shard_idx * 1000),
            "op": "subscribe",
            "args": args
        }));
    }
    Some(msgs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::VisibilityCache;
    use crate::types::{
        Exchange, MarketState, NormalizedTicker, SystemConfig, SystemConfigJwtSecret,
        SystemConfigNodeEnv,
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
    fn handle_message_merges_funding_into_existing_ticker() {
        let lvc = Arc::new(LatestValueCache::new());
        lvc.upsert(btc_ticker());
        let tac = Arc::new(TokenAnnotationCache::new());
        let config = test_config();
        let (tx, _) = broadcast::channel(4);
        let mut batcher = TickerBatcher::new(tx, "okx_f".to_string(), config.clone());
        let message = serde_json::json!({
            "arg": { "channel": "funding-rate", "instId": "BTC-USDT-SWAP" },
            "data": [{
                "fundingRate": "0.0001",
                "fundingTime": "1700000000000",
                "nextFundingTime": "1700028800000",
                "ts": "1699999999000"
            }]
        });

        handle_message(&message.to_string(), &mut batcher, &tac, &config, &lvc);

        let ticker = lvc.get(&Exchange::OkxF, "BTC", "USDT").unwrap();
        assert_eq!(ticker.c, 105.0);
        assert_eq!(ticker.v_base, 1.0);
        assert_eq!(ticker.funding_rate, Some(0.0001));
        assert_eq!(ticker.funding_interval_hours, Some(8.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700000000000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1699999999000));
    }

    #[tokio::test]
    async fn subscription_factory_includes_tickers_and_funding_rate() {
        let subscriptions = subscription_factory(vec!["BTC-USDT-SWAP".to_string()], 7)
            .await
            .unwrap();
        let args = subscriptions[0]
            .get("args")
            .and_then(|v| v.as_array())
            .unwrap();

        assert!(args.iter().any(|arg| {
            arg.get("channel").and_then(|v| v.as_str()) == Some("tickers")
                && arg.get("instId").and_then(|v| v.as_str()) == Some("BTC-USDT-SWAP")
        }));
        assert!(args.iter().any(|arg| {
            arg.get("channel").and_then(|v| v.as_str()) == Some("funding-rate")
                && arg.get("instId").and_then(|v| v.as_str()) == Some("BTC-USDT-SWAP")
        }));
    }
}
