use crate::cache::lvc::LatestValueCache;
use log::trace;
use std::sync::{Arc, RwLock};
use std::collections::HashSet;

/// Gates the broadcast channel: a ticker is only eligible to be forwarded to
/// frontend clients when **both** conditions are satisfied:
///
/// 1. At least `min_sources` exchanges have a live price for the `(base, quote)` pair
///    in the Latest-Value Cache.
/// 2. The maximum cross-exchange price spread for those sources is at or above
///    `min_spread_pct` percent.
///
/// Configure via env vars `FILTER_MIN_SOURCES` (default 2) and
/// `FILTER_MIN_SPREAD_PCT` (default 10.0).
#[derive(Clone)]
pub struct EligibilityFilter {
    pub min_sources: usize,
    pub min_spread_pct: f64,
    pub pinlist: Arc<RwLock<HashSet<String>>>,
}

impl EligibilityFilter {
    pub fn new(min_sources: usize, min_spread_pct: f64, pinlist: Arc<RwLock<HashSet<String>>>) -> Self {
        Self { min_sources, min_spread_pct, pinlist }
    }

    /// Returns `true` if the ticker identified by `(base, quote)` passes the
    /// eligibility criteria based on the current state of the LVC.
    ///
    /// The LVC must already contain the latest value for the incoming ticker
    /// (i.e. `lvc.upsert()` must have been called before this check).
    pub fn is_eligible(&self, base: &str, quote: &str, lvc: &LatestValueCache) -> bool {
        if self.pinlist.read().unwrap().contains(base) {
            trace!("[EligibilityFilter] {}/{} PASS: pinned", base, quote);
            return true;
        }

        let sources = lvc.get_all_for_base(base);

        // ── Condition 1: minimum source count ──────────────────────────────
        if sources.len() < self.min_sources {
            trace!(
                "[EligibilityFilter] {}/{} rejected: {} source(s) < min {}",
                base, quote, sources.len(), self.min_sources
            );
            return false;
        }

        // ── Condition 2: minimum spread ────────────────────────────────────
        // Use the USD-normalised close price (`c`) present on every NormalizedTicker.
        // `rust_decimal::Decimal` → convert to f64 for the percentage arithmetic.
        use rust_decimal::prelude::ToPrimitive;

        let valid_sources: Vec<&crate::types::ticker::NormalizedTicker> = sources
            .iter()
            .filter(|t| {
                let p = t.c.to_f64().unwrap_or(0.0);
                let v = t.v_quote.to_f64().unwrap_or(0.0);
                p > 0.0 && v >= 30000.0
            })
            .collect();

        if valid_sources.len() < self.min_sources {
            // Fewer usable prices than required (e.g. all zero/missing or < $30k volume)
            trace!(
                "[EligibilityFilter] {}/{} rejected: fewer than {} usable sources with >= $30k volume",
                base, quote, self.min_sources
            );
            return false;
        }

        let min_source = valid_sources.iter().min_by(|a, b| a.c.cmp(&b.c)).unwrap();
        let max_source = valid_sources.iter().max_by(|a, b| a.c.cmp(&b.c)).unwrap();

        let min_price = min_source.c.to_f64().unwrap();
        let max_price = max_source.c.to_f64().unwrap();

        let spread_pct = (max_price - min_price) / min_price * 100.0;

        if spread_pct < self.min_spread_pct {
            trace!(
                "[EligibilityFilter] {}/{} rejected: spread {:.4}% < min {:.1}%",
                base, quote, spread_pct, self.min_spread_pct
            );
            return false;
        }
        
        let min_vol = min_source.v_quote.to_f64().unwrap_or(0.0);
        let max_vol = max_source.v_quote.to_f64().unwrap_or(0.0);

        trace!(
            "[EligibilityFilter] {}/{} PASS: {} valid sources, spread {:.4}%, min_vol={:.0}, max_vol={:.0}",
            base, quote, valid_sources.len(), spread_pct, min_vol, max_vol
        );
        true
    }
}
