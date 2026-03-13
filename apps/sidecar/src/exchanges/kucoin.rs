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
use crate::normalizer::kucoin::normalize_kucoin_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;
use crate::config::Config;

const BULLET_PUBLIC_URL: &str = "https://api.kucoin.com/api/v1/bullet-public";
const RECONNECT_DELAY_SECONDS: u64 = 5;

// KuCoin limits: max 100 topics per message, max 300 topics per connection
// We chunk the entire universe into connections of 300 symbols max.
// Within each connection, we send subscribe messages in batches of 100 max.
const MAX_SYMBOLS_PER_CONN: usize = 300;
const SUBSCRIBE_BATCH_SIZE: usize = 100;

const DEFAULT_PING_INTERVAL_MS: u64 = 18000;

pub struct KucoinExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>, // true if AT LEAST ONE shard is connected
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl KucoinExchange {
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

    /// POST /api/v1/bullet-public → returns (ws_endpoint, token, ping_interval_ms)
    async fn get_ws_token() -> Option<(String, String, u64)> {
        let client = reqwest::Client::new();
        let res = client
            .post(BULLET_PUBLIC_URL)
            .header("Content-Length", "0")
            .send()
            .await
            .ok()?;
        let json: Value = res.json().await.ok()?;
        if json["code"].as_str() != Some("200000") {
            error!("[KucoinExchange] bullet-public returned bad code: {}", json["code"]);
            return None;
        }
        let data = json.get("data")?;
        let token = data.get("token")?.as_str()?.to_string();
        let servers = data.get("instanceServers")?.as_array()?;
        let server = servers.first()?;
        let endpoint = server.get("endpoint")?.as_str()?.to_string();
        let ping_ms = server.get("pingInterval")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_PING_INTERVAL_MS);
        Some((endpoint, token, ping_ms))
    }

    /// Shard single connection loop
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
            // Get token individually for each connection shard
            let (endpoint, token, ping_interval_ms) = match Self::get_ws_token().await {
                Some(v) => v,
                None => {
                    error!("[KucoinExchange] [Shard {}] Failed to get WS token, retrying in {}s", shard_idx, RECONNECT_DELAY_SECONDS);
                    sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                    continue;
                }
            };

            let connect_id = uuid::Uuid::new_v4().to_string().replace('-', "");
            let ws_url = format!("{}?token={}&connectId={}", endpoint, token, connect_id);

            if verbose {
                info!("[KucoinExchange] [Shard {}] Connecting ({} symbols)", shard_idx, symbols_chunk.len());
            }

            let ws_url_parsed = match ws_url.parse::<tokio_tungstenite::tungstenite::http::Uri>() {
                Ok(u) => u,
                Err(e) => {
                    error!("[KucoinExchange] [Shard {}] Invalid WS URL: {}", shard_idx, e);
                    sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                    continue;
                }
            };

            match connect_async(ws_url_parsed).await {
                Ok((ws_stream, _)) => {
                    let (mut write, mut read) = ws_stream.split();

                    // Wait for welcome
                    let welcomed = if let Some(Ok(Message::Text(txt))) = read.next().await {
                        if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                            v["type"].as_str() == Some("welcome")
                        } else {
                            false
                        }
                    } else {
                        false
                    };

                    if !welcomed {
                        warn!("[KucoinExchange] [Shard {}] Did not receive welcome message", shard_idx);
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    let current_active = active_shards.fetch_add(1, Ordering::SeqCst) + 1;
                    connected.store(true, Ordering::SeqCst);
                    
                    let status = serde_json::json!({
                        "type": "shard_status",
                        "source": "kucoin",
                        "connected": current_active,
                        "total": total_shards
                    });
                    let _ = tx.send(status.to_string());

                    // Subscribe logic 
                    let mut sub_ok = true;
                    // Chunk this shard's assigned symbols by the message max size (100)
                    for (batch_idx, chunk) in symbols_chunk.chunks(SUBSCRIBE_BATCH_SIZE).enumerate() {
                        let topic = format!("/market/ticker:{}", chunk.join(","));
                        let sub_id = uuid::Uuid::new_v4().to_string().replace('-', "");
                        let sub_msg = serde_json::json!({
                            "id": sub_id,
                            "type": "subscribe",
                            "topic": topic,
                            "privateChannel": false,
                            "response": true
                        });
                        if let Err(e) = write.send(Message::Text(sub_msg.to_string().into())).await {
                            error!("[KucoinExchange] [Shard {}] Failed to send subscription batch {}: {}", shard_idx, batch_idx, e);
                            sub_ok = false;
                            break;
                        }
                        sleep(Duration::from_millis(150)).await;
                    }

                    if !sub_ok {
                        connected.store(false, Ordering::SeqCst);
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    if verbose {
                        info!("[KucoinExchange] [Shard {}] Subscribed to {} tickers", shard_idx, symbols_chunk.len());
                    }

                    let filter = EligibilityFilter::new(
                        config.filter_min_sources,
                        config.filter_min_spread_pct,
                        config.pinlist.clone(),
                    );
                    let mut batcher = TickerBatcher::new(
                        tx.clone(),
                        "kucoin".to_string(),
                        lvc.clone(),
                        filter,
                    );
                    let mut flush_interval = interval(Duration::from_millis(config.batch_duration_ms));
                    let mut ping_interval = interval(Duration::from_millis(ping_interval_ms));
                    ping_interval.tick().await; // skip first immediate tick

                    loop {
                        tokio::select! {
                            _ = ping_interval.tick() => {
                                let ping_id = uuid::Uuid::new_v4().to_string().replace('-', "");
                                let ping_msg = serde_json::json!({
                                    "id": ping_id,
                                    "type": "ping"
                                });
                                if let Err(e) = write.send(Message::Text(ping_msg.to_string().into())).await {
                                    error!("[KucoinExchange] [Shard {}] Failed to send ping: {}", shard_idx, e);
                                    break;
                                } else {
                                    trace!("[KucoinExchange] [Shard {}] Sent ping", shard_idx);
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
                                            let msg_type = raw.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                            match msg_type {
                                                "pong" => {
                                                    trace!("[KucoinExchange] [Shard {}] Received pong", shard_idx);
                                                }
                                                "ack" => {
                                                    debug!("[KucoinExchange] [Shard {}] Subscribe ack", shard_idx);
                                                }
                                                "message" => {
                                                    if let Some(mut ticker) = normalize_kucoin_ticker(&raw) {
                                                        if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                                            continue;
                                                        }
                                                        if let Some(unified) = tac.get_unified(&ticker.exchange, &ticker.base) {
                                                            ticker.base = unified;
                                                        }
                                                        trace!(
                                                            "[KuCoin] Normalized: {}/{} c={}",
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
                                                "error" => {
                                                    error!("[KucoinExchange] [Shard {}] Server error: {}", shard_idx, raw);
                                                }
                                                _ => {
                                                    debug!("[KucoinExchange] [Shard {}] Unhandled msg type '{}'", shard_idx, msg_type);
                                                }
                                            }
                                        }
                                    }
                                    Ok(Message::Ping(payload)) => {
                                        if let Err(e) = write.send(Message::Pong(payload)).await {
                                            error!("[KucoinExchange] [Shard {}] Failed to send pong: {}", shard_idx, e);
                                            break;
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if verbose {
                                            info!("[KucoinExchange] [Shard {}] Connection closed by server.", shard_idx);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if verbose {
                                            error!("[KucoinExchange] [Shard {}] WebSocket error: {}", shard_idx, e);
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
                        "source": "kucoin",
                        "connected": current_active,
                        "total": total_shards
                    });
                    let _ = tx.send(status.to_string());
                    if verbose {
                        error!("[KucoinExchange] [Shard {}] Failed to connect: {}. Reconnecting in {}s…", shard_idx, e, RECONNECT_DELAY_SECONDS);
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
                "source": "kucoin",
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
        // Wait for market cache to populate
        let mut waited = 0u64;
        loop {
            let markets = market_cache.get_kucoin_markets().await;
            if !markets.is_empty() {
                info!("[KucoinExchange] Market cache ready with {} symbols", markets.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[KucoinExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }

        let symbols = market_cache.get_kucoin_markets().await;
        if symbols.is_empty() {
            warn!("[KucoinExchange] No symbols available to subscribe to.");
            return;
        }

        // Chunk symbols into separate connection shards
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
        info!("[KucoinExchange] Distributed {} symbols across {} shards", symbols.len(), total_shards);
    }
}

#[async_trait]
impl Exchange for KucoinExchange {
    async fn connect(&mut self) {
        info!("[KucoinExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[KucoinExchange] Already running, skipping reconnect");
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
            info!("[KucoinExchange] Manager task started");
            Self::manager_loop(tx, connected, verbose, lvc, tac, market_cache, config).await;
        });
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
