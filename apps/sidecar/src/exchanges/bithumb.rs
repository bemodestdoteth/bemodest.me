use crate::cache::lvc::LatestValueCache;
use crate::cache::ForexCache;
use crate::cache::MarketCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::upbit::normalize_upbit_ticker;
use crate::types::Exchange as ExchangeType;
use log::info;
use serde_json::Value;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

pub const TICKER_STREAM_URL: &str = "wss://ws-api.bithumb.com/websocket/v1";
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) {
    let mut waited = 0u64;
    loop {
        let markets = market_cache.get_bithumb_markets().await;
        if !markets.is_empty() {
            info!(
                "[BithumbExchange] Market cache ready with {} symbols",
                markets.len()
            );
            break;
        }
        if waited >= 30_000 {
            log::warn!("[BithumbExchange] Market cache still empty after 30s, proceeding anyway");
            break;
        }
        sleep(Duration::from_millis(500)).await;
        waited += 500;
    }
}

pub fn handle_message(
    text: &str,
    batcher: &mut TickerBatcher,
    lvc: &Arc<LatestValueCache>,
    tac: &Arc<TokenAnnotationCache>,
    forex: &Arc<ForexCache>,
    config: &Arc<Config>,
) {
    if let Ok(raw) = serde_json::from_str::<Value>(text) {
        process_bithumb_tickers(&raw, lvc, tac, forex, batcher, config);
    }
}

fn process_bithumb_tickers(
    raw: &Value,
    lvc: &LatestValueCache,
    tac: &TokenAnnotationCache,
    forex: &ForexCache,
    batcher: &mut TickerBatcher,
    config: &Config,
) {
    let rate = forex.get_krw_per_usd();

    let btc_krw: Option<f64> = lvc
        .get(&ExchangeType::Bithumb, "BTC", "KRW")
        .and_then(|t| t.c_krw)
        .or_else(|| forex.get_btc_krw());

    if let Some(arr) = raw.as_array() {
        for item in arr {
            if let Some(mut normalized) =
                normalize_upbit_ticker(item, ExchangeType::Bithumb, rate, btc_krw)
            {
                if config
                    .excludelist
                    .read()
                    .unwrap()
                    .iter()
                    .any(|ex| normalized.base.starts_with(ex))
                {
                    continue;
                }
                if let Some(unified) = tac.get_unified(&normalized.exchange, &normalized.base) {
                    normalized.base = unified;
                }
                let payload = serde_json::json!({
                    "type": "normalized_ticker",
                    "source": normalized.exchange.to_string(),
                    "data": &normalized
                });
                batcher.push(normalized.base.clone(), normalized.quote.clone(), payload);
                lvc.upsert(normalized);
            }
        }
    } else if let Some(mut normalized) =
        normalize_upbit_ticker(raw, ExchangeType::Bithumb, rate, btc_krw)
    {
        if config
            .excludelist
            .read()
            .unwrap()
            .iter()
            .any(|ex| normalized.base.contains(ex))
        {
            return;
        }
        if let Some(unified) = tac.get_unified(&normalized.exchange, &normalized.base) {
            normalized.base = unified;
        }
        let payload = serde_json::json!({
            "type": "normalized_ticker",
            "source": normalized.exchange.to_string(),
            "data": &normalized
        });
        batcher.push(normalized.base.clone(), normalized.quote.clone(), payload);
        lvc.upsert(normalized);
    }
}

pub async fn subscription_factory(
    market_cache: Arc<MarketCache>,
) -> Option<Vec<serde_json::Value>> {
    let mut symbols = market_cache.get_bithumb_markets().await;
    if symbols.is_empty() {
        return None;
    }
    if !symbols.contains(&"KRW-BTC".to_string()) {
        symbols.push("KRW-BTC".to_string());
    }

    let ticket_id = uuid::Uuid::new_v4().to_string();
    let mut payload_array = vec![serde_json::json!({"ticket": ticket_id})];

    for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
        payload_array.push(serde_json::json!({
            "type": "ticker",
            "codes": chunk
        }));
    }

    payload_array.push(serde_json::json!({"format": "SIMPLE"}));

    Some(vec![serde_json::Value::Array(payload_array)])
}
