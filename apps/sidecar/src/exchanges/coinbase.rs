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
use crate::normalizer::coinbase::normalize_coinbase_ticker;

use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://ws-feed.exchange.coinbase.com";
const RECONNECT_DELAY_SECONDS: u64 = 5;

/// Coinbase docs recommend splitting large symbol lists across multiple connections.
/// We subscribe in batches to avoid "Message too big" errors (ErrSlowRead).
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub struct CoinbaseExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl CoinbaseExchange {
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
        // Coinbase cache stores raw currency IDs ("BTC", "ETH", …).
        // We emit product_ids as "{id}-USD" — only IDs without a dash (i.e. coins, not
        // already-compound IDs) are used, replicating what the /currencies endpoint provides.
        let mut waited = 0u64;
        loop {
            let currencies = market_cache.get_coinbase_markets().await;
            if !currencies.is_empty() {
                info!("[CoinbaseExchange] Market cache ready with {} currencies", currencies.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[CoinbaseExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }

        loop {
            if verbose {
                info!("[CoinbaseExchange] Connecting to: {}", TICKER_STREAM_URL);
            }

            match connect_async(TICKER_STREAM_URL).await {
                Ok((ws_stream, _)) => {
                    if verbose {
                        info!("[CoinbaseExchange] WebSocket connected.");
                    }
                    connected.store(true, Ordering::SeqCst);

                    let status = serde_json::json!({
                        "type": "status",
                        "source": "coinbase",
                        "connected": true
                    });
                    let _ = tx.send(status.to_string());

                    let (mut write, mut read) = ws_stream.split();

                    // ── Build product_id list from market cache ────────────────
                    // The cache holds raw Coinbase currency IDs (e.g. "BTC", "ETH").
                    // Convert them to USD product_ids ("BTC-USD", "ETH-USD").
                    let currencies = market_cache.get_coinbase_markets().await;
                    if currencies.is_empty() {
                        warn!("[CoinbaseExchange] No currencies available, skipping subscription");
                        connected.store(false, Ordering::SeqCst);
                        sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
                        continue;
                    }

                    // Filter out currencies that already contain a dash (they are
                    // already product_ids rather than base currencies).
                    let product_ids: Vec<String> = currencies
                        .iter()
                        .filter(|id| !id.contains('-'))
                        .map(|id| format!("{}-USD", id))
                        .collect();

                    // Send subscriptions in batches to stay within frame size limits
                    for chunk in product_ids.chunks(SUBSCRIBE_BATCH_SIZE) {
                        let sub_msg = serde_json::json!({
                            "type": "subscribe",
                            "product_ids": chunk,
                            "channels": ["ticker_batch"]
                        });
                        if let Err(e) = write.send(Message::Text(sub_msg.to_string().into())).await {
                            error!("[CoinbaseExchange] Failed to send subscription batch: {}", e);
                            break;
                        }
                    }

                    if verbose {
                        info!("[CoinbaseExchange] Subscribed to {} product_ids via ticker_batch", product_ids.len());
                    }

                    // ── Message loop ───────────────────────────────────────────
                    let filter = EligibilityFilter::new(config.filter_min_sources, config.filter_min_spread_pct, config.pinlist.clone());
                    let mut batcher = TickerBatcher::new(tx.clone(), "coinbase".to_string(), lvc.clone(), filter);
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
                                            // Skip subscriptions/error ack frames
                                            match raw.get("type").and_then(|t| t.as_str()) {
                                                Some("subscriptions") | Some("error") => {
                                                    debug!("[CoinbaseExchange] Control frame: {}", text);
                                                    continue;
                                                }
                                                _ => {}
                                            }

                                            if let Some(mut ticker) = normalize_coinbase_ticker(&raw) {
                                                if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                                    continue;
                                                }
                                                if let Some(unified) = tac.get_unified(&ticker.exchange, &ticker.base) {
                                                    ticker.base = unified;
                                                }
                                                trace!(
                                                    "[Coinbase] Normalized: {}/{} c={}",
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
                                            error!("[CoinbaseExchange] Failed to send pong: {}", e);
                                            break;
                                        } else {
                                            debug!("[CoinbaseExchange] Sent pong");
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if verbose {
                                            info!("[CoinbaseExchange] Connection closed. Reconnecting in {}s…", RECONNECT_DELAY_SECONDS);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if verbose {
                                            error!("[CoinbaseExchange] WebSocket error: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
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
                        "source": "coinbase",
                        "connected": false
                    });
                    let _ = tx.send(status.to_string());
                    if verbose {
                        error!("[CoinbaseExchange] Failed to connect: {}. Reconnecting in {}s…", e, RECONNECT_DELAY_SECONDS);
                    }
                }
            }

            connected.store(false, Ordering::SeqCst);
            sleep(Duration::from_secs(RECONNECT_DELAY_SECONDS)).await;
        }
    }
}

#[async_trait]
impl Exchange for CoinbaseExchange {
    async fn connect(&mut self) {
        info!("[CoinbaseExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[CoinbaseExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[CoinbaseExchange] Spawning connection task…");

        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let verbose = self.verbose;
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let market_cache = self.market_cache.clone();
        let config = self.config.clone();

        tokio::spawn(async move {
            info!("[CoinbaseExchange] Connection task started");
            Self::connect_and_loop(tx, connected, verbose, lvc, tac, market_cache, config).await;
        });
        info!("[CoinbaseExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
