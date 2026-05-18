use moka::future::Cache;
use mongodb::{bson::doc, Client};

use futures_util::TryStreamExt;
use log::{error, info, warn};
use std::time::Duration;

use crate::types::ExchangeExt;

/// High-performance token mapping cache using Moka
/// Maps exchange symbols (e.g., "BTCUSDT") to (base, quote) pairs (e.g., ("BTC", "USDT"))
#[derive(Clone)]
pub struct TokenCache {
    /// Symbol -> (base, quote) mapping
    cache: Cache<String, (String, String)>,
    /// MongoDB client for fallback lookups
    mongo_client: Option<Client>,
}

impl TokenCache {
    /// Create a new token cache with optional MongoDB connection
    pub async fn new(mongo_uri: Option<&str>) -> Self {
        // Build cache with 1-hour TTL and 10k max capacity
        let cache = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(3600))
            .build();

        let mongo_client = if let Some(uri) = mongo_uri {
            match Client::with_uri_str(uri).await {
                Ok(client) => {
                    info!("[TokenCache] Connected to MongoDB");
                    Some(client)
                }
                Err(e) => {
                    error!("[TokenCache] Failed to connect to MongoDB: {}", e);
                    None
                }
            }
        } else {
            warn!("[TokenCache] No MongoDB URI provided, using static parsing only");
            None
        };

        let token_cache = Self {
            cache,
            mongo_client,
        };

        // Preload if MongoDB is available
        if token_cache.mongo_client.is_some() {
            if let Err(e) = token_cache.preload().await {
                error!("[TokenCache] Preload failed: {}", e);
            }
        }

        token_cache
    }

    /// Preload all token mappings from MongoDB
    async fn preload(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let client = self.mongo_client.as_ref().ok_or("No MongoDB client")?;
        let db = client.database("codys");
        let collection = db.collection::<mongodb::bson::Document>("tokens");

        let mut cursor = collection.find(doc! {}).await?;
        let mut count = 0;

        while let Some(doc) = cursor.try_next().await? {
            if let (Some(symbol), Some(base), Some(quote)) = (
                doc.get_str("symbol").ok(),
                doc.get_str("base").ok(),
                doc.get_str("quote").ok(),
            ) {
                self.cache
                    .insert(symbol.to_string(), (base.to_string(), quote.to_string()))
                    .await;
                count += 1;
            }
        }

        info!("[TokenCache] Preloaded {} token mappings", count);
        Ok(())
    }

    /// Get symbol mapping (cache-first, then MongoDB, then static parser)
    pub async fn get(
        &self,
        symbol: &str,
        exchange: crate::types::Exchange,
    ) -> Option<(String, String)> {
        // 1. Check cache first
        if let Some(mapping) = self.cache.get(symbol).await {
            return Some(mapping);
        }

        // 2. Try MongoDB lookup
        if let Some(client) = &self.mongo_client {
            if let Ok(mapping) = self.lookup_mongo(client, symbol).await {
                self.cache.insert(symbol.to_string(), mapping.clone()).await;
                return Some(mapping);
            }
        }

        // 3. Fall back to static parsing
        // 3. Fall back to static parsing
        let result = exchange.parse_symbol(symbol);

        // Cache the result if found
        if let Some(mapping) = result.as_ref() {
            let val: (String, String) = mapping.clone();
            self.cache.insert(symbol.to_string(), val).await;
        }

        result
    }

    /// Lookup symbol in MongoDB
    async fn lookup_mongo(
        &self,
        client: &Client,
        symbol: &str,
    ) -> Result<(String, String), Box<dyn std::error::Error + Send + Sync>> {
        let db = client.database("codys");
        let collection = db.collection::<mongodb::bson::Document>("tokens");

        let doc = collection
            .find_one(doc! { "symbol": symbol })
            .await?
            .ok_or("Symbol not found")?;

        let base = doc.get_str("base")?.to_string();
        let quote = doc.get_str("quote")?.to_string();

        Ok((base, quote))
    }

    /// Manually insert a mapping (for dynamic updates)
    pub async fn insert(&self, symbol: String, base: String, quote: String) {
        self.cache.insert(symbol, (base, quote)).await;
    }

    /// Get current cache entry count
    pub fn entry_count(&self) -> u64 {
        self.cache.entry_count()
    }
}
