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
use crate::normalizer::okx::normalize_okx_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;
use crate::config::Config;

/// OKX public WebSocket endpoint (Business stream — also supports `tickers`)
const WS_URL: &str = "wss://ws.okx.com:8443/ws/v5/public";

const RECONNECT_DELAY_SECONDS: u64 = 5;

/// OKX allows up to 480 subscribe/unsubscribe/login ops per hour per connection.
/// To be safe we cap args per subscribe message at 100 and symbols per connection at 300.
const MAX_SYMBOLS_PER_CONN: usize = 300;
const SUBSCRIBE_BATCH_SIZE: usize = 100;

/// Send a ping string every 25 seconds (server drops the connection after 30 s of silence).
const PING_INTERVAL_SECS: u64 = 25;

pub struct OkxExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl OkxExchange {
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

    /// One connection shard — connects, subscribes to `symbols_chunk`, then pumps messages.
    async fn run_shard(
        shard_idx: usize,
        total_shards: usize,
        symbols_chunk: Vec<String>,
        tx: broadcast::Sender<String>,
        connected: Arc<AtomicBool>,
        active_shards: Arc<std::sync::atomic::AtomicUsize>,
        verbose: bool,
        lvc: Arc<LatestValueCache>,
        tac: Arc<TokenAnnotationCache>,
        config: Arc<Config>,
    ) {
        loop {
            if verbose {
                info!("[OkxExchange] [Shard {}] Connecting ({} symbols)", shard_idx, symbols_chunk.len());
            }

            let ws_url_parsed = match WS_URL.parse::<tokio_tungstenite::tungstenite::http::Uri>() {
                Ok(u) => u,
                Err(e) => {
                    error!("[OkxExchange] [Shard {}] Invalid WS URL: {}", shard_idx, e);
                    sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                    continue;
                }
            };

            match connect_async(ws_url_parsed).await {
                Ok((ws_stream, _)) => {
                    let (mut write, mut read) = ws_stream.split();

                    // Mark connected and broadcast shard_status
                    connected.store(true, Ordering::SeqCst);
                    let current_active = active_shards.fetch_add(1, Ordering::SeqCst) + 1;
                    
                    let status = serde_json::json!({
                        "type": "shard_status",
                        "source": "okx",
                        "connected": current_active,
                        "total": total_shards
                    });
                    let _ = tx.send(status.to_string());

                    // Subscribe in batches of SUBSCRIBE_BATCH_SIZE args per message
                    let mut sub_ok = true;
                    for (batch_idx, chunk) in symbols_chunk.chunks(SUBSCRIBE_BATCH_SIZE).enumerate() {
                        let args: Vec<Value> = chunk
                            .iter()
                            .map(|inst_id| serde_json::json!({"channel": "tickers", "instId": inst_id}))
                            .collect();
                        let sub_msg = serde_json::json!({
                            "id": format!("{}", shard_idx * 1000 + batch_idx),
                            "op": "subscribe",
                            "args": args
                        });
                        if let Err(e) = write.send(Message::Text(sub_msg.to_string().into())).await {
                            error!("[OkxExchange] [Shard {}] Failed to send sub batch {}: {}", shard_idx, batch_idx, e);
                            sub_ok = false;
                            break;
                        }
                        // Small delay between batches to be polite
                        sleep(Duration::from_millis(150)).await;
                    }

                    if !sub_ok {
                        connected.store(false, Ordering::SeqCst);
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    if verbose {
                        info!("[OkxExchange] [Shard {}] Subscribed to {} tickers", shard_idx, symbols_chunk.len());
                    }

                    let filter = EligibilityFilter::new(
                        config.filter_min_sources,
                        config.filter_min_spread_pct,
                        config.pinlist.clone(),
                    );
                    let mut batcher = TickerBatcher::new(
                        tx.clone(),
                        "okx".to_string(),
                        lvc.clone(),
                        filter,
                    );
                    let mut flush_interval = interval(Duration::from_millis(config.batch_duration_ms));
                    let mut ping_interval = interval(Duration::from_secs(PING_INTERVAL_SECS));
                    ping_interval.tick().await; // consume the immediate first tick

                    loop {
                        tokio::select! {
                            _ = ping_interval.tick() => {
                                // OKX expects the literal string "ping"
                                if let Err(e) = write.send(Message::Text("ping".into())).await {
                                    error!("[OkxExchange] [Shard {}] Failed to send ping: {}", shard_idx, e);
                                    break;
                                } else {
                                    trace!("[OkxExchange] [Shard {}] Sent ping", shard_idx);
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
                                        // OKX heartbeat response
                                        if text.trim() == "pong" {
                                            trace!("[OkxExchange] [Shard {}] Received pong", shard_idx);
                                            continue;
                                        }

                                        if let Ok(raw) = serde_json::from_str::<Value>(&text) {
                                            // Handle event messages (subscribe ack, error, etc.)
                                            if let Some(event) = raw.get("event").and_then(|v| v.as_str()) {
                                                match event {
                                                    "subscribe" => debug!("[OkxExchange] [Shard {}] Subscribe ack", shard_idx),
                                                    "error" => {
                                                        let code = raw.get("code").and_then(|v| v.as_str()).unwrap_or("?");
                                                        let msg  = raw.get("msg").and_then(|v| v.as_str()).unwrap_or("?");
                                                        error!("[OkxExchange] [Shard {}] Server error {}: {}", shard_idx, code, msg);
                                                    }
                                                    _ => debug!("[OkxExchange] [Shard {}] Unhandled event '{}'", shard_idx, event),
                                                }
                                                continue;
                                            }

                                            // Ticker push
                                            if let Some(mut ticker) = normalize_okx_ticker(&raw) {
                                                if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                                    continue;
                                                }
                                                if let Some(unified) = tac.get_unified(&ticker.exchange, &ticker.base) {
                                                    ticker.base = unified;
                                                }
                                                trace!(
                                                    "[OKX] Normalized: {}/{} c={}",
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
                                            error!("[OkxExchange] [Shard {}] Failed to send pong: {}", shard_idx, e);
                                            break;
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if verbose {
                                            info!("[OkxExchange] [Shard {}] Connection closed by server.", shard_idx);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if verbose {
                                            error!("[OkxExchange] [Shard {}] WebSocket error: {}", shard_idx, e);
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
                    let current_active = {
                        let prev = active_shards.load(Ordering::SeqCst);
                        if prev > 0 {
                            active_shards.fetch_sub(1, Ordering::SeqCst) - 1
                        } else {
                            0
                        }
                    };
                    
                    let status = serde_json::json!({
                        "type": "shard_status",
                        "source": "okx",
                        "connected": current_active,
                        "total": total_shards
                    });
                    let _ = tx.send(status.to_string());
                    if verbose {
                        error!("[OkxExchange] [Shard {}] Failed to connect: {}. Reconnecting in {}s…", shard_idx, e, RECONNECT_DELAY_SECONDS);
                    }
                }
            }

            // Decrement active_shards if we were previously connected
            let current_active = {
                let prev = active_shards.load(Ordering::SeqCst);
                if prev > 0 {
                    active_shards.fetch_sub(1, Ordering::SeqCst) - 1
                } else {
                    0
                }
            };
            
            let status = serde_json::json!({
                "type": "shard_status",
                "source": "okx",
                "connected": current_active,
                "total": total_shards
            });
            let _ = tx.send(status.to_string());
            
            if shard_idx == 0 {
                connected.store(false, Ordering::SeqCst);
            }
            sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
        }
    }

    async fn manager_loop(
        tx: broadcast::Sender<String>,
        connected: Arc<AtomicBool>,
        verbose: bool,
        lvc: Arc<LatestValueCache>,
        tac: Arc<TokenAnnotationCache>,
        market_cache: Arc<MarketCache>,
        config: Arc<Config>,
    ) {
        // Wait for the OKX market cache to be populated
        let mut waited = 0u64;
        loop {
            let markets = market_cache.get_okx_markets().await;
            if !markets.is_empty() {
                info!("[OkxExchange] Market cache ready with {} symbols", markets.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[OkxExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }

        let symbols = market_cache.get_okx_markets().await;
        if symbols.is_empty() {
            warn!("[OkxExchange] No symbols available to subscribe to.");
            return;
        }

        // Distribute symbols across shards
        let total_shards = (symbols.len() + MAX_SYMBOLS_PER_CONN - 1) / MAX_SYMBOLS_PER_CONN;
        let active_shards = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let mut shard_idx = 0;
        
        for chunk in symbols.chunks(MAX_SYMBOLS_PER_CONN) {
            let chunk_vec = chunk.to_vec();
            let c_tx = tx.clone();
            let c_conn = connected.clone();
            let c_active = active_shards.clone();
            let c_verb = verbose;
            let c_lvc = lvc.clone();
            let c_tac = tac.clone();
            let c_cf = config.clone();

            tokio::spawn(async move {
                Self::run_shard(shard_idx, total_shards, chunk_vec, c_tx, c_conn, c_active, c_verb, c_lvc, c_tac, c_cf).await;
            });
            shard_idx += 1;
        }
        info!("[OkxExchange] Distributed {} symbols across {} shards", symbols.len(), total_shards);
    }
}

#[async_trait]
impl Exchange for OkxExchange {
    async fn connect(&mut self) {
        info!("[OkxExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[OkxExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);

        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let verbose = self.verbose;
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let market_cache = self.market_cache.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            info!("[OkxExchange] Manager task started");
            Self::manager_loop(tx, connected, verbose, lvc, tac, market_cache, config).await;
        });
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
