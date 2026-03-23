use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, warn};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::kraken::normalize_kraken_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://ws.kraken.com/v2";
const RECONNECT_DELAY_SECONDS: u64 = 5;

/// Kraken WS v2 has no aggregated ticker stream — we must subscribe per-symbol.
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub struct KrakenExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl KrakenExchange {
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
            let symbols = market_cache.get_kraken_markets().await;
            if !symbols.is_empty() {
                info!("[KrakenExchange] Market cache ready with {} symbols", symbols.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[KrakenExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }
    }
}

#[async_trait]
impl Exchange for KrakenExchange {
    async fn connect(&mut self) {
        info!("[KrakenExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[KrakenExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[KrakenExchange] Spawning connection task…");

        let mc = self.market_cache.clone();
        let ctx = super::base::WsSessionContext {
            source: "kraken".to_string(),
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
            info!("[KrakenExchange] Connection task started");

            super::base::WsSession::run_loop(
                ctx,
                move || {
                    let mc2 = mc.clone();
                    async move {
                        let symbols = mc2.get_kraken_markets().await;
                        if symbols.is_empty() {
                            return None;
                        }
                        let mut msgs = Vec::new();
                        for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
                            msgs.push(serde_json::json!({
                                "method": "subscribe",
                                "params": {
                                    "channel": "ticker",
                                    "symbol": chunk
                                }
                            }));
                        }
                        Some(msgs)
                    }
                },
                move |text, batcher| {
                    if let Ok(raw) = serde_json::from_str::<Value>(text) {
                        let channel = raw.get("channel").and_then(|c| c.as_str());
                        let msg_type = raw.get("type").and_then(|t| t.as_str());

                        match (channel, msg_type) {
                            (Some("heartbeat"), _) => return,
                            (_, Some("subscribe")) | (_, Some("error")) => return,
                            (Some("ticker"), _) => {}
                            _ => return,
                        }

                        if let Some(normalized_list) = normalize_kraken_ticker(&raw) {
                            for mut ticker in normalized_list {
                                if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                    continue;
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
                }
            ).await;
        });
        info!("[KrakenExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
