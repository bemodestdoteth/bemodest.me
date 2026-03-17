use papaya::HashMap;
use crate::types::{NormalizedTicker, Exchange};
use log::trace;

/// Lock-free Latest-Value Cache using Papaya
/// Stores one NormalizedTicker per (exchange, base, quote) key
#[derive(Clone)]
pub struct LatestValueCache {
    inner: HashMap<String, NormalizedTicker>,
}

impl LatestValueCache {
    pub fn new() -> Self {
        Self {
            inner: HashMap::new(),
        }
    }

    /// Build cache key: "exchange:BASE:QUOTE"
    fn make_key(exchange: &Exchange, base: &str, quote: &str) -> String {
        format!("{}:{}:{}", exchange, base, quote)
    }

    /// Insert or overwrite the latest ticker value
    pub fn upsert(&self, ticker: NormalizedTicker) {
        let key = Self::make_key(&ticker.exchange, &ticker.base, &ticker.quote);
        trace!("[LVC] upsert {}", key);
        let guard = self.inner.guard();
        self.inner.insert(key, ticker, &guard);
    }

    /// Get the latest ticker for a specific exchange + pair
    pub fn get(&self, exchange: &Exchange, base: &str, quote: &str) -> Option<NormalizedTicker> {
        let key = Self::make_key(exchange, base, quote);
        let guard = self.inner.guard();
        self.inner.get(&key, &guard).cloned()
    }

    /// Get all exchange tickers for a given base/quote pair
    pub fn get_all_for_pair(&self, base: &str, quote: &str) -> Vec<NormalizedTicker> {
        let suffix = format!(":{}:{}", base, quote);
        let guard = self.inner.guard();
        let mut results = Vec::new();
        for (key, val) in self.inner.iter(&guard) {
            let key: &String = key;
            if key.ends_with(&suffix) {
                results.push(val.clone());
            }
        }
        results
    }

    /// Get all exchange tickers for a given base asset across all quotes
    pub fn get_all_for_base(&self, base: &str) -> Vec<NormalizedTicker> {
        let guard = self.inner.guard();
        let mut results = Vec::new();
        for (_, val) in self.inner.iter(&guard) {
            let val: &NormalizedTicker = val;
            if val.base == base {
                results.push(val.clone());
            }
        }
        results
    }

    /// Return a full snapshot of all cached tickers
    pub fn snapshot(&self) -> Vec<NormalizedTicker> {
        let guard = self.inner.guard();
        self.inner.iter(&guard).map(|(_, v): (&String, &NormalizedTicker)| v.clone()).collect()
    }

    /// Number of entries in the cache
    pub fn len(&self) -> usize {
        self.inner.len()
    }
}
