use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, warn};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::bitget::normalize_bitget_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://ws.bitget.com/v3/ws/public";
const RECONNECT_DELAY_SECONDS: u64 = 5;

/// Subscribe in batches to avoid oversized frames
const SUBSCRIBE_BATCH_SIZE: usize = 100;

/// Bitget requires a ping every 30 seconds or the server disconnects
const PING_INTERVAL_SECONDS: u64 = 25;

pub struct BitgetExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl BitgetExchange {
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
            let symbols = market_cache.get_bitget_markets().await;
            if !symbols.is_empty() {
                info!("[BitgetExchange] Market cache ready with {} symbols", symbols.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[BitgetExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }
    }
}

#[async_trait]
impl Exchange for BitgetExchange {
    async fn connect(&mut self) {
        info!("[BitgetExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[BitgetExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[BitgetExchange] Spawning connection task…");

        let market_cache = self.market_cache.clone();
        let ctx = super::base::WsSessionContext {
            source: "bitget".to_string(),
            url: TICKER_STREAM_URL.to_string(),
            verbose: self.verbose,
            reconnect_delay: Duration::from_secs(RECONNECT_DELAY_SECONDS),
            tx: self.tx.clone(),
            connected: self.connected.clone(),
            running: self.running.clone(),
            lvc: self.lvc.clone(),
            config: self.config.clone(),
            refresh_tx: None,
            ping_interval: Some(Duration::from_secs(PING_INTERVAL_SECONDS)),
            ping_text: Some("ping".to_string()),
            ping_factory: None,
            url_factory: None,
        };

        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            Self::wait_for_market_cache(&market_cache).await;
            info!("[BitgetExchange] Connection task started");

            super::base::WsSession::run_loop(
                ctx,
                move || {
                    let mc = market_cache.clone();
                    async move {
                        let symbols = mc.get_bitget_markets().await;
                        if symbols.is_empty() {
                            return None;
                        }
                        let args: Vec<Value> = symbols.iter().map(|sym| serde_json::json!({
                            "instType": "spot",
                            "topic": "ticker",
                            "symbol": sym
                        })).collect();
                        
                        let mut msgs = Vec::new();
                        for chunk in args.chunks(SUBSCRIBE_BATCH_SIZE) {
                            msgs.push(serde_json::json!({
                                "op": "subscribe",
                                "args": chunk
                            }));
                        }
                        Some(msgs)
                    }
                },
                move |text, batcher| {
                    if text.trim() == "pong" {
                        return;
                    }
                    if let Ok(raw) = serde_json::from_str::<Value>(text) {
                        if raw.get("event").is_some() {
                            return;
                        }
                        let arg = match raw.get("arg") {
                            Some(a) => a,
                            None => return,
                        };
                        let channel = arg.get("channel").or_else(|| arg.get("topic")).and_then(|v| v.as_str()).unwrap_or("");
                        if channel != "ticker" {
                            return;
                        }

                        if let Some(mut ticker) = normalize_bitget_ticker(&raw) {
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
        info!("[BitgetExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
