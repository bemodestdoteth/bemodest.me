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

    /// Overwrite the stored USD rate.
    fn set_krw_per_usd(&self, rate: f64) {
        self.krw_per_usd.store(rate.to_bits(), Ordering::Relaxed);
    }

    /// Overwrite the stored BTC rate.
    fn set_btc_krw(&self, rate: f64) {
        self.btc_krw.store(rate.to_bits(), Ordering::Relaxed);
    }

    /// Spawn a background task that refreshes the rate every `interval`.
    /// Reads the URL from the `UPBIT_FOREX_URL` environment variable.
    pub fn start_poller(cache: Arc<Self>, interval: Duration) {
        let url = match std::env::var("UPBIT_FOREX_URL") {
            Ok(u) => u,
            Err(_) => {
                warn!("[ForexCache] UPBIT_FOREX_URL not set — poller disabled");
                return;
            }
        };

        tokio::spawn(async move {
            let client = reqwest::Client::new();
            let btc_url = "https://api.upbit.com/v1/ticker?markets=KRW-BTC";

            loop {
                // 1) Fetch KRW/USD
                match client.get(&url).send().await {
                    Ok(resp) => match resp.json::<Vec<ForexEntry>>().await {
                        Ok(entries) => {
                            if let Some(entry) = entries.first() {
                                cache.set_krw_per_usd(entry.base_price);
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

                // 2) Fetch BTC/KRW
                match client.get(btc_url).send().await {
                    Ok(resp) => {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if let Some(ticker) = json.as_array().and_then(|a| a.get(0)) {
                                if let Some(price) = ticker.get("trade_price").and_then(|v| v.as_f64()) {
                                    cache.set_btc_krw(price);
                                    info!("[ForexCache] BTC/KRW price updated: {}", price);
                                }
                            }
                        }
                    }
                    Err(e) => warn!("[ForexCache] Failed to fetch BTC/KRW price: {}", e),
                }

                tokio::time::sleep(interval).await;
            }
        });
    }
}
