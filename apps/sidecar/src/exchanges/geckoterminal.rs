use async_trait::async_trait;
use futures_util::TryStreamExt;
use log::{error, info, warn};
use mongodb::{bson::doc, Client};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;

use crate::cache::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::Exchange;
use crate::types::{now_micros, Exchange as ExchangeType, NormalizedTicker};

const GECKOTERMINAL_BASE_URL: &str = "https://api.geckoterminal.com/api/v2/networks";
const MAX_ADDRESSES_PER_REQUEST: usize = 30;
const MAX_RETRY_ATTEMPTS: u32 = 3;
const RETRY_BACKOFF_FACTOR: u64 = 2;
const INITIAL_RETRY_DELAY_MS: u64 = 1000;
const WORKER_POLL_DELAY_MS: u64 = 6000;

pub struct GeckoterminalExchange {
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    config: Arc<Config>,
    mongo_client: Option<Client>,
}

impl GeckoterminalExchange {
    pub fn new(
        tx: broadcast::Sender<String>,
        lvc: Arc<LatestValueCache>,
        tac: Arc<TokenAnnotationCache>,
        config: Arc<Config>,
    ) -> Self {
        Self {
            tx,
            connected: Arc::new(AtomicBool::new(false)),
            lvc,
            tac,
            config,
            mongo_client: None,
        }
    }

    async fn get_mongo_client(&mut self) -> Option<Client> {
        if self.mongo_client.is_some() {
            return self.mongo_client.clone();
        }

        if let Some(uri) = &self.config.mongo_uri {
            match Client::with_uri_str(uri).await {
                Ok(client) => {
                    self.mongo_client = Some(client.clone());
                    Some(client)
                }
                Err(e) => {
                    error!("[Geckoterminal] Failed to connect to MongoDB: {}", e);
                    None
                }
            }
        } else {
            None
        }
    }

    async fn load_contract_mappings(
        &mut self,
    ) -> Option<(
        HashMap<String, Vec<String>>,
        HashMap<String, String>,
        HashMap<String, String>,
    )> {
        let client = self.get_mongo_client().await?;
        let db = client.database("codys");
        let collection = db.collection::<mongodb::bson::Document>("tokens");

        let mut cursor = match collection.find(doc! {}).await {
            Ok(c) => c,
            Err(e) => {
                error!("[Geckoterminal] Failed to query contract mappings: {}", e);
                return None;
            }
        };

        let mut network_to_addresses: HashMap<String, Vec<String>> = HashMap::new();
        let mut id_to_symbol: HashMap<String, String> = HashMap::new();
        let mut addr_to_symbol: HashMap<String, String> = HashMap::new();

        while let Ok(Some(doc)) = cursor.try_next().await {
            let id = doc.get_str("id").ok()?;
            let symbol = doc.get_str("symbol").ok()?;
            id_to_symbol.insert(id.to_string(), symbol.to_string());

            if let Ok(contracts) = doc.get_document("contracts") {
                for (network, address_val) in contracts {
                    if let Some(address) = address_val.as_str() {
                        network_to_addresses
                            .entry(network.clone())
                            .or_insert_with(Vec::new)
                            .push(address.to_string());

                        let addr_key = format!("{}:{}", network, address.to_lowercase());
                        addr_to_symbol.insert(addr_key, symbol.to_string());
                    }
                }
            }
        }

        info!(
            "[Geckoterminal] Loaded mappings for {} coins across {} networks",
            id_to_symbol.len(),
            network_to_addresses.len()
        );
        Some((network_to_addresses, id_to_symbol, addr_to_symbol))
    }

    async fn load_caip_mappings(&mut self) -> HashMap<String, String> {
        let mut gt_to_caip2 = HashMap::new();
        let client = match self.get_mongo_client().await {
            Some(c) => c,
            None => return gt_to_caip2,
        };

        let db = client.database("codys");
        let collection = db.collection::<mongodb::bson::Document>("chains");

        // Assuming a standard mapping collection or method
        let mut cursor = match collection.find(doc! {}).await {
            Ok(c) => c,
            Err(_) => return gt_to_caip2,
        };

        while let Ok(Some(doc)) = cursor.try_next().await {
            if let (Ok(caip2), Ok(gt)) = (doc.get_str("caip2"), doc.get_str("geckoterminal_id")) {
                gt_to_caip2.insert(gt.to_string(), caip2.to_string());
            }
        }

        gt_to_caip2
    }
}

#[async_trait]
impl Exchange for GeckoterminalExchange {
    async fn connect(&mut self) {
        if self.connected.load(Ordering::SeqCst) {
            return;
        }

        let connected = self.connected.clone();
        let tx = self.tx.clone();
        let _lvc = self.lvc.clone();
        let _tac = self.tac.clone();
        let _config = self.config.clone();

        let (network_to_addresses, id_to_symbol, addr_to_symbol) =
            match self.load_contract_mappings().await {
                Some(m) => m,
                None => {
                    error!("[Geckoterminal] Could not load initial mappings. Poller won't start.");
                    return;
                }
            };

        let gt_to_caip2 = self.load_caip_mappings().await;
        connected.store(true, Ordering::SeqCst);

        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .unwrap();

            info!("[Geckoterminal] Poller task started");

            loop {
                for (network, addresses) in &network_to_addresses {
                    for chunk in addresses.chunks(MAX_ADDRESSES_PER_REQUEST) {
                        let address_list = chunk.join(",");
                        let url = format!(
                            "{}/{}/tokens/multi/{}",
                            GECKOTERMINAL_BASE_URL, network, address_list
                        );

                        let mut success = false;
                        let mut backoff = INITIAL_RETRY_DELAY_MS;

                        for attempt in 1..=MAX_RETRY_ATTEMPTS {
                            match client
                                .get(&url)
                                .header("Accept", "application/json")
                                .header("User-Agent", "Mozilla/5.0")
                                .send()
                                .await
                            {
                                Ok(resp) => {
                                    if resp.status().is_success() {
                                        if let Ok(json) = resp.json::<Value>().await {
                                            if let Some(data) =
                                                json.get("data").and_then(|v| v.as_array())
                                            {
                                                for item in data {
                                                    if let Some(normalized) = normalize_gt_token(
                                                        item,
                                                        network,
                                                        &id_to_symbol,
                                                        &addr_to_symbol,
                                                    ) {
                                                        let payload = serde_json::json!({
                                                            "type": "normalized_ticker",
                                                            "source": format!("dex_{}", gt_to_caip2.get(network).unwrap_or(network).replace(":", "_")),
                                                            "data": &normalized
                                                        });
                                                        if let Ok(s) =
                                                            serde_json::to_string(&payload)
                                                        {
                                                            let _ = tx.send(s);
                                                        }
                                                    }
                                                }
                                                success = true;
                                                break;
                                            }
                                        }
                                    } else if resp.status().as_u16() == 429
                                        || resp.status().as_u16() >= 500
                                    {
                                        warn!("[Geckoterminal] Attempt {} failed with status {}. Retrying in {}ms...", attempt, resp.status(), backoff);
                                    } else {
                                        warn!(
                                            "[Geckoterminal] Non-retryable error: {}",
                                            resp.status()
                                        );
                                        break;
                                    }
                                }
                                Err(e) => {
                                    warn!("[Geckoterminal] Attempt {} failed: {}. Retrying in {}ms...", attempt, e, backoff);
                                }
                            }

                            if attempt < MAX_RETRY_ATTEMPTS {
                                tokio::time::sleep(Duration::from_millis(backoff)).await;
                                backoff *= RETRY_BACKOFF_FACTOR;
                            }
                        }

                        if !success {
                            error!(
                                "[Geckoterminal] Failed to fetch tokens for {} after {} attempts",
                                network, MAX_RETRY_ATTEMPTS
                            );
                        }

                        // Respect rate limit between chunks
                        tokio::time::sleep(Duration::from_millis(WORKER_POLL_DELAY_MS)).await;
                    }
                }

                // End of all networks cycle, optional delay before restart
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}

fn resolve_base_symbol(
    attrs: &Value,
    network: &str,
    id_to_symbol: &HashMap<String, String>,
    addr_to_symbol: &HashMap<String, String>,
) -> String {
    let coingecko_id = attrs
        .get("coingecko_coin_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if !coingecko_id.is_empty() {
        if let Some(sym) = id_to_symbol.get(coingecko_id) {
            return sym.to_uppercase();
        }
    }

    let addr = attrs
        .get("address")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let addr_key = format!("{}:{}", network, addr);
    if let Some(sym) = addr_to_symbol.get(&addr_key) {
        return sym.to_uppercase();
    }

    let raw = attrs
        .get("symbol")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_uppercase();
    if raw.starts_with('W') && raw.len() > 1 {
        raw[1..].to_string()
    } else {
        raw
    }
}

fn normalize_gt_token(
    token: &Value,
    network: &str,
    id_to_symbol: &HashMap<String, String>,
    addr_to_symbol: &HashMap<String, String>,
) -> Option<NormalizedTicker> {
    let attrs = token.get("attributes")?;
    let price_usd_str = attrs.get("price_usd")?.as_str()?;
    let price_usd: f64 = price_usd_str.parse().ok()?;

    let base = resolve_base_symbol(attrs, network, id_to_symbol, addr_to_symbol);
    let now = chrono::Utc::now().timestamp_millis();

    let v_quote: f64 = attrs
        .get("volume_usd")
        .and_then(|v| v.get("h24"))
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0);

    let liquidity: Option<f64> = attrs
        .get("total_reserve_in_usd")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok());

    Some(NormalizedTicker {
        exchange: ExchangeType::Dex,
        base: base.clone(),
        raw_base: base,
        quote: "USD".to_string(),
        o: price_usd,
        h: price_usd,
        l: price_usd,
        c: price_usd,
        v_base: 0.0,
        v_quote,
        liquidity,
        timestamp_ms: now,
        market_state: Some(crate::types::MarketState::Active),
        ingest_time_us: now_micros(),
        o_krw: None,
        h_krw: None,
        l_krw: None,
        c_krw: None,
        v_quote_krw: None,
        change_24h: None,
    })
}
