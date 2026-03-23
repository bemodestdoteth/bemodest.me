use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, error, warn};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use async_trait::async_trait;
use super::Exchange;
use crate::normalizer::kucoin::normalize_kucoin_ticker;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::MarketCache;
use crate::config::Config;

const BULLET_PUBLIC_URL: &str = "https://api.kucoin.com/api/v1/bullet-public";
const RECONNECT_DELAY_SECONDS: u64 = 5;

// KuCoin limits: max 100 topics per message, max 300 topics per connection
const MAX_SYMBOLS_PER_CONN: usize = 300;
const SUBSCRIBE_BATCH_SIZE: usize = 100;
const DEFAULT_PING_INTERVAL_MS: u64 = 18000;

pub struct KucoinExchange {
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
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

    async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) -> Vec<String> {
        let mut waited = 0u64;
        loop {
            let markets = market_cache.get_kucoin_markets().await;
            if !markets.is_empty() {
                info!("[KucoinExchange] Market cache ready with {} symbols", markets.len());
                return markets;
            }
            if waited >= 30_000 {
                warn!("[KucoinExchange] Market cache still empty after 30s, proceeding anyway");
                return vec![];
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }
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
                warn!("[KucoinExchange] No symbols, connection task terminating");
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
                    let url_factory = Arc::new(move || {
                        Box::pin(async move {
                            match Self::get_ws_token().await {
                                Some((endpoint, token, _)) => {
                                    let connect_id = uuid::Uuid::new_v4().to_string().replace('-', "");
                                    Some(format!("{}?token={}&connectId={}", endpoint, token, connect_id))
                                }
                                None => None,
                            }
                        }) as super::base::FutString
                    });

                    let ctx = super::base::WsSessionContext {
                        source: format!("kucoin_shard_{}", shard_idx),
                        url: "".to_string(), // Set via factory
                        verbose,
                        reconnect_delay: Duration::from_secs(RECONNECT_DELAY_SECONDS),
                        tx: tx.clone(),
                        connected: shard_connected,
                        running: running.clone(),
                        lvc: lvc.clone(),
                        config: config.clone(),
                        refresh_tx: None,
                        ping_interval: Some(Duration::from_millis(DEFAULT_PING_INTERVAL_MS)),
                        ping_text: None,
                        ping_factory: Some(Arc::new(|| {
                            let ping_id = uuid::Uuid::new_v4().to_string().replace('-', "");
                            serde_json::json!({
                                "id": ping_id,
                                "type": "ping"
                            }).to_string()
                        })),
                        url_factory: Some(url_factory),
                    };

                    super::base::WsSession::run_loop(
                        ctx,
                        move || {
                            let symbols = symbols_chunk.clone();
                            async move {
                                let mut msgs = Vec::new();
                                for chunk in symbols.chunks(SUBSCRIBE_BATCH_SIZE) {
                                    let topic = format!("/market/ticker:{}", chunk.join(","));
                                    let sub_id = uuid::Uuid::new_v4().to_string().replace('-', "");
                                    msgs.push(serde_json::json!({
                                        "id": sub_id,
                                        "type": "subscribe",
                                        "topic": topic,
                                        "privateChannel": false,
                                        "response": true
                                    }));
                                }
                                Some(msgs)
                            }
                        },
                        move |text, batcher| {
                            if let Ok(raw) = serde_json::from_str::<Value>(text) {
                                let msg_type = raw.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                if msg_type == "message" {
                                    if let Some(mut ticker) = normalize_kucoin_ticker(&raw) {
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
                            } else {
                                warn!("[KucoinExchange] Received non-JSON message: {}", text);
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
