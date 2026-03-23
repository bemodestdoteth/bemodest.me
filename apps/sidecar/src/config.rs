use std::env;
use std::str::FromStr;
use std::sync::{Arc, RwLock};

use std::collections::HashSet;
use crate::types::{SystemConfig, SystemConfigJwtSecret, SystemConfigNodeEnv};

#[derive(Clone)]
pub struct Config {
    pub inner: SystemConfig,
    pub port: u16,
    pub api_port: u16,
    pub jwt_secret: String,
    pub mongo_uri: Option<String>,
    pub redis_url: String,
    pub dex_redis_channel: String,
    pub batch_duration_ms: u64,
    pub filter_min_sources: usize,
    pub filter_min_spread_pct: f64,
    pub webhook_secret: String,
    pub forex_update_interval_sec: u64,
    pub market_cache_update_interval_sec: u64,
    pub excludelist: Arc<RwLock<HashSet<String>>>,
    pub pinlist: Arc<RwLock<HashSet<String>>>,
}

impl Config {
    pub fn from_env() -> Self {
        // Core required fields
        let jwt_secret_raw = env::var("JWT_SECRET").expect("JWT_SECRET must be set");
        let jwt_secret = SystemConfigJwtSecret::from_str(&jwt_secret_raw).expect("JWT_SECRET is too short");

        // Optional numeric fields with sane defaults
        let port = env::var("SIDECAR_PORT")
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(25834);
        let api_port = env::var("PORT")
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(3001);
        let batching_duration_ms = env::var("BATCHING_DURATION_MS")
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(1000);
        let filter_min_sources = env::var("FILTER_MIN_SOURCES")
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(2);
        let filter_min_spread_pct = env::var("FILTER_MIN_SPREAD_PCT")
            .ok()
            .and_then(|s| s.parse::<f64>().ok());

        // MongoDB URI logic
        let mongo_uri = env::var("MONGO_URI").ok().or_else(|| {
            if let (Ok(h), Ok(p), Ok(db), Ok(u), Ok(pw)) = (
                env::var("MONGO_HOST"), env::var("MONGO_PORT"), env::var("MONGO_DB_NAME"),
                env::var("MONGO_USER"), env::var("MONGO_PASSWORD")
            ) {
                let tls = env::var("MONGO_TLS").unwrap_or_else(|_| "false".to_string());
                let asrc = env::var("MONGO_AUTH_SOURCE").unwrap_or_else(|_| "admin".to_string());
                Some(format!("mongodb://{u}:{}@{h}:{p}/{db}?tls={tls}&authSource={asrc}", urlencoding::encode(&pw)))
            } else {
                None
            }
        });

        // Redis URL logic
        let redis_url = env::var("REDIS_URL").ok().or_else(|| {
            let host = env::var("REDIS_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
            let port = env::var("REDIS_PORT").unwrap_or_else(|_| "6380".to_string());
            env::var("REDIS_PASSWORD").ok().filter(|p| !p.is_empty()).map(|pass| {
                format!("redis://:{pass}@{host}:{port}")
            }).or(Some(format!("redis://{host}:{port}")))
        });

        let node_env = env::var("NODE_ENV")
            .ok()
            .and_then(|s| SystemConfigNodeEnv::from_str(&s).ok())
            .unwrap_or(SystemConfigNodeEnv::Dev);

        let inner = SystemConfig {
            port,
            api_port,
            sidecar_port: port,
            jwt_secret,
            snapper_api_secret: env::var("SNAPPER_API_SECRET").ok(),
            mongo_uri,
            redis_url: redis_url.clone(),
            dex_redis_channel: env::var("DEX_REDIS_CHANNEL").unwrap_or_else(|_| "dex_prices".to_string()),
            batching_duration_ms,
            filter_min_sources,
            filter_min_spread_pct,
            mongo_user: env::var("MONGO_USER").ok(),
            mongo_password: env::var("MONGO_PASSWORD").ok(),
            mongo_host: env::var("MONGO_HOST").ok(),
            mongo_port: env::var("MONGO_PORT").unwrap_or_else(|_| "27017".to_string()),
            mongo_db_name: env::var("MONGO_DB_NAME").ok(),
            redis_host: env::var("REDIS_HOST").ok(),
            redis_port: env::var("REDIS_PORT").unwrap_or_else(|_| "6380".to_string()),
            redis_password: env::var("REDIS_PASSWORD").ok(),
            node_env,
        };

        // App-specific overrides
        let forex_update_interval_sec = env::var("FOREX_UPDATE_INTERVAL_SEC")
            .ok().and_then(|s| s.parse().ok()).unwrap_or(60);
        let market_cache_update_interval_sec = env::var("MARKET_CACHE_UPDATE_INTERVAL_SEC")
            .ok().and_then(|s| s.parse().ok()).unwrap_or(1800);

        let excludelist_raw = env::var("EXCLUDELIST").unwrap_or_default();
        let excludelist_set = excludelist_raw.split(',').map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty()).collect();

        let pinlist_raw = env::var("PINLIST").unwrap_or_default();
        let pinlist_set = pinlist_raw.split(',').map(|s| s.trim().to_uppercase()).filter(|s| !s.is_empty()).collect();

        Config {
            port: inner.port as u16,
            api_port: inner.api_port as u16,
            jwt_secret: inner.jwt_secret.to_string(),
            mongo_uri: inner.mongo_uri.clone(),
            redis_url: inner.redis_url.clone().unwrap_or_else(|| "redis://127.0.0.1:6380".to_string()),
            dex_redis_channel: inner.dex_redis_channel.clone(),
            batch_duration_ms: inner.batching_duration_ms as u64,
            filter_min_sources: inner.filter_min_sources as usize,
            filter_min_spread_pct: inner.filter_min_spread_pct.unwrap_or(10.0),
            webhook_secret: inner.snapper_api_secret.clone().unwrap_or_default(),
            inner,
            forex_update_interval_sec,
            market_cache_update_interval_sec,
            excludelist: Arc::new(RwLock::new(excludelist_set)),
            pinlist: Arc::new(RwLock::new(pinlist_set)),
        }
    }
}



