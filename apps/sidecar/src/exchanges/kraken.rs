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
use crate::normalizer::kraken::normalize_kraken_ticker;

use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://ws.kraken.com/v2";
const RECONNECT_DELAY_SECONDS: u64 = 5;

/// Kraken WS v2 has no aggregated ticker stream — we must subscribe per-symbol.
/// Batch subscriptions to keep individual frames well under the server's frame limit.
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

        loop {
            if verbose {
                info!("[KrakenExchange] Connecting to: {}", TICKER_STREAM_URL);
            }

            match connect_async(TICKER_STREAM_URL).await {
                Ok((ws_stream, _)) => {
                    if verbose {
                        info!("[KrakenExchange] WebSocket connected.");
                    }
                    connected.store(true, Ordering::SeqCst);

                    let status = serde_json::json!({
                        "type": "status",
                        "source": "kraken",
                        "connected": true
                    });
                    let _ = tx.send(status.to_string());

                    let (mut write, mut read) = ws_stream.split();

                    // ── Build symbol list from market cache ────────────────────
                    // Cache stores wsname format: "XBT/USD", "ETH/USD", …
                    let symbols = market_cache.get_kraken_markets().await;
                    if symbols.is_empty() {
                        warn!("[KrakenExchange] No symbols available, skipping subscription");
                        connected.store(false, Ordering::SeqCst);
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    // Send subscriptions in batches
                    for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
                        let sub_msg = serde_json::json!({
                            "method": "subscribe",
                            "params": {
                                "channel": "ticker",
                                "symbol": chunk
                            }
                        });
                        if let Err(e) = write.send(Message::Text(sub_msg.to_string().into())).await {
                            error!("[KrakenExchange] Failed to send subscription batch: {}", e);
                            break;
                        }
                    }

                    if verbose {
                        info!("[KrakenExchange] Subscribed to {} symbols via ticker channel", symbols.len());
                    }

                    // ── Message loop ───────────────────────────────────────────
                    let filter = EligibilityFilter::new(config.filter_min_sources, config.filter_min_spread_pct, config.pinlist.clone());
                    let mut batcher = TickerBatcher::new(tx.clone(), "kraken".to_string(), lvc.clone(), filter);
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
                                            // Skip non-ticker control frames (heartbeat, subscribe ack, etc.)
                                            let channel = raw.get("channel").and_then(|c| c.as_str());
                                            let msg_type = raw.get("type").and_then(|t| t.as_str());

                                            match (channel, msg_type) {
                                                (Some("heartbeat"), _) => {
                                                    trace!("[KrakenExchange] Heartbeat");
                                                    continue;
                                                }
                                                (_, Some("subscribe")) | (_, Some("error")) => {
                                                    debug!("[KrakenExchange] Control frame: {}", text);
                                                    continue;
                                                }
                                                (Some("ticker"), _) => {}
                                                _ => continue,
                                            }

                                            if let Some(normalized_list) = normalize_kraken_ticker(&raw) {
                                                for mut ticker in normalized_list {
                                                    if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                                        continue;
                                                    }
                                                    if let Some(unified) = tac.get_unified(&ticker.exchange, &ticker.base) {
                                                        ticker.base = unified;
                                                    }
                                                    trace!(
                                                        "[Kraken] Normalized: {}/{} c={}",
                                                        ticker.base, ticker.quote, ticker.c
                                                    );
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
                                    Ok(Message::Ping(payload)) => {
                                        if let Err(e) = write.send(Message::Pong(payload)).await {
                                            error!("[KrakenExchange] Failed to send pong: {}", e);
                                            break;
                                        } else {
                                            debug!("[KrakenExchange] Sent pong");
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if verbose {
                                            info!("[KrakenExchange] Connection closed. Reconnecting in {}s…", RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if verbose {
                                            error!("[KrakenExchange] WebSocket error: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
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
                        "source": "kraken",
                        "connected": false
                    });
                    let _ = tx.send(status.to_string());
                    if verbose {
                        error!("[KrakenExchange] Failed to connect: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
                    }
                }
            }

            connected.store(false, Ordering::SeqCst);
            sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
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

        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let verbose = self.verbose;
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let market_cache = self.market_cache.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            info!("[KrakenExchange] Connection task started");
            Self::connect_and_loop(tx, connected, verbose, lvc, tac, market_cache, config).await;
        });
        info!("[KrakenExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
