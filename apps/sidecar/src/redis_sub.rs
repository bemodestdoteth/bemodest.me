use futures_util::StreamExt;
use log::{error, info, warn};
use tokio::sync::broadcast;

use crate::cache::lvc::LatestValueCache;
use crate::cache::EligibilityFilter;
use crate::types::NormalizedTicker;
use serde_json::Value;
use std::sync::Arc;

/// Subscribes to `channel` on Redis and forwards eligible messages into `tx`.
/// Reconnects automatically with exponential backoff on failure.
pub async fn run_dex_subscriber(
    redis_url: String,
    channel: String,
    tx: broadcast::Sender<String>,
    lvc: Arc<LatestValueCache>,
    filter: EligibilityFilter,
) {
    const INITIAL_BACKOFF_MS: u64 = 1_000;
    const MAX_BACKOFF_MS: u64 = 30_000;
    const BACKOFF_FACTOR: u64 = 2;

    let mut backoff_ms = INITIAL_BACKOFF_MS;

    loop {
        info!(
            "[DexSub] Connecting to Redis at {} (channel={})",
            redis_url, channel
        );

        let client = match redis::Client::open(redis_url.clone()) {
            Ok(c) => c,
            Err(e) => {
                error!("[DexSub] Failed to create Redis client: {e}. Retrying in {backoff_ms}ms");
                tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * BACKOFF_FACTOR).min(MAX_BACKOFF_MS);
                continue;
            }
        };

        let conn = match client.get_async_pubsub().await {
            Ok(c) => c,
            Err(e) => {
                error!("[DexSub] Redis connection error: {e}. Retrying in {backoff_ms}ms");
                tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
                backoff_ms = (backoff_ms * BACKOFF_FACTOR).min(MAX_BACKOFF_MS);
                continue;
            }
        };

        let mut pubsub = conn;

        if let Err(e) = pubsub.subscribe(&channel).await {
            error!("[DexSub] Subscribe failed: {e}. Retrying in {backoff_ms}ms");
            tokio::time::sleep(tokio::time::Duration::from_millis(backoff_ms)).await;
            backoff_ms = (backoff_ms * BACKOFF_FACTOR).min(MAX_BACKOFF_MS);
            continue;
        }

        info!("[DexSub] Subscribed to Redis channel '{channel}'");
        backoff_ms = INITIAL_BACKOFF_MS; // reset after successful connect

        let mut msg_stream = pubsub.on_message();

        loop {
            match msg_stream.next().await {
                Some(msg) => {
                    let payload: String = match msg.get_payload() {
                        Ok(p) => p,
                        Err(e) => {
                            warn!("[DexSub] Failed to decode message payload: {e}");
                            continue;
                        }
                    };

                    // Check eligibility before forwarding
                    let mut broadcast = false;

                    if let Ok(mut value) = serde_json::from_str::<Value>(&payload) {
                        if value.get("type").and_then(|t| t.as_str()) == Some("normalized_ticker") {
                            if let Some(data) = value.get_mut("data") {
                                if let Some(obj) = data.as_object_mut() {
                                    // Inject enum variant so NormalizedTicker deserializes
                                    obj.insert("exchange".to_string(), serde_json::json!("Dex"));
                                }

                                if let Ok(ticker) =
                                    serde_json::from_value::<NormalizedTicker>(data.clone())
                                {
                                    let base = ticker.base.clone();
                                    let quote = ticker.quote.clone();

                                    lvc.upsert(ticker);

                                    if filter.is_eligible(&base, &quote, &lvc) {
                                        broadcast = true;
                                    }
                                }
                            }
                        }
                    }

                    // Forward into broadcast channel; ignore if no active receivers
                    if broadcast && tx.receiver_count() > 0 {
                        if let Err(e) = tx.send(payload) {
                            warn!("[DexSub] Broadcast send error: {e}");
                        }
                    }
                }
                None => {
                    error!("[DexSub] Redis message stream ended. Reconnecting...");
                    break; // break inner loop → outer loop reconnects
                }
            }
        }
    }
}
