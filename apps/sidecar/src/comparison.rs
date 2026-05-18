use crate::cache::lvc::LatestValueCache;
use crate::types::{now_micros, Exchange};
use log::debug;
use serde::Serialize;

/// Price entry for one exchange
#[derive(Debug, Clone, Serialize)]
pub struct ExchangePrice {
    pub exchange: Exchange,
    pub price: f64,
    pub timestamp_ms: i64,
}

/// Cross-exchange comparison for a single trading pair
#[derive(Debug, Clone, Serialize)]
pub struct TickerComparison {
    pub base: String,
    pub quote: String,
    pub entries: Vec<ExchangePrice>,
    /// Spread as a percentage: (max - min) / min * 100
    pub spread_pct: Option<f64>,
    pub highest_exchange: Option<Exchange>,
    pub lowest_exchange: Option<Exchange>,
}

/// Compare all exchange prices for a given pair
pub fn compare_pair(lvc: &LatestValueCache, base: &str, quote: &str) -> Option<TickerComparison> {
    let tickers = lvc.get_all_for_pair(base, quote);
    if tickers.is_empty() {
        return None;
    }

    // Staleness threshold: 10 seconds in microseconds (PRICE_ALERT_PLAN.md Phase 3)
    let now_us = now_micros();
    let stale_threshold_us: i64 = 10_000_000;

    let entries: Vec<ExchangePrice> = tickers
        .iter()
        .filter(|t| now_us - t.ingest_time_us < stale_threshold_us)
        .filter(|t| t.v_quote >= 30000.0)
        .map(|t| ExchangePrice {
            exchange: t.exchange,
            price: t.c,
            timestamp_ms: t.timestamp_ms,
        })
        .collect();

    if entries.len() < 2 {
        return Some(TickerComparison {
            base: base.to_string(),
            quote: quote.to_string(),
            entries,
            spread_pct: None,
            highest_exchange: None,
            lowest_exchange: None,
        });
    }

    // Find min and max
    let mut min_entry = &entries[0];
    let mut max_entry = &entries[0];
    for entry in &entries[1..] {
        if entry.price < min_entry.price {
            min_entry = entry;
        }
        if entry.price > max_entry.price {
            max_entry = entry;
        }
    }

    // Compute spread percentage: (max - min) / min * 100
    let spread_pct = if min_entry.price > 0.0 {
        Some((max_entry.price - min_entry.price) / min_entry.price * 100.0)
    } else {
        None
    };

    let highest = max_entry.exchange;
    let lowest = min_entry.exchange;

    debug!(
        "[Comparison] {}/{}: spread={:?}% high={} low={}",
        base, quote, spread_pct, highest, lowest
    );

    Some(TickerComparison {
        base: base.to_string(),
        quote: quote.to_string(),
        entries,
        spread_pct,
        highest_exchange: Some(highest),
        lowest_exchange: Some(lowest),
    })
}
