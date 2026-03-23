use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, warn};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::gateio::normalize_gateio_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://api.gateio.ws/ws/v4/";
const RECONNECT_DELAY_SECONDS: u64 = 5;

/// Subscribe batch size for Gateio to prevent too large payloads
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub struct GateioExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl GateioExchange {
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
            let markets = market_cache.get_gateio_markets().await;
            if !markets.is_empty() {
                info!("[GateioExchange] Market cache ready with {} currencies", markets.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[GateioExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }
    }
}

#[async_trait]
impl Exchange for GateioExchange {
    async fn connect(&mut self) {
        info!("[GateioExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[GateioExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[GateioExchange] Spawning connection task…");

        let mc = self.market_cache.clone();
        let ping_factory = Arc::new(|| {
            let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
            serde_json::json!({
                "time": time,
                "channel": "spot.ping"
            }).to_string()
        });

        let ctx = super::base::WsSessionContext {
            source: "gateio".to_string(),
            url: TICKER_STREAM_URL.to_string(),
            verbose: self.verbose,
            reconnect_delay: Duration::from_secs(RECONNECT_DELAY_SECONDS),
            tx: self.tx.clone(),
            connected: self.connected.clone(),
            running: self.running.clone(),
            lvc: self.lvc.clone(),
            config: self.config.clone(),
            refresh_tx: None,
            ping_interval: Some(Duration::from_secs(5)),
            ping_text: None,
            ping_factory: Some(ping_factory),
            url_factory: None,
        };

        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            Self::wait_for_market_cache(&mc).await;
            info!("[GateioExchange] Connection task started");

            super::base::WsSession::run_loop(
                ctx,
                move || {
                    let mc2 = mc.clone();
                    async move {
                        let symbols = mc2.get_gateio_markets().await;
                        if symbols.is_empty() {
                            return None;
                        }
                        
                        let mut msgs = Vec::new();
                        for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
                            let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
                            msgs.push(serde_json::json!({
                                "time": time,
                                "channel": "spot.tickers",
                                "event": "subscribe",
                                "payload": chunk
                            }));
                        }
                        Some(msgs)
                    }
                },
                move |text, batcher| {
                    if let Ok(raw) = serde_json::from_str::<Value>(text) {
                        if raw.get("channel").and_then(|v| v.as_str()) == Some("spot.ping") {
                            return;
                        }
                        if raw.get("channel").and_then(|v| v.as_str()) != Some("spot.tickers") 
                            || raw.get("event").and_then(|v| v.as_str()) != Some("update") {
                            return;
                        }

                        if let Some(mut ticker) = normalize_gateio_ticker(&raw) {
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
        info!("[GateioExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
