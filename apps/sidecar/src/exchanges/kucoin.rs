use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, error, warn};
use std::sync::Arc;
use crate::normalizer::kucoin::normalize_kucoin_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::config::Config;

pub const BULLET_PUBLIC_URL: &str = "https://api.kucoin.com/api/v1/bullet-public";
pub const MAX_SYMBOLS_PER_CONN: usize = 300;
const SUBSCRIBE_BATCH_SIZE: usize = 100;
pub const DEFAULT_PING_INTERVAL_MS: u64 = 18000;

pub async fn get_ws_token() -> Option<(String, String, u64)> {
    let client = reqwest::Client::new();
    let res = client
        .post(BULLET_PUBLIC_URL)
        .header("Content-Length", "0")
        .send()
        .await
        .ok()?;
    let json: Value = res.json().await.ok()?;
    if json["code"].as_str() != Some("200000") {
        error!("[KucoinExchange] bullet-public returned bad code: {}", json["code"]);
        return None;
    }
    let data = json.get("data")?;
    let token = data.get("token")?.as_str()?.to_string();
    let servers = data.get("instanceServers")?.as_array()?;
    let server = servers.first()?;
    let endpoint = server.get("endpoint")?.as_str()?.to_string();
    let ping_ms = server.get("pingInterval")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_PING_INTERVAL_MS);
    Some((endpoint, token, ping_ms))
}

pub async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) -> Vec<String> {
    let mut waited = 0u64;
    loop {
        let markets = market_cache.get_kucoin_markets().await;
        if !markets.is_empty() {
            info!("[KucoinExchange] Market cache ready with {} symbols", markets.len());
            return markets;
        }
        if waited >= 30_000 {
            warn!("[KucoinExchange] Market cache still empty after 30s, proceeding anyway");
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
    if let Ok(raw) = serde_json::from_str::<Value>(text) {
        let msg_type = raw.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if msg_type == "message" {
            if let Some(mut ticker) = normalize_kucoin_ticker(&raw) {
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
    } else {
        warn!("[KucoinExchange] Received non-JSON message: {}", text);
    }
}

pub async fn subscription_factory(symbols: Vec<String>) -> Option<Vec<serde_json::Value>> {
    if symbols.is_empty() {
        return None;
    }
    let mut msgs = Vec::new();
    for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
        let topic = format!("/market/ticker:{}", chunk.join(","));
        let sub_id = uuid::Uuid::new_v4().to_string().replace('-', "");
        msgs.push(serde_json::json!({
            "id": sub_id,
            "type": "subscribe",
            "topic": topic,
            "privateChannel": false,
            "response": true
        }));
    }
    Some(msgs)
}

pub fn ping_factory() -> Option<serde_json::Value> {
    let ping_id = uuid::Uuid::new_v4().to_string().replace('-', "");
    Some(serde_json::json!({
        "id": ping_id,
        "type": "ping"
    }))
}
