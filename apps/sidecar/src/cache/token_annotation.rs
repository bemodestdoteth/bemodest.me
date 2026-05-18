use crate::types::Exchange as ExchangeType;
use futures_util::TryStreamExt;
use log::{error, info};
use mongodb::{bson::doc, Client};
use papaya::HashMap;

/// Highly optimized token annotation cache.
/// Maps "(exchange):(base_token)" -> "unified_token"
#[derive(Clone)]
pub struct TokenAnnotationCache {
    /// Internal map from "exchange_string:base_symbol" -> "unified_symbol"
    inner: HashMap<String, String>,
}

impl TokenAnnotationCache {
    /// Create uninitialized cache
    pub fn new() -> Self {
        Self {
            inner: HashMap::new(),
        }
    }

    /// Load from MongoDB (codys/tokenAnnotation collection)
    pub async fn init(mongo_uri: Option<&str>) -> Self {
        let cache = Self::new();

        if let Some(uri) = mongo_uri {
            match Client::with_uri_str(uri).await {
                Ok(client) => {
                    info!("[TokenAnnotationCache] Connected to MongoDB for annotations");
                    if let Err(e) = cache.preload(&client).await {
                        error!("[TokenAnnotationCache] Preload failed: {}", e);
                    }
                }
                Err(e) => {
                    error!("[TokenAnnotationCache] Failed to connect to MongoDB: {}", e);
                }
            }
        } else {
            info!("[TokenAnnotationCache] No MongoDB URI provided, cache will be empty");
        }

        cache
    }

    async fn preload(
        &self,
        client: &Client,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let db = client.database("codys");
        let collection = db.collection::<mongodb::bson::Document>("tokenAnnotation");

        let mut cursor = collection.find(doc! {}).await?;
        let mut count = 0;

        let guard = self.inner.guard();

        while let Some(document) = cursor.try_next().await? {
            let unified_token = document.get_str("token")?.to_string();
            if let Ok(annotation) = document.get_document("annotation") {
                for (exchange, value) in annotation.iter() {
                    if let Some(exchange_token) = value.as_str() {
                        // Key format: "binance:BEAMX"
                        let key = format!("{}:{}", exchange, exchange_token);
                        self.inner.insert(key, unified_token.clone(), &guard);
                        count += 1;
                    }
                }
            }
        }

        info!(
            "[TokenAnnotationCache] Preloaded {} token annotations",
            count
        );
        Ok(())
    }

    /// Retrieve the unified token name if it exists, otherwise return the original base_symbol
    pub fn get_unified(&self, exchange: &ExchangeType, base_symbol: &str) -> Option<String> {
        let key = format!("{}:{}", exchange, base_symbol);
        let guard = self.inner.guard();
        self.inner.get(&key, &guard).cloned()
    }

    /// Resolve the unified ticker base name using prioritized mapping (raw first, then stripped).
    pub fn resolve_ticker_base(
        &self,
        exchange: &ExchangeType,
        raw_base: &str,
        base: &str,
    ) -> String {
        if let Some(unified) = self.get_unified(exchange, raw_base) {
            unified
        } else if let Some(unified) = self.get_unified(exchange, base) {
            unified
        } else {
            base.to_string()
        }
    }
}
