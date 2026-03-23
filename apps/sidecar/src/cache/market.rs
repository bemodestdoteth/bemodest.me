use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use log::{info, error};
use serde::Deserialize;
use tokio::sync::RwLock;
use redis::AsyncCommands;

/// Holds dynamically-fetched market symbol lists for exchanges.
#[derive(Clone)]
pub struct MarketCache {
    markets: HashMap<String, Arc<RwLock<Vec<String>>>>,
}

#[derive(Deserialize)]
struct MarketEntry {
    market: String,
}

#[derive(Deserialize)]
struct BybitResponse {
    result: BybitResult,
}
#[derive(Deserialize)]
struct BybitResult {
    list: Vec<BybitTicker>,
}
#[derive(Deserialize)]
struct BybitTicker {
    symbol: String,
}

#[derive(Deserialize)]
struct GateioCurrencyPair {
    id: String,
    trade_status: String,
}

#[derive(Deserialize)]
struct BitgetResponse {
    data: Vec<BitgetInstrument>,
}
#[derive(Deserialize)]
struct BitgetInstrument {
    symbol: String,
    #[serde(rename = "quoteCoin")]
    quote_coin: String,
    status: String,
}

#[derive(Deserialize)]
struct BitgetFResponse {
    data: Vec<BitgetFInstrument>,
}
#[derive(Deserialize)]
struct BitgetFInstrument {
    #[serde(rename = "baseCoin")]
    base_coin: String,
    status: String,
}

#[derive(Deserialize)]
struct CoinbaseCurrency {
    id: String,
    status: String,
}

#[derive(Deserialize)]
struct KrakenResponse {
    result: HashMap<String, KrakenPair>,
}
#[derive(Deserialize)]
struct KrakenPair {
    wsname: String,
}

#[derive(Deserialize)]
struct KucoinResponse {
    data: KucoinData,
}
#[derive(Deserialize)]
struct KucoinData {
    list: Vec<KucoinTicker>,
}
#[derive(Deserialize)]
struct KucoinTicker {
    symbol: String,
}

#[derive(Deserialize)]
struct OkxResponse {
    data: Vec<OkxInstrument>,
}
#[derive(Deserialize)]
struct OkxInstrument {
    #[serde(rename = "instId")]
    inst_id: String,
    #[serde(rename = "quoteCcy")]
    #[serde(default)]
    quote_ccy: String,
    state: String,
    #[serde(rename = "instFamily")]
    #[serde(default)]
    inst_family: String,
}

use crate::types::ExchangeExt;

impl MarketCache {
    pub fn new() -> Arc<Self> {
        let mut markets = HashMap::new();
        
        // Populate all exchanges that need market cache
        use crate::types::Exchange;
        for ex_variant in [
            Exchange::Upbit, Exchange::Bithumb, Exchange::Bybit, Exchange::BybitF,
            Exchange::Gateio, Exchange::Bitget, Exchange::BitgetF, Exchange::Coinbase,
            Exchange::Kraken, Exchange::Kucoin, Exchange::Okx, Exchange::OkxF,
        ] {
            markets.insert(ex_variant.source_name().to_string(), Arc::new(RwLock::new(Vec::new())));
        }

        Arc::new(Self { markets })
    }

    async fn get_markets(&self, source: &str) -> Vec<String> {
        if let Some(lock) = self.markets.get(source) {
            lock.read().await.clone()
        } else {
            Vec::new()
        }
    }

    pub async fn get_markets_for_exchange(&self, ex: crate::types::Exchange) -> Vec<String> {
        self.get_markets(ex.source_name()).await
    }

    // Compatibility getters
    pub async fn get_upbit_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::Upbit).await }
    pub async fn get_bithumb_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::Bithumb).await }
    pub async fn get_bybit_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::Bybit).await }
    pub async fn get_bybit_f_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::BybitF).await }
    pub async fn get_gateio_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::Gateio).await }
    pub async fn get_bitget_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::Bitget).await }
    pub async fn get_bitget_f_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::BitgetF).await }
    pub async fn get_coinbase_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::Coinbase).await }
    pub async fn get_kraken_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::Kraken).await }
    pub async fn get_kucoin_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::Kucoin).await }
    pub async fn get_okx_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::Okx).await }
    pub async fn get_okx_f_markets(&self) -> Vec<String> { self.get_markets_for_exchange(crate::types::Exchange::OkxF).await }

    pub async fn initial_fetch(cache: &Arc<Self>) {
        info!("[MarketCache] Combined initial fetch started");
        cache.refresh_all(None).await;
    }

    pub fn start_poller(cache: Arc<Self>, interval: Duration, redis_url: String) {
        tokio::spawn(async move {
            let redis_client = redis::Client::open(redis_url).ok();
            loop {
                tokio::time::sleep(interval).await;
                cache.refresh_all(redis_client.as_ref()).await;
            }
        });
    }

    async fn refresh_all(&self, redis_client: Option<&redis::Client>) {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let mut korean_changed = false;

        for source in self.markets.keys() {
            let env_var = format!("{}_MARKET_URL", source.to_uppercase());
            let url = match std::env::var(&env_var) {
                Ok(u) => u,
                Err(_) => continue,
            };

            match self.fetch_source(&client, source, &url).await {
                Ok(new_markets) => {
                    let mut lock = self.markets.get(source).unwrap().write().await;
                    if (source == "upbit" || source == "bithumb") && *lock != new_markets {
                        info!("[MarketCache] {} market list changed; signaling refresh", source);
                        korean_changed = true;
                    }
                    info!("[MarketCache] Refreshed {} markets: {}", source, new_markets.len());
                    *lock = new_markets;
                }
                Err(e) => error!("[MarketCache] {} refresh failed: {}", source, e),
            }
        }

        if korean_changed {
            if let Some(rc) = redis_client {
                if let Ok(mut conn) = rc.get_multiplexed_async_connection().await {
                    let payload = serde_json::json!({ "type": "market_cache_updated" }).to_string();
                    let _ : redis::RedisResult<String> = conn.xadd_maxlen("sidecar:config", redis::streams::StreamMaxlen::Approx(1000), "*", &[("payload", payload.as_str())]).await;
                }
            }
        }
    }

    async fn fetch_source(&self, client: &reqwest::Client, source: &str, url: &str) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
        match source {
            "upbit" | "bithumb" => {
                let entries: Vec<MarketEntry> = client.get(url).send().await?.json().await?;
                let all_codes: HashSet<String> = entries.iter().map(|e| e.market.clone()).collect();
                let mut result = Vec::new();
                for entry in &entries {
                    let parts: Vec<&str> = entry.market.split('-').collect();
                    if parts.len() == 2 {
                        let (quote, base) = (parts[0], parts[1]);
                        if (quote == "BTC" || quote == "USDT") && all_codes.contains(&format!("KRW-{}", base)) { continue; }
                        if quote == "USDT" && all_codes.contains(&format!("BTC-{}", base)) { continue; }
                        result.push(entry.market.clone());
                    }
                }
                Ok(result)
            }
            "bybit" | "bybit_f" => {
                let resp: BybitResponse = client.get(url).send().await?.json().await?;
                Ok(resp.result.list.into_iter().filter(|t| t.symbol.ends_with("USDT")).map(|t| t.symbol).collect())
            }
            "gateio" => {
                let entries: Vec<GateioCurrencyPair> = client.get(url).send().await?.json().await?;
                Ok(entries.into_iter().filter(|c| c.trade_status == "tradable" && c.id.ends_with("_USDT")).map(|c| c.id).collect())
            }
            "bitget" => {
                let resp: BitgetResponse = client.get(url).send().await?.json().await?;
                Ok(resp.data.into_iter().filter(|t| t.quote_coin == "USDT" && t.status == "online").map(|t| t.symbol).collect())
            }
            "bitget_f" => {
                let resp: BitgetFResponse = client.get(url).send().await?.json().await?;
                Ok(resp.data.into_iter().filter(|t| t.status == "online").map(|t| t.base_coin).collect())
            }
            "coinbase" => {
                let entries: Vec<CoinbaseCurrency> = client.get(url).send().await?.json().await?;
                Ok(entries.into_iter().filter(|c| c.status == "online").map(|c| c.id).collect())
            }
            "kraken" => {
                let resp: KrakenResponse = client.get(url).send().await?.json().await?;
                Ok(resp.result.into_iter().filter(|(k, _)| k.ends_with("USD")).map(|(_, v)| v.wsname).collect())
            }
            "kucoin" => {
                let resp: KucoinResponse = client.get(url).send().await?.json().await?;
                Ok(resp.data.list.into_iter().filter(|t| t.symbol.ends_with("USDT")).map(|t| t.symbol).collect())
            }
            "okx" => {
                let resp: OkxResponse = client.get(url).send().await?.json().await?;
                Ok(resp.data.into_iter().filter(|t| t.quote_ccy == "USDT" && t.state == "live").map(|t| t.inst_id).collect())
            }
            "okx_f" => {
                let resp: OkxResponse = client.get(url).send().await?.json().await?;
                Ok(resp.data.into_iter().filter(|t| t.state == "live" && t.inst_family.ends_with("USDT")).map(|t| t.inst_id).collect())
            }
            _ => Err("Unknown source".into()),
        }
    }
}
