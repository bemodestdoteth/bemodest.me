use tokio::time::Duration;
use serde_json::Value;
use log::{info, trace};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::binance::normalize_binance_ticker_array;
use crate::types::Exchange as ExchangeType;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
// use crate::exchanges::batcher::TickerBatcher; // Pruned by SENTINEL
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://fstream.binance.com/stream?streams=!miniTicker@arr";
const RECONNECT_DELAY_SECONDS: u64 = 5;

pub struct BinanceFExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    config: Arc<Config>,
}

impl BinanceFExchange {
    pub fn new(tx: broadcast::Sender<String>, verbose: bool, lvc: Arc<LatestValueCache>, tac: Arc<TokenAnnotationCache>, config: Arc<Config>) -> Self {
        Self { 
            tx, 
            verbose,
            connected: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            lvc,
            tac,
            config,
        }
    }
}

#[async_trait]
impl Exchange for BinanceFExchange {
    async fn connect(&mut self) {
        info!("[BinanceFExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[BinanceFExchange] Already running, skipping reconnect");
            return;
        }
        
        self.running.store(true, Ordering::SeqCst);
        info!("[BinanceFExchange] Spawning connection task...");

        let ctx = super::base::WsSessionContext {
            source: "binance_f".to_string(),
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

        let tac = self.tac.clone();
        let config = self.config.clone();
        let lvc = self.lvc.clone();
        let tx = self.tx.clone();

        tokio::spawn(async move {
            info!("[BinanceFExchange] Connection task started");
            super::base::WsSession::run_loop(
                ctx,
                || async { None },
                move |text, batcher| {
                    if let Ok(mut json_val) = serde_json::from_str::<Value>(text) {
                        let data_content = if let Some(inner_data) = json_val.get_mut("data") {
                            inner_data.take()
                        } else {
                            json_val.clone()
                        };

                        let normalized = normalize_binance_ticker_array(&data_content, ExchangeType::BinanceF);
                        for mut ticker in normalized {
                            if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                continue;
                            }
                            ticker.base = tac.resolve_ticker_base(&ticker.exchange, &ticker.raw_base, &ticker.base);
                            trace!("[BinanceF] Normalized: {}/{} c={}", ticker.base, ticker.quote, ticker.c);
                            let payload = serde_json::json!({
                                "type": "normalized_ticker",
                                "source": ticker.exchange.to_string(),
                                "data": &ticker
                            });
                            batcher.push(ticker.base.clone(), ticker.quote.clone(), payload);
                            lvc.upsert(ticker);
                        }

                        let wrapped = serde_json::json!({
                            "type": "ticker",
                            "source": "binance_f",
                            "data": data_content
                        });
                        let _ = tx.send(wrapped.to_string());
                    }
                }
            ).await;
        });
        info!("[BinanceFExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
