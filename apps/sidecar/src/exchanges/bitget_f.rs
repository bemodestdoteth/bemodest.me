use crate::cache::lvc::LatestValueCache;
use crate::cache::MarketCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::bitget::normalize_bitget_f_ticker;
use log::{info, warn};
use serde_json::Value;
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

        if let Some(mut ticker) = normalize_bitget_f_ticker(&raw) {
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
