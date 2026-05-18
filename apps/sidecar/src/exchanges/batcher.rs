use crate::cache::eligibility::EligibilityFilter;
use crate::cache::lvc::LatestValueCache;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Per-exchange ticker batcher.
///
/// Accumulates normalized ticker payloads within each flush window, then
/// applies the `EligibilityFilter` at flush time — only tickers that pass
/// both the minimum-source-count and minimum-spread-pct checks are forwarded
/// to the broadcast channel.
pub struct TickerBatcher {
    tx: broadcast::Sender<String>,
    source: String,
    /// `symbol (base) → (base, quote, json_payload)`
    buffer: HashMap<String, (String, String, Value)>,
    lvc: Arc<LatestValueCache>,
    filter: EligibilityFilter,
}

impl TickerBatcher {
    pub fn new(
        tx: broadcast::Sender<String>,
        source: String,
        lvc: Arc<LatestValueCache>,
        filter: EligibilityFilter,
    ) -> Self {
        Self {
            tx,
            source,
            buffer: HashMap::new(),
            lvc,
            filter,
        }
    }

    /// Adds (or overwrites) a ticker update in the batch.
    ///
    /// `base` and `quote` are needed at flush time to query the LVC for the
    /// spread/source check.
    pub fn push(&mut self, base: String, quote: String, data: Value) {
        self.buffer.insert(base.clone(), (base, quote, data));
    }

    /// Flushes eligible tickers to the broadcast channel.
    ///
    /// The filter is evaluated here — after the full batch window — so that
    /// prices from all exchanges that arrived during that window are already
    /// in the LVC, giving the spread calculation maximum accuracy.
    pub fn flush(&mut self) {
        if self.buffer.is_empty() {
            return;
        }

        let eligible: Vec<&Value> = self
            .buffer
            .values()
            .filter(|(base, quote, _)| self.filter.is_eligible(base, quote, &self.lvc))
            .map(|(_, _, payload)| payload)
            .collect();

        if !eligible.is_empty() {
            if let Ok(json) = serde_json::to_string(&serde_json::json!({
                "type": "batch",
                "source": self.source,
                "data": eligible
            })) {
                let _ = self.tx.send(json);
            }
        }

        self.buffer.clear();
    }
}
