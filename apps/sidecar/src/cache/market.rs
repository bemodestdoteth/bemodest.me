use log::{error, info};
use redis::AsyncCommands;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};

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
struct BinanceFResponse {
    symbols: Vec<BinanceFSymbol>,
}
#[derive(Deserialize)]
struct BinanceFSymbol {
    symbol: String,
    #[serde(rename = "contractType")]
    contract_type: String,
    status: String,
    #[serde(rename = "quoteAsset")]
    quote_asset: String,
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

#[derive(Deserialize)]
struct HyperliquidMetaResponse {
    universe: Vec<HyperliquidAsset>,
}

#[derive(Deserialize)]
struct HyperliquidAsset {
    name: String,
    #[serde(default, rename = "isDelisted")]
    is_delisted: bool,
}

#[derive(Deserialize)]
struct HyperliquidPerpDex {
    name: String,
}

type HyperliquidPerpDexResponse = Vec<Option<HyperliquidPerpDex>>;

use crate::types::ExchangeExt;

const BINANCE_F_DEFAULT_MARKET_URL: &str = "https://fapi.binance.com/fapi/v1/exchangeInfo";
const HYPERLIQUID_F_DEFAULT_MARKET_URL: &str = "https://api.hyperliquid.xyz/info";

impl MarketCache {
    pub fn new() -> Arc<Self> {
        let mut markets = HashMap::new();

        // Populate all exchanges that need market cache
        use crate::types::Exchange;
        for ex_variant in [
            Exchange::Upbit,
            Exchange::Bithumb,
            Exchange::Bybit,
            Exchange::BybitF,
            Exchange::BinanceF,
            Exchange::Gateio,
            Exchange::Bitget,
            Exchange::BitgetF,
            Exchange::Coinbase,
            Exchange::Kraken,
            Exchange::Kucoin,
            Exchange::Okx,
            Exchange::OkxF,
            Exchange::HyperliquidF,
        ] {
            markets.insert(
                ex_variant.source_name().to_string(),
                Arc::new(RwLock::new(Vec::new())),
            );
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

    fn get_markets_snapshot(&self, source: &str) -> Vec<String> {
        self.markets
            .get(source)
            .and_then(|lock| lock.try_read().ok().map(|markets| markets.clone()))
            .unwrap_or_default()
    }

    pub fn get_markets_for_exchange_snapshot(&self, ex: crate::types::Exchange) -> Vec<String> {
        self.get_markets_snapshot(ex.source_name())
    }

    // Compatibility getters
    pub async fn get_upbit_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::Upbit)
            .await
    }
    pub async fn get_bithumb_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::Bithumb)
            .await
    }
    pub async fn get_bybit_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::Bybit)
            .await
    }
    pub async fn get_bybit_f_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::BybitF)
            .await
    }
    pub async fn get_binance_f_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::BinanceF)
            .await
    }
    pub fn get_binance_f_markets_snapshot(&self) -> Vec<String> {
        self.get_markets_for_exchange_snapshot(crate::types::Exchange::BinanceF)
    }
    pub async fn get_gateio_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::Gateio)
            .await
    }
    pub async fn get_bitget_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::Bitget)
            .await
    }
    pub async fn get_bitget_f_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::BitgetF)
            .await
    }
    pub async fn get_coinbase_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::Coinbase)
            .await
    }
    pub async fn get_kraken_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::Kraken)
            .await
    }
    pub async fn get_kucoin_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::Kucoin)
            .await
    }
    pub async fn get_okx_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::Okx)
            .await
    }
    pub async fn get_okx_f_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::OkxF)
            .await
    }
    pub async fn get_hyperliquid_f_markets(&self) -> Vec<String> {
        self.get_markets_for_exchange(crate::types::Exchange::HyperliquidF)
            .await
    }

    #[cfg(test)]
    pub async fn set_markets_for_test(&self, source: &str, markets: Vec<String>) {
        if let Some(lock) = self.markets.get(source) {
            *lock.write().await = markets;
        }
    }

    pub async fn initial_fetch(cache: &Arc<Self>) {
        info!("[MarketCache] Combined initial fetch started");
        cache.refresh_all(None, None).await;
    }

    pub fn start_poller(
        cache: Arc<Self>,
        interval: Duration,
        redis_url: String,
        refresh_tx: Option<broadcast::Sender<()>>,
    ) {
        tokio::spawn(async move {
            let redis_client = redis::Client::open(redis_url).ok();
            loop {
                tokio::time::sleep(interval).await;
                cache
                    .refresh_sources(None, redis_client.as_ref(), refresh_tx.as_ref())
                    .await;
            }
        });
    }

    pub fn start_korean_poller(
        cache: Arc<Self>,
        interval: Duration,
        redis_url: String,
        refresh_tx: Option<broadcast::Sender<()>>,
    ) {
        tokio::spawn(async move {
            let redis_client = redis::Client::open(redis_url).ok();
            loop {
                tokio::time::sleep(interval).await;
                cache
                    .refresh_sources(
                        Some(&["upbit", "bithumb"]),
                        redis_client.as_ref(),
                        refresh_tx.as_ref(),
                    )
                    .await;
            }
        });
    }

    async fn refresh_all(
        &self,
        redis_client: Option<&redis::Client>,
        refresh_tx: Option<&broadcast::Sender<()>>,
    ) {
        self.refresh_sources(None, redis_client, refresh_tx).await;
    }

    async fn refresh_sources(
        &self,
        sources: Option<&[&str]>,
        redis_client: Option<&redis::Client>,
        refresh_tx: Option<&broadcast::Sender<()>>,
    ) {
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let mut korean_changed = false;

        let source_names: Vec<String> = sources
            .map(|names| names.iter().map(|name| (*name).to_string()).collect())
            .unwrap_or_else(|| self.markets.keys().cloned().collect());

        for source in source_names {
            let source = source.as_str();
            let env_var = format!("{}_MARKET_URL", source.to_uppercase());
            let url = match std::env::var(&env_var) {
                Ok(u) => u,
                Err(_) if source == "binance_f" => BINANCE_F_DEFAULT_MARKET_URL.to_string(),
                Err(_) if source == "hyperliquid_f" => HYPERLIQUID_F_DEFAULT_MARKET_URL.to_string(),
                Err(_) => continue,
            };

            match self.fetch_source(&client, source, &url).await {
                Ok(new_markets) => {
                    let mut new_markets = new_markets;
                    new_markets.sort();
                    new_markets.dedup();

                    let mut lock = self.markets.get(source).unwrap().write().await;
                    if (source == "upbit" || source == "bithumb") && *lock != new_markets {
                        let old_set: HashSet<_> = lock.iter().cloned().collect();
                        let new_set: HashSet<_> = new_markets.iter().cloned().collect();
                        let mut added: Vec<_> = new_set.difference(&old_set).cloned().collect();
                        let removed_count = old_set.difference(&new_set).count();
                        added.sort();
                        let sample: Vec<_> = added.iter().take(10).cloned().collect();

                        info!(
                            "[MarketCache] {} market list changed; added={}, removed={}, sample_added={:?}; signaling refresh",
                            source,
                            added.len(),
                            removed_count,
                            sample
                        );
                        korean_changed = true;
                    }
                    info!(
                        "[MarketCache] Refreshed {} markets: {}",
                        source,
                        new_markets.len()
                    );
                    *lock = new_markets;
                }
                Err(e) => error!("[MarketCache] {} refresh failed: {}", source, e),
            }
        }

        if korean_changed {
            if let Some(tx) = refresh_tx {
                let _ = tx.send(());
            }

            if let Some(rc) = redis_client {
                if let Ok(mut conn) = rc.get_multiplexed_async_connection().await {
                    let payload = serde_json::json!({ "type": "market_cache_updated" }).to_string();
                    let _: redis::RedisResult<String> = conn
                        .xadd_maxlen(
                            "sidecar:config",
                            redis::streams::StreamMaxlen::Approx(1000),
                            "*",
                            &[("payload", payload.as_str())],
                        )
                        .await;
                }
            }
        }
    }

    async fn fetch_source(
        &self,
        client: &reqwest::Client,
        source: &str,
        url: &str,
    ) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
        match source {
            "upbit" | "bithumb" => {
                let entries: Vec<MarketEntry> = client.get(url).send().await?.json().await?;
                let all_codes: HashSet<String> = entries.iter().map(|e| e.market.clone()).collect();
                let mut result = Vec::new();
                for entry in &entries {
                    let parts: Vec<&str> = entry.market.split('-').collect();
                    if parts.len() == 2 {
                        let (quote, base) = (parts[0], parts[1]);
                        if (quote == "BTC" || quote == "USDT")
                            && all_codes.contains(&format!("KRW-{}", base))
                        {
                            continue;
                        }
                        if quote == "USDT" && all_codes.contains(&format!("BTC-{}", base)) {
                            continue;
                        }
                        result.push(entry.market.clone());
                    }
                }
                result.sort();
                result.dedup();
                Ok(result)
            }
            "bybit" | "bybit_f" => {
                let resp: BybitResponse = client.get(url).send().await?.json().await?;
                Ok(resp
                    .result
                    .list
                    .into_iter()
                    .filter(|t| t.symbol.ends_with("USDT"))
                    .map(|t| t.symbol)
                    .collect())
            }
            "binance_f" => {
                let resp: BinanceFResponse = client.get(url).send().await?.json().await?;
                Ok(resp
                    .symbols
                    .into_iter()
                    .filter(|s| {
                        s.status == "TRADING"
                            && s.quote_asset == "USDT"
                            && s.contract_type == "PERPETUAL"
                    })
                    .map(|s| s.symbol)
                    .collect())
            }
            "gateio" => {
                let entries: Vec<GateioCurrencyPair> = client.get(url).send().await?.json().await?;
                Ok(entries
                    .into_iter()
                    .filter(|c| c.trade_status == "tradable" && c.id.ends_with("_USDT"))
                    .map(|c| c.id)
                    .collect())
            }
            "bitget" => {
                let resp: BitgetResponse = client.get(url).send().await?.json().await?;
                Ok(resp
                    .data
                    .into_iter()
                    .filter(|t| t.quote_coin == "USDT" && t.status == "online")
                    .map(|t| t.symbol)
                    .collect())
            }
            "bitget_f" => {
                let resp: BitgetFResponse = client.get(url).send().await?.json().await?;
                Ok(resp
                    .data
                    .into_iter()
                    .filter(|t| t.status == "online")
                    .map(|t| t.base_coin)
                    .collect())
            }
            "coinbase" => {
                let entries: Vec<CoinbaseCurrency> = client.get(url).send().await?.json().await?;
                Ok(entries
                    .into_iter()
                    .filter(|c| c.status == "online")
                    .map(|c| c.id)
                    .collect())
            }
            "kraken" => {
                let resp: KrakenResponse = client.get(url).send().await?.json().await?;
                Ok(resp
                    .result
                    .into_values()
                    .filter(|pair| pair.wsname.ends_with("/USD"))
                    .map(|pair| pair.wsname)
                    .collect())
            }
            "kucoin" => {
                let resp: KucoinResponse = client.get(url).send().await?.json().await?;
                Ok(resp
                    .data
                    .list
                    .into_iter()
                    .filter(|t| t.symbol.ends_with("USDT"))
                    .map(|t| t.symbol)
                    .collect())
            }
            "okx" => {
                let resp: OkxResponse = client.get(url).send().await?.json().await?;
                Ok(resp
                    .data
                    .into_iter()
                    .filter(|t| t.quote_ccy == "USDT" && t.state == "live")
                    .map(|t| t.inst_id)
                    .collect())
            }
            "okx_f" => {
                let resp: OkxResponse = client.get(url).send().await?.json().await?;
                Ok(resp
                    .data
                    .into_iter()
                    .filter(|t| t.state == "live" && t.inst_family.ends_with("USDT"))
                    .map(|t| t.inst_id)
                    .collect())
            }
            "hyperliquid_f" => fetch_hyperliquid_f_markets(client, url).await,
            _ => Err("Unknown source".into()),
        }
    }
}

fn hyperliquid_active_asset_names(resp: HyperliquidMetaResponse, dex: Option<&str>) -> Vec<String> {
    resp.universe
        .into_iter()
        .filter(|asset| !asset.is_delisted)
        .map(|asset| match dex {
            Some(dex) if !asset.name.contains(':') => format!("{}:{}", dex, asset.name),
            _ => asset.name,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hyperliquid_active_asset_names_qualifies_hip3_assets() {
        let resp = HyperliquidMetaResponse {
            universe: vec![
                HyperliquidAsset {
                    name: "SKHX".to_string(),
                    is_delisted: false,
                },
                HyperliquidAsset {
                    name: "DELISTED".to_string(),
                    is_delisted: true,
                },
            ],
        };

        assert_eq!(hyperliquid_active_asset_names(resp, Some("xyz")), vec!["xyz:SKHX"]);
    }

    #[test]
    fn hyperliquid_active_asset_names_keeps_core_assets_unqualified() {
        let resp = HyperliquidMetaResponse {
            universe: vec![HyperliquidAsset {
                name: "BTC".to_string(),
                is_delisted: false,
            }],
        };

        assert_eq!(hyperliquid_active_asset_names(resp, None), vec!["BTC"]);
    }

    #[test]
    fn hyperliquid_perp_dex_response_allows_null_default_dex() {
        let dexes: HyperliquidPerpDexResponse = serde_json::from_value(serde_json::json!([
            null,
            { "name": "xyz" }
        ]))
        .unwrap();

        let names: Vec<_> = dexes
            .into_iter()
            .flatten()
            .map(|dex| dex.name)
            .collect();

        assert_eq!(names, vec!["xyz"]);
    }
}

async fn fetch_hyperliquid_f_markets(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let core: HyperliquidMetaResponse = client
        .post(url)
        .json(&serde_json::json!({ "type": "meta" }))
        .send()
        .await?
        .json()
        .await?;
    let mut markets = hyperliquid_active_asset_names(core, None);

    let dexes: HyperliquidPerpDexResponse = client
        .post(url)
        .json(&serde_json::json!({ "type": "perpDexs" }))
        .send()
        .await?
        .json()
        .await?;

    for dex in dexes.into_iter().flatten() {
        let resp: HyperliquidMetaResponse = client
            .post(url)
            .json(&serde_json::json!({ "type": "meta", "dex": dex.name.as_str() }))
            .send()
            .await?
            .json()
            .await?;
        markets.extend(hyperliquid_active_asset_names(resp, Some(dex.name.as_str())));
    }

    Ok(markets)
}
