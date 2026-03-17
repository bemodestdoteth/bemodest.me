use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::time::{sleep, Duration};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use log::{error, info, warn};

type HmacSha256 = Hmac<Sha256>;

use crate::alert::types::AlertFiredEvent;
use crate::config::Config;

// ============================================================================
// Constants
// ============================================================================

/// Exponential backoff delays for retries (seconds): 1 s, 5 s, 20 s
const RETRY_DELAYS_SECS: [u64; 3] = [1, 5, 20];

/// Number of consecutive per-event delivery failures before marking dead.
/// Each trigger event counts as one attempt; we mark dead after 3 separate
/// events all fail completely (matching the plan spec).
const DEAD_AFTER_FAILURES: u32 = 3;

// ============================================================================
// Entry Point
// ============================================================================

/// Consume `AlertFiredEvent`s from the broadcast channel and deliver them
/// to each rule's configured webhook URL.
///
/// HMAC-SHA256 signing reuses the existing `SNAPPER_API_SECRET` via:
///   `sig = HMAC-SHA256(key=secret, msg=payload_bytes + timestamp_ms_string)`
///
/// Headers sent:
///   `X-Timestamp: <unix_ms>`
///   `X-Signature: <hex>`
pub async fn run(
    mut rx: broadcast::Receiver<AlertFiredEvent>,
    config: Arc<Config>,
) {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("[Webhook] Failed to build HTTP client");

    // Per-rule failure counter — persists across events for the same rule_id
    let mut failure_counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();

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

        let rule_id = event.rule_id.clone();

        // Build and attempt delivery
        let delivered = deliver_with_retry(&client, &event, &config).await;

        if delivered {
            // Reset consecutive failure counter on success
            failure_counts.remove(&rule_id);
        } else {
            let count = failure_counts.entry(rule_id.clone()).or_insert(0);
            *count += 1;
            warn!(
                "[Webhook] Rule {:?} delivery failed ({}/{} before dead)",
                rule_id, count, DEAD_AFTER_FAILURES
            );

            if *count >= DEAD_AFTER_FAILURES {
                mark_webhook_dead(&client, &rule_id, &config).await;
                failure_counts.remove(&rule_id); // reset so we don't spam
            }
        }
    }
}

// ============================================================================
// Delivery w/ Retry
// ============================================================================

/// Try to POST the event payload up to 3 times with exponential backoff.
/// Returns `true` if any attempt succeeded (2xx response).
async fn deliver_with_retry(
    client: &reqwest::Client,
    event: &AlertFiredEvent,
    config: &Config,
) -> bool {
    // Determine webhook URL stored on the rule (event carries it indirectly
    // through rule_id — we don't store it on AlertFiredEvent to keep the
    // channel payload lean).  The webhook URL is passed via Config::webhook_secret
    // but since we embedded it in the event at engine level, we added it there.
    // Retrieve from the event directly (we'll add webhook_url to AlertFiredEvent below).
    let webhook_url = &event.webhook_url;

    let timestamp_ms = chrono::Utc::now().timestamp_millis();

    // Serialize payload
    let payload = match serde_json::to_vec(&event) {
        Ok(b) => b,
        Err(e) => {
            error!("[Webhook] Serialisation failed: {}", e);
            return false;
        }
    };

    // Build HMAC-SHA256 signature: key=SNAPPER_API_SECRET, msg=payload+timestamp
    let sig_hex = sign_payload(&payload, timestamp_ms, &config.webhook_secret);

    for (attempt, delay_secs) in RETRY_DELAYS_SECS.iter().enumerate() {
        if attempt > 0 {
            sleep(Duration::from_secs(*delay_secs)).await;
        }

        let result = client
            .post(webhook_url)
            .header("Content-Type", "application/json")
            .header("X-Timestamp", timestamp_ms.to_string())
            .header("X-Signature", &sig_hex)
            .body(payload.clone())
            .send()
            .await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                info!(
                    "[Webhook] Rule {:?} delivered (attempt {}/{})",
                    event.rule_id, attempt + 1, RETRY_DELAYS_SECS.len()
                );
                return true;
            }
            Ok(resp) => {
                warn!(
                    "[Webhook] Rule {:?} attempt {}/{} — HTTP {}",
                    event.rule_id, attempt + 1, RETRY_DELAYS_SECS.len(), resp.status()
                );
            }
            Err(e) => {
                warn!(
                    "[Webhook] Rule {:?} attempt {}/{} — error: {}",
                    event.rule_id, attempt + 1, RETRY_DELAYS_SECS.len(), e
                );
            }
        }
    }

    false
}

// ============================================================================
// HMAC-SHA256 Singer
// ============================================================================

/// Produce a lower-hex HMAC-SHA256 signature.
///
/// The message is `payload_bytes || timestamp_ms_decimal_string`, matching the
/// validation the Node API performs (same SNAPPER_API_SECRET, same algorithm).
fn sign_payload(payload: &[u8], timestamp_ms: i64, secret: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("[Webhook] HMAC initialization failed");
    
    mac.update(payload);
    mac.update(timestamp_ms.to_string().as_bytes());
    
    let result = mac.finalize();
    let code_bytes = result.into_bytes();
    
    hex::encode(code_bytes)
}

// ============================================================================
// Dead Webhook Notification
// ============================================================================

/// PATCH `/api/alert-rules/:id` `{ "webhook_dead": true }` on the local Node API.
///
/// The Node API then emits a Socket.IO event so the UI can surface the failure.
/// Failures here are only logged — the webhook was already dead, so there's
/// nothing further to do.
async fn mark_webhook_dead(client: &reqwest::Client, rule_id: &str, config: &Config) {
    let url = format!(
        "http://127.0.0.1:{}/api/alert-rules/{}/mark-dead",
        config.api_port, rule_id
    );

    let body = serde_json::json!({ "webhook_dead": true });

    match client.patch(&url).json(&body).send().await {
        Ok(resp) if resp.status().is_success() => {
            warn!(
                "[Webhook] Rule {:?} marked dead — {} consecutive event failures",
                rule_id, DEAD_AFTER_FAILURES
            );
        }
        Ok(resp) => {
            error!(
                "[Webhook] Failed to mark rule {:?} dead — API returned {}",
                rule_id,
                resp.status()
            );
        }
        Err(e) => {
            error!(
                "[Webhook] Failed to mark rule {:?} dead — request error: {}",
                rule_id, e
            );
        }
    }
}
