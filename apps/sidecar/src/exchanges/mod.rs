use async_trait::async_trait;
use std::collections::HashMap;

const SHARDED_EXCHANGES: &[&str] = &["kucoin", "okx", "okx_f"];

pub mod binance;
pub mod binance_f;
pub mod bitget;
pub mod bitget_f;
pub mod bithumb;
pub mod bybit;
pub mod bybit_f;
pub mod coinbase;
pub mod gateio;
pub mod geckoterminal;
pub mod generic;
pub mod hyperliquid_f;
pub mod kraken;
pub mod kucoin;
pub mod okx;
pub mod okx_f;
pub mod upbit;

#[async_trait]
pub trait Exchange: Send + Sync {
    async fn connect(&mut self);
    fn is_connected(&self) -> bool;
    /// Signal the exchange to refresh its WebSocket subscriptions based on the latest market cache/pinlist.
    async fn refresh_subscriptions(&self) {}
}

pub struct ExchangeManager {
    exchanges: HashMap<String, Box<dyn Exchange>>,
}

impl ExchangeManager {
    pub fn new() -> Self {
        Self {
            exchanges: HashMap::new(),
        }
    }

    pub fn register(&mut self, name: &str, exchange: Box<dyn Exchange>) {
        self.exchanges.insert(name.to_string(), exchange);
    }

    pub fn unregister(&mut self, name: &str) {
        self.exchanges.remove(name);
    }

    pub async fn ensure_connected(&mut self, name: &str) {
        log::info!("[ExchangeManager] ensure_connected called for: {}", name);
        if let Some(exchange) = self.exchanges.get_mut(name) {
            let is_conn = exchange.is_connected();
            log::info!("[ExchangeManager] {} is_connected: {}", name, is_conn);
            if !is_conn {
                log::info!("[ExchangeManager] Calling connect() for {}", name);
                exchange.connect().await;
            }
            return;
        }

        let shard_names = self.get_shard_names_for(name);
        if !shard_names.is_empty() {
            for shard_name in shard_names {
                if let Some(exchange) = self.exchanges.get_mut(&shard_name) {
                    let is_conn = exchange.is_connected();
                    log::info!("[ExchangeManager] {} is_connected: {}", shard_name, is_conn);
                    if !is_conn {
                        log::info!("[ExchangeManager] Calling connect() for {}", shard_name);
                        exchange.connect().await;
                    }
                }
            }
            return;
        }

        if SHARDED_EXCHANGES.contains(&name) {
            log::info!(
                "[ExchangeManager] Sharded exchange '{}' pending shard registration",
                name
            );
            return;
        }

        log::warn!("[ExchangeManager] Exchange '{}' not found", name);
    }

    pub fn is_connected(&self, name: &str) -> bool {
        if let Some(exchange) = self.exchanges.get(name) {
            exchange.is_connected()
        } else {
            // Check if it's a sharded exchange
            let shards = self.get_shards_for(name);
            if !shards.is_empty() {
                return shards.iter().any(|&ex| ex.is_connected());
            }
            false
        }
    }

    pub fn get_shard_stats(&self, base_name: &str) -> Option<(usize, usize)> {
        let shards = self.get_shards_for(base_name);
        if shards.is_empty() {
            return None;
        }
        let total = shards.len();
        let connected = shards.iter().filter(|&&ex| ex.is_connected()).count();
        Some((connected, total))
    }

    fn get_shards_for(&self, base_name: &str) -> Vec<&Box<dyn Exchange>> {
        let prefix = format!("{}_shard_", base_name);
        self.exchanges
            .iter()
            .filter(|(name, _)| name.starts_with(&prefix))
            .map(|(_, ex)| ex)
            .collect()
    }

    fn get_shard_names_for(&self, base_name: &str) -> Vec<String> {
        let prefix = format!("{}_shard_", base_name);
        self.exchanges
            .keys()
            .filter(|name| name.starts_with(&prefix))
            .cloned()
            .collect()
    }

    pub async fn refresh_all_subscriptions(&self) {
        log::info!("[ExchangeManager] refreshing subscriptions for all exchanges");
        for (name, exchange) in &self.exchanges {
            log::info!(
                "[ExchangeManager] refreshing {} (connected={})",
                name,
                exchange.is_connected()
            );
            exchange.refresh_subscriptions().await;
        }
    }
}
pub mod base;
pub mod batcher;
