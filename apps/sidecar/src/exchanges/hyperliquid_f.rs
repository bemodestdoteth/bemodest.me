use crate::cache::lvc::LatestValueCache;
use crate::cache::MarketCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::hyperliquid_f::normalize_hyperliquid_f_ticker;
use log::{info, warn};
use serde_json::Value;
use std::sync::Arc;

pub const WS_URL: &str = "wss://api.hyperliquid.xyz/ws";

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) {
    let markets = market_cache.get_hyperliquid_f_markets().await;
    if markets.is_empty() {
        info!("[HyperliquidFExchange] Market cache empty; using BTC liveness subscription");
    } else {
        info!(
            "[HyperliquidFExchange] Market cache ready with {} symbols",
            markets.len()
        );
    }
}

pub fn handle_message(
    text: &str,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) {
    if let Ok(raw) = serde_json::from_str::<Value>(text) {
        if raw.get("subscriptionResponse").is_some() || raw.get("pong").is_some() {
            return;
        }

        if let Some(tickers) = normalize_hyperliquid_f_ticker(&raw) {
            for mut ticker in tickers {
                if config
                    .excludelist
                    .read()
                    .unwrap()
                    .iter()
                    .any(|ex| ticker.base.starts_with(ex))
                {
                    continue;
                }
                ticker.base =
                    tac.resolve_ticker_base(&ticker.exchange, &ticker.raw_base, &ticker.base);
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
            }
        }
    } else {
        warn!("[HyperliquidFExchange] Received non-JSON message: {}", text);
    }
}

pub async fn subscription_factory(
    market_cache: Arc<MarketCache>,
) -> Option<Vec<serde_json::Value>> {
    let mut markets = market_cache.get_hyperliquid_f_markets().await;
    if markets.is_empty() {
        markets.push("BTC".to_string());
    }

    Some(
        markets
            .into_iter()
            .map(|coin| active_asset_context_subscription(&coin))
            .collect(),
    )
}

fn active_asset_context_subscription(coin: &str) -> serde_json::Value {
    serde_json::json!({
        "method": "subscribe",
        "subscription": { "type": "activeAssetCtx", "coin": coin }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::VisibilityCache;
    use crate::types::{
        Exchange, NormalizedTicker, SystemConfig, SystemConfigJwtSecret, SystemConfigNodeEnv,
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
            exchange: Exchange::HyperliquidF,
            base: "BTC".to_string(),
            raw_base: "BTC".to_string(),
            quote: "USDC".to_string(),
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
            funding_interval_hours: Some(1.0),
            next_funding_time_ms: Some(1700003600000),
            funding_timestamp_ms: Some(1700000000000),
        }
    }

    #[test]
    fn handle_message_preserves_existing_funding_when_ctx_has_no_funding() {
        let lvc = Arc::new(LatestValueCache::new());
        lvc.upsert(btc_ticker());
        let tac = Arc::new(TokenAnnotationCache::new());
        let config = test_config();
        let (tx, _) = broadcast::channel(4);
        let mut batcher = TickerBatcher::new(tx, "hyperliquid_f".to_string(), config.clone());
        let message = serde_json::json!({
            "channel": "activeAssetCtx",
            "data": {
                "coin": "BTC",
                "ctx": {
                    "prevDayPx": "100.0",
                    "dayNtlVlm": "212.0",
                    "oraclePx": "106.0",
                    "markPx": "106.0",
                    "dayBaseVlm": "2.0"
                }
            }
        });

        handle_message(&message.to_string(), &mut batcher, &tac, &config, &lvc);

        let ticker = lvc.get(&Exchange::HyperliquidF, "BTC", "USDC").unwrap();
        assert_eq!(ticker.c, 106.0);
        assert_eq!(ticker.funding_rate, Some(0.0001));
        assert_eq!(ticker.funding_interval_hours, Some(1.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700003600000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1700000000000));
    }

    #[tokio::test]
    async fn subscription_factory_returns_btc_liveness_subscription_without_markets() {
        let messages = subscription_factory(MarketCache::new()).await.unwrap();

        assert_eq!(messages.len(), 1);
        assert_eq!(
            messages[0],
            serde_json::json!({
                "method": "subscribe",
                "subscription": { "type": "activeAssetCtx", "coin": "BTC" }
            })
        );
    }

    #[tokio::test]
    async fn subscription_factory_uses_hip3_qualified_market_names() {
        let market_cache = MarketCache::new();
        market_cache
            .set_markets_for_test("hyperliquid_f", vec!["xyz:SKHX".to_string()])
            .await;

        let messages = subscription_factory(market_cache).await.unwrap();

        assert_eq!(
            messages,
            vec![serde_json::json!({
                "method": "subscribe",
                "subscription": { "type": "activeAssetCtx", "coin": "xyz:SKHX" }
            })]
        );
    }
}
