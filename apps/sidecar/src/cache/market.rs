use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use log::{info, warn, error};
use serde::Deserialize;
use tokio::sync::RwLock;
use redis::AsyncCommands;

/// Holds dynamically-fetched market symbol lists for exchanges.
///
/// Korean exchanges (Upbit, Bithumb): hits `/v1/market/all`, extracts the
/// `market` field, and applies KRW-priority deduplication.
///
/// Bybit spot: hits `/v5/market/tickers?category=spot`, extracts the `symbol`
/// field from `result.list`, and keeps only symbols ending with `USDT`.
///
/// Coinbase spot: hits `/currencies`, extracts the `id` field from entries
/// where `status == "online"`.
///
/// KuCoin spot: hits `/api/ua/v1/market/ticker?tradeType=SPOT`, extracts the
/// `symbol` field from `data.list`, and keeps only symbols ending with `USDT`.
///
/// OKX spot: hits `/api/v5/public/instruments?instType=SPOT`, extracts the
/// `instId` field from `data`, keeping only entries where `quoteCcy == "USDT"`.
#[derive(Clone)]
pub struct MarketCache {
    upbit: Arc<RwLock<Vec<String>>>,
    bithumb: Arc<RwLock<Vec<String>>>,
    bybit: Arc<RwLock<Vec<String>>>,
    bybit_f: Arc<RwLock<Vec<String>>>,
    gateio: Arc<RwLock<Vec<String>>>,
    bitget: Arc<RwLock<Vec<String>>>,
    bitget_f: Arc<RwLock<Vec<String>>>,
    coinbase: Arc<RwLock<Vec<String>>>,
    kraken: Arc<RwLock<Vec<String>>>,
    kucoin: Arc<RwLock<Vec<String>>>,
    okx: Arc<RwLock<Vec<String>>>,
    okx_f: Arc<RwLock<Vec<String>>>,
}

#[derive(Deserialize)]
struct MarketEntry {
    market: String,
}

// ── Bybit response shape ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct BybitTicker {
    symbol: String,
}

#[derive(Deserialize)]
struct BybitResult {
    list: Vec<BybitTicker>,
}

#[derive(Deserialize)]
struct BybitResponse {
    result: BybitResult,
}

// ── Gateio response shape ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct GateioCurrencyPair {
    id: String,
    trade_status: String,
}

impl MarketCache {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            upbit: Arc::new(RwLock::new(Vec::new())),
            bithumb: Arc::new(RwLock::new(Vec::new())),
            bybit: Arc::new(RwLock::new(Vec::new())),
            bybit_f: Arc::new(RwLock::new(Vec::new())),
            gateio: Arc::new(RwLock::new(Vec::new())),
            bitget: Arc::new(RwLock::new(Vec::new())),
            bitget_f: Arc::new(RwLock::new(Vec::new())),
            coinbase: Arc::new(RwLock::new(Vec::new())),
            kraken: Arc::new(RwLock::new(Vec::new())),
            kucoin: Arc::new(RwLock::new(Vec::new())),
            okx: Arc::new(RwLock::new(Vec::new())),
            okx_f: Arc::new(RwLock::new(Vec::new())),
        })
    }

    /// Return a snapshot of the current Upbit market codes.
    pub async fn get_upbit_markets(&self) -> Vec<String> {
        self.upbit.read().await.clone()
    }

    /// Return a snapshot of the current Bithumb market codes.
    pub async fn get_bithumb_markets(&self) -> Vec<String> {
        self.bithumb.read().await.clone()
    }

    /// Return a snapshot of the current Bybit USDT spot symbols.
    pub async fn get_bybit_markets(&self) -> Vec<String> {
        self.bybit.read().await.clone()
    }

    /// Return a snapshot of the current Bybit Futures USDT symbols.
    pub async fn get_bybit_f_markets(&self) -> Vec<String> {
        self.bybit_f.read().await.clone()
    }

    pub async fn get_gateio_markets(&self) -> Vec<String> {
        self.gateio.read().await.clone()
    }

    /// Return a snapshot of the current Bitget USDT spot symbols.
    pub async fn get_bitget_markets(&self) -> Vec<String> {
        self.bitget.read().await.clone()
    }

    /// Return a snapshot of the current Bitget Futures base coins.
    pub async fn get_bitget_f_markets(&self) -> Vec<String> {
        self.bitget_f.read().await.clone()
    }

    /// Return a snapshot of the current Coinbase online currency ids.
    pub async fn get_coinbase_markets(&self) -> Vec<String> {
        self.coinbase.read().await.clone()
    }

    /// Return a snapshot of the current Kraken USD spot pair symbols.
    pub async fn get_kraken_markets(&self) -> Vec<String> {
        self.kraken.read().await.clone()
    }

    /// Return a snapshot of the current KuCoin USDT spot symbols.
    pub async fn get_kucoin_markets(&self) -> Vec<String> {
        self.kucoin.read().await.clone()
    }

    /// Return a snapshot of the current OKX USDT-base spot instIds.
    pub async fn get_okx_markets(&self) -> Vec<String> {
        self.okx.read().await.clone()
    }

    /// Return a snapshot of the current OKX Futures instIds.
    pub async fn get_okx_f_markets(&self) -> Vec<String> {
        self.okx_f.read().await.clone()
    }

    /// Perform a one-shot blocking fetch on startup so the data is guaranteed
    /// to be available before any exchange tries to subscribe.
    pub async fn initial_fetch(cache: &Arc<Self>) {
        println!("[MarketCache] DEBUG: initial_fetch called");
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        if let Ok(url) = std::env::var("UPBIT_MARKET_URL") {
            match fetch_and_filter(&client, &url).await {
                Ok(markets) => {
                    info!("[MarketCache] Initial fetch: {} Upbit markets", markets.len());
                    *cache.upbit.write().await = markets;
                }
                Err(e) => error!("[MarketCache] Initial Upbit fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] UPBIT_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("BITHUMB_MARKET_URL") {
            match fetch_and_filter(&client, &url).await {
                Ok(markets) => {
                    info!("[MarketCache] Initial fetch: {} Bithumb markets", markets.len());
                    *cache.bithumb.write().await = markets;
                }
                Err(e) => error!("[MarketCache] Initial Bithumb fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] BITHUMB_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("BYBIT_MARKET_URL") {
            match fetch_bybit_usdt_symbols(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} Bybit USDT symbols", symbols.len());
                    *cache.bybit.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial Bybit fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] BYBIT_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("BYBIT_F_MARKET_URL") {
            match fetch_bybit_usdt_symbols(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} Bybit Futures USDT symbols", symbols.len());
                    *cache.bybit_f.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial Bybit Futures fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] BYBIT_F_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("GATEIO_MARKET_URL") {
            match fetch_gateio_currency_pairs(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} Gateio currency pairs", symbols.len());
                    *cache.gateio.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial Gateio fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] GATEIO_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("BITGET_MARKET_URL") {
            match fetch_bitget_usdt_symbols(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} Bitget USDT symbols", symbols.len());
                    *cache.bitget.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial Bitget fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] BITGET_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("BITGET_F_MARKET_URL") {
            match fetch_bitget_f_base_coins(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} Bitget Futures base coins", symbols.len());
                    *cache.bitget_f.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial Bitget Futures fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] BITGET_F_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("COINBASE_MARKET_URL") {
            match fetch_coinbase_online_currencies(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} Coinbase online currencies", symbols.len());
                    *cache.coinbase.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial Coinbase fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] COINBASE_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("KRAKEN_MARKET_URL") {
            match fetch_kraken_usd_pairs(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} Kraken USD pairs", symbols.len());
                    *cache.kraken.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial Kraken fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] KRAKEN_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("KUCOIN_MARKET_URL") {
            match fetch_kucoin_usdt_symbols(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} KuCoin USDT symbols", symbols.len());
                    *cache.kucoin.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial KuCoin fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] KUCOIN_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("OKX_MARKET_URL") {
            match fetch_okx_usdt_base_instruments(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} OKX USDT-base instruments", symbols.len());
                    *cache.okx.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial OKX fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] OKX_MARKET_URL not set");
        }

        if let Ok(url) = std::env::var("OKX_F_MARKET_URL") {
            match fetch_okx_f_usd_instruments(&client, &url).await {
                Ok(symbols) => {
                    info!("[MarketCache] Initial fetch: {} OKX Futures instruments", symbols.len());
                    *cache.okx_f.write().await = symbols;
                }
                Err(e) => error!("[MarketCache] Initial OKX Futures fetch failed: {}", e),
            }
        } else {
            warn!("[MarketCache] OKX_F_MARKET_URL not set");
        }
    }

    /// Spawn a background task that refreshes all market listings every `interval`.
    ///
    /// When the Upbit or Bithumb market list changes between polls (new KRW pairs added
    /// or removed), a `market_cache_updated` event is published to the `sidecar:config`
    /// Redis stream so that `main.rs` can call `refresh_all_subscriptions()` and the
    /// running WebSocket session picks up the new subscription set immediately.
    ///
    /// Reads market URLs and `redis_url` from the caller (no env reads inside the task).
    pub fn start_poller(cache: Arc<Self>, interval: Duration, redis_url: String) {
        let upbit_url = std::env::var("UPBIT_MARKET_URL").ok();
        let bithumb_url = std::env::var("BITHUMB_MARKET_URL").ok();
        let bybit_url = std::env::var("BYBIT_MARKET_URL").ok();
        let bybit_f_url = std::env::var("BYBIT_F_MARKET_URL").ok();
        let gateio_url = std::env::var("GATEIO_MARKET_URL").ok();
        let bitget_url = std::env::var("BITGET_MARKET_URL").ok();
        let bitget_f_url = std::env::var("BITGET_F_MARKET_URL").ok();
        let coinbase_url = std::env::var("COINBASE_MARKET_URL").ok();
        let kraken_url = std::env::var("KRAKEN_MARKET_URL").ok();
        let kucoin_url = std::env::var("KUCOIN_MARKET_URL").ok();
        let okx_url = std::env::var("OKX_MARKET_URL").ok();
        let okx_f_url = std::env::var("OKX_F_MARKET_URL").ok();

        if upbit_url.is_none() && bithumb_url.is_none() && bybit_url.is_none() && bybit_f_url.is_none() && gateio_url.is_none() && bitget_url.is_none() && bitget_f_url.is_none() && coinbase_url.is_none() && kraken_url.is_none() && kucoin_url.is_none() && okx_url.is_none() && okx_f_url.is_none() {
            return;
        }

        tokio::spawn(async move {
            let client = reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
                .build()
                .unwrap_or_else(|_| reqwest::Client::new());

            // Optional Redis client — only used when Upbit/Bithumb lists change.
            // A connection failure here is non-fatal; we just skip the notification.
            let redis_client = redis::Client::open(redis_url.clone()).ok();

            loop {
                // Sleep first — initial_fetch already populated the cache
                tokio::time::sleep(interval).await;

                let mut korean_markets_changed = false;

                // ── Upbit ──
                if let Some(ref url) = upbit_url {
                    match fetch_and_filter(&client, url).await {
                        Ok(new_markets) => {
                            let old_set: HashSet<String> = cache.upbit.read().await.iter().cloned().collect();
                            let new_set: HashSet<String> = new_markets.iter().cloned().collect();
                            if old_set != new_set {
                                info!(
                                    "[MarketCache] Upbit market list changed ({} → {} symbols); will signal subscription refresh",
                                    old_set.len(), new_set.len()
                                );
                                korean_markets_changed = true;
                            }
                            info!("[MarketCache] Refreshed {} Upbit markets", new_markets.len());
                            *cache.upbit.write().await = new_markets;
                        }
                        Err(e) => error!("[MarketCache] Upbit refresh failed: {}", e),
                    }
                }

                // ── Bithumb ──
                if let Some(ref url) = bithumb_url {
                    match fetch_and_filter(&client, url).await {
                        Ok(new_markets) => {
                            let old_set: HashSet<String> = cache.bithumb.read().await.iter().cloned().collect();
                            let new_set: HashSet<String> = new_markets.iter().cloned().collect();
                            if old_set != new_set {
                                info!(
                                    "[MarketCache] Bithumb market list changed ({} → {} symbols); will signal subscription refresh",
                                    old_set.len(), new_set.len()
                                );
                                korean_markets_changed = true;
                            }
                            info!("[MarketCache] Refreshed {} Bithumb markets", new_markets.len());
                            *cache.bithumb.write().await = new_markets;
                        }
                        Err(e) => error!("[MarketCache] Bithumb refresh failed: {}", e),
                    }
                }

                // Publish market_cache_updated once per poll cycle (not once per exchange)
                // so the sidecar only re-subscribes one time even if both lists changed.
                if korean_markets_changed {
                    if let Some(ref rc) = redis_client {
                        match rc.get_multiplexed_async_connection().await {
                            Ok(mut conn) => {
                                let payload = serde_json::json!({ "type": "market_cache_updated" }).to_string();
                                let result: redis::RedisResult<String> = conn
                                    .xadd_maxlen(
                                        "sidecar:config",
                                        redis::streams::StreamMaxlen::Approx(1000),
                                        "*",
                                        &[("payload", payload.as_str())],
                                    )
                                    .await;
                                match result {
                                    Ok(_) => info!("[MarketCache] Published market_cache_updated to sidecar:config stream"),
                                    Err(e) => error!("[MarketCache] Failed to publish market_cache_updated: {}", e),
                                }
                            }
                            Err(e) => error!("[MarketCache] Redis connection failed, skipping market_cache_updated publish: {}", e),
                        }
                    }
                }

                // ── Bybit ──
                if let Some(ref url) = bybit_url {
                    match fetch_bybit_usdt_symbols(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} Bybit USDT symbols", symbols.len());
                            *cache.bybit.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] Bybit refresh failed: {}", e),
                    }
                }

                // ── Bybit Futures ──
                if let Some(ref url) = bybit_f_url {
                    match fetch_bybit_usdt_symbols(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} Bybit Futures USDT symbols", symbols.len());
                            *cache.bybit_f.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] Bybit Futures refresh failed: {}", e),
                    }
                }

                if let Some(ref url) = gateio_url {
                    match fetch_gateio_currency_pairs(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} Gateio currency pairs", symbols.len());
                            *cache.gateio.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] Gateio refresh failed: {}", e),
                    }
                }

                // ── Bitget ──
                if let Some(ref url) = bitget_url {
                    match fetch_bitget_usdt_symbols(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} Bitget USDT symbols", symbols.len());
                            *cache.bitget.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] Bitget refresh failed: {}", e),
                    }
                }

                // ── Bitget Futures ──
                if let Some(ref url) = bitget_f_url {
                    match fetch_bitget_f_base_coins(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} Bitget Futures base coins", symbols.len());
                            *cache.bitget_f.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] Bitget Futures refresh failed: {}", e),
                    }
                }

                // ── Coinbase ──
                if let Some(ref url) = coinbase_url {
                    match fetch_coinbase_online_currencies(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} Coinbase online currencies", symbols.len());
                            *cache.coinbase.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] Coinbase refresh failed: {}", e),
                    }
                }

                // ── Kraken ──
                if let Some(ref url) = kraken_url {
                    match fetch_kraken_usd_pairs(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} Kraken USD pairs", symbols.len());
                            *cache.kraken.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] Kraken refresh failed: {}", e),
                    }
                }

                // ── KuCoin ──
                if let Some(ref url) = kucoin_url {
                    match fetch_kucoin_usdt_symbols(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} KuCoin USDT symbols", symbols.len());
                            *cache.kucoin.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] KuCoin refresh failed: {}", e),
                    }
                }

                // ── OKX ──
                if let Some(ref url) = okx_url {
                    match fetch_okx_usdt_base_instruments(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} OKX USDT-base instruments", symbols.len());
                            *cache.okx.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] OKX refresh failed: {}", e),
                    }
                }

                // ── OKX Futures ──
                if let Some(ref url) = okx_f_url {
                    match fetch_okx_f_usd_instruments(&client, url).await {
                        Ok(symbols) => {
                            info!("[MarketCache] Refreshed {} OKX Futures instruments", symbols.len());
                            *cache.okx_f.write().await = symbols;
                        }
                        Err(e) => error!("[MarketCache] OKX Futures refresh failed: {}", e),
                    }
                }
            }
        });
    }
}

/// Fetch the market listing from a URL and apply the de-duplication filter.
///
/// Filter rules (from the Python reference):
///   • If quote is BTC or USDT **and** `KRW-{base}` exists → skip
///   • If quote is USDT **and** `BTC-{base}` exists → skip
///
/// This ensures we keep one canonical entry per coin, preferring:
///   KRW > BTC > USDT
async fn fetch_and_filter(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let entries: Vec<MarketEntry> = client.get(url).send().await?.json().await?;

    // Collect all market codes into a HashSet for O(1) lookups
    let all_codes: HashSet<String> = entries.iter().map(|e| e.market.clone()).collect();

    let mut result: Vec<String> = Vec::with_capacity(entries.len());

    for entry in &entries {
        let parts: Vec<&str> = entry.market.split('-').collect();
        if parts.len() != 2 {
            continue;
        }
        let quote = parts[0];
        let base = parts[1];

        // Skip BTC/USDT pairs when KRW equivalent exists
        if (quote == "BTC" || quote == "USDT") && all_codes.contains(&format!("KRW-{}", base)) {
            continue;
        }
        // Skip USDT pairs when BTC equivalent exists
        if quote == "USDT" && all_codes.contains(&format!("BTC-{}", base)) {
            continue;
        }

        result.push(entry.market.clone());
    }

    Ok(result)
}

/// Fetch Bybit spot tickers and return only symbols whose quote currency is
/// USDT (i.e. the symbol string ends with `"USDT"`).
async fn fetch_bybit_usdt_symbols(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let resp: BybitResponse = client.get(url).send().await?.json().await?;

    let symbols: Vec<String> = resp
        .result
        .list
        .into_iter()
        .filter(|t| t.symbol.ends_with("USDT"))
        .map(|t| t.symbol)
        .collect();

    Ok(symbols)
}

/// Fetch Gate.io spot currency pairs and return IDs that are tradable and end with _USDT.
async fn fetch_gateio_currency_pairs(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let entries: Vec<GateioCurrencyPair> = client.get(url).send().await?.json().await?;

    let symbols: Vec<String> = entries
        .into_iter()
        .filter(|c| c.trade_status == "tradable" && c.id.ends_with("_USDT"))
        .map(|c| c.id)
        .collect();

    Ok(symbols)
}

// ── Bitget response shape ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct BitgetInstrument {
    symbol: String,
    #[serde(rename = "quoteCoin")]
    quote_coin: String,
    status: String,
}

#[derive(Deserialize)]
struct BitgetResponse {
    data: Vec<BitgetInstrument>,
}

/// Fetch Bitget spot tickers and return only symbols whose quote currency is
/// USDT.
async fn fetch_bitget_usdt_symbols(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let resp: BitgetResponse = client.get(url).send().await?.json().await?;

    let symbols: Vec<String> = resp
        .data
        .into_iter()
        .filter(|t| t.quote_coin == "USDT" && t.status == "online")
        .map(|t| t.symbol)
        .collect();

    Ok(symbols)
}

// ── Bitget Futures response shape ──────────────────────────────────────────

#[derive(Deserialize)]
struct BitgetFInstrument {
    #[serde(rename = "baseCoin")]
    base_coin: String,
    status: String,
}

#[derive(Deserialize)]
struct BitgetFResponse {
    data: Vec<BitgetFInstrument>,
}

/// Fetch Bitget futures tickers and return only baseCoins.
async fn fetch_bitget_f_base_coins(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let resp: BitgetFResponse = client.get(url).send().await?.json().await?;

    let symbols: Vec<String> = resp
        .data
        .into_iter()
        .filter(|t| t.status == "online")
        .map(|t| t.base_coin)
        .collect();

    Ok(symbols)
}

// ── Coinbase response shape ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct CoinbaseCurrency {
    id: String,
    status: String,
}

/// Fetch Coinbase currencies and return only `id`s where `status == "online"`.
async fn fetch_coinbase_online_currencies(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let entries: Vec<CoinbaseCurrency> = client.get(url).send().await?.json().await?;

    let symbols: Vec<String> = entries
        .into_iter()
        .filter(|c| c.status == "online")
        .map(|c| c.id)
        .collect();

    Ok(symbols)
}

// ── Kraken response shape ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct KrakenPair {
    wsname: String,
}

#[derive(Deserialize)]
struct KrakenResponse {
    result: HashMap<String, KrakenPair>,
}

/// Fetch Kraken AssetPairs and return `wsname` values (e.g. `"XBT/USD"`) for
/// pairs whose REST key ends with `USD`. The WebSocket v2 API requires the
/// slash-separated `wsname` format for symbol subscriptions.
async fn fetch_kraken_usd_pairs(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let resp: KrakenResponse = client.get(url).send().await?.json().await?;

    let symbols: Vec<String> = resp
        .result
        .into_iter()
        .filter(|(k, _)| k.ends_with("USD"))
        .map(|(_, v)| v.wsname)
        .collect();

    Ok(symbols)
}

// ── KuCoin response shape ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct KucoinTicker {
    symbol: String,
}

#[derive(Deserialize)]
struct KucoinData {
    list: Vec<KucoinTicker>,
}

#[derive(Deserialize)]
struct KucoinResponse {
    data: KucoinData,
}

/// Fetch KuCoin spot tickers and return only symbols whose name ends with
/// `"USDT"` (i.e. USDT-quoted pairs).
async fn fetch_kucoin_usdt_symbols(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let resp: KucoinResponse = client.get(url).send().await?.json().await?;

    let symbols: Vec<String> = resp
        .data
        .list
        .into_iter()
        .filter(|t| t.symbol.ends_with("USDT"))
        .map(|t| t.symbol)
        .collect();

    Ok(symbols)
}

// ── OKX response shape ────────────────────────────────────────────────────────

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
struct OkxResponse {
    data: Vec<OkxInstrument>,
}

/// Fetch OKX spot instruments and return `instId` values where
/// `quoteCcy == "USDT"` and `state == "live"`.
async fn fetch_okx_usdt_base_instruments(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let resp: OkxResponse = client.get(url).send().await?.json().await?;

    let symbols: Vec<String> = resp
        .data
        .into_iter()
        .filter(|t| t.quote_ccy == "USDT" && t.state == "live")
        .map(|t| t.inst_id)
        .collect();

    Ok(symbols)
}

/// Fetch OKX swap instruments and return `instId` values where
/// `instFamily` ends with `"USD"` and `state == "live"`.
async fn fetch_okx_f_usd_instruments(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<String>, Box<dyn std::error::Error + Send + Sync>> {
    let resp: OkxResponse = client.get(url).send().await?.json().await?;

    let symbols: Vec<String> = resp
        .data
        .into_iter()
        .filter(|t| t.state == "live" && t.inst_family.ends_with("USDT"))
        .map(|t| t.inst_id)
        .collect();

    Ok(symbols)
}
