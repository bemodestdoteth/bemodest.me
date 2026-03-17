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
use crate::normalizer::upbit::normalize_upbit_ticker;
use crate::types::Exchange as ExchangeType;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::ForexCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;
use crate::config::Config;
// use rust_decimal::Decimal; // Pruned by SENTINEL

const TICKER_STREAM_URL: &str = "wss://api.upbit.com/websocket/v1";
const RECONNECT_DELAY_SECONDS: u64 = 5;

// Batch subscriptions to keep individual frames well under the server's frame limit.
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub struct UpbitExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    forex: Arc<ForexCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
    refresh_tx: broadcast::Sender<()>,
}

impl UpbitExchange {
    pub fn new(tx: broadcast::Sender<String>, verbose: bool, lvc: Arc<LatestValueCache>, tac: Arc<TokenAnnotationCache>, forex: Arc<ForexCache>, market_cache: Arc<MarketCache>, config: Arc<Config>) -> Self {
        let (refresh_tx, _) = broadcast::channel(16);
        Self {
            tx,
            verbose,
            connected: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            lvc,
            tac,
            forex,
            market_cache,
            config,
            refresh_tx,
        }
    }

    async fn connect_and_loop(
        tx: broadcast::Sender<String>,
        connected: Arc<AtomicBool>,
        verbose: bool,
        lvc: Arc<LatestValueCache>,
        tac: Arc<TokenAnnotationCache>,
        forex: Arc<ForexCache>,
        market_cache: Arc<MarketCache>,
        config: Arc<Config>,
        refresh_tx: broadcast::Sender<()>,
    ) {
        // Wait for market cache to populate (poll every 500ms, max 30s)
        let mut waited = 0u64;
        loop {
            let markets = market_cache.get_upbit_markets().await;
            if !markets.is_empty() {
                info!("[UpbitExchange] Market cache ready with {} symbols", markets.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[UpbitExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }

        loop {
            if verbose {
                info!("Connecting to Upbit WebSocket: {}", TICKER_STREAM_URL);
            }

            match connect_async(TICKER_STREAM_URL).await {
                Ok((ws_stream, _)) => {
                    if verbose {
                        info!("Upbit WebSocket connected.");
                    }
                    connected.store(true, Ordering::SeqCst);

                    let status = serde_json::json!({
                        "type": "status",
                        "source": "upbit",
                        "connected": true
                    });
                    let _ = tx.send(status.to_string());

                    let (mut write, mut read) = ws_stream.split();

                    // Get dynamic symbol list from the market cache
                    let mut symbols = market_cache.get_upbit_markets().await;
                    if symbols.is_empty() {
                        warn!("[UpbitExchange] No symbols available, skipping subscription");
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    // Always subscribe to KRW-BTC to ensure we have the conversion rate for BTC pairs
                    if !symbols.contains(&"KRW-BTC".to_string()) {
                        symbols.push("KRW-BTC".to_string());
                    }

                    // Construct a single payload with chunked symbol lists
                    // Upbit format: [{"ticket":"..."}, {"type":"ticker","codes":[...]}, ..., {"format":"SIMPLE_LIST"}]
                    let ticket_id = uuid::Uuid::new_v4().to_string();
                    let mut payload_array = vec![
                        serde_json::json!({"ticket": ticket_id})
                    ];
                    
                    for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
                        payload_array.push(serde_json::json!({
                            "type": "ticker",
                            "codes": chunk
                        }));
                    }
                    
                    payload_array.push(serde_json::json!({"format": "SIMPLE_LIST"}));
                    
                    let subscription_payload = serde_json::Value::Array(payload_array);

                    if let Err(e) = write.send(Message::Text(subscription_payload.to_string().into())).await {
                        error!("Failed to send subscription to Upbit: {}", e);
                        connected.store(false, Ordering::SeqCst);
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    if verbose {
                        info!("Subscribed to {} Upbit tickers in {} batches (1 payload)", symbols.len(), symbols.chunks(SUBSCRIBE_BATCH_SIZE).count());
                    }

                    let filter = EligibilityFilter::new(config.filter_min_sources, config.filter_min_spread_pct, config.pinlist.clone());
                    let mut batcher = TickerBatcher::new(tx.clone(), "upbit".to_string(), lvc.clone(), filter);
                    let mut flush_interval = interval(Duration::from_millis(config.batch_duration_ms));

                    let mut refresh_rx = refresh_tx.subscribe();

                    loop {
                        tokio::select! {
                            _ = refresh_rx.recv() => {
                                info!("[UpbitExchange] Refreshing subscriptions...");
                                let mut symbols = market_cache.get_upbit_markets().await;
                                if !symbols.contains(&"KRW-BTC".to_string()) {
                                    symbols.push("KRW-BTC".to_string());
                                }
                                let ticket_id = uuid::Uuid::new_v4().to_string();
                                let mut payload_array = vec![serde_json::json!({"ticket": ticket_id})];
                                for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
                                    payload_array.push(serde_json::json!({"type": "ticker", "codes": chunk}));
                                }
                                payload_array.push(serde_json::json!({"format": "SIMPLE_LIST"}));
                                let subscription_payload = serde_json::Value::Array(payload_array);
                                if let Err(e) = write.send(Message::Text(subscription_payload.to_string().into())).await {
                                    error!("Failed to send subscription refresh to Upbit: {}", e);
                                    break;
                                }
                                info!("Subscribed to {} Upbit tickers (refresh)", symbols.len());
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
                                        // Parse and normalize (Upbit sends both single objects and arrays)
                                        if let Ok(raw) = serde_json::from_str::<Value>(&text) {
                                            process_upbit_tickers(&raw, &lvc, &tac, &forex, &mut batcher, &config);
                                        }
        

                                    }
                                    Ok(Message::Binary(data)) => {
                                        // Upbit sends data as binary, decode it
                                        match String::from_utf8(data.to_vec()) {
                                            Ok(text) => {
                                                // Parse and normalize (Upbit sends both single objects and arrays)
                                                if let Ok(raw) = serde_json::from_str::<Value>(&text) {
                                                    process_upbit_tickers(&raw, &lvc, &tac, &forex, &mut batcher, &config);
                                                }
        

                                            }
                                            Err(e) => {
                                                error!("Failed to decode binary message from Upbit: {}", e);
                                            }
                                        }
                                    }
                                    Ok(Message::Ping(payload)) => {
                                        if let Err(e) = write.send(Message::Pong(payload)).await {
                                            error!("Failed to send pong to Upbit: {}", e);
                                            break;
                                        } else {
                                            debug!("Sent pong to Upbit");
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if verbose {
                                            info!("Upbit WebSocket connection closed. Reconnecting in {}s...", RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if verbose {
                                            error!("An error occurred with Upbit WebSocket: {}. Reconnecting in {}s...", e, RECONNECT_DELAY_SECONDS);
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
                        "source": "upbit",
                        "connected": false
                    });
                    let _ = tx.send(status.to_string());

                    if verbose {
                        error!("Failed to connect to Upbit WebSocket: {}. Reconnecting in {}s...", e, RECONNECT_DELAY_SECONDS);
                    }
                }
            }

            connected.store(false, Ordering::SeqCst);
            sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
        }
    }
}

#[async_trait]
impl Exchange for UpbitExchange {
    async fn connect(&mut self) {
        info!("[UpbitExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[UpbitExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[UpbitExchange] Spawning connection task...");

        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let verbose = self.verbose;
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let forex = self.forex.clone();
        let market_cache = self.market_cache.clone();
        let config = self.config.clone();
        let refresh_tx = self.refresh_tx.clone();

        tokio::spawn(async move {
            info!("[UpbitExchange] Connection task started");
            Self::connect_and_loop(tx, connected, verbose, lvc, tac, forex, market_cache, config, refresh_tx).await;
        });
        info!("[UpbitExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    async fn refresh_subscriptions(&self) {
        let _ = self.refresh_tx.send(());
    }
}

/// Handle Upbit payloads that can be either a single ticker object or an array of tickers.
/// Upbit sends SNAPSHOT as a single object, and REALTIME updates as a JSON array.
fn process_upbit_tickers(raw: &Value, lvc: &LatestValueCache, tac: &TokenAnnotationCache, forex: &ForexCache, batcher: &mut TickerBatcher, config: &Config) {
    let rate = forex.get_krw_per_usd();

    // Cache the BTC/KRW price from the LVC so BTC-denominated pairs can be converted.
    // Fallback to the global forex cache if the local pair isn't in memory yet.
    let btc_krw: Option<f64> = lvc
        .get(&ExchangeType::Upbit, "BTC", "KRW")
        .and_then(|t| t.c_krw)
        .or_else(|| forex.get_btc_krw());

    if let Some(arr) = raw.as_array() {
        for item in arr {
            if let Some(mut normalized) = normalize_upbit_ticker(item, ExchangeType::Upbit, rate, btc_krw) {
                if config.excludelist.read().unwrap().iter().any(|ex| normalized.base.starts_with(ex)) {
                    continue;
                }
                if let Some(unified) = tac.get_unified(&normalized.exchange, &normalized.base) {
                    normalized.base = unified;
                }
                trace!("[Upbit] Normalized: {}/{} c={} (c_krw={:?})", normalized.base, normalized.quote, normalized.c, normalized.c_krw);
                
                let payload = serde_json::json!({
                    "type": "normalized_ticker",
                    "source": normalized.exchange.to_string(),
                    "data": &normalized
                });
                batcher.push(normalized.base.clone(), normalized.quote.clone(), payload);
                lvc.upsert(normalized);
            }
        }
    } else if let Some(mut normalized) = normalize_upbit_ticker(raw, ExchangeType::Upbit, rate, btc_krw) {
        if config.excludelist.read().unwrap().iter().any(|ex| normalized.base.contains(ex)) {
            return;
        }
        if let Some(unified) = tac.get_unified(&normalized.exchange, &normalized.base) {
            normalized.base = unified;
        }
        trace!("[Upbit] Normalized: {}/{} c={} (c_krw={:?})", normalized.base, normalized.quote, normalized.c, normalized.c_krw);
        
        let payload = serde_json::json!({
            "type": "normalized_ticker",
            "source": normalized.exchange.to_string(),
            "data": &normalized
        });
        batcher.push(normalized.base.clone(), normalized.quote.clone(), payload);
        lvc.upsert(normalized);
    }
}
