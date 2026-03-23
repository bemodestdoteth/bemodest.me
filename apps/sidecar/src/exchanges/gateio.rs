use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, warn};
use std::sync::Arc;
use crate::normalizer::gateio::normalize_gateio_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::config::Config;

pub const TICKER_STREAM_URL: &str = "wss://api.gateio.ws/ws/v4/";
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) {
    let mut waited = 0u64;
    loop {
        let markets = market_cache.get_gateio_markets().await;
        if !markets.is_empty() {
            info!("[GateioExchange] Market cache ready with {} currencies", markets.len());
            break;
        }
        if waited >= 30_000 {
            warn!("[GateioExchange] Market cache still empty after 30s, proceeding anyway");
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
        if raw.get("channel").and_then(|v| v.as_str()) == Some("spot.ping") {
            return;
        }
        if raw.get("channel").and_then(|v| v.as_str()) != Some("spot.tickers") 
            || raw.get("event").and_then(|v| v.as_str()) != Some("update") {
            return;
        }

        if let Some(mut ticker) = normalize_gateio_ticker(&raw) {
            if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
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

pub async fn subscription_factory(market_cache: Arc<MarketCache>) -> Option<Vec<serde_json::Value>> {
    let symbols = market_cache.get_gateio_markets().await;
    if symbols.is_empty() {
        return None;
    }
    
    let mut msgs = Vec::new();
    for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
        let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        msgs.push(serde_json::json!({
            "time": time,
            "channel": "spot.tickers",
            "event": "subscribe",
            "payload": chunk
        }));
    }
    Some(msgs)
}

pub fn ping_factory() -> Option<serde_json::Value> {
    let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
    Some(serde_json::json!({
        "time": time,
        "channel": "spot.ping"
    }))
}

