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
use crate::normalizer::bybit::normalize_bybit_ticker;

use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://stream.bybit.com/v5/public/spot";
const RECONNECT_DELAY_SECONDS: u64 = 5;

/// Maximum number of topics per subscribe message.
/// Bybit docs state a maximum of 10 args are supported per request.
const SUBSCRIBE_BATCH_SIZE: usize = 10;

pub struct BybitExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl BybitExchange {
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
            let markets = market_cache.get_bybit_markets().await;
            if !markets.is_empty() {
                info!("[BybitExchange] Market cache ready with {} symbols", markets.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[BybitExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }

        loop {
            if verbose {
                info!("Connecting to Bybit WebSocket: {}", TICKER_STREAM_URL);
            }

            match connect_async(TICKER_STREAM_URL).await {
                Ok((ws_stream, _)) => {
                    if verbose {
                        info!("Bybit Spot WebSocket connected.");
                    }
                    connected.store(true, Ordering::SeqCst);

                    let status = serde_json::json!({
                        "type": "status",
                        "source": "bybit",
                        "connected": true
                    });
                    let _ = tx.send(status.to_string());

                    let (mut write, mut read) = ws_stream.split();

                    // ── Build subscription args from market cache ──────────────
                    let symbols = market_cache.get_bybit_markets().await;
                    if symbols.is_empty() {
                        warn!("[BybitExchange] No symbols available, skipping subscription");
                        connected.store(false, Ordering::SeqCst);
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    // Convert symbol list to "tickers.BTCUSDT" topic strings
                    let topics: Vec<String> = symbols
                        .iter()
                        .map(|s| format!("tickers.{}", s))
                        .collect();

                    // Send in batches to avoid oversized frames
                    for chunk in topics.chunks(SUBSCRIBE_BATCH_SIZE) {
                        let sub_msg = serde_json::json!({
                            "op": "subscribe",
                            "args": chunk
                        });
                        if let Err(e) = write.send(Message::Text(sub_msg.to_string().into())).await {
                            error!("[BybitExchange] Failed to send subscription batch: {}", e);
                            break;
                        }
                    }

                    if verbose {
                        info!("[BybitExchange] Subscribed to {} Bybit spot tickers", topics.len());
                    }

                    // ── Message loop ───────────────────────────────────────────
                    let filter = EligibilityFilter::new(config.filter_min_sources, config.filter_min_spread_pct, config.pinlist.clone());
                    let mut batcher = TickerBatcher::new(tx.clone(), "bybit".to_string(), lvc.clone(), filter);
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
                                        if let Ok(raw) = serde_json::from_str::<Value>(&text) {
                                            // Skip pong/subscribe-ack frames (they have "op" or "success")
                                            if raw.get("op").is_some() || raw.get("success").is_some() {
                                                debug!("[BybitExchange] Control frame: {}", text);
                                                continue;
                                            }
        
                                            // Normalize ticker update
                                            if let Some(mut ticker) = normalize_bybit_ticker(&raw) {
                                                if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                                    continue;
                                                }
                                                if let Some(unified) = tac.get_unified(&ticker.exchange, &ticker.base) {
                                                    ticker.base = unified;
                                                }
                                                trace!(
                                                    "[Bybit] Normalized: {}/{} c={}",
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
                                            error!("[BybitExchange] Failed to send pong: {}", e);
                                            break;
                                        } else {
                                            debug!("[BybitExchange] Sent pong");
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if verbose {
                                            info!("[BybitExchange] Connection closed. Reconnecting in {}s…", RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if verbose {
                                            error!("[BybitExchange] WebSocket error: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
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
                        "source": "bybit",
                        "connected": false
                    });
                    let _ = tx.send(status.to_string());
                    if verbose {
                        error!("[BybitExchange] Failed to connect: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
                    }
                }
            }

            connected.store(false, Ordering::SeqCst);
            sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
        }
    }
}

#[async_trait]
impl Exchange for BybitExchange {
    async fn connect(&mut self) {
        info!("[BybitExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[BybitExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[BybitExchange] Spawning connection task…");

        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let verbose = self.verbose;
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let market_cache = self.market_cache.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            info!("[BybitExchange] Connection task started");
            Self::connect_and_loop(tx, connected, verbose, lvc, tac, market_cache, config).await;
        });
        info!("[BybitExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
