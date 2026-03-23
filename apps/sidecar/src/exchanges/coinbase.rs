use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, warn};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::coinbase::normalize_coinbase_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://ws-feed.exchange.coinbase.com";
const RECONNECT_DELAY_SECONDS: u64 = 5;

/// Subscribe in batches to avoid "Message too big" errors
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub struct CoinbaseExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl CoinbaseExchange {
    pub fn new(
        tx: broadcast::Sender<String>,
        verbose: bool,
        lvc: Arc<LatestValueCache>,
        tac: Arc<TokenAnnotationCache>,
        market_cache: Arc<MarketCache>,
        config: Arc<Config>,
    ) -> Self {
        Self {
            tx,
            verbose,
            connected: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            lvc,
            tac,
            market_cache,
            config,
        }
    }

    async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) {
        let mut waited = 0u64;
        loop {
            let currencies = market_cache.get_coinbase_markets().await;
            if !currencies.is_empty() {
                info!("[CoinbaseExchange] Market cache ready with {} currencies", currencies.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[CoinbaseExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }
    }
}

#[async_trait]
impl Exchange for CoinbaseExchange {
    async fn connect(&mut self) {
        info!("[CoinbaseExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[CoinbaseExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[CoinbaseExchange] Spawning connection task…");

        let mc = self.market_cache.clone();
        let ctx = super::base::WsSessionContext {
            source: "coinbase".to_string(),
            url: TICKER_STREAM_URL.to_string(),
            verbose: self.verbose,
            reconnect_delay: Duration::from_secs(RECONNECT_DELAY_SECONDS),
            tx: self.tx.clone(),
            connected: self.connected.clone(),
            running: self.running.clone(),
            lvc: self.lvc.clone(),
            config: self.config.clone(),
            refresh_tx: None,
            ping_interval: None,
            ping_text: None,
            ping_factory: None,
            url_factory: None,
        };

        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            Self::wait_for_market_cache(&mc).await;
            info!("[CoinbaseExchange] Connection task started");

            super::base::WsSession::run_loop(
                ctx,
                move || {
                    let mc2 = mc.clone();
                    async move {
                        let currencies = mc2.get_coinbase_markets().await;
                        if currencies.is_empty() {
                            return None;
                        }
                        let product_ids: Vec<String> = currencies
                            .iter()
                            .filter(|id| !id.contains('-'))
                            .map(|id| format!("{}-USD", id))
                            .collect();

                        let mut msgs = Vec::new();
                        for chunk in product_ids.chunks(SUBSCRIBE_BATCH_SIZE) {
                            msgs.push(serde_json::json!({
                                "type": "subscribe",
                                "product_ids": chunk,
                                "channels": ["ticker_batch"]
                            }));
                        }
                        Some(msgs)
                    }
                },
                move |text, batcher| {
                    if let Ok(raw) = serde_json::from_str::<Value>(text) {
                        match raw.get("type").and_then(|t| t.as_str()) {
                            Some("subscriptions") | Some("error") => return,
                            _ => {}
                        }

                        if let Some(mut ticker) = normalize_coinbase_ticker(&raw) {
                            if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                return;
                            }
                            ticker.base = tac.resolve_ticker_base(&ticker.exchange, &ticker.raw_base, &ticker.base);
                            let payload = serde_json::json!({
                                "type": "normalized_ticker",
                                "source": ticker.exchange.to_string(),
                                "data": &ticker
                            });
                            batcher.push(ticker.base.clone(), ticker.quote.clone(), payload);
                            lvc.upsert(ticker);
                        }
                    }
                }
            ).await;
        });
        info!("[CoinbaseExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
