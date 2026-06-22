use crate::types::NormalizedTicker;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Serialize)]
pub struct VisibilityPair {
    pub base: String,
    pub quote: String,
    pub spread_pct: f64,
    pub threshold: f64,
    pub pinned: bool,
    pub rule_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct VisibilityState {
    pairs: Vec<VisibilityPair>,
    visible_pair_keys: HashSet<String>,
    visible_bases: HashSet<String>,
    rule_valid: bool,
}

#[derive(Debug, Clone, Default)]
pub struct VisibilityCache {
    state: Arc<RwLock<VisibilityState>>,
}

impl VisibilityCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn replace(&self, pairs: Vec<VisibilityPair>, rule_valid: bool) {
        let visible_pair_keys = pairs
            .iter()
            .map(|pair| pair_key(&pair.base, &pair.quote))
            .collect();
        let visible_bases = pairs.iter().map(|pair| pair.base.clone()).collect();
        let mut guard = self.state.write().unwrap();
        *guard = VisibilityState {
            pairs,
            visible_pair_keys,
            visible_bases,
            rule_valid,
        };
    }

    pub fn is_visible(
        &self,
        base: &str,
        quote: &str,
        pinlist: &Arc<RwLock<HashSet<String>>>,
    ) -> bool {
        if pinlist.read().unwrap().contains(base) {
            return true;
        }
        let guard = self.state.read().unwrap();
        guard.rule_valid && guard.visible_pair_keys.contains(&pair_key(base, quote))
    }

    pub fn pairs(&self) -> Vec<VisibilityPair> {
        self.state.read().unwrap().pairs.clone()
    }

    pub fn filter_tickers(
        &self,
        tickers: Vec<NormalizedTicker>,
        pinlist: &Arc<RwLock<HashSet<String>>>,
    ) -> Vec<NormalizedTicker> {
        tickers
            .into_iter()
            .filter(|ticker| self.is_visible(&ticker.base, &ticker.quote, pinlist))
            .collect()
    }

    pub fn is_base_visible(&self, base: &str, pinlist: &Arc<RwLock<HashSet<String>>>) -> bool {
        if pinlist.read().unwrap().contains(base) {
            return true;
        }
        let guard = self.state.read().unwrap();
        guard.rule_valid && guard.visible_bases.contains(base)
    }
}

pub fn pair_key(base: &str, quote: &str) -> String {
    format!("{}:{}", base, quote)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_visibility_allows_different_quote_for_visible_base() {
        let cache = VisibilityCache::new();
        let pinlist = Arc::new(RwLock::new(HashSet::new()));
        cache.replace(
            vec![VisibilityPair {
                base: "B3".to_string(),
                quote: "USDT".to_string(),
                spread_pct: 1.0,
                threshold: 0.5,
                pinned: false,
                rule_id: Some("market-watch".to_string()),
            }],
            true,
        );

        assert!(!cache.is_visible("B3", "USDC", &pinlist));
        assert!(cache.is_base_visible("B3", &pinlist));
    }
}
