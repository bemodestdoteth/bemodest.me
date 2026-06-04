use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    Client,
};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tokio::time::{interval, Duration};
// use rust_decimal::Decimal; // Pruned by SENTINEL
// use rust_decimal::prelude::ToPrimitive; // Pruned by SENTINEL
use chrono::Utc;
use log::{debug, error, info, warn};

use crate::alert::state::AlertStateStore;
use crate::alert::types::{AlertCondition, AlertFiredEvent, AlertRule, AlertState, AlertStatus};
use crate::cache::{LatestValueCache, PriceHistoryCache, PriceSample, VisibilityPair};
use crate::config::Config;
use crate::types::{now_micros, AlertRuleScope, NormalizedTicker};

// ============================================================================
// Constants
// ============================================================================

pub const STALE_THRESHOLD_US: i64 = 10_000_000; // 10 seconds
pub const VOLUME_FLOOR_USD: f64 = 30_000.0;
const QUORUM_MIN: usize = 2;
const ENGINE_TICK_MS: u64 = 1000;

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

    let cursor = match col
        .find(doc! { "$or": [{ "enabled": true }, { "scope": "market_watch" }] })
        .await
    {
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
    for mut doc in docs {
        normalize_alert_rule_dates(&mut doc);
        match mongodb::bson::from_document::<AlertRule>(doc) {
            Ok(rule) => rules.push(rule),
            Err(e) => warn!("[AlertEngine] Failed to deserialise alert rule: {}", e),
        }
    }

    // Conflict detection: two rules with the same raw ticker symbol that map to
    // different canonical tokens surface a warning (plan decision Q1).
    detect_conflicts(&rules);

    info!(
        "[AlertEngine] Loaded {} alert rules from MongoDB",
        rules.len()
    );
    rules
}

fn normalize_alert_rule_dates(doc: &mut Document) {
    for key in ["created_at", "updated_at"] {
        if let Some(Bson::DateTime(value)) = doc.get(key).cloned() {
            doc.insert(key, Bson::String(value.to_string()));
        }
    }
}

/// Warn when two rules reference the same raw symbol as different canonical tickers.
fn detect_conflicts(rules: &[AlertRule]) {
    // group rule labels by ticker for simple conflict detection
    let mut seen: HashMap<String, Vec<String>> = HashMap::new();
    for r in rules {
        seen.entry(r.ticker.clone())
            .or_default()
            .push(r.label.clone());
    }
    for (ticker, labels) in &seen {
        if labels.len() > 1 {
            warn!(
                "[AlertEngine] Ticker symbol {:?} appears in {} rules — \
                 verify tokenAnnotation mapping is unambiguous. Rules: {:?}",
                ticker,
                labels.len(),
                labels
            );
        }
    }
}

// ============================================================================
// Live Ticker Snapshot
// ============================================================================

pub type LiveTickerEntry = (String, f64, f64, Option<f64>);
pub type LiveTickerGroups = HashMap<String, Vec<LiveTickerEntry>>;

pub fn group_live_tickers(snapshot: &[NormalizedTicker], now_us: i64) -> LiveTickerGroups {
    let mut groups: LiveTickerGroups = HashMap::new();
    for ticker in snapshot {
        if now_us - ticker.ingest_time_us >= STALE_THRESHOLD_US {
            continue;
        }
        let key = format!("{}:{}", ticker.base, ticker.quote);
        groups.entry(key).or_default().push((
            ticker.exchange.to_string(),
            ticker.c,
            ticker.v_quote,
            ticker.change_24h,
        ));
    }
    groups
}

fn sample_history(snapshot: &[NormalizedTicker], now_us: i64, history: &PriceHistoryCache) {
    for ticker in snapshot {
        if now_us - ticker.ingest_time_us >= STALE_THRESHOLD_US {
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

// ============================================================================
// Alert Engine  (1000 ms tick)
// ============================================================================

/// Main alert evaluation loop.
///
/// - Every 1000 ms: snapshot LVC, group by `(base, quote)`, evaluate each rule.
/// - Fires on threshold crossing + hysteresis + cooldown lock acquired.
/// - Sends `AlertFiredEvent` on `alert_tx` for the webhook dispatcher.
pub async fn run(
    lvc: Arc<LatestValueCache>,
    history: Arc<PriceHistoryCache>,
    rules: Arc<RwLock<Vec<AlertRule>>>,
    mut state_store: AlertStateStore,
    alert_tx: broadcast::Sender<AlertFiredEvent>,
    tx: broadcast::Sender<String>,
    config: Arc<Config>,
) {
    let mut tick = interval(Duration::from_millis(ENGINE_TICK_MS));
    loop {
        tick.tick().await;

        // ── 1. Snapshot LVC once, then reuse it for history + alerts ─────
        let snapshot = lvc.snapshot();
        let now_us = now_micros();
        sample_history(&snapshot, now_us, &history);

        // ── 2. Group live tickers by (base, quote) ───────────────────────
        // Key: "BASE:QUOTE", Value: list of (exchange_id, close_price, v_quote)
        let groups = group_live_tickers(&snapshot, now_us);

        // ── 3. Evaluate each rule ─────────────────────────────────────────
        let rules_snap = {
            let guard = rules.read().await;
            guard.clone()
        };

        let visibility_rule = find_market_watch_rule(&rules_snap);
        update_visibility_state(
            visibility_rule,
            &groups,
            &config,
            &history,
            &mut state_store,
            &alert_tx,
            &tx,
        )
        .await;

        for rule in &rules_snap {
            if rule.scope == AlertRuleScope::MarketWatch {
                continue;
            }
            if !rule.enabled || rule.webhook_dead {
                continue;
            }

            if rule.ticker == "*" {
                // ── Wildcard mode: evaluate every (base, quote) group ──────────
                for (group_key, all_entries) in &groups {
                    let (base, quote) = group_key.split_once(':').unwrap_or((group_key, ""));
                    let synthetic_id = format!("{}:{}", rule.id, group_key);
                    try_fire(
                        rule,
                        base,
                        quote,
                        all_entries,
                        &history,
                        &mut state_store,
                        &alert_tx,
                        &synthetic_id,
                    )
                    .await;
                }
            } else {
                // ── Single-ticker mode ─────────────────────────────────────────
                let pair_key = format!("{}:{}", rule.ticker, rule.quote);
                let all_entries = match groups.get(&pair_key) {
                    Some(e) => e.as_slice(),
                    None => continue,
                };
                try_fire(
                    rule,
                    &rule.ticker,
                    &rule.quote,
                    all_entries,
                    &history,
                    &mut state_store,
                    &alert_tx,
                    &rule.id,
                )
                .await;
            }
        }

        // ── 4. Publish Price Leaders to Redis ────────────────────────────
        // We select the leader (max volume) rejecting Upbit/Bithumb/Futures/DEX
        // to match the "Deep Dive" logic in the frontend/API.
        let mut leader_prices: Vec<(String, String)> = Vec::new();

        for (pair, mut entries) in groups {
            // Reject non-leader-eligible sources
            entries.retain(|(ex, _, _, _)| {
                let lower = ex.to_lowercase();
                !lower.ends_with("_f")
                    && !lower.ends_with("_futures")
                    && lower != "upbit"
                    && lower != "bithumb"
                    && !lower.starts_with("dex_")
            });

            if let Some((_, price, _, _)) = entries
                .into_iter()
                .max_by(|(_, _, v1, _), (_, _, v2, _)| v1.partial_cmp(v2).unwrap())
            {
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

fn find_market_watch_rule(rules: &[AlertRule]) -> Option<&AlertRule> {
    let mut matches = rules
        .iter()
        .filter(|rule| rule.scope == AlertRuleScope::MarketWatch);
    let first = matches.next();
    if matches.next().is_some() {
        error!("[AlertEngine] Multiple market_watch rules configured; failing visibility closed except pinned");
        return None;
    }
    match first {
        Some(rule)
            if rule.ticker == "*" && rule.condition == AlertCondition::SpreadPct && !rule.webhook_url.is_empty() =>
        {
            Some(rule)
        }
        Some(rule) => {
            error!(
                "[AlertEngine] Invalid market_watch rule {:?}; requires ticker='*', condition='spread_pct', webhook_url",
                rule.id
            );
            None
        }
        None => {
            error!("[AlertEngine] No market_watch rule configured; failing visibility closed except pinned");
            None
        }
    }
}

async fn update_visibility_state(
    rule: Option<&AlertRule>,
    groups: &LiveTickerGroups,
    config: &Config,
    history: &PriceHistoryCache,
    state_store: &mut AlertStateStore,
    alert_tx: &broadcast::Sender<AlertFiredEvent>,
    tx: &broadcast::Sender<String>,
) {
    let pinlist = config.pinlist.read().unwrap().clone();
    let Some(rule) = rule else {
        let pinned_pairs = pinlist
            .iter()
            .map(|base| VisibilityPair {
                base: base.clone(),
                quote: "".to_string(),
                spread_pct: 0.0,
                threshold: 0.0,
                pinned: true,
                rule_id: None,
            })
            .collect::<Vec<_>>();
        config.visibility.replace(pinned_pairs, false);
        broadcast_visibility_and_summary(tx, config, groups);
        return;
    };

    let mut visible_pairs = Vec::new();
    let min_sources = rule.min_sources as usize;
    let volume_floor = rule.volume_floor_usd.unwrap_or(VOLUME_FLOOR_USD);

    for (group_key, all_entries) in groups {
        let (base, quote) = group_key.split_once(':').unwrap_or((group_key, ""));
        let entries = filter_rule_entries(rule, all_entries, volume_floor);
        let pinned = pinlist.contains(base);
        let spread = evaluate_condition(rule, base, quote, &entries, history).map(|result| result.0);
        let rule_matched = entries.len() >= min_sources && spread.is_some_and(|value| value > rule.value);

        if rule_matched {
            let synthetic_id = format!("{}:{}", rule.id, group_key);
            if !rule.webhook_dead && rule.enabled {
                try_fire(rule, base, quote, all_entries, history, state_store, alert_tx, &synthetic_id).await;
            }
        }

        if rule_matched || pinned {
            visible_pairs.push(VisibilityPair {
                base: base.to_string(),
                quote: quote.to_string(),
                spread_pct: spread.unwrap_or(0.0),
                threshold: rule.value,
                pinned,
                rule_id: Some(rule.id.clone()),
            });
        }
    }

    for base in pinlist {
        if !visible_pairs.iter().any(|pair| pair.base == base) {
            visible_pairs.push(VisibilityPair {
                base,
                quote: "".to_string(),
                spread_pct: 0.0,
                threshold: rule.value,
                pinned: true,
                rule_id: Some(rule.id.clone()),
            });
        }
    }

    config.visibility.replace(visible_pairs, true);
    broadcast_visibility_and_summary(tx, config, groups);
}

fn filter_rule_entries(
    rule: &AlertRule,
    all_entries: &[(String, f64, f64, Option<f64>)],
    volume_floor: f64,
) -> Vec<(String, f64, f64, Option<f64>)> {
    all_entries
        .iter()
        .filter(|(ex, _, volume, _)| {
            *volume >= volume_floor && (rule.exchanges.is_empty() || rule.exchanges.contains(ex))
        })
        .cloned()
        .collect()
}

fn broadcast_visibility_and_summary(
    tx: &broadcast::Sender<String>,
    config: &Config,
    groups: &LiveTickerGroups,
) {
    let visible_pairs = config.visibility.pairs();
    let visibility_msg = serde_json::json!({
        "type": "market_visibility",
        "data": visible_pairs,
    });
    let _ = tx.send(visibility_msg.to_string());

    let mut summary = Vec::new();
    for pair in &visible_pairs {
        if pair.quote.is_empty() {
            continue;
        }
        let key = format!("{}:{}", pair.base, pair.quote);
        let Some(entries) = groups.get(&key) else { continue };
        let prices = entries
            .iter()
            .map(|(_, price, _, _)| *price)
            .filter(|price| *price > 0.0)
            .collect::<Vec<_>>();
        let changes = entries.iter().filter_map(|(_, _, _, change)| *change).collect::<Vec<_>>();
        let mut entry = serde_json::json!({
            "base": pair.base,
            "quote": pair.quote,
            "spread_pct": round4(pair.spread_pct),
            "arb_pct": round4(pct_spread(&prices)),
        });
        if let Some((leader, price, volume, _)) = entries.iter().max_by(|(_, _, a, _), (_, _, b, _)| a.partial_cmp(b).unwrap()) {
            entry["leader"] = serde_json::json!(leader);
            entry["leader_price"] = serde_json::json!(price);
            entry["leader_volume"] = serde_json::json!(volume);
        }
        if !changes.is_empty() {
            entry["change_24h"] = serde_json::json!(round4(changes.iter().sum::<f64>() / changes.len() as f64));
        }
        summary.push(entry);
    }

    let summary_msg = serde_json::json!({ "type": "market_summary", "data": summary });
    let _ = tx.send(summary_msg.to_string());
}

fn pct_spread(prices: &[f64]) -> f64 {
    if prices.len() < 2 {
        return 0.0;
    }
    let max = prices.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let min = prices.iter().cloned().fold(f64::INFINITY, f64::min);
    if min > 0.0 {
        (max - min) / min * 100.0
    } else {
        0.0
    }
}

#[inline]
fn round4(v: f64) -> f64 {
    (v * 10_000.0).round() / 10_000.0
}

// ============================================================================
// Per-group evaluate-and-fire helper
// ============================================================================

/// Evaluate a rule against a single `(base, quote)` group and fire if thresholds
/// are crossed.  Returns `true` if the alert fired.
///
/// `lock_id` is the Redis key suffix — use `rule.id` for single-ticker rules
/// and `format!("{}:{}", rule.id, group_key)` for wildcard rules so each
/// ticker gets its own cooldown.
async fn try_fire(
    rule: &AlertRule,
    base: &str,
    quote: &str,
    all_entries: &[(String, f64, f64, Option<f64>)],
    history: &PriceHistoryCache,
    state_store: &mut AlertStateStore,
    alert_tx: &broadcast::Sender<AlertFiredEvent>,
    lock_id: &str,
) -> bool {
    let volume_floor = rule.volume_floor_usd.unwrap_or(VOLUME_FLOOR_USD);
    let entries = filter_rule_entries(rule, all_entries, volume_floor);

    let quorum_min = rule.min_sources as usize;

    // Quorum check
    if entries.len() < quorum_min {
        debug!(
            "[AlertEngine] Rule {:?}: quorum not met ({}/{})",
            rule.label,
            entries.len(),
            quorum_min
        );
        return false;
    }

    // Evaluate condition
    let eval_result = evaluate_condition(rule, base, quote, &entries, history);
    let (metric_value, highest_exchange, lowest_exchange, price_high, price_low) = match eval_result
    {
        Some(r) => r,
        None => return false,
    };

    // Threshold check
    if metric_value <= rule.value {
        return false;
    }

    // Hysteresis
    if metric_value <= rule.recovery_value {
        return false;
    }

    // Cooldown lock
    let lock_acquired = state_store
        .try_acquire_lock(lock_id, rule.cooldown_secs as u64, None)
        .await;
    if !lock_acquired {
        debug!("[AlertEngine] Rule {:?} still within cooldown", rule.label);
        return false;
    }

    // Build and send event
    let now_ms = Utc::now().timestamp_millis();
    let pair_key = format!("{}:{}", base, quote);
    let event = AlertFiredEvent {
        rule_id: rule.id.clone(),
        webhook_url: rule.webhook_url.clone(),
        label: format!("{} [{}]", rule.label, pair_key),
        scope: match rule.scope {
            AlertRuleScope::MarketWatch => "market_watch".to_string(),
            AlertRuleScope::Alert => "alert".to_string(),
        },
        condition: rule.condition.clone(),
        ticker: base.to_string(),
        quote: quote.to_string(),
        exchanges: entries.iter().map(|(ex, _, _, _)| ex.to_string()).collect(),
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
    state_store
        .set_state(
            lock_id,
            &AlertState {
                status: AlertStatus::Triggered,
                triggered_at: now_ms,
                cooldown_until: now_ms + (rule.cooldown_secs as i64 * 1000),
                last_value: metric_value.to_string(),
            },
        )
        .await;

    info!(
        "[AlertEngine] FIRED rule {:?} — {}: {:.4} > threshold {:.4}",
        rule.label, pair_key, metric_value, rule.value
    );

    true
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
    base: &str,
    quote: &str,
    entries: &[(String, f64, f64, Option<f64>)],
    history: &PriceHistoryCache,
) -> Option<(
    f64,
    Option<String>,
    Option<String>,
    Option<f64>,
    Option<f64>,
)> {
    match rule.condition {
        // ── spread_pct ───────────────────────────────────────────────────
        AlertCondition::SpreadPct => {
            let min = entries
                .iter()
                .min_by(|(_, p1, _, _), (_, p2, _, _)| p1.partial_cmp(p2).unwrap())?;
            let max = entries
                .iter()
                .max_by(|(_, p1, _, _), (_, p2, _, _)| p1.partial_cmp(p2).unwrap())?;
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
            let sum: f64 = entries.iter().map(|(_, p, _, _)| *p).sum();
            let avg = sum / (entries.len() as f64);
            Some((avg, None, None, None, None))
        }

        // ── price_below ──────────────────────────────────────────────────
        AlertCondition::PriceBelow => {
            let sum: f64 = entries.iter().map(|(_, p, _, _)| *p).sum();
            let avg = sum / (entries.len() as f64);
            // For PriceBelow, the metric is -(avg) so the threshold comparison
            // `metric > rule.value` fires when avg < -rule.value.
            // We store the actual avg as price data but negate for the comparison.
            Some((-avg, None, None, None, None))
        }

        // ── change_pct_5m ────────────────────────────────────────────────
        AlertCondition::ChangePct5m => {
            // Use first matching exchange in the whitelist (or first available)
            let (exchange, current_price, _, _) = entries.first()?;
            let hist_key = PriceHistoryCache::make_key(exchange, base, quote);
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
            let (exchange, _, current_v_quote, _) = entries.first()?;
            let hist_key = PriceHistoryCache::make_key(exchange, base, quote);
            let samples = history.get_last_n(&hist_key, 300);
            if samples.is_empty() {
                return None;
            }
            let avg_v: f64 =
                samples.iter().map(|s| s.v_quote).sum::<f64>() / (samples.len() as f64);
            if avg_v <= 0.0 {
                return None;
            }
            let spike_ratio = *current_v_quote / avg_v;
            Some((spike_ratio, None, None, None, None))
        }
        // ── change_pct_24h ───────────────────────────────────────────────
        AlertCondition::ChangePct24h => {
            let with_change: Vec<(&String, f64)> = entries
                .iter()
                .filter_map(|(ex, _, _, change_24h)| change_24h.map(|v| (ex, v)))
                .collect();

            if with_change.is_empty() {
                return None;
            }

            let avg_change =
                with_change.iter().map(|(_, v)| *v).sum::<f64>() / with_change.len() as f64;

            let max = with_change
                .iter()
                .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())?;
            let min = with_change
                .iter()
                .min_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())?;

            Some((
                avg_change.abs(),
                Some(max.0.clone()),
                Some(min.0.clone()),
                Some(max.1),
                Some(min.1),
            ))
        }
    }
}
