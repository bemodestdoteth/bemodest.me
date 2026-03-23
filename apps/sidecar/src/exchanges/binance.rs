use tokio::time::Duration;
use log::info;
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::binance::normalize_binance_ticker_array;
use crate::types::Exchange as ExchangeType;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://stream.binance.com:9443/ws/!miniTicker@arr";
const RECONNECT_DELAY_SECONDS: u64 = 5;

pub struct BinanceExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    config: Arc<Config>,
}

impl BinanceExchange {
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

    fn handle_message(
        text: &str,
        batcher: &mut TickerBatcher,
        tac: &Arc<TokenAnnotationCache>,
        config: &Arc<Config>,
        lvc: &Arc<LatestValueCache>,
    ) {
        if let Ok(raw) = serde_json::from_str::<serde_json::Value>(text) {
            let usdt_only: serde_json::Value = match raw.as_array() {
                Some(arr) => serde_json::Value::Array(
                    arr.iter()
                        .filter(|item| {
                            item.get("s")
                                .and_then(|s| s.as_str())
                                .map(|s| s.ends_with("USDT"))
                                .unwrap_or(false)
                        })
                        .cloned()
                        .collect()
                ),
                None => raw,
            };

            let normalized = normalize_binance_ticker_array(&usdt_only, ExchangeType::Binance);

            for mut ticker in normalized {
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

#[async_trait]
impl Exchange for BinanceExchange {
    async fn connect(&mut self) {
        info!("[BinanceExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[BinanceExchange] Already running, skipping reconnect");
            return;
        }
        
        self.running.store(true, Ordering::SeqCst);
        info!("[BinanceExchange] Spawning connection task...");

        let ctx = super::base::WsSessionContext {
            source: "binance".to_string(),
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

        tokio::spawn(async move {
            super::base::WsSession::run_loop(
                ctx,
                || async { None },
                move |text, batcher| {
                    Self::handle_message(text, batcher, &tac, &config, &lvc);
                }
            ).await;
        });
        info!("[BinanceExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
