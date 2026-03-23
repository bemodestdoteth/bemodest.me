use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, warn};
use std::sync::Arc;
use crate::normalizer::kraken::normalize_kraken_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::config::Config;

pub const TICKER_STREAM_URL: &str = "wss://ws.kraken.com/v2";
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) {
    let mut waited = 0u64;
    loop {
        let symbols = market_cache.get_kraken_markets().await;
        if !symbols.is_empty() {
            info!("[KrakenExchange] Market cache ready with {} symbols", symbols.len());
            break;
        }
        if waited >= 30_000 {
            warn!("[KrakenExchange] Market cache still empty after 30s, proceeding anyway");
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
        let channel = raw.get("channel").and_then(|c| c.as_str());
        let msg_type = raw.get("type").and_then(|t| t.as_str());

        match (channel, msg_type) {
            (Some("heartbeat"), _) => return,
            (_, Some("subscribe")) | (_, Some("error")) => return,
            (Some("ticker"), _) => {}
            _ => return,
        }

        if let Some(normalized_list) = normalize_kraken_ticker(&raw) {
            for mut ticker in normalized_list {
                if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                    continue;
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
}

pub async fn subscription_factory(market_cache: Arc<MarketCache>) -> Option<Vec<serde_json::Value>> {
    let symbols = market_cache.get_kraken_markets().await;
    if symbols.is_empty() {
        return None;
    }
    let mut msgs = Vec::new();
    for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
        msgs.push(serde_json::json!({
            "method": "subscribe",
            "params": {
                "channel": "ticker",
                "symbol": chunk
            }
        }));
    }
    Some(msgs)
}

