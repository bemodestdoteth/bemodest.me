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
use crate::normalizer::bybit_f::normalize_bybit_f_ticker;
use crate::types::ticker::{Exchange as ExchangeType, parse_binance_symbol};
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;
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

        loop {
            if verbose {
                info!("Connecting to Bybit Futures WebSocket: {}", TICKER_STREAM_URL);
            }

            match connect_async(TICKER_STREAM_URL).await {
                Ok((ws_stream, _)) => {
                    if verbose {
                        info!("Bybit Futures WebSocket connected.");
                    }
                    connected.store(true, Ordering::SeqCst);

                    let status = serde_json::json!({
                        "type": "status",
                        "source": "bybit_f",
                        "connected": true
                    });
                    let _ = tx.send(status.to_string());

                    let (mut write, mut read) = ws_stream.split();

                    // ── Build subscription args from market cache ──────────────
                    let symbols = market_cache.get_bybit_f_markets().await;
                    if symbols.is_empty() {
                        warn!("[BybitFExchange] No symbols available, skipping subscription");
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
                            error!("[BybitFExchange] Failed to send subscription batch: {}", e);
                            break;
                        }
                    }

                    if verbose {
                        info!("[BybitFExchange] Subscribed to {} Bybit Futures tickers", topics.len());
                    }

                    // ── Message loop ───────────────────────────────────────────
                    let mut ping_interval = tokio::time::interval(Duration::from_secs(20));
                    let filter = EligibilityFilter::new(config.filter_min_sources, config.filter_min_spread_pct, config.pinlist.clone());
                    let mut batcher = TickerBatcher::new(tx.clone(), "bybit_f".to_string(), lvc.clone(), filter);
                    let mut flush_interval = interval(Duration::from_millis(config.batch_duration_ms));

                    loop {
                        tokio::select! {
                            _ = ping_interval.tick() => {
                                let ping_msg = serde_json::json!({
                                    "req_id": "1",
                                    "op": "ping"
                                });
                                if let Err(e) = write.send(Message::Text(ping_msg.to_string().into())).await {
                                    error!("[BybitFExchange] Failed to send active ping: {}", e);
                                    break;
                                } else {
                                    debug!("[BybitFExchange] Sent active ping");
                                }
                            }
                            _ = flush_interval.tick() => {
                                batcher.flush();
                            }
                            msg_res = read.next() => {
                                match msg_res {
                                    Some(Ok(Message::Text(text))) => {
                                        if let Ok(raw) = serde_json::from_str::<Value>(&text) {
                                            // Skip pong/subscribe-ack frames (they have "op" or "success")
                                            if raw.get("op").is_some() || raw.get("success").is_some() {
                                                debug!("[BybitFExchange] Control frame: {}", text);
                                                continue;
                                            }
        
                                            // Extract existing from LVC for delta updates
                                            let existing = if let Some(topic) = raw.get("topic").and_then(|t| t.as_str()) {
                                                if let Some(symbol_str) = topic.strip_prefix("tickers.") {
                                                    if let Some((b, q)) = parse_binance_symbol(symbol_str) {
                                                        lvc.get(&ExchangeType::BybitFutures, &b, &q)
                                                    } else { None }
                                                } else { None }
                                            } else { None };
        
                                            // Normalize ticker update
                                            if let Some(mut ticker) = normalize_bybit_f_ticker(&raw, existing) {
                                                if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                                    continue;
                                                }
                                                if let Some(unified) = tac.get_unified(&ticker.exchange, &ticker.base) {
                                                    ticker.base = unified;
                                                }
                                                trace!(
                                                    "[BybitF] Normalized: {}/{} c={}",
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
                                    Some(Ok(Message::Ping(payload))) => {
                                        if let Err(e) = write.send(Message::Pong(payload)).await {
                                            error!("[BybitFExchange] Failed to send pong: {}", e);
                                            break;
                                        } else {
                                            debug!("[BybitFExchange] Sent pong");
                                        }
                                    }
                                    Some(Ok(Message::Close(_))) => {
                                        if verbose {
                                            info!("[BybitFExchange] Connection closed. Reconnecting in {}s…", RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    Some(Err(e)) => {
                                        if verbose {
                                            error!("[BybitFExchange] WebSocket error: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    None => {
                                        if verbose {
                                            info!("[BybitFExchange] Stream ended.");
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
                        "source": "bybit_f",
                        "connected": false
                    });
                    let _ = tx.send(status.to_string());
                    if verbose {
                        error!("[BybitFExchange] Failed to connect: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
                    }
                }
            }

            connected.store(false, Ordering::SeqCst);
            sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
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

        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let verbose = self.verbose;
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let market_cache = self.market_cache.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            info!("[BybitFExchange] Connection task started");
            Self::connect_and_loop(tx, connected, verbose, lvc, tac, market_cache, config).await;
        });
        info!("[BybitFExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
