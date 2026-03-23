use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, warn};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::okx_f::normalize_okx_f_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::config::Config;

const WS_URL: &str = "wss://ws.okx.com:8443/ws/v5/public";
const RECONNECT_DELAY_SECONDS: u64 = 5;
const MAX_SYMBOLS_PER_CONN: usize = 300;
const SUBSCRIBE_BATCH_SIZE: usize = 100;
const PING_INTERVAL_SECS: u64 = 25;

pub struct OkxFExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    market_cache: Arc<MarketCache>,
    config: Arc<Config>,
}

impl OkxFExchange {
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

    async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) -> Vec<String> {
        let mut waited = 0u64;
        loop {
            let markets = market_cache.get_okx_f_markets().await;
            if !markets.is_empty() {
                info!("[OkxFExchange] Market cache ready with {} symbols", markets.len());
                return markets;
            }
            if waited >= 30_000 {
                warn!("[OkxFExchange] Market cache still empty after 30s, proceeding anyway");
                return vec![];
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }
    }
}

#[async_trait]
impl Exchange for OkxFExchange {
    async fn connect(&mut self) {
        info!("[OkxFExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
            info!("[OkxFExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        let mc = self.market_cache.clone();
        let tx = self.tx.clone();
        let connected = self.connected.clone();
        let running = self.running.clone();
        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let config = self.config.clone();
        let verbose = self.verbose;

        tokio::spawn(async move {
            let symbols = Self::wait_for_market_cache(&mc).await;
            if symbols.is_empty() {
                warn!("[OkxFExchange] No symbols, connection task terminating");
                running.store(false, Ordering::SeqCst);
                return;
            }

            let total_shards = (symbols.len() + MAX_SYMBOLS_PER_CONN - 1) / MAX_SYMBOLS_PER_CONN;
            let active_shards = Arc::new(std::sync::atomic::AtomicUsize::new(0));

            for (shard_idx, chunk) in symbols.chunks(MAX_SYMBOLS_PER_CONN).enumerate() {
                let symbols_chunk = chunk.to_vec();
                let tx = tx.clone();
                let connected_main = connected.clone();
                let running = running.clone();
                let active_shards_clone = active_shards.clone();
                let lvc = lvc.clone();
                let tac = tac.clone();
                let config = config.clone();

                let shard_connected = Arc::new(AtomicBool::new(false));
                let shard_connected_monitor = shard_connected.clone();
                let total_shards_copy = total_shards;

                tokio::spawn(async move {
                    let mut prev_connected = false;
                    loop {
                        let curr_connected = shard_connected_monitor.load(Ordering::SeqCst);
                        if curr_connected && !prev_connected {
                            let newly_active = active_shards_clone.fetch_add(1, Ordering::SeqCst) + 1;
                            if newly_active == total_shards_copy {
                                connected_main.store(true, Ordering::SeqCst);
                            }
                            prev_connected = true;
                        } else if !curr_connected && prev_connected {
                            let newly_active = active_shards_clone.fetch_sub(1, Ordering::SeqCst) - 1;
                            if newly_active < total_shards_copy {
                                connected_main.store(false, Ordering::SeqCst);
                            }
                            prev_connected = false;
                        }
                        tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
                    }
                });

                tokio::spawn(async move {
                    let ctx = super::base::WsSessionContext {
                        source: format!("okx_f_shard_{}", shard_idx),
                        url: WS_URL.to_string(),
                        verbose,
                        reconnect_delay: Duration::from_secs(RECONNECT_DELAY_SECONDS),
                        tx: tx.clone(),
                        connected: shard_connected,
                        running: running.clone(),
                        lvc: lvc.clone(),
                        config: config.clone(),
                        refresh_tx: None,
                        ping_interval: Some(Duration::from_secs(PING_INTERVAL_SECS)),
                        ping_text: Some("ping".to_string()),
                        ping_factory: None,
                        url_factory: None,
                    };

                    super::base::WsSession::run_loop(
                        ctx,
                        move || {
                            let symbols = symbols_chunk.clone();
                            async move {
                                let mut msgs = Vec::new();
                                for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
                                    let args: Vec<Value> = chunk
                                        .iter()
                                        .map(|inst_id| {
                                            serde_json::json!({"channel": "tickers", "instId": inst_id})
                                        })
                                        .collect();

                                    msgs.push(serde_json::json!({
                                        "id": format!("{}", shard_idx * 1000), // simplistic unique ID
                                        "op": "subscribe",
                                        "args": args
                                    }));
                                }
                                Some(msgs)
                            }
                        },
                        move |text, batcher| {
                            if text.trim() == "pong" {
                                return;
                            }
                            if let Ok(raw) = serde_json::from_str::<Value>(text) {
                                if raw.get("event").is_some() {
                                    return;
                                }
                                if let Some(mut ticker) = normalize_okx_f_ticker(&raw) {
                                    if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                                        return;
                                    }
                                    ticker.base = tac.resolve_ticker_base(&ticker.exchange, &ticker.raw_base, &ticker.base);
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
                    ).await;
                });
            }
        });
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}
