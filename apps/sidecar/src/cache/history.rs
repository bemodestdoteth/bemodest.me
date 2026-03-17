use std::collections::{HashMap, VecDeque};
use std::sync::RwLock;
use serde::{Deserialize, Serialize};

/// A single price/volume sample stored in the history buffer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceSample {
    /// Unix timestamp in milliseconds (exchange-reported or local receipt time)
    pub timestamp_ms: i64,
    /// Close price — USD-denominated (matches LVC normalisation)
    pub price: f64,
    /// 24-h quote volume — USD-denominated
    pub v_quote: f64,
}

/// Rolling 5-minute price history buffer — one sample per second,
/// capped at 300 entries per `"exchange:BASE:QUOTE"` key.
///
/// Wraps a plain `HashMap` inside an `RwLock`. The alert engine takes
/// the full cache behind an `Arc` so reads from multiple tasks are
/// concurrent; the history sampler (single tokio task) holds the write
/// lock only for the instant needed to push one sample.
pub struct PriceHistoryCache {
    inner: RwLock<HashMap<String, VecDeque<PriceSample>>>,
}

impl PriceHistoryCache {
    /// Create an empty history cache.
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
        }
    }

    /// Build cache key — identical format to LVC: `"exchange:BASE:QUOTE"`.
    pub fn make_key(exchange: &str, base: &str, quote: &str) -> String {
        format!("{}:{}:{}", exchange, base, quote)
    }

    /// Push a new sample for the given `(exchange, base, quote)` triple.
    ///
    /// If the deque for this key already contains 300 entries the oldest
    /// entry is dropped to maintain the 5-minute window (1 sample/sec × 300).
    pub fn push(&self, exchange: &str, base: &str, quote: &str, sample: PriceSample) {
        let key = Self::make_key(exchange, base, quote);
        let mut guard = self.inner.write().unwrap();
        let deque = guard.entry(key).or_insert_with(VecDeque::new);
        if deque.len() >= 300 {
            deque.pop_front();
        }
        deque.push_back(sample);
    }

    /// Return the last `n` samples for `key`, oldest first.
    ///
    /// Returns an empty `Vec` when the key is unknown or has fewer than `n`
    /// entries — callers must handle partial results.
    pub fn get_last_n(&self, key: &str, n: usize) -> Vec<PriceSample> {
        let guard = self.inner.read().unwrap();
        match guard.get(key) {
            None => Vec::new(),
            Some(deque) => {
                let skip = deque.len().saturating_sub(n);
                deque.iter().skip(skip).cloned().collect()
            }
        }
    }

    /// Return the most recent sample for `key`, if any.
    pub fn get_latest(&self, key: &str) -> Option<PriceSample> {
        let guard = self.inner.read().unwrap();
        guard.get(key).and_then(|d| d.back().cloned())
    }

    /// Total number of tracked keys (exchange × pair combinations).
    pub fn key_count(&self) -> usize {
        self.inner.read().unwrap().len()
    }
}
