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
use crate::normalizer::bitget::normalize_bitget_f_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://ws.bitget.com/v3/ws/public";
const RECONNECT_DELAY_SECONDS: u64 = 5;

/// Subscribe in batches to avoid oversized frames
const SUBSCRIBE_BATCH_SIZE: usize = 100;

/// Bitget requires a ping every 30 seconds or the server disconnects
const PING_INTERVAL_SECONDS: u64 = 25;

pub struct BitgetFExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl BitgetFExchange {
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
            let symbols = market_cache.get_bitget_f_markets().await;
            if !symbols.is_empty() {
                info!("[BitgetFExchange] Market cache ready with {} base coins", symbols.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[BitgetFExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }

        loop {
            if verbose {
                info!("[BitgetFExchange] Connecting to: {}", TICKER_STREAM_URL);
            }

            match connect_async(TICKER_STREAM_URL).await {
                Ok((ws_stream, _)) => {
                    if verbose {
                        info!("[BitgetFExchange] WebSocket connected.");
                    }
                    connected.store(true, Ordering::SeqCst);

                    let status = serde_json::json!({
                        "type": "status",
                        "source": "bitget_f",
                        "connected": true
                    });
                    let _ = tx.send(status.to_string());

                    let (mut write, mut read) = ws_stream.split();

                    // ── Build subscription payloads from market cache ──────────
                    let base_coins = market_cache.get_bitget_f_markets().await;
                    if base_coins.is_empty() {
                        warn!("[BitgetFExchange] No symbols available, skipping subscription");
                        connected.store(false, Ordering::SeqCst);
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    // Build args: [{"instType":"usdt-futures","topic":"ticker","symbol":"BTCUSDT"}, ...]
                    let args: Vec<Value> = base_coins
                        .iter()
                        .map(|base| serde_json::json!({
                            "instType": "usdt-futures",
                            "topic": "ticker",
                            "symbol": format!("{}USDT", base)
                        }))
                        .collect();

                    // Send in batches
                    for chunk in args.chunks(SUBSCRIBE_BATCH_SIZE) {
                        let sub_msg = serde_json::json!({
                            "op": "subscribe",
                            "args": chunk
                        });
                        if let Err(e) = write.send(Message::Text(sub_msg.to_string().into())).await {
                            error!("[BitgetFExchange] Failed to send subscription batch: {}", e);
                            break;
                        }
                    }

                    if verbose {
                        info!("[BitgetFExchange] Subscribed to {} Bitget Futures USDT tickers", base_coins.len());
                    }

                    // ── Message loop ───────────────────────────────────────────
                    let filter = EligibilityFilter::new(config.filter_min_sources, config.filter_min_spread_pct, config.pinlist.clone());
                    let mut batcher = TickerBatcher::new(tx.clone(), "bitget_f".to_string(), lvc.clone(), filter);
                    let mut flush_interval = interval(Duration::from_millis(config.batch_duration_ms));
                    let mut ping_interval = interval(Duration::from_secs(PING_INTERVAL_SECONDS));

                    loop {
                        tokio::select! {
                            _ = ping_interval.tick() => {
                                // Bitget ping: send literal string "ping"
                                if let Err(e) = write.send(Message::Text("ping".into())).await {
                                    error!("[BitgetFExchange] Failed to send ping: {}", e);
                                    break;
                                } else {
                                    trace!("[BitgetFExchange] Sent ping");
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
                                        // Handle server-level pong
                                        if text.trim() == "pong" {
                                            trace!("[BitgetFExchange] Received pong");
                                            continue;
                                        }

                                        if let Ok(raw) = serde_json::from_str::<Value>(&text) {
                                            // Log subscribe confirmations and errors
                                            if let Some(event) = raw.get("event").and_then(|v| v.as_str()) {
                                                if event == "error" {
                                                    error!("[BitgetFExchange] Server error: {}", text);
                                                } else {
                                                    debug!("[BitgetFExchange] Control frame event={}: {}", event, text);
                                                }
                                                continue;
                                            }

                                            // Only process ticker data frames
                                            let arg = match raw.get("arg") {
                                                Some(a) => a,
                                                None => {
                                                    debug!("[BitgetFExchange] No 'arg' field: {}", text);
                                                    continue;
                                                }
                                            };
                                            let channel = arg.get("channel").or_else(|| arg.get("topic")).and_then(|v| v.as_str()).unwrap_or("");
                                            if channel != "ticker" {
                                                debug!("[BitgetFExchange] Ignoring non-ticker topic: {}", channel);
                                                continue;
                                            }

                                            // Normalize
                                            if let Some(mut ticker) = normalize_bitget_f_ticker(&raw) {
                                                if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                                    continue;
                                                }
                                                if let Some(unified) = tac.get_unified(&ticker.exchange, &ticker.base) {
                                                    ticker.base = unified;
                                                }
                                                trace!(
                                                    "[BitgetF] Normalized: {}/{} c={}",
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
                                    Ok(Message::Ping(payload)) => {
                                        if let Err(e) = write.send(Message::Pong(payload)).await {
                                            error!("[BitgetFExchange] Failed to send pong: {}", e);
                                            break;
                                        } else {
                                            debug!("[BitgetFExchange] Sent pong");
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if verbose {
                                            info!("[BitgetFExchange] Connection closed. Reconnecting in {}s…", RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if verbose {
                                            error!("[BitgetFExchange] WebSocket error: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
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
                        "source": "bitget_f",
                        "connected": false
                    });
                    let _ = tx.send(status.to_string());
                    if verbose {
                        error!("[BitgetFExchange] Failed to connect: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
                    }
                }
            }

            connected.store(false, Ordering::SeqCst);
            sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
        }
    }
}

#[async_trait]
impl Exchange for BitgetFExchange {
    async fn connect(&mut self) {
        info!("[BitgetFExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[BitgetFExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[BitgetFExchange] Spawning connection task…");

        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let verbose = self.verbose;
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let market_cache = self.market_cache.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            info!("[BitgetFExchange] Connection task started");
            Self::connect_and_loop(tx, connected, verbose, lvc, tac, market_cache, config).await;
        });
        info!("[BitgetFExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
