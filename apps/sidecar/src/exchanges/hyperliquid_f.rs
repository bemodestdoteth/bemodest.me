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
}
