use crate::cache::lvc::LatestValueCache;
use crate::cache::MarketCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::coinbase::normalize_coinbase_ticker;
use log::{info, warn};
use serde_json::Value;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

pub const TICKER_STREAM_URL: &str = "wss://ws-feed.exchange.coinbase.com";
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) {
    let mut waited = 0u64;
    loop {
        let currencies = market_cache.get_coinbase_markets().await;
        if !currencies.is_empty() {
            info!(
                "[CoinbaseExchange] Market cache ready with {} currencies",
                currencies.len()
            );
            break;
        }
        if waited >= 30_000 {
            warn!("[CoinbaseExchange] Market cache still empty after 30s, proceeding anyway");
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
    if let Ok(raw) = serde_json::from_str::<Value>(text) {
        match raw.get("type").and_then(|t| t.as_str()) {
            Some("subscriptions") | Some("error") => return,
            _ => {}
        }

        if let Some(mut ticker) = normalize_coinbase_ticker(&raw) {
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
            let payload = serde_json::json!({
                "type": "normalized_ticker",
                "source": ticker.exchange.to_string(),
                "data": &ticker
            });
            batcher.push(ticker.base.clone(), ticker.quote.clone(), payload);
            lvc.upsert(ticker);
        }
    }
}

pub async fn subscription_factory(
    market_cache: Arc<MarketCache>,
) -> Option<Vec<serde_json::Value>> {
    let currencies = market_cache.get_coinbase_markets().await;
    if currencies.is_empty() {
        return None;
    }
    let product_ids: Vec<String> = currencies
        .iter()
        .filter(|id| !id.contains('-'))
        .map(|id| format!("{}-USD", id))
        .collect();

    let mut msgs = Vec::new();
    for chunk in product_ids.chunks(SUBSCRIBE_BATCH_SIZE) {
        msgs.push(serde_json::json!({
            "type": "subscribe",
            "product_ids": chunk,
            "channels": ["ticker_batch"]
        }));
    }
    Some(msgs)
}
