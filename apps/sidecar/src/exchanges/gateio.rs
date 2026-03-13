use futures_util::{StreamExt, SinkExt};
use tokio::time::{sleep, Duration, interval};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use serde_json::Value;
use log::{info, error, debug, warn, trace};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::gateio::normalize_gateio_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;
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

    async fn connect_and_loop(
        tx: broadcast::Sender<String>,
        connected: Arc<AtomicBool>,
        verbose: bool,
        lvc: Arc<LatestValueCache>,
        tac: Arc<TokenAnnotationCache>,
        market_cache: Arc<MarketCache>,
        config: Arc<Config>,
    ) {
        // ── Wait for market cache to populate ─────────────────────────────────
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

        loop {
            if verbose {
                info!("Connecting to Gate.io WebSocket: {}", TICKER_STREAM_URL);
            }

            match connect_async(TICKER_STREAM_URL).await {
                Ok((ws_stream, _)) => {
                    if verbose {
                        info!("Gate.io Spot WebSocket connected.");
                    }
                    connected.store(true, Ordering::SeqCst);

                    let status = serde_json::json!({
                        "type": "status",
                        "source": "gateio",
                        "connected": true
                    });
                    let _ = tx.send(status.to_string());

                    let (mut write, mut read) = ws_stream.split();

                    // ── Build subscription args from market cache ──────────────
                    let currencies = market_cache.get_gateio_markets().await;
                    if currencies.is_empty() {
                        warn!("[GateExchange] No currencies available, skipping subscription");
                        connected.store(false, Ordering::SeqCst);
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    // Market cache now returns full pair IDs like "BTC_USDT"
                    let symbols: Vec<String> = currencies;

                    // Send in batches to avoid oversized frames
                    for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
                        let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
                        let sub_msg = serde_json::json!({
                            "time": time,
                            "channel": "spot.tickers",
                            "event": "subscribe",
                            "payload": chunk
                        });
                        if let Err(e) = write.send(Message::Text(sub_msg.to_string().into())).await {
                            error!("[GateExchange] Failed to send subscription batch: {}", e);
                            break;
                        }
                    }

                    if verbose {
                        info!("[GateioExchange] Subscribed to {} Gateio spot tickers", symbols.len());
                    }

                    // ── Message loop ───────────────────────────────────────────
                    let filter = EligibilityFilter::new(config.filter_min_sources, config.filter_min_spread_pct, config.pinlist.clone());
                    let mut batcher = TickerBatcher::new(tx.clone(), "gateio".to_string(), lvc.clone(), filter);
                    let mut flush_interval = interval(Duration::from_millis(config.batch_duration_ms));
                    
                    // Gate.io requires application-level ping every N seconds.
                    let mut ping_interval = interval(Duration::from_secs(5));

                    loop {
                        tokio::select! {
                            _ = ping_interval.tick() => {
                                let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
                                let ping_msg = serde_json::json!({
                                    "time": time,
                                    "channel": "spot.ping"
                                });
                                if let Err(e) = write.send(Message::Text(ping_msg.to_string().into())).await {
                                    error!("[GateioExchange] Failed to send spot.ping: {}", e);
                                    break;
                                } else {
                                    trace!("[GateioExchange] Sent spot.ping");
                                }
                            }
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
                                        if let Ok(raw) = serde_json::from_str::<Value>(&text) {
                                            // Handle server spot.pong or subscribe responses
                                            if raw.get("channel").and_then(|v| v.as_str()) == Some("spot.ping") {
                                                trace!("[GateExchange] Received spot.pong");
                                                continue;
                                            }
                                            
                                            // Only process spot.tickers updates
                                            if raw.get("channel").and_then(|v| v.as_str()) != Some("spot.tickers") 
                                                || raw.get("event").and_then(|v| v.as_str()) != Some("update") {
                                                debug!("[GateioExchange] Control/other frame: {}", text);
                                                continue;
                                            }
        
                                            // Normalize ticker update
                                            if let Some(mut ticker) = normalize_gateio_ticker(&raw) {
                                                if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                                    continue;
                                                }
                                                if let Some(unified) = tac.get_unified(&ticker.exchange, &ticker.base) {
                                                    ticker.base = unified;
                                                }
                                                trace!(
                                                    "[Gateio] Normalized: {}/{} c={}",
                                                    ticker.base, ticker.quote, ticker.c
                                                );
                                                // Broadcast normalized_ticker for tracked symbols
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
                                    Ok(Message::Ping(payload)) => {
                                        if let Err(e) = write.send(Message::Pong(payload)).await {
                                            error!("[GateExchange] Failed to send pong: {}", e);
                                            break;
                                        } else {
                                            debug!("[GateExchange] Sent pong");
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if verbose {
                                            info!("[GateioExchange] Connection closed. Reconnecting in {}s…", RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if verbose {
                                            error!("[GateioExchange] WebSocket error: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
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
                        "source": "gateio",
                        "connected": false
                    });
                    let _ = tx.send(status.to_string());
                    if verbose {
                        error!("[GateioExchange] Failed to connect: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
                    }
                }
            }

            connected.store(false, Ordering::SeqCst);
            sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
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

        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let verbose = self.verbose;
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let market_cache = self.market_cache.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            info!("[GateioExchange] Connection task started");
            Self::connect_and_loop(tx, connected, verbose, lvc, tac, market_cache, config).await;
        });
        info!("[GateioExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
