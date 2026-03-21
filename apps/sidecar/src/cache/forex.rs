use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use log::{info, warn};
use serde::Deserialize;

/// Atomic f64 wrapper (serialized as IEEE-754 bits)
#[derive(Default)]
pub struct ForexCache {
    /// KRW per 1 USD — stored as raw IEEE-754 bits in an AtomicU64
    krw_per_usd: AtomicU64,
    /// KRW per 1 BTC — stored as raw IEEE-754 bits in an AtomicU64
    btc_krw: AtomicU64,
    /// KRW per 1 USDT from Upbit — stored as raw IEEE-754 bits in an AtomicU64
    upbit_usdt_krw: AtomicU64,
    /// KRW per 1 USDT from Bithumb — stored as raw IEEE-754 bits in an AtomicU64
    bithumb_usdt_krw: AtomicU64,
}

#[derive(Deserialize)]
struct ForexEntry {
    #[serde(rename = "basePrice")]
    base_price: f64,
}

impl ForexCache {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            krw_per_usd: AtomicU64::new(0),
            btc_krw: AtomicU64::new(0),
            upbit_usdt_krw: AtomicU64::new(0),
            bithumb_usdt_krw: AtomicU64::new(0),
        })
    }

    /// Return the last fetched KRW/USD rate, or `None` if not yet populated.
    pub fn get_krw_per_usd(&self) -> Option<f64> {
        let bits = self.krw_per_usd.load(Ordering::Relaxed);
        if bits == 0 {
            None
        } else {
            Some(f64::from_bits(bits))
        }
    }

    /// Return the last fetched BTC/KRW rate, or `None` if not yet populated.
    pub fn get_btc_krw(&self) -> Option<f64> {
        let bits = self.btc_krw.load(Ordering::Relaxed);
        if bits == 0 {
            None
        } else {
            Some(f64::from_bits(bits))
        }
    }

    pub fn get_upbit_usdt_krw(&self) -> Option<f64> {
        let bits = self.upbit_usdt_krw.load(Ordering::Relaxed);
        if bits == 0 {
            None
        } else {
            Some(f64::from_bits(bits))
        }
    }

    pub fn get_bithumb_usdt_krw(&self) -> Option<f64> {
        let bits = self.bithumb_usdt_krw.load(Ordering::Relaxed);
        if bits == 0 {
            None
        } else {
            Some(f64::from_bits(bits))
        }
    }

    /// Overwrite the stored USD rate.
    fn set_krw_per_usd(&self, rate: f64) {
        self.krw_per_usd.store(rate.to_bits(), Ordering::Relaxed);
    }

    /// Overwrite the stored BTC rate.
    fn set_btc_krw(&self, rate: f64) {
        self.btc_krw.store(rate.to_bits(), Ordering::Relaxed);
    }

    fn set_upbit_usdt_krw(&self, rate: f64) {
        self.upbit_usdt_krw.store(rate.to_bits(), Ordering::Relaxed);
    }

    fn set_bithumb_usdt_krw(&self, rate: f64) {
        self.bithumb_usdt_krw.store(rate.to_bits(), Ordering::Relaxed);
    }

    /// Spawn a background task that refreshes the rate every `interval`.
    /// Reads the URL from the `UPBIT_FOREX_URL` environment variable.
    pub fn start_poller(cache: Arc<Self>, tx: tokio::sync::broadcast::Sender<String>, interval: Duration) {
        let url = match std::env::var("UPBIT_FOREX_URL") {
            Ok(u) => u,
            Err(_) => {
                warn!("[ForexCache] UPBIT_FOREX_URL not set — poller disabled");
                return;
            }
        };

        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let upbit_url = "https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-USDT";
            let bithumb_url = "https://api.bithumb.com/public/ticker/USDT_KRW";

            loop {
                let mut usd_krw = None;
                let mut btc_krw = None;
                let mut upbit_usdt_krw = None;
                let mut bithumb_usdt_krw = None;

                // 1) Fetch KRW/USD
                match client.get(&url).send().await {
                    Ok(resp) => match resp.json::<Vec<ForexEntry>>().await {
                        Ok(entries) => {
                            if let Some(entry) = entries.first() {
                                cache.set_krw_per_usd(entry.base_price);
                                usd_krw = Some(entry.base_price);
                                info!(
                                    "[ForexCache] KRW/USD basePrice updated: {}",
                                    entry.base_price
                                );
                            }
                        }
                        Err(e) => warn!("[ForexCache] Failed to parse forex response: {}", e),
                    },
                    Err(e) => warn!("[ForexCache] Failed to fetch forex data: {}", e),
                }

                // 2) Fetch Upbit (BTC & USDT)
                match client.get(upbit_url).send().await {
                    Ok(resp) => {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if let Some(tickers) = json.as_array() {
                                for ticker in tickers {
                                    if let Some(market) = ticker.get("market").and_then(|v| v.as_str()) {
                                        if let Some(price) = ticker.get("trade_price").and_then(|v| v.as_f64()) {
                                            if market == "KRW-BTC" {
                                                cache.set_btc_krw(price);
                                                btc_krw = Some(price);
                                                info!("[ForexCache] BTC/KRW price updated: {}", price);
                                            } else if market == "KRW-USDT" {
                                                cache.set_upbit_usdt_krw(price);
                                                upbit_usdt_krw = Some(price);
                                                info!("[ForexCache] Upbit USDT/KRW price updated: {}", price);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => warn!("[ForexCache] Failed to fetch Upbit prices: {}", e),
                }

                // 3) Fetch Bithumb USDT
                match client.get(bithumb_url).send().await {
                    Ok(resp) => {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if let Some(data) = json.get("data") {
                                if let Some(price_str) = data.get("closing_price").and_then(|v| v.as_str()) {
                                    if let Ok(price) = price_str.parse::<f64>() {
                                        cache.set_bithumb_usdt_krw(price);
                                        bithumb_usdt_krw = Some(price);
                                        info!("[ForexCache] Bithumb USDT/KRW price updated: {}", price);
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => warn!("[ForexCache] Failed to fetch Bithumb prices: {}", e),
                }

                // Broadcast
                let msg = serde_json::json!({
                    "type": "forex",
                    "data": {
                        "usd_krw": usd_krw.or_else(|| cache.get_krw_per_usd()),
                        "btc_krw": btc_krw.or_else(|| cache.get_btc_krw()),
                        "upbit_usdt_krw": upbit_usdt_krw.or_else(|| cache.get_upbit_usdt_krw()),
                        "bithumb_usdt_krw": bithumb_usdt_krw.or_else(|| cache.get_bithumb_usdt_krw())
                    }
                });
                let _ = tx.send(msg.to_string());

                tokio::time::sleep(interval).await;
            }
        });
    }
}
