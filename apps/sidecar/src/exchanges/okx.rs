use crate::cache::lvc::LatestValueCache;
use crate::cache::MarketCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::okx::normalize_okx_ticker;
use log::{info, warn};
use serde_json::Value;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

pub const WS_URL: &str = "wss://ws.okx.com:8443/ws/v5/public";
pub const MAX_SYMBOLS_PER_CONN: usize = 100;
const SUBSCRIBE_BATCH_SIZE: usize = 100;
pub const PING_INTERVAL_SECS: u64 = 25;

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) -> Vec<String> {
    let mut waited = 0u64;
    loop {
        let markets = market_cache.get_okx_markets().await;
        if !markets.is_empty() {
            info!(
                "[OkxExchange] Market cache ready with {} symbols",
                markets.len()
            );
            return markets;
        }
        if waited >= 30_000 {
            warn!("[OkxExchange] Market cache still empty after 30s, proceeding anyway");
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
        if let Some(mut ticker) = normalize_okx_ticker(&raw) {
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
    } else {
        warn!("[OkxExchange] Received non-JSON message: {}", text);
    }
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
            .map(|inst_id| serde_json::json!({"channel": "tickers", "instId": inst_id}))
            .collect();
        msgs.push(serde_json::json!({
            "id": format!("{}", shard_idx * 1000),
            "op": "subscribe",
            "args": args
        }));
    }
    Some(msgs)
}
