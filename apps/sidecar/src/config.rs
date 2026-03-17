use std::env;
use std::sync::{Arc, RwLock};
use std::collections::HashSet;

#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub jwt_secret: String,
    pub mongo_uri: Option<String>,
    pub forex_update_interval_sec: u64,
    pub market_cache_update_interval_sec: u64,
    pub redis_url: String,
    pub dex_redis_channel: String,
    pub batch_duration_ms: u64,
    pub excludelist: Arc<RwLock<HashSet<String>>>,
    pub pinlist: Arc<RwLock<HashSet<String>>>,
    /// Minimum number of exchanges that must have a live price for a symbol
    /// before it is forwarded to the broadcast channel. (env: FILTER_MIN_SOURCES)
    pub filter_min_sources: usize,
    /// Minimum cross-exchange max-spread percentage required for broadcast.
    /// (env: FILTER_MIN_SPREAD_PCT)
    pub filter_min_spread_pct: f64,
    /// Shared HMAC-SHA256 secret for outbound webhook signatures.
    /// Reuses SNAPPER_API_SECRET so the Node API can verify with validateSignature().
    pub webhook_secret: String,
    /// Port the Node API listens on — used for the dead-webhook PATCH back-channel.
    pub api_port: u16,
}

impl Config {
    pub fn from_env() -> Self {
        // Use SIDECAR_PORT to avoid conflict with API's PORT when sharing the same .env file
        let port = env::var("SIDECAR_PORT")
            .unwrap_or_else(|_| "25834".to_string())
            .parse()
            .expect("SIDECAR_PORT must be a number");
        let jwt_secret = env::var("JWT_SECRET")
            .expect("JWT_SECRET must be set");
            
        let forex_update_interval_sec = env::var("FOREX_UPDATE_INTERVAL_SEC")
            .unwrap_or_else(|_| "60".to_string())
            .parse()
            .unwrap_or(60);

        let market_cache_update_interval_sec = env::var("MARKET_CACHE_UPDATE_INTERVAL_SEC")
            .unwrap_or_else(|_| "1800".to_string())
            .parse()
            .unwrap_or(1800);

        // Sentinel: Simplified Mongo URI assembly. Prioritize MONGO_URI.
        let mongo_uri = env::var("MONGO_URI").ok().or_else(|| {
            if let (Ok(h), Ok(p), Ok(db), Ok(u), Ok(pw), Ok(tls), Ok(asrc)) = (
                env::var("MONGO_HOST"), env::var("MONGO_PORT"), env::var("MONGO_DB_NAME"),
                env::var("MONGO_USER"), env::var("MONGO_PASSWORD"), env::var("MONGO_TLS"), env::var("MONGO_AUTH_SOURCE")
            ) {
                Some(format!("mongodb://{u}:{}@{h}:{p}/{db}?tls={tls}&authSource={asrc}", urlencoding::encode(&pw)))
            } else {
                None
            }
        });

        // Build Redis URL from shared .env vars
        let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| {
            let host = env::var("REDIS_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
            let port = env::var("REDIS_PORT").unwrap_or_else(|_| "6380".to_string()); // Default to TS port
            match env::var("REDIS_PASSWORD") {
                Ok(pass) if !pass.is_empty() => format!("redis://:{pass}@{host}:{port}"),
                _ => format!("redis://{host}:{port}"),
            }
        });

        let dex_redis_channel = env::var("DEX_REDIS_CHANNEL")
            .unwrap_or_else(|_| "dex_prices".to_string());

        let batch_duration_ms = env::var("BATCHING_DURATION_MS")
            .unwrap_or_else(|_| "1000".to_string())
            .parse()
            .unwrap_or(1000);

        let excludelist_raw = env::var("EXCLUDELIST")
            .unwrap_or_else(|_| "".to_string());
        let excludelist_set: HashSet<String> = excludelist_raw
            .split(',')
            .map(|s| s.trim().to_uppercase())
            .filter(|s| !s.is_empty())
            .collect();

        let pinlist_raw = env::var("PINLIST")
            .unwrap_or_else(|_| "".to_string());
        let pinlist_set: HashSet<String> = pinlist_raw
            .split(',')
            .map(|s| s.trim().to_uppercase())
            .filter(|s| !s.is_empty())
            .collect();

        let filter_min_sources = env::var("FILTER_MIN_SOURCES")
            .unwrap_or_else(|_| "2".to_string())
            .parse()
            .unwrap_or(2usize);

        let filter_min_spread_pct = env::var("FILTER_MIN_SPREAD_PCT")
            .unwrap_or_else(|_| "10.0".to_string())
            .parse()
            .unwrap_or(10.0f64);

        let webhook_secret = env::var("SNAPPER_API_SECRET")
            .unwrap_or_else(|_| "".to_string());

        let api_port = env::var("PORT")
            .unwrap_or_else(|_| "3000".to_string())
            .parse()
            .unwrap_or(3000u16);

        Config { 
            port, 
            jwt_secret, 
            mongo_uri,
            forex_update_interval_sec,
            market_cache_update_interval_sec,
            redis_url,
            dex_redis_channel,
            batch_duration_ms,
            excludelist: Arc::new(RwLock::new(excludelist_set)),
            pinlist: Arc::new(RwLock::new(pinlist_set)),
            filter_min_sources,
            filter_min_spread_pct,
            webhook_secret,
            api_port,
        }
    }
}
