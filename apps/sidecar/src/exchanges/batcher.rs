use crate::config::Config;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::broadcast;

/// Per-exchange ticker batcher.
///
/// Accumulates normalized ticker payloads within each flush window, then
/// forwards only tickers that are currently visible in the shared Market Watch
/// visibility cache. Pinned symbols are visible through `Config::pinlist`.
pub struct TickerBatcher {
    tx: broadcast::Sender<String>,
    source: String,
    /// `symbol (base) → (base, quote, json_payload)`
    buffer: HashMap<String, (String, String, Value)>,
    config: Arc<Config>,
}

impl TickerBatcher {
    pub fn new(tx: broadcast::Sender<String>, source: String, config: Arc<Config>) -> Self {
        Self {
            tx,
            source,
            buffer: HashMap::new(),
            config,
        }
    }

    /// Adds (or overwrites) a ticker update in the batch.
    pub fn push(&mut self, base: String, quote: String, data: Value) {
        self.buffer.insert(base.clone(), (base, quote, data));
    }

    /// Flushes visible tickers to the broadcast channel.
    pub fn flush(&mut self) {
        if self.buffer.is_empty() {
            return;
        }

        let eligible: Vec<&Value> = self
            .buffer
            .values()
            .filter(|(base, quote, _)| {
                self.config
                    .visibility
                    .is_visible(base, quote, &self.config.pinlist)
            })
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
