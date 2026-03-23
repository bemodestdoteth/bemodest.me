use tokio::time::{sleep, Duration};
use serde_json::Value;
use log::{info, warn};
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
use crate::config::Config;

const TICKER_STREAM_URL: &str = "wss://ws-api.bithumb.com/websocket/v1";
const RECONNECT_DELAY_SECONDS: u64 = 5;

// Batch subscriptions to keep individual frames well under the server's frame limit.
const SUBSCRIBE_BATCH_SIZE: usize = 100;

pub struct BithumbExchange {
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

impl BithumbExchange {
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

    async fn wait_for_market_cache(market_cache: &Arc<MarketCache>) {
        let mut waited = 0u64;
        loop {
            let markets = market_cache.get_bithumb_markets().await;
            if !markets.is_empty() {
                info!("[BithumbExchange] Market cache ready with {} symbols", markets.len());
                break;
            }
            if waited >= 30_000 {
                warn!("[BithumbExchange] Market cache still empty after 30s, proceeding anyway");
                break;
            }
            sleep(Duration::from_millis(500)).await;
            waited += 500;
        }
    }
}

#[async_trait]
impl Exchange for BithumbExchange {
    async fn connect(&mut self) {
        info!("[BithumbExchange] connect() called");
        if self.running.load(Ordering::SeqCst) {
             info!("[BithumbExchange] Already running, skipping reconnect");
            return;
        }

        self.running.store(true, Ordering::SeqCst);
        info!("[BithumbExchange] Spawning connection task...");

        let market_cache = self.market_cache.clone();
        let ctx = super::base::WsSessionContext {
            source: "bithumb".to_string(),
            url: TICKER_STREAM_URL.to_string(),
            verbose: self.verbose,
            reconnect_delay: Duration::from_secs(RECONNECT_DELAY_SECONDS),
            tx: self.tx.clone(),
            connected: self.connected.clone(),
            running: self.running.clone(),
            lvc: self.lvc.clone(),
            config: self.config.clone(),
            refresh_tx: Some(self.refresh_tx.clone()),
            ping_interval: None,
            ping_text: None,
            ping_factory: None,
            url_factory: None,
        };

        let lvc = self.lvc.clone();
        let tac = self.tac.clone();
        let config = self.config.clone();
        let forex = self.forex.clone();

        tokio::spawn(async move {
            Self::wait_for_market_cache(&market_cache).await;
            info!("[BithumbExchange] Connection task started");

            super::base::WsSession::run_loop(
                ctx,
                move || {
                    let mc = market_cache.clone();
                    async move {
                        let mut symbols = mc.get_bithumb_markets().await;
                        if symbols.is_empty() {
                            return None;
                        }
                        if !symbols.contains(&"KRW-BTC".to_string()) {
                            symbols.push("KRW-BTC".to_string());
                        }

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
                        
                        payload_array.push(serde_json::json!({"format": "SIMPLE"}));
                        
                        // Bithumb expects the payload as one large message containing multiple objects in an array structure
                        // Wait! Bithumb/Upbit WebSocket protocols usually expect ONE message that IS an array of JSON objects.
                        // My WsSession's subscription_factory returns Vec<Value> which are sent as INDIVIDUAL messages.
                        // I'll wrap it in a Vec with one element.
                        Some(vec![serde_json::Value::Array(payload_array)])
                    }
                },
                move |text, batcher| {
                    if let Ok(raw) = serde_json::from_str::<Value>(text) {
                        process_bithumb_tickers(&raw, &lvc, &tac, &forex, batcher, &config);
                    }
                }
            ).await;
        });
        info!("[BithumbExchange] Task spawned successfully");
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    async fn refresh_subscriptions(&self) {
        let _ = self.refresh_tx.send(());
    }
}

fn process_bithumb_tickers(raw: &Value, lvc: &LatestValueCache, tac: &TokenAnnotationCache, forex: &ForexCache, batcher: &mut crate::exchanges::batcher::TickerBatcher, config: &Config) {
    let rate = forex.get_krw_per_usd();

    let btc_krw: Option<f64> = lvc
        .get(&ExchangeType::Bithumb, "BTC", "KRW")
        .and_then(|t| t.c_krw)
        .or_else(|| forex.get_btc_krw());

    if let Some(arr) = raw.as_array() {
        for item in arr {
            if let Some(mut normalized) = normalize_upbit_ticker(item, ExchangeType::Bithumb, rate, btc_krw) {
                if config.excludelist.read().unwrap().iter().any(|ex| normalized.base.starts_with(ex)) {
                    continue;
                }
                if let Some(unified) = tac.get_unified(&normalized.exchange, &normalized.base) {
                    normalized.base = unified;
                }
                let payload = serde_json::json!({
                    "type": "normalized_ticker",
                    "source": normalized.exchange.to_string(),
                    "data": &normalized
                });
                batcher.push(normalized.base.clone(), normalized.quote.clone(), payload);
                lvc.upsert(normalized);
            }
        }
    } else if let Some(mut normalized) = normalize_upbit_ticker(raw, ExchangeType::Bithumb, rate, btc_krw) {
        if config.excludelist.read().unwrap().iter().any(|ex| normalized.base.contains(ex)) {
            return;
        }
        if let Some(unified) = tac.get_unified(&normalized.exchange, &normalized.base) {
            normalized.base = unified;
        }
        let payload = serde_json::json!({
            "type": "normalized_ticker",
            "source": normalized.exchange.to_string(),
            "data": &normalized
        });
        batcher.push(normalized.base.clone(), normalized.quote.clone(), payload);
        lvc.upsert(normalized);
    }
}
