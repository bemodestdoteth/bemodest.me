use crate::cache::lvc::LatestValueCache;
use crate::cache::MarketCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::bybit_f::normalize_bybit_f_ticker;
use crate::types::{Exchange as ExchangeType, ExchangeExt};
use log::{info, warn};
use serde_json::Value;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

pub const FUTURES_STREAM_URL: &str = "wss://stream.bybit.com/v5/public/linear";
const SUBSCRIBE_BATCH_SIZE: usize = 10;

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) {
    let mut waited = 0u64;
    loop {
        let markets = market_cache.get_bybit_f_markets().await;
        if !markets.is_empty() {
            info!(
                "[BybitFExchange] Market cache ready with {} symbols",
                markets.len()
            );
            break;
        }
        if waited >= 30_000 {
            warn!("[BybitFExchange] Market cache still empty after 30s, proceeding anyway");
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
        if raw.get("op").is_some() || raw.get("success").is_some() {
            return;
        }

        let existing = if let Some(topic) = raw.get("topic").and_then(|t| t.as_str()) {
            if let Some(symbol_str) = topic.strip_prefix("tickers.") {
                if let Some((b, q)) = ExchangeType::BybitF.parse_symbol(symbol_str) {
                    lvc.get(&ExchangeType::BybitF, &b, &q)
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        };

        if let Some(mut ticker) = normalize_bybit_f_ticker(&raw, existing) {
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
    let symbols = market_cache.get_bybit_f_markets().await;
    if symbols.is_empty() {
        return None;
    }
    let topics: Vec<String> = symbols.iter().map(|s| format!("tickers.{}", s)).collect();

    let mut msgs = Vec::new();
    for chunk in topics.chunks(SUBSCRIBE_BATCH_SIZE) {
        msgs.push(serde_json::json!({
            "op": "subscribe",
            "args": chunk
        }));
    }
    Some(msgs)
}
