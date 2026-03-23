use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, warn};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::bybit_f::normalize_bybit_f_ticker;
use crate::types::{Exchange as ExchangeType, parse_binance_symbol};
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://stream.bybit.com/v5/public/linear";
const RECONNECT_DELAY_SECONDS: u64 = 5;

/// Maximum number of topics per subscribe message.
/// Bybit docs state a maximum of 10 args are supported per request.
const SUBSCRIBE_BATCH_SIZE: usize = 10;

pub struct BybitFExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl BybitFExchange {
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
            let markets = market_cache.get_bybit_f_markets().await;
            if !markets.is_empty() {
                info!("[BybitFExchange] Market cache ready with {} symbols", markets.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[BybitFExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }
    }
}

#[async_trait]
impl Exchange for BybitFExchange {
    async fn connect(&mut self) {
        info!("[BybitFExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[BybitFExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[BybitFExchange] Spawning connection task…");

        let market_cache = self.market_cache.clone();
        let ping_msg = serde_json::json!({
            "req_id": "1",
            "op": "ping"
        }).to_string();

        let ctx = super::base::WsSessionContext {
            source: "bybit_f".to_string(),
            url: TICKER_STREAM_URL.to_string(),
            verbose: self.verbose,
            reconnect_delay: Duration::from_secs(RECONNECT_DELAY_SECONDS),
            tx: self.tx.clone(),
            connected: self.connected.clone(),
            running: self.running.clone(),
            lvc: self.lvc.clone(),
            config: self.config.clone(),
            refresh_tx: None,
            ping_interval: Some(Duration::from_secs(20)),
            ping_text: Some(ping_msg),
            ping_factory: None,
            url_factory: None,
        };

        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            Self::wait_for_market_cache(&market_cache).await;
            info!("[BybitFExchange] Connection task started");

            super::base::WsSession::run_loop(
                ctx,
                move || {
                    let mc = market_cache.clone();
                    async move {
                        let symbols = mc.get_bybit_f_markets().await;
                        if symbols.is_empty() {
                            return None;
                        }
                        let topics: Vec<String> = symbols.iter().map(|s| format!("tickers.{}", s)).collect();
                        
                        let mut msgs = Vec::new();
                        for chunk in topics.chunks(SUBSCRIBE_BATCH_SIZE) {
                            msgs.push(serde_json::json!({
                                "op": "subscribe",
                                "args": chunk
                            }));
                        }
                        Some(msgs)
                    }
                },
                move |text, batcher| {
                    if let Ok(raw) = serde_json::from_str::<Value>(text) {
                        if raw.get("op").is_some() || raw.get("success").is_some() {
                            return;
                        }

                        let existing = if let Some(topic) = raw.get("topic").and_then(|t| t.as_str()) {
                            if let Some(symbol_str) = topic.strip_prefix("tickers.") {
                                if let Some((b, q)) = parse_binance_symbol(symbol_str) {
                                    lvc.get(&ExchangeType::BybitF, &b, &q)
                                } else { None }
                            } else { None }
                        } else { None };

                        if let Some(mut ticker) = normalize_bybit_f_ticker(&raw, existing) {
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
        info!("[BybitFExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
