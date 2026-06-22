use hmac::{Hmac, Mac};
use log::{error, info, warn};
use sha2::Sha256;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::time::{sleep, Duration};

use crate::alert::types::AlertFiredEvent;
use crate::config::Config;

type HmacSha256 = Hmac<Sha256>;

const RETRY_DELAYS_SECS: [u64; 3] = [1, 5, 20];
const DEAD_AFTER_FAILURES: u32 = 3;

pub async fn run(mut rx: broadcast::Receiver<AlertFiredEvent>, config: Arc<Config>) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("[Webhook] Failed to build HTTP client");

    let mut failure_counts: HashMap<String, u32> = HashMap::new();

    loop {
        let event = match rx.recv().await {
            Ok(e) => e,
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!("[Webhook] Receiver lagged by {} messages", n);
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => {
                info!("[Webhook] Alert channel closed — dispatcher exiting");
                break;
            }
        };

        let failure_key = format!("{}:{}", event.rule_id, event.destination_id);
        let delivered = deliver_with_retry(&client, &event, &config).await;

        if delivered {
            failure_counts.remove(&failure_key);
            continue;
        }

        let count = failure_counts.entry(failure_key.clone()).or_insert(0);
        *count += 1;
        warn!(
            "[Webhook] Rule {:?} destination {:?} delivery failed ({}/{} before dead)",
            event.rule_id, event.destination_id, count, DEAD_AFTER_FAILURES
        );

        if *count >= DEAD_AFTER_FAILURES {
            mark_destination_dead(&client, &event.rule_id, &event.destination_id, &config).await;
            failure_counts.remove(&failure_key);
        }
    }
}

async fn deliver_with_retry(
    client: &reqwest::Client,
    event: &AlertFiredEvent,
    config: &Config,
) -> bool {
    let payload = serde_json::json!({
        "alert_event_id": event.alert_event_id,
        "rule_id": event.rule_id,
        "label": event.label,
        "scope": event.scope,
        "condition": event.condition,
        "ticker": event.ticker,
        "quote": event.quote,
        "exchanges": event.exchanges,
        "value": event.value,
        "threshold": event.threshold,
        "alert_type": event.alert_type.as_str(),
        "destination_id": event.destination_id,
        "delivery_destination": {
            "_id": event.destination_id,
            "label": event.destination_label,
            "kind": event.destination_kind,
        },
        "highest_exchange": event.highest_exchange,
        "lowest_exchange": event.lowest_exchange,
        "price_high": event.price_high,
        "price_low": event.price_low,
        "premium_exchange": event.premium_exchange,
        "premium_adjustment_pct": event.premium_adjustment_pct,
        "triggered_at": event.triggered_at,
        "webhook_template": event.webhook_template.as_ref().map(|template| template.as_str()),
        "template_payload": event.template_payload,
    });
    let body = match serde_json::to_vec(&payload) {
        Ok(value) => value,
        Err(e) => {
            error!("[Webhook] Serialisation failed: {}", e);
            return false;
        }
    };

    for (attempt, delay_secs) in RETRY_DELAYS_SECS.iter().enumerate() {
        if attempt > 0 {
            sleep(Duration::from_secs(*delay_secs)).await;
        }

        let timestamp_ms = chrono::Utc::now().timestamp_millis();
        let sig_hex = sign_timestamp(timestamp_ms, &config.webhook_secret);
        let result = client
            .post(&event.webhook_url)
            .header("Content-Type", "application/json")
            .header("X-Timestamp", timestamp_ms.to_string())
            .header("X-Signature", sig_hex)
            .body(body.clone())
            .send()
            .await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                info!(
                    "[Webhook] Rule {:?} destination {:?} delivered (attempt {}/{})",
                    event.rule_id,
                    event.destination_id,
                    attempt + 1,
                    RETRY_DELAYS_SECS.len()
                );
                return true;
            }
            Ok(resp) => warn!(
                "[Webhook] Rule {:?} destination {:?} attempt {}/{} — HTTP {}",
                event.rule_id,
                event.destination_id,
                attempt + 1,
                RETRY_DELAYS_SECS.len(),
                resp.status()
            ),
            Err(e) => warn!(
                "[Webhook] Rule {:?} destination {:?} attempt {}/{} — error: {}",
                event.rule_id,
                event.destination_id,
                attempt + 1,
                RETRY_DELAYS_SECS.len(),
                e
            ),
        }
    }

    false
}

fn sign_timestamp(timestamp_ms: i64, secret: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("[Webhook] HMAC initialization failed");
    mac.update(timestamp_ms.to_string().as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

async fn mark_destination_dead(
    client: &reqwest::Client,
    rule_id: &str,
    destination_id: &str,
    config: &Config,
) {
    let url = format!(
        "http://127.0.0.1:{}/api/alert-rules/{}/destinations/{}/mark-dead",
        config.api_port, rule_id, destination_id
    );

    let timestamp_ms = chrono::Utc::now().timestamp_millis();
    let sig_hex = sign_timestamp(timestamp_ms, &config.webhook_secret);

    match client
        .patch(&url)
        .header("X-Timestamp", timestamp_ms.to_string())
        .header("X-Signature", sig_hex)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => warn!(
            "[Webhook] Rule {:?} destination {:?} marked dead — {} consecutive event failures",
            rule_id, destination_id, DEAD_AFTER_FAILURES
        ),
        Ok(resp) => error!(
            "[Webhook] Failed to mark rule {:?} destination {:?} dead — API returned {}",
            rule_id,
            destination_id,
            resp.status()
        ),
        Err(e) => error!(
            "[Webhook] Failed to mark rule {:?} destination {:?} dead — request error: {}",
            rule_id, destination_id, e
        ),
    }
}
