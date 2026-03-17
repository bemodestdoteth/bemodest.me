use futures_util::{StreamExt, SinkExt};
use tokio::time::{sleep, Duration, interval};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use serde_json::Value;
use log::{info, error, debug, trace};
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
use crate::cache::EligibilityFilter;
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

    async fn connect_and_loop(
        tx: broadcast::Sender<String>, 
        connected: Arc<AtomicBool>,
        verbose: bool,
        lvc: Arc<LatestValueCache>,
        tac: Arc<TokenAnnotationCache>,
        config: Arc<Config>,
    ) {
        loop {
            if verbose {
                info!("Connecting to Binance Futures WebSocket: {}", TICKER_STREAM_URL);
            }
            
            match connect_async(TICKER_STREAM_URL).await {
                Ok((ws_stream, _)) => {
                    if verbose {
                        info!("Binance Futures WebSocket connected.");
                    }
                    connected.store(true, Ordering::SeqCst);

                    let status = serde_json::json!({
                        "type": "status",
                        "source": "binance_f",
                        "connected": true
                    });
                    let _ = tx.send(status.to_string());

                    let (mut write, mut read) = ws_stream.split();
                    
                    let filter = EligibilityFilter::new(config.filter_min_sources, config.filter_min_spread_pct, config.pinlist.clone());
                    let mut batcher = TickerBatcher::new(tx.clone(), "binance_f".to_string(), lvc.clone(), filter);
                    let mut flush_interval = interval(Duration::from_millis(config.batch_duration_ms));

                    loop {
                        tokio::select! {
                            _ = flush_interval.tick() => {
                                batcher.flush();
                            }
                            msg_res = read.next() => {
                                let msg_res = match msg_res {
                                    Some(m) => m,
                                    None => break,
                                };
                                match msg_res {
                                    Ok(Message::Text(text)) => {
                                        // Parse the Combined Stream payload to extract 'data'
                                        let parsed: Result<Value, _> = serde_json::from_str(&text);
                                        let data_content = match parsed {
                                            Ok(mut json_val) => {
                                                // If it has "data", use that. Otherwise use the whole thing.
                                                if let Some(inner_data) = json_val.get_mut("data") {
                                                    inner_data.take()
                                                } else {
                                                    json_val
                                                }
                                            },
                                            Err(_) => Value::Null,
                                        };
        
                                        // Normalize and upsert to LVC
                                        let normalized = normalize_binance_ticker_array(&data_content, ExchangeType::BinanceF);
                                        for mut ticker in normalized {
                                            if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                                continue;
                                            }
                                            if let Some(unified) = tac.get_unified(&ticker.exchange, &ticker.base) {
                                                ticker.base = unified;
                                            }
                                            trace!("[BinanceF] Normalized: {}/{} c={}", ticker.base, ticker.quote, ticker.c);
                                            // Broadcast normalized_ticker for tracked symbols
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
                                    Ok(Message::Ping(payload)) => {
                                        if let Err(e) = write.send(Message::Pong(payload)).await {
                                            error!("Failed to send pong to Binance Futures: {}", e);
                                            break;
                                        } else {
                                            debug!("Sent pong to Binance Futures");
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if verbose {
                                            info!("Binance Futures WebSocket connection closed. Reconnecting in {}s...", RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if verbose {
                                            error!("An error occurred with Binance Futures WebSocket: {}. Reconnecting in {}s...", e, RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    let status = serde_json::json!({
                        "type": "status",
                        "source": "binance_f",
                        "connected": false
                    });
                    let _ = tx.send(status.to_string());

                    if verbose {
                        error!("Failed to connect to Binance Futures WebSocket: {}. Reconnecting in {}s...", e, RECONNECT_DELAY_SECONDS);
                    }
                }
            }
            
            connected.store(false, Ordering::SeqCst);
            sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
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

        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let verbose = self.verbose;
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            info!("[BinanceFExchange] Connection task started");
            Self::connect_and_loop(tx, connected, verbose, lvc, tac, config).await;
        });
        info!("[BinanceFExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
