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
use uuid::Uuid;

use crate::alert::state::AlertStateStore;
use crate::alert::types::{
    AlertCondition, AlertFiredEvent, AlertRule, AlertRuntimeConfig, AlertState, AlertStatus,
    AlertType, RuntimeAlertRule, WebhookTemplate,
};
use crate::cache::{ForexCache, LatestValueCache, PriceHistoryCache, PriceSample, VisibilityPair};
use crate::config::Config;
use crate::types::{
    now_micros, AlertRuleAlertTypeRulesItemAlertType, AlertRuleAlertTypeRulesItemOperator,
    AlertRuleScope, NormalizedTicker,
};

// ============================================================================
// Constants
// ============================================================================

pub const STALE_THRESHOLD_US: i64 = 10_000_000; // 10 seconds
pub const VOLUME_FLOOR_USD: f64 = 30_000.0;
const QUORUM_MIN: usize = 2;
const ENGINE_TICK_MS: u64 = 1000;

struct ConditionEvaluation {
    value: f64,
    highest_exchange: Option<String>,
    lowest_exchange: Option<String>,
    price_high: Option<f64>,
    price_low: Option<f64>,
    premium_exchange: Option<String>,
    premium_adjustment_pct: Option<f64>,
}

struct PremiumAdjustment {
    exchange: &'static str,
    signed_adjustment_pct: f64,
}

// ============================================================================
// Rule Loader
// ============================================================================

/// Load all enabled alert rules from MongoDB `alertRules` collection.
///
/// Returns an empty Vec on any connection/query error (engine stays idle
/// rather than crashing — rules will reload on the next `alertrules_updated`
/// pub/sub event).
pub async fn load_alert_runtime_config(config: &Config) -> AlertRuntimeConfig {
    let mongo_uri = match &config.mongo_uri {
        Some(u) => u.clone(),
        None => {
            warn!("[AlertEngine] No MongoDB URI configured — alert config not loaded");
            return AlertRuntimeConfig::default();
        }
    };

    let client = match Client::with_uri_str(&mongo_uri).await {
        Ok(c) => c,
        Err(e) => {
            error!("[AlertEngine] MongoDB connect failed: {}", e);
            return AlertRuntimeConfig::default();
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
            return AlertRuntimeConfig::default();
        }
    };

    let docs: Vec<mongodb::bson::Document> = match cursor.try_collect().await {
        Ok(d) => d,
        Err(e) => {
            error!("[AlertEngine] alertRules cursor error: {}", e);
            return AlertRuntimeConfig::default();
        }
    };

    let mut rules = Vec::with_capacity(docs.len());
    for mut doc in docs {
        normalize_alert_rule_dates(&mut doc);
        match mongodb::bson::from_document::<RuntimeAlertRule>(doc) {
            Ok(rule) => rules.push(rule),
            Err(e) => warn!("[AlertEngine] Failed to deserialise alert rule: {}", e),
        }
    }

    let destination_collection = config.inner.collection_alert_destinations.as_str();
    let dest_col = db.collection::<mongodb::bson::Document>(destination_collection);
    let dest_cursor = match dest_col.find(doc! {}).await {
        Ok(c) => c,
        Err(e) => {
            error!(
                "[AlertEngine] {} query failed: {}",
                destination_collection, e
            );
            return AlertRuntimeConfig::default();
        }
    };
    let dest_docs: Vec<mongodb::bson::Document> = match dest_cursor.try_collect().await {
        Ok(d) => d,
        Err(e) => {
            error!("[AlertEngine] alertDestinations cursor error: {}", e);
            return AlertRuntimeConfig::default();
        }
    };
    let mut destinations = HashMap::with_capacity(dest_docs.len());
    for doc in dest_docs {
        match mongodb::bson::from_document::<crate::alert::types::AlertDestination>(doc) {
            Ok(destination) => {
                destinations.insert(destination.id.clone(), destination);
            }
            Err(e) => warn!(
                "[AlertEngine] Failed to deserialise alert destination: {}",
                e
            ),
        }
    }

    // Conflict detection: two rules with the same raw ticker symbol that map to
    // different canonical tokens surface a warning (plan decision Q1).
    let generated_rules = rules.iter().map(|r| r.rule.clone()).collect::<Vec<_>>();
    detect_conflicts(&generated_rules);

    info!(
        "[AlertEngine] Loaded {} alert rules and {} destinations from MongoDB",
        rules.len(),
        destinations.len()
    );
    AlertRuntimeConfig {
        rules,
        destinations,
    }
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
    forex_cache: Arc<ForexCache>,
    runtime_config: Arc<RwLock<AlertRuntimeConfig>>,
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
        let runtime_snap = {
            let guard = runtime_config.read().await;
            guard.clone()
        };
        let rules_snap = runtime_snap.rules;
        let destinations_snap = runtime_snap.destinations;

        let visibility_rule = find_market_watch_rule(&rules_snap);
        update_visibility_state(
            visibility_rule,
            &destinations_snap,
            &groups,
            &config,
            &history,
            &forex_cache,
            &mut state_store,
            &alert_tx,
            &tx,
        )
        .await;

        for runtime_rule in &rules_snap {
            let rule = &runtime_rule.rule;
            if rule.scope == AlertRuleScope::MarketWatch {
                continue;
            }
            if !rule.enabled {
                continue;
            }

            if rule.ticker == "*" {
                // ── Wildcard mode: evaluate every (base, quote) group ──────────
                for (group_key, all_entries) in &groups {
                    let (base, quote) = group_key.split_once(':').unwrap_or((group_key, ""));
                    let synthetic_id = format!("{}:{}", rule.id, group_key);
                    try_fire(
                        runtime_rule,
                        &destinations_snap,
                        base,
                        quote,
                        all_entries,
                        &history,
                        &forex_cache,
                        &mut state_store,
                        &alert_tx,
                        &config,
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
                    runtime_rule,
                    &destinations_snap,
                    &rule.ticker,
                    &rule.quote,
                    all_entries,
                    &history,
                    &forex_cache,
                    &mut state_store,
                    &alert_tx,
                    &config,
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

fn find_market_watch_rule(rules: &[RuntimeAlertRule]) -> Option<&RuntimeAlertRule> {
    let mut matches = rules
        .iter()
        .filter(|runtime_rule| runtime_rule.rule.scope == AlertRuleScope::MarketWatch);
    let first = matches.next();
    if matches.next().is_some() {
        error!("[AlertEngine] Multiple market_watch rules configured; failing visibility closed except pinned");
        return None;
    }
    match first {
        Some(runtime_rule)
            if runtime_rule.rule.ticker == "*"
                && runtime_rule.rule.condition == AlertCondition::SpreadPct =>
        {
            Some(runtime_rule)
        }
        Some(runtime_rule) => {
            error!(
                "[AlertEngine] Invalid market_watch rule {:?}; requires ticker='*', condition='spread_pct'",
                runtime_rule.rule.id
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
    runtime_rule: Option<&RuntimeAlertRule>,
    destinations: &HashMap<String, crate::alert::types::AlertDestination>,
    groups: &LiveTickerGroups,
    config: &Config,
    history: &PriceHistoryCache,
    forex_cache: &Arc<ForexCache>,
    state_store: &mut AlertStateStore,
    alert_tx: &broadcast::Sender<AlertFiredEvent>,
    tx: &broadcast::Sender<String>,
) {
    let pinlist = config.pinlist.read().unwrap().clone();
    let Some(runtime_rule) = runtime_rule else {
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

    let rule = &runtime_rule.rule;
    let mut visible_pairs = Vec::new();
    let min_sources = rule.min_sources as usize;
    let volume_floor = rule.volume_floor_usd.unwrap_or(VOLUME_FLOOR_USD);

    for (group_key, all_entries) in groups {
        let (base, quote) = group_key.split_once(':').unwrap_or((group_key, ""));
        let entries = filter_rule_entries(rule, all_entries, volume_floor);
        let pinned = pinlist.contains(base);
        let spread = evaluate_condition(rule, base, quote, &entries, history, None)
            .map(|result| result.value);
        let rule_matched =
            entries.len() >= min_sources && spread.is_some_and(|value| value > rule.value);

        if rule_matched {
            state_store
                .ensure_first_visible_at(group_key, Utc::now().timestamp_millis())
                .await;
        } else {
            state_store.clear_first_visible_at(group_key).await;
        }

        if rule_matched && rule.enabled {
            let synthetic_id = format!("{}:{}", rule.id, group_key);
            try_fire(
                runtime_rule,
                destinations,
                base,
                quote,
                all_entries,
                history,
                forex_cache,
                state_store,
                alert_tx,
                config,
                &synthetic_id,
            )
            .await;
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
        let Some(entries) = groups.get(&key) else {
            continue;
        };
        let prices = entries
            .iter()
            .map(|(_, price, _, _)| *price)
            .filter(|price| *price > 0.0)
            .collect::<Vec<_>>();
        let changes = entries
            .iter()
            .filter_map(|(_, _, _, change)| *change)
            .collect::<Vec<_>>();
        let mut entry = serde_json::json!({
            "base": pair.base,
            "quote": pair.quote,
            "spread_pct": round4(pair.spread_pct),
            "arb_pct": round4(pct_spread(&prices)),
        });
        if let Some((leader, price, volume, _)) = entries
            .iter()
            .max_by(|(_, _, a, _), (_, _, b, _)| a.partial_cmp(b).unwrap())
        {
            entry["leader"] = serde_json::json!(leader);
            entry["leader_price"] = serde_json::json!(price);
            entry["leader_volume"] = serde_json::json!(volume);
        }
        if !changes.is_empty() {
            entry["change_24h"] =
                serde_json::json!(round4(changes.iter().sum::<f64>() / changes.len() as f64));
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
// Template payload helpers
// ============================================================================

fn price_spike_payload(
    base: &str,
    quote: &str,
    entries: &[(String, f64, f64, Option<f64>)],
    history: &PriceHistoryCache,
) -> serde_json::Value {
    let low = entries
        .iter()
        .min_by(|(_, p1, _, _), (_, p2, _, _)| p1.partial_cmp(p2).unwrap());
    let high = entries
        .iter()
        .max_by(|(_, p1, _, _), (_, p2, _, _)| p1.partial_cmp(p2).unwrap());

    let (buy_exchange, buy_price) = low
        .map(|(exchange, price, _, _)| (Some(exchange.clone()), Some(*price)))
        .unwrap_or((None, None));
    let (sell_exchange, sell_price) = high
        .map(|(exchange, price, _, _)| (Some(exchange.clone()), Some(*price)))
        .unwrap_or((None, None));

    let buy_previous =
        low.and_then(|(exchange, _, _, _)| previous_price(history, exchange, base, quote, 300));
    let sell_previous =
        high.and_then(|(exchange, _, _, _)| previous_price(history, exchange, base, quote, 300));
    let start_price = sell_previous.or(buy_previous);
    let end_price = sell_price.or(buy_price);
    let from_start_pct = match (start_price, end_price) {
        (Some(start), Some(end)) if start > 0.0 => Some((end - start) / start * 100.0),
        _ => None,
    };

    serde_json::json!({
        "schema": "price_spike",
        "symbol": base,
        "quote": quote,
        "windows": [{
            "label": "5m",
            "buy": {
                "venue": buy_exchange,
                "chain": serde_json::Value::Null,
                "previous_price": buy_previous,
                "current_price": buy_price
            },
            "sell": {
                "venue": sell_exchange,
                "chain": serde_json::Value::Null,
                "previous_price": sell_previous,
                "current_price": sell_price
            },
            "contract_address": serde_json::Value::Null,
            "pool_address": serde_json::Value::Null,
            "links": {
                "cmc": serde_json::Value::Null,
                "dexscreener": serde_json::Value::Null,
                "gmgn": serde_json::Value::Null
            },
            "from_start_pct": from_start_pct,
            "price_action": [start_price, buy_price, end_price]
        }]
    })
}

fn previous_price(
    history: &PriceHistoryCache,
    exchange: &str,
    base: &str,
    quote: &str,
    samples: usize,
) -> Option<f64> {
    let hist_key = PriceHistoryCache::make_key(exchange, base, quote);
    history
        .get_last_n(&hist_key, samples)
        .first()
        .map(|sample| sample.price)
}

fn new_entry_payload(
    base: &str,
    quote: &str,
    entries: &[(String, f64, f64, Option<f64>)],
    value: f64,
    first_visible_at_ms: Option<i64>,
) -> serde_json::Value {
    let low = entries
        .iter()
        .min_by(|(_, p1, _, _), (_, p2, _, _)| p1.partial_cmp(p2).unwrap());
    let high = entries
        .iter()
        .max_by(|(_, p1, _, _), (_, p2, _, _)| p1.partial_cmp(p2).unwrap());

    serde_json::json!({
        "schema": "new_entry",
        "symbol": base,
        "quote": quote,
        "gap_pct": value,
        "gap_maintained_since_ms": first_visible_at_ms,
        "best_route": {
            "buy": route_side(low),
            "sell": route_side(high),
            "bridge": serde_json::Value::Null,
            "gap_pct": value
        },
        "price": {
            "buy": low.into_iter().map(price_row).collect::<Vec<_>>(),
            "sell": high.into_iter().map(price_row).collect::<Vec<_>>()
        },
        "routes": [{
            "from_chain": serde_json::Value::Null,
            "to_chain": serde_json::Value::Null,
            "gap_pct": value,
            "bridge": serde_json::Value::Null
        }],
        "contracts": [],
    })
}

fn route_side(entry: Option<&(String, f64, f64, Option<f64>)>) -> serde_json::Value {
    match entry {
        Some((venue, price, _, _)) => serde_json::json!({
            "venue": venue,
            "chain": serde_json::Value::Null,
            "price": price,
        }),
        None => serde_json::Value::Null,
    }
}

fn price_row((venue, price, _, _): &(String, f64, f64, Option<f64>)) -> serde_json::Value {
    serde_json::json!({
        "venue": venue,
        "price": price,
        "gap_pct": serde_json::Value::Null,
        "chain": serde_json::Value::Null,
    })
}

fn template_payload(
    template: &WebhookTemplate,
    rule: &AlertRule,
    base: &str,
    quote: &str,
    entries: &[(String, f64, f64, Option<f64>)],
    history: &PriceHistoryCache,
    value: f64,
    first_visible_at_ms: Option<i64>,
) -> Option<serde_json::Value> {
    match template {
        WebhookTemplate::PriceSpike if rule.condition == AlertCondition::ChangePct5m => {
            Some(price_spike_payload(base, quote, entries, history))
        }
        WebhookTemplate::NewEntry if rule.scope == AlertRuleScope::MarketWatch => Some(
            new_entry_payload(base, quote, entries, value, first_visible_at_ms),
        ),
        _ => None,
    }
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
    runtime_rule: &RuntimeAlertRule,
    destinations: &HashMap<String, crate::alert::types::AlertDestination>,
    base: &str,
    quote: &str,
    all_entries: &[(String, f64, f64, Option<f64>)],
    history: &PriceHistoryCache,
    forex_cache: &Arc<ForexCache>,
    state_store: &mut AlertStateStore,
    alert_tx: &broadcast::Sender<AlertFiredEvent>,
    config: &Config,
    lock_id: &str,
) -> bool {
    let rule = &runtime_rule.rule;
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
    let eval_result = evaluate_condition(rule, base, quote, &entries, history, Some(forex_cache));
    let evaluation = match eval_result {
        Some(r) => r,
        None => return false,
    };
    let metric_value = evaluation.value;

    let Some((alert_type, threshold)) = classify_alert_type(runtime_rule, metric_value) else {
        return false;
    };

    // Cooldown lock (separate by alert type, sharing rule cooldown_secs)
    let typed_lock_id = format!("{}:{}", lock_id, alert_type.as_str());
    let lock_acquired = state_store
        .try_acquire_lock(&typed_lock_id, rule.cooldown_secs as u64, None)
        .await;
    if !lock_acquired {
        debug!("[AlertEngine] Rule {:?} still within cooldown", rule.label);
        return false;
    }

    // Build and send events for active assignments supporting this alert type.
    let now_ms = Utc::now().timestamp_millis();
    let pair_key = format!("{}:{}", base, quote);
    let mut delivered_count = 0usize;
    for assignment in &rule.destination_assignments {
        if !assignment.enabled || assignment.dead {
            continue;
        }
        let Some(destination) = destinations.get(assignment.destination_id.as_str()) else {
            warn!(
                "[AlertEngine] Rule {:?} references missing destination {:?}",
                rule.id, assignment.destination_id
            );
            continue;
        };
        if !destination.enabled || !destination.alert_types.contains(&alert_type) {
            continue;
        }
        if !is_allowed_destination_url(&destination.url, config) {
            warn!(
                "[AlertEngine] Destination {:?} has disallowed URL; skipping fail-closed",
                destination.id
            );
            continue;
        }

        let webhook_template = WebhookTemplate::from_url(&destination.url);
        let first_visible_at_ms = if matches!(webhook_template, Some(WebhookTemplate::NewEntry)) {
            state_store.get_first_visible_at(&pair_key).await
        } else {
            None
        };
        let template_payload = webhook_template.as_ref().and_then(|template| {
            template_payload(
                template,
                rule,
                base,
                quote,
                &entries,
                history,
                metric_value,
                first_visible_at_ms,
            )
        });

        let event = AlertFiredEvent {
            alert_event_id: Uuid::new_v4().to_string(),
            rule_id: rule.id.clone(),
            assignment_id: assignment.destination_id.to_string(),
            destination_id: destination.id.clone(),
            destination_label: destination.label.clone(),
            destination_kind: destination.kind.clone(),
            webhook_url: destination.url.clone(),
            alert_type: alert_type.clone(),
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
            threshold,
            highest_exchange: evaluation.highest_exchange.clone(),
            lowest_exchange: evaluation.lowest_exchange.clone(),
            price_high: evaluation.price_high,
            price_low: evaluation.price_low,
            premium_exchange: evaluation.premium_exchange.clone(),
            premium_adjustment_pct: evaluation.premium_adjustment_pct,
            triggered_at: Utc::now(),
            webhook_template,
            template_payload,
        };

        if let Err(e) = alert_tx.send(event) {
            warn!("[AlertEngine] alert_tx send failed: {}", e);
        } else {
            delivered_count += 1;
        }
    }

    if delivered_count == 0 {
        return false;
    }

    // Persist state
    state_store
        .set_state(
            &typed_lock_id,
            &AlertState {
                status: AlertStatus::Triggered,
                triggered_at: now_ms,
                cooldown_until: now_ms + (rule.cooldown_secs as i64 * 1000),
                last_value: metric_value.to_string(),
            },
        )
        .await;

    info!(
        "[AlertEngine] FIRED rule {:?} ({}) — {}: {:.4} crossed threshold {:.4}",
        rule.label,
        alert_type.as_str(),
        pair_key,
        metric_value,
        threshold
    );

    true
}

fn is_allowed_destination_url(url: &str, config: &Config) -> bool {
    let Ok(parsed) = url.parse::<reqwest::Url>() else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    let is_loopback = host == "127.0.0.1" || host == "localhost";
    if is_loopback {
        return config.inner.node_env == crate::types::SystemConfigNodeEnv::Dev
            && config.alert_destination_allow_loopback_in_dev;
    }

    matches!(parsed.scheme(), "http" | "https")
        && host_matches_alert_suffix(host, &config.alert_destination_tailscale_suffix)
}

fn host_matches_alert_suffix(host: &str, suffix: &str) -> bool {
    let suffix = suffix.trim();
    if suffix.is_empty() {
        return false;
    }
    if suffix.starts_with('.') {
        return host.ends_with(suffix) && host.len() > suffix.len();
    }
    host == suffix || host.ends_with(&format!(".{suffix}"))
}

fn classify_alert_type(rule: &RuntimeAlertRule, metric_value: f64) -> Option<(AlertType, f64)> {
    let mut normal = None;
    let mut urgent = None;

    for type_rule in &rule.rule.alert_type_rules {
        let matched = match type_rule.operator {
            AlertRuleAlertTypeRulesItemOperator::Gt => metric_value > type_rule.value,
            AlertRuleAlertTypeRulesItemOperator::Gte => metric_value >= type_rule.value,
            AlertRuleAlertTypeRulesItemOperator::Lt => metric_value < type_rule.value,
            AlertRuleAlertTypeRulesItemOperator::Lte => metric_value <= type_rule.value,
        };
        if matched {
            match type_rule.alert_type {
                AlertRuleAlertTypeRulesItemAlertType::Normal => normal = Some(type_rule.value),
                AlertRuleAlertTypeRulesItemAlertType::Urgent => urgent = Some(type_rule.value),
            }
        }
    }

    urgent
        .map(|threshold| (AlertType::Urgent, threshold))
        .or_else(|| normal.map(|threshold| (AlertType::Normal, threshold)))
}

fn spread_premium_adjustment(
    high_exchange: &str,
    low_exchange: &str,
    forex_cache: &ForexCache,
) -> Option<Option<PremiumAdjustment>> {
    let high_korean = korean_premium_source(high_exchange);
    let low_korean = korean_premium_source(low_exchange);

    match (high_korean, low_korean) {
        (Some(_), Some(_)) | (None, None) => Some(None),
        (Some((exchange, getter)), None) => premium_pct(forex_cache, getter).map(|premium| {
            Some(PremiumAdjustment {
                exchange,
                signed_adjustment_pct: -premium,
            })
        }),
        (None, Some((exchange, getter))) => premium_pct(forex_cache, getter).map(|premium| {
            Some(PremiumAdjustment {
                exchange,
                signed_adjustment_pct: premium,
            })
        }),
    }
}

fn korean_premium_source(exchange: &str) -> Option<(&'static str, fn(&ForexCache) -> Option<f64>)> {
    match exchange.to_ascii_lowercase().as_str() {
        "upbit" => Some(("upbit", ForexCache::get_upbit_usdt_krw)),
        "bithumb" => Some(("bithumb", ForexCache::get_bithumb_usdt_krw)),
        _ => None,
    }
}

fn premium_pct(
    forex_cache: &ForexCache,
    usdt_krw_getter: fn(&ForexCache) -> Option<f64>,
) -> Option<f64> {
    let krw_per_usd = forex_cache.get_krw_per_usd()?;
    let usdt_krw = usdt_krw_getter(forex_cache)?;
    if krw_per_usd <= 0.0 || usdt_krw <= 0.0 {
        return None;
    }
    Some((usdt_krw - krw_per_usd) / krw_per_usd * 100.0)
}

// ============================================================================
// Condition Evaluator
// ============================================================================

/// Evaluate the rule's condition against current exchange data (and history for
/// time-based conditions).
///
/// Returns condition evaluation details or `None` if the condition cannot be evaluated.
fn evaluate_condition(
    rule: &AlertRule,
    base: &str,
    quote: &str,
    entries: &[(String, f64, f64, Option<f64>)],
    history: &PriceHistoryCache,
    forex_cache: Option<&Arc<ForexCache>>,
) -> Option<ConditionEvaluation> {
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
            let premium_adjustment = match forex_cache {
                Some(cache) => spread_premium_adjustment(&max.0, &min.0, cache)?,
                None => None,
            };
            let value = spread
                + premium_adjustment
                    .as_ref()
                    .map(|adjustment| adjustment.signed_adjustment_pct)
                    .unwrap_or(0.0);
            Some(ConditionEvaluation {
                value,
                highest_exchange: Some(max.0.clone()),
                lowest_exchange: Some(min.0.clone()),
                price_high: Some(max.1),
                price_low: Some(min.1),
                premium_exchange: premium_adjustment
                    .as_ref()
                    .map(|adjustment| adjustment.exchange.to_string()),
                premium_adjustment_pct: premium_adjustment
                    .map(|adjustment| adjustment.signed_adjustment_pct),
            })
        }

        // ── price_above ──────────────────────────────────────────────────
        AlertCondition::PriceAbove => {
            // Average price across whitelisted exchanges
            let sum: f64 = entries.iter().map(|(_, p, _, _)| *p).sum();
            let avg = sum / (entries.len() as f64);
            Some(ConditionEvaluation {
                value: avg,
                highest_exchange: None,
                lowest_exchange: None,
                price_high: None,
                price_low: None,
                premium_exchange: None,
                premium_adjustment_pct: None,
            })
        }

        // ── price_below ──────────────────────────────────────────────────
        AlertCondition::PriceBelow => {
            let sum: f64 = entries.iter().map(|(_, p, _, _)| *p).sum();
            let avg = sum / (entries.len() as f64);
            // For PriceBelow, the metric is -(avg) so the threshold comparison
            // `metric > rule.value` fires when avg < -rule.value.
            // We store the actual avg as price data but negate for the comparison.
            Some(ConditionEvaluation {
                value: -avg,
                highest_exchange: None,
                lowest_exchange: None,
                price_high: None,
                price_low: None,
                premium_exchange: None,
                premium_adjustment_pct: None,
            })
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
            Some(ConditionEvaluation {
                value: change_pct.abs(),
                highest_exchange: None,
                lowest_exchange: None,
                price_high: None,
                price_low: None,
                premium_exchange: None,
                premium_adjustment_pct: None,
            })
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
            Some(ConditionEvaluation {
                value: spike_ratio,
                highest_exchange: None,
                lowest_exchange: None,
                price_high: None,
                price_low: None,
                premium_exchange: None,
                premium_adjustment_pct: None,
            })
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

            Some(ConditionEvaluation {
                value: avg_change.abs(),
                highest_exchange: Some(max.0.clone()),
                lowest_exchange: Some(min.0.clone()),
                price_high: Some(max.1),
                price_low: Some(min.1),
                premium_exchange: None,
                premium_adjustment_pct: None,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries(high_exchange: &str, low_exchange: &str) -> Vec<(String, f64, f64, Option<f64>)> {
        vec![
            (low_exchange.to_string(), 100.0, VOLUME_FLOOR_USD, None),
            (high_exchange.to_string(), 110.0, VOLUME_FLOOR_USD, None),
        ]
    }

    fn spread_rule() -> AlertRule {
        serde_json::from_value(serde_json::json!({
            "_id": "rule-1",
            "scope": "alert",
            "condition": "spread_pct",
            "cooldown_secs": 300,
            "enabled": true,
            "exchanges": [],
            "label": "Spread",
            "minSources": 2,
            "quote": "USDT",
            "recovery_value": 0,
            "ticker": "ETH",
            "value": 1,
            "destination_assignments": [],
            "alert_type_rules": [{
                "alert_type": "normal",
                "operator": "gt",
                "value": 1
            }]
        }))
        .expect("spread rule should deserialize")
    }

    fn forex_cache() -> Arc<ForexCache> {
        let cache = ForexCache::new();
        cache.set_test_rates(1000.0, 1030.0, 1020.0);
        cache
    }

    #[test]
    fn spread_adjusts_down_when_korean_venue_is_high_side() {
        let rule = spread_rule();
        let history = PriceHistoryCache::new();
        let cache = forex_cache();
        let result = evaluate_condition(&rule, "ETH", "USDT", &entries("upbit", "binance"), &history, Some(&cache))
            .expect("spread should evaluate");

        assert!((result.value - 7.0).abs() < 0.0001);
        assert_eq!(result.premium_exchange.as_deref(), Some("upbit"));
        assert_eq!(result.premium_adjustment_pct, Some(-3.0));
    }

    #[test]
    fn spread_adjusts_up_when_korean_venue_is_low_side() {
        let rule = spread_rule();
        let history = PriceHistoryCache::new();
        let cache = forex_cache();
        let result = evaluate_condition(&rule, "ETH", "USDT", &entries("binance", "bithumb"), &history, Some(&cache))
            .expect("spread should evaluate");

        assert!((result.value - 12.0).abs() < 0.0001);
        assert_eq!(result.premium_exchange.as_deref(), Some("bithumb"));
        assert_eq!(result.premium_adjustment_pct, Some(2.0));
    }

    #[test]
    fn spread_stays_raw_when_both_or_neither_side_is_korean() {
        let rule = spread_rule();
        let history = PriceHistoryCache::new();
        let cache = forex_cache();
        let both_korean = evaluate_condition(&rule, "ETH", "USDT", &entries("upbit", "bithumb"), &history, Some(&cache))
            .expect("spread should evaluate");
        let neither_korean = evaluate_condition(&rule, "ETH", "USDT", &entries("okx", "binance"), &history, Some(&cache))
            .expect("spread should evaluate");

        assert!((both_korean.value - 10.0).abs() < 0.0001);
        assert_eq!(both_korean.premium_exchange, None);
        assert!((neither_korean.value - 10.0).abs() < 0.0001);
        assert_eq!(neither_korean.premium_exchange, None);
    }

    #[test]
    fn spread_fails_closed_when_required_premium_is_missing() {
        let rule = spread_rule();
        let history = PriceHistoryCache::new();
        let cache = ForexCache::new();
        let result = evaluate_condition(&rule, "ETH", "USDT", &entries("upbit", "binance"), &history, Some(&cache));

        assert!(result.is_none());
    }

    #[test]
    fn spread_allows_negative_adjusted_value() {
        let rule = spread_rule();
        let history = PriceHistoryCache::new();
        let cache = ForexCache::new();
        cache.set_test_rates(1000.0, 1200.0, 1000.0);
        let result = evaluate_condition(&rule, "ETH", "USDT", &entries("upbit", "binance"), &history, Some(&cache))
            .expect("spread should evaluate");

        assert!((result.value + 10.0).abs() < 0.0001);
    }
}
