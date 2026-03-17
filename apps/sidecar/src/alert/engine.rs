use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::{broadcast, RwLock};
use tokio::time::{interval, Duration};
use mongodb::{Client, bson::doc};
use futures_util::TryStreamExt;
use rust_decimal::Decimal;
use rust_decimal::prelude::ToPrimitive;
use chrono::Utc;
use log::{info, warn, error, debug};

use crate::cache::{LatestValueCache, PriceHistoryCache, PriceSample};
use crate::config::Config;
use crate::types::now_micros;
use crate::alert::types::{AlertCondition, AlertFiredEvent, AlertRule, AlertState, AlertStatus};
use crate::alert::state::AlertStateStore;

// ============================================================================
// Constants
// ============================================================================

const STALE_THRESHOLD_US: i64 = 10_000_000; // 10 seconds
const VOLUME_FLOOR_USD: f64 = 30_000.0;
const QUORUM_MIN: usize = 2;
const ENGINE_TICK_MS: u64 = 500;

// ============================================================================
// Rule Loader
// ============================================================================

/// Load all enabled alert rules from MongoDB `alertRules` collection.
///
/// Returns an empty Vec on any connection/query error (engine stays idle
/// rather than crashing — rules will reload on the next `alertrules_updated`
/// pub/sub event).
pub async fn load_alert_rules(config: &Config) -> Vec<AlertRule> {
    let mongo_uri = match &config.mongo_uri {
        Some(u) => u.clone(),
        None => {
            warn!("[AlertEngine] No MongoDB URI configured — alert rules not loaded");
            return Vec::new();
        }
    };

    let client = match Client::with_uri_str(&mongo_uri).await {
        Ok(c) => c,
        Err(e) => {
            error!("[AlertEngine] MongoDB connect failed: {}", e);
            return Vec::new();
        }
    };

    let db = client.database("codys");
    let col = db.collection::<mongodb::bson::Document>("alertRules");

    let cursor = match col.find(doc! { "enabled": true }).await {
        Ok(c) => c,
        Err(e) => {
            error!("[AlertEngine] alertRules query failed: {}", e);
            return Vec::new();
        }
    };

    let docs: Vec<mongodb::bson::Document> = match cursor.try_collect().await {
        Ok(d) => d,
        Err(e) => {
            error!("[AlertEngine] alertRules cursor error: {}", e);
            return Vec::new();
        }
    };

    let mut rules = Vec::with_capacity(docs.len());
    for doc in docs {
        match mongodb::bson::from_document::<AlertRule>(doc) {
            Ok(rule) => rules.push(rule),
            Err(e) => warn!("[AlertEngine] Failed to deserialise alert rule: {}", e),
        }
    }

    // Conflict detection: two rules with the same raw ticker symbol that map to
    // different canonical tokens surface a warning (plan decision Q1).
    detect_conflicts(&rules);

    info!("[AlertEngine] Loaded {} alert rules from MongoDB", rules.len());
    rules
}

/// Warn when two rules reference the same raw symbol as different canonical tickers.
fn detect_conflicts(rules: &[AlertRule]) {
    // group rule labels by ticker for simple conflict detection
    let mut seen: HashMap<String, Vec<String>> = HashMap::new();
    for r in rules {
        seen.entry(r.ticker.clone()).or_default().push(r.label.clone());
    }
    for (ticker, labels) in &seen {
        if labels.len() > 1 {
            warn!(
                "[AlertEngine] Ticker symbol {:?} appears in {} rules — \
                 verify tokenAnnotation mapping is unambiguous. Rules: {:?}",
                ticker, labels.len(), labels
            );
        }
    }
}

// ============================================================================
// History Sampler  (1 Hz — feeds PriceHistoryCache)
// ============================================================================

/// Spawned as a separate 1-second task.
/// Snapshots the LVC and appends one `PriceSample` per live ticker to the
/// history cache. Live = not stale (< 10 s) AND passes volume floor.
pub async fn run_history_sampler(
    lvc: Arc<LatestValueCache>,
    history: Arc<PriceHistoryCache>,
) {
    let mut tick = interval(Duration::from_secs(1));
    loop {
        tick.tick().await;
        let now_us = now_micros();
        for ticker in lvc.snapshot() {
            if now_us - ticker.ingest_time_us >= STALE_THRESHOLD_US {
                continue;
            }
            if ticker.v_quote < VOLUME_FLOOR_USD {
                continue;
            }
            history.push(
                &ticker.exchange.to_string(),
                &ticker.base,
                &ticker.quote,
                PriceSample {
                    timestamp_ms: ticker.timestamp_ms,
                    price: ticker.c,
                    v_quote: ticker.v_quote,
                },
            );
        }
    }
}

// ============================================================================
// Alert Engine  (500 ms tick)
// ============================================================================

/// Main alert evaluation loop.
///
/// - Every 500 ms: snapshot LVC, group by `(base, quote)`, evaluate each rule.
/// - Fires on threshold crossing + hysteresis + cooldown lock acquired.
/// - Sends `AlertFiredEvent` on `alert_tx` for the webhook dispatcher.
pub async fn run(
    lvc: Arc<LatestValueCache>,
    history: Arc<PriceHistoryCache>,
    rules: Arc<RwLock<Vec<AlertRule>>>,
    mut state_store: AlertStateStore,
    alert_tx: broadcast::Sender<AlertFiredEvent>,
) {
    let mut tick = interval(Duration::from_millis(ENGINE_TICK_MS));
    loop {
        tick.tick().await;

        // ── 1. Snapshot LVC ──────────────────────────────────────────────
        let snapshot = lvc.snapshot();
        let now_us = now_micros();

        // ── 2. Group live tickers by (base, quote) ───────────────────────
        // Key: "BASE:QUOTE", Value: list of (exchange_id, close_price, v_quote)
        let mut groups: HashMap<String, Vec<(String, f64, f64)>> = HashMap::new();
        for ticker in &snapshot {
            if now_us - ticker.ingest_time_us >= STALE_THRESHOLD_US {
                continue;
            }
            if ticker.v_quote < VOLUME_FLOOR_USD {
                continue;
            }
            let key = format!("{}:{}", ticker.base, ticker.quote);
            groups.entry(key).or_default().push((
                ticker.exchange.to_string(),
                ticker.c,
                ticker.v_quote,
            ));
        }

        // ── 3. Evaluate each rule ─────────────────────────────────────────
        let rules_snap = {
            let guard = rules.read().await;
            guard.clone()
        };

        for rule in &rules_snap {
            if !rule.enabled || rule.webhook_dead {
                continue;
            }

            let pair_key = format!("{}:{}", rule.ticker, rule.quote);
            let all_entries = match groups.get(&pair_key) {
                Some(e) => e.clone(),
                None => continue,
            };

            // Filter to whitelisted exchanges (empty = all)
            let entries: Vec<(String, f64, f64)> = if rule.exchanges.is_empty() {
                all_entries
            } else {
                all_entries
                    .into_iter()
                    .filter(|(ex, _, _)| rule.exchanges.contains(ex))
                    .collect()
            };

            // Quorum check
            if entries.len() < QUORUM_MIN {
                debug!(
                    "[AlertEngine] Rule {:?}: quorum not met ({}/{})",
                    rule.label, entries.len(), QUORUM_MIN
                );
                continue;
            }

            // Evaluate condition
            let eval_result = evaluate_condition(rule, &entries, &history);
            let (metric_value, highest_exchange, lowest_exchange, price_high, price_low) =
                match eval_result {
                    Some(r) => r,
                    None => continue,
                };

            // Threshold check
            if metric_value <= rule.value {
                continue;
            }

            // Hysteresis: if already triggered check recovery_value
            // (We rely on the cooldown lock as the primary gate; this is a
            //  belt-and-suspenders check for fast re-trigger within one cooldown window.)
            if metric_value <= rule.recovery_value {
                continue;
            }

            // Cooldown lock — atomic, no Lua required
            let lock_acquired = state_store
                .try_acquire_lock(&rule.id, rule.cooldown_secs as u64)
                .await;
            if !lock_acquired {
                debug!("[AlertEngine] Rule {:?} still within cooldown", rule.label);
                continue;
            }

            // Build and send event
            let now_ms = Utc::now().timestamp_millis();
            let event = AlertFiredEvent {
                rule_id: rule.id.clone(),
                webhook_url: rule.webhook_url.clone(),
                label: rule.label.clone(),
                condition: rule.condition.clone(),
                ticker: rule.ticker.clone(),
                quote: rule.quote.clone(),
                exchanges: entries.iter().map(|(ex, _, _)| ex.to_string()).collect(),
                value: metric_value,
                threshold: rule.value,
                highest_exchange: highest_exchange.clone(),
                lowest_exchange: lowest_exchange.clone(),
                price_high,
                price_low,
                triggered_at: Utc::now(),
            };

            if let Err(e) = alert_tx.send(event) {
                warn!("[AlertEngine] alert_tx send failed: {}", e);
            }

            // Persist state
            state_store.set_state(
                &rule.id,
                &AlertState {
                    status: AlertStatus::Triggered,
                    triggered_at: now_ms,
                    cooldown_until: now_ms + (rule.cooldown_secs as i64 * 1000),
                    last_value: metric_value.to_string(),
                },
            ).await;

            info!(
                "[AlertEngine] FIRED rule {:?} — {}: {:.4} > threshold {:.4}",
                rule.label, pair_key, metric_value, rule.value
            );
        }

        // ── 4. Publish Price Leaders to Redis ────────────────────────────
        // We select the leader (max volume) rejecting Upbit/Bithumb/Futures/DEX 
        // to match the "Deep Dive" logic in the frontend/API.
        let mut leader_prices: Vec<(String, String)> = Vec::new();

        for (pair, mut entries) in groups {
            // Reject non-leader-eligible sources
            entries.retain(|(ex, _, _)| {
                let lower = ex.to_lowercase();
                !lower.ends_with("_f") && 
                !lower.ends_with("_futures") && 
                lower != "upbit" && 
                lower != "bithumb" && 
                !lower.starts_with("dex_")
            });

            if let Some((_, price, _)) = entries.into_iter().max_by(|(_, _, v1), (_, _, v2)| v1.partial_cmp(v2).unwrap()) {
                // Key: BASE, Field: USD Price
                // We use only the Base symbol as the key for lvc:prices hash
                if let Some(base) = pair.split(':').next() {
                    leader_prices.push((base.to_string(), price.to_string()));
                }
            }
        }

        if !leader_prices.is_empty() {
            state_store.publish_lvc_prices(leader_prices).await;
        }
    }
}

// ============================================================================
// Condition Evaluator
// ============================================================================

/// Evaluate the rule's condition against current exchange data (and history for
/// time-based conditions).
///
/// Returns `(metric_value, highest_exchange, lowest_exchange, price_high, price_low)`
/// or `None` if the condition cannot be evaluated (e.g. insufficient history).
fn evaluate_condition(
    rule: &AlertRule,
    entries: &[(String, f64, f64)],
    history: &PriceHistoryCache,
) -> Option<(f64, Option<String>, Option<String>, Option<f64>, Option<f64>)> {
    match rule.condition {
        // ── spread_pct ───────────────────────────────────────────────────
        AlertCondition::SpreadPct => {
            let min = entries.iter().min_by(|(_, p1, _), (_, p2, _)| p1.partial_cmp(p2).unwrap())?;
            let max = entries.iter().max_by(|(_, p1, _), (_, p2, _)| p1.partial_cmp(p2).unwrap())?;
            if min.1 <= 0.0 {
                return None;
            }
            let spread = (max.1 - min.1) / min.1 * 100.0;
            Some((
                spread,
                Some(max.0.clone()),
                Some(min.0.clone()),
                Some(max.1),
                Some(min.1),
            ))
        }

        // ── price_above ──────────────────────────────────────────────────
        AlertCondition::PriceAbove => {
            // Average price across whitelisted exchanges
            let sum: f64 = entries.iter().map(|(_, p, _)| *p).sum();
            let avg = sum / (entries.len() as f64);
            Some((avg, None, None, None, None))
        }

        // ── price_below ──────────────────────────────────────────────────
        AlertCondition::PriceBelow => {
            let sum: f64 = entries.iter().map(|(_, p, _)| *p).sum();
            let avg = sum / (entries.len() as f64);
            // For PriceBelow, the metric is -(avg) so the threshold comparison
            // `metric > rule.value` fires when avg < -rule.value.
            // We store the actual avg as price data but negate for the comparison.
            Some((-avg, None, None, None, None))
        }

        // ── change_pct_5m ────────────────────────────────────────────────
        AlertCondition::ChangePct5M => {
            // Use first matching exchange in the whitelist (or first available)
            let (exchange, current_price, _) = entries.first()?;
            let hist_key =
                PriceHistoryCache::make_key(exchange, &rule.ticker, &rule.quote);
            let samples = history.get_last_n(&hist_key, 300); // up to 5 min
            let oldest = samples.first()?;
            if oldest.price <= 0.0 {
                return None;
            }
            let change_pct = (*current_price - oldest.price) / oldest.price * 100.0;
            Some((change_pct.abs(), None, None, None, None))
        }

        // ── volume_spike ─────────────────────────────────────────────────
        AlertCondition::VolumeSpike => {
            let (exchange, _, current_v_quote) = entries.first()?;
            let hist_key =
                PriceHistoryCache::make_key(exchange, &rule.ticker, &rule.quote);
            let samples = history.get_last_n(&hist_key, 300);
            if samples.is_empty() {
                return None;
            }
            let avg_v: f64 = samples.iter().map(|s| s.v_quote).sum::<f64>() / (samples.len() as f64);
            if avg_v <= 0.0 {
                return None;
            }
            let spike_ratio = *current_v_quote / avg_v;
            Some((spike_ratio, None, None, None, None))
        }
    }
}
