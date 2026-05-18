use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::time::{interval, Duration};
use log::{debug, info};

use crate::alert::engine::group_live_tickers;
use crate::cache::LatestValueCache;
use crate::types::now_micros;

const SUMMARY_TICK_MS: u64 = 500;

/// Market summary broadcast task.
///
/// Runs every 500 ms. Snapshots the LVC, groups tickers by (base, quote),
/// computes per-pair spread_pct, arb_pct, leader, and 24h change, then
/// broadcasts `{ type: "market_summary", data: [...] }` over the main
/// broadcast channel so connected WS clients can render at ≤2 Hz instead
/// of re-rendering on every raw normalized_ticker (~50 Hz).
pub async fn run(lvc: Arc<LatestValueCache>, tx: broadcast::Sender<String>) {
    let mut tick = interval(Duration::from_millis(SUMMARY_TICK_MS));
    info!("[MarketSummary] Task started ({}ms tick)", SUMMARY_TICK_MS);

    loop {
        tick.tick().await;

        let snapshot = lvc.snapshot();
        let now_us = now_micros();
        let groups = group_live_tickers(&snapshot, now_us);

        if groups.is_empty() {
            continue;
        }

        let mut data: Vec<serde_json::Value> = Vec::with_capacity(groups.len());

        for (pair_key, entries) in &groups {
            let (base, quote) = pair_key.split_once(':').unwrap_or((pair_key.as_str(), ""));

            // ── Spot-only prices for spread_pct (excludes all _f / _futures) ─
            let spot_prices: Vec<f64> = entries
                .iter()
                .filter(|(ex, _, _, _)| {
                    let lower = ex.to_lowercase();
                    !lower.ends_with("_f") && !lower.ends_with("_futures")
                })
                .map(|(_, p, _, _)| *p)
                .filter(|p| *p > 0.0)
                .collect();

            let spread_pct = pct_spread(&spot_prices);

            // ── All-source prices for arb_pct (futures included) ─────────────
            let all_prices: Vec<f64> = entries
                .iter()
                .map(|(_, p, _, _)| *p)
                .filter(|p| *p > 0.0)
                .collect();

            let arb_pct = pct_spread(&all_prices);

            // ── Leader: max volume, exclude _f / upbit / bithumb / dex ───────
            let leader = entries
                .iter()
                .filter(|(ex, _, _, _)| {
                    let lower = ex.to_lowercase();
                    !lower.ends_with("_f")
                        && lower != "upbit"
                        && lower != "bithumb"
                        && !lower.starts_with("dex_")
                })
                .max_by(|(_, _, v1, _), (_, _, v2, _)| {
                    v1.partial_cmp(v2).unwrap_or(std::cmp::Ordering::Equal)
                });

            // ── Average 24h change ────────────────────────────────────────────
            let changes: Vec<f64> = entries.iter().filter_map(|(_, _, _, c)| *c).collect();
            let change_24h: Option<f64> = if changes.is_empty() {
                None
            } else {
                Some(changes.iter().sum::<f64>() / changes.len() as f64)
            };

            let mut entry = serde_json::json!({
                "base": base,
                "quote": quote,
                "spread_pct": round4(spread_pct),
                "arb_pct": round4(arb_pct),
            });

            if let Some((name, price, vol, _)) = leader {
                entry["leader"] = serde_json::json!(name);
                entry["leader_price"] = serde_json::json!(price);
                entry["leader_volume"] = serde_json::json!(vol);
            }
            if let Some(chg) = change_24h {
                entry["change_24h"] = serde_json::json!(round4(chg));
            }

            data.push(entry);
        }

        let msg = serde_json::json!({ "type": "market_summary", "data": data });
        let _ = tx.send(msg.to_string());
        debug!("[MarketSummary] Broadcast {} pairs", data.len());
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
