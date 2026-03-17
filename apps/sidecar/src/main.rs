#![allow(dead_code)]
mod auth;
mod config;
mod websocket;
mod exchanges;
mod types;
mod normalizer;
mod cache;
mod comparison;
mod api;
mod redis_sub;
mod alert;

use crate::config::Config;
use crate::cache::TokenCache;
use crate::cache::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::ForexCache;
use crate::cache::MarketCache;
use crate::cache::PriceHistoryCache;
use crate::alert::engine::{load_alert_rules, run_history_sampler};
use crate::alert::state::AlertStateStore;
use crate::alert::types::AlertFiredEvent;
use log::{info, error};
use std::error::Error;
use tokio::sync::{broadcast, RwLock};
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::exchanges::{ExchangeManager, binance::BinanceExchange, upbit::UpbitExchange, bithumb::BithumbExchange, binance_f::BinanceFExchange, bybit::BybitExchange, bybit_f::BybitFExchange, gateio::GateioExchange, bitget::BitgetExchange, bitget_f::BitgetFExchange, coinbase::CoinbaseExchange, kraken::KrakenExchange, kucoin::KucoinExchange, okx::OkxExchange, okx_f::OkxFExchange, geckoterminal::GeckoterminalExchange};
use redis::AsyncCommands;


#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut set = tokio::task::JoinSet::new();


    // Initialize logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    
    // Load environment variables
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let env_file = match std::env::var("NODE_ENV") {
        Ok(val) if val == "dev" => format!("{}/../api/.env.dev", manifest_dir),
        _ => format!("{}/../api/.env", manifest_dir),
    };
    
    if let Err(_) = dotenvy::from_path(&env_file) {
        // Fallback to local .env in CWD or system environment
        if let Err(_) = dotenvy::dotenv() {
            log::warn!("No .env file found at {} or in current directory. Using system environment variables.", env_file);
        } else {
            info!("Loaded environment from local .env");
        }
    } else {
        info!("Loaded environment from {}", env_file);
    }
    
    let config = Arc::new(Config::from_env());

    // Pre-declare alert rules Arc so the pubsub task can reload it on alertrules_updated
    let alert_rules: Arc<RwLock<Vec<crate::alert::types::AlertRule>>> =
        Arc::new(RwLock::new(Vec::new()));

    // Initialize Exchange Manager
    let manager = ExchangeManager::new();
    let manager = Arc::new(Mutex::new(manager));
    let manager_clone = manager.clone();

    // Start Redis configuration subscriber for dynamically updating excludelist
    let pubsub_client_res = redis::Client::open(config.redis_url.clone());
    if let Ok(client) = pubsub_client_res {
        let config_clone = config.clone();
        let alert_rules_clone = alert_rules.clone();
        set.spawn(async move {
            let mut backoff = 1;
            loop {
                // 1) Fetch initial from Redis
                if let Ok(mut cmd_conn) = client.get_multiplexed_async_connection().await {
                    let new_list: redis::RedisResult<Vec<String>> = cmd_conn.smembers("config:excludelist").await;
                    if let Ok(list) = new_list {
                        if !list.is_empty() {
                            let mut write_lock = config_clone.excludelist.write().unwrap();
                            write_lock.clear();
                            for item in list {
                                write_lock.insert(item.to_uppercase());
                            }
                            info!("Updated sidecar excludelist from Redis on startup: {:?}", *write_lock);
                        }
                    }
                    
                    let new_pin_list: redis::RedisResult<Vec<String>> = cmd_conn.smembers("config:pinlist").await;
                    if let Ok(list) = new_pin_list {
                        if !list.is_empty() {
                            let mut write_lock = config_clone.pinlist.write().unwrap();
                            write_lock.clear();
                            for item in list {
                                write_lock.insert(item.to_uppercase());
                            }
                            info!("Updated sidecar pinlist from Redis on startup: {:?}", *write_lock);
                        }
                    }
                }

                // 2) Subscribe and listen via Redis Streams
                match client.get_multiplexed_async_connection().await {
                    Ok(mut conn) => {
                        // Create consumer group
                        let _ : redis::RedisResult<()> = redis::cmd("XGROUP")
                            .arg("CREATE").arg("sidecar:config").arg("sidecar_group").arg("$").arg("MKSTREAM")
                            .query_async(&mut conn).await;

                        info!("Subscribed to sidecar:config Redis stream");
                        backoff = 1;

                        loop {
                            let opts = redis::streams::StreamReadOptions::default()
                                .group("sidecar_group", "consumer-1")
                                .block(5000)
                                .count(10);
                            
                            let results: redis::RedisResult<redis::streams::StreamReadReply> =
                                conn.xread_options(&["sidecar:config"], &[">"], &opts).await;

                            match results {
                                Ok(reply) => {
                                    for key in reply.keys {
                                        for msg in key.ids {
                                            if let Some(payload_val) = msg.map.get("payload") {
                                                if let redis::Value::BulkString(bytes) = payload_val {
                                                    if let Ok(payload) = std::str::from_utf8(bytes) {
                                                        if let Ok(json) = serde_json::from_str::<crate::types::generated::SidecarConfigPayload>(payload) {
                                                            match json.sidecar_config_payload_type {
                                                                 crate::types::generated::Type::ExcludelistUpdated => {
                                                                     let new_list: redis::RedisResult<Vec<String>> = conn.smembers("config:excludelist").await;
                                                                     if let Ok(list) = new_list {
                                                                         {
                                                                             let mut write_lock = config_clone.excludelist.write().unwrap();
                                                                             write_lock.clear();
                                                                             for item in list {
                                                                                 write_lock.insert(item.to_uppercase());
                                                                             }
                                                                         }
                                                                         info!("Updated sidecar excludelist from Redis stream");
                                                                     }
                                                                 }
                                                                 crate::types::generated::Type::PinlistUpdated => {
                                                                     let new_pin_list: redis::RedisResult<Vec<String>> = conn.smembers("config:pinlist").await;
                                                                     if let Ok(list) = new_pin_list {
                                                                         {
                                                                             let mut write_lock = config_clone.pinlist.write().unwrap();
                                                                             write_lock.clear();
                                                                             for item in list {
                                                                                 write_lock.insert(item.to_uppercase());
                                                                             }
                                                                         }
                                                                         info!("Updated sidecar pinlist from Redis stream");
                                                                         
                                                                         // Trigger dynamic subscription refresh for all exchanges
                                                                         manager_clone.lock().await.refresh_all_subscriptions().await;
                                                                     }
                                                                 }
                                                                crate::types::generated::Type::AlertrulesUpdated => {
                                                                    let reloaded = load_alert_rules(&config_clone).await;
                                                                    let count = reloaded.len();
                                                                    let mut guard = alert_rules_clone.write().await;
                                                                    *guard = reloaded;
                                                                    info!("[AlertEngine] Reloaded {} alert rules from Redis stream", count);
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                            // Acknowledge message
                                            let _ : redis::RedisResult<()> = redis::cmd("XACK")
                                                .arg("sidecar:config").arg("sidecar_group").arg(&msg.id)
                                                .query_async(&mut conn).await;
                                        }
                                    }
                                }
                                Err(e) => {
                                    // Redis-rs might timeout gracefully or return IO error on block timeout, loop if so
                                    if !e.is_io_error() && !e.is_timeout() {
                                        error!("Redis Stream read error: {}", e);
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        error!("Redis connection error: {}", e);
                        tokio::time::sleep(tokio::time::Duration::from_secs(backoff)).await;
                        backoff = std::cmp::min(backoff * 2, 60);
                    }
                }
            }
        });
    }

    info!("Starting Sidecar on port {}", config.port);

    // Initialize Token Cache (Phase 2)
    let token_cache = TokenCache::new(config.mongo_uri.as_deref()).await;
    let token_cache = Arc::new(token_cache);
    info!("[Sidecar] Token cache initialized with {} entries", token_cache.entry_count());

    // Initialize Latest-Value Cache (Phase 3)
    let lvc = Arc::new(LatestValueCache::new());
    info!("[Sidecar] Latest-Value Cache initialized");

    // Initialize Token Annotation Cache (Unification Layer)
    let tac = Arc::new(TokenAnnotationCache::init(config.mongo_uri.as_deref()).await);
    info!("[Sidecar] Token Annotation Cache initialized");

    // Initialize Forex Rate Cache — polls UPBIT_FOREX_URL using configurable interval
    let forex_cache = ForexCache::new();
    ForexCache::start_poller(forex_cache.clone(), std::time::Duration::from_secs(config.forex_update_interval_sec));
    info!("[Sidecar] Forex Rate Cache initialized (polling every {}s)", config.forex_update_interval_sec);

    // Initialize Market Cache — fetch once (blocking), then poll using configurable interval
    let market_cache = MarketCache::new();
    MarketCache::initial_fetch(&market_cache).await;
    MarketCache::start_poller(market_cache.clone(), std::time::Duration::from_secs(config.market_cache_update_interval_sec));
    info!("[Sidecar] Market Cache initialized (polling every {}s)", config.market_cache_update_interval_sec);

    // ── Alert System (Phase 5 wiring) ────────────────────────────────────────

    // 1. Init price history buffer (1 sample/sec, 300 entries per key = 5 min)
    let history_cache = Arc::new(PriceHistoryCache::new());

    // 2. Spawn history sampler (1 Hz tick)
    let lvc_sampler = lvc.clone();
    let hist_sampler = history_cache.clone();
    set.spawn(async move {
        run_history_sampler(lvc_sampler, hist_sampler).await;
    });
    info!("[Sidecar] Price history sampler spawned (1 Hz)");

    // 3. Load alert rules from MongoDB and populate the shared Arc
    let initial_rules = load_alert_rules(&config).await;
    info!("[Sidecar] Loaded {} alert rules on startup", initial_rules.len());
    {
        let mut guard = alert_rules.write().await;
        *guard = initial_rules;
    }

    // 4. Init Redis-backed alert state store
    let alert_state_store = AlertStateStore::new(&config.redis_url).await;
    info!("[Sidecar] Alert state store connected to Redis");

    // 5. Alert fired broadcast channel
    let (alert_tx, _) = broadcast::channel::<AlertFiredEvent>(1000);

    // 6. Spawn alert engine (500 ms evaluation tick)
    {
        let lvc_e        = lvc.clone();
        let hist_e       = history_cache.clone();
        let rules_e      = alert_rules.clone();
        let alert_tx_e   = alert_tx.clone();
        set.spawn(async move {
            crate::alert::engine::run(
                lvc_e, hist_e, rules_e, alert_state_store, alert_tx_e,
            ).await;
        });
    }
    info!("[Sidecar] Alert engine spawned (500 ms tick)");

    // 7. Spawn webhook dispatcher
    {
        let rx  = alert_tx.subscribe();
        let cfg = config.clone();
        set.spawn(async move {
            crate::alert::webhook::run(rx, cfg).await;
        });
    }
    info!("[Sidecar] Webhook dispatcher spawned");

    // Binance !ticker@arr sends ~300-500 messages/sec
    // Buffer sized for 20s lag tolerance before message drop
    let (tx, _) = broadcast::channel(10000);
    
    {
        let mut mg = manager.lock().await;
        // Register Binance (Lazy connect)
        let binance = Box::new(BinanceExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), config.clone()));
        mg.register("binance", binance);
        
        // Register Upbit (Lazy connect)
        let upbit = Box::new(UpbitExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), forex_cache.clone(), market_cache.clone(), config.clone()));
        mg.register("upbit", upbit);

        // Register Bithumb (Lazy connect)
        let bithumb = Box::new(BithumbExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), forex_cache.clone(), market_cache.clone(), config.clone()));
        mg.register("bithumb", bithumb);

        // Register Binance Futures (Lazy connect)
        let binance_f = Box::new(BinanceFExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), config.clone()));
        mg.register("binance_f", binance_f);

        // Register Bybit Spot (Lazy connect)
        let bybit = Box::new(BybitExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("bybit", bybit);

        // Register Bybit Futures (Lazy connect)
        let bybit_f = Box::new(BybitFExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("bybit_f", bybit_f);

        // Register Gateio Spot (Lazy connect)
        let gateio = Box::new(GateioExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("gateio", gateio);

        // Register Bitget Spot (Lazy connect)
        let bitget = Box::new(BitgetExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("bitget", bitget);

        // Register Bitget Futures (Lazy connect)
        let bitget_f = Box::new(BitgetFExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("bitget_f", bitget_f);

        // Register Coinbase Spot (Lazy connect)
        let coinbase = Box::new(CoinbaseExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("coinbase", coinbase);
        
        // Register Kraken Spot (Lazy connect)
        let kraken = Box::new(KrakenExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("kraken", kraken);

        // Register KuCoin Spot (Lazy connect)
        let kucoin = Box::new(KucoinExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("kucoin", kucoin);

        // Register OKX Spot (Lazy connect)
        let okx = Box::new(OkxExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("okx", okx);
        
        // Register OKX Futures (Lazy connect)
        let okx_f = Box::new(OkxFExchange::new(tx.clone(), true, lvc.clone(), tac.clone(), market_cache.clone(), config.clone()));
        mg.register("okx_f", okx_f);

        // Register Geckoterminal (DEX Poller)
        let gt = Box::new(GeckoterminalExchange::new(tx.clone(), lvc.clone(), tac.clone(), config.clone()));
        mg.register("geckoterminal", gt);
    }
    
    // Start DEX Redis subscriber (forwards dex_prices channel into broadcast tx)
    let dex_tx = tx.clone();
    let dex_redis_url = config.redis_url.clone();
    let dex_channel = config.dex_redis_channel.clone();
    let dex_lvc = lvc.clone();
    let dex_filter = crate::cache::EligibilityFilter::new(config.filter_min_sources, config.filter_min_spread_pct, config.pinlist.clone());

    set.spawn(async move {
        redis_sub::run_dex_subscriber(dex_redis_url, dex_channel, dex_tx, dex_lvc, dex_filter).await;
    });
    info!("[Sidecar] DEX Redis subscriber task spawned");

    // Start WebSocket Server
    set.spawn(async move {
        websocket::run_server(config.port, config.jwt_secret.clone(), tx, manager, lvc).await;
    });
    
    info!("[Sidecar] Supervisor loop started monitoring tasks");
    while let Some(res) = set.join_next().await {
        match res {
            Ok(_) => error!("[Sidecar] A critical task exited gracefully. This is unexpected. Terminating process."),
            Err(e) => {
                if e.is_panic() {
                    error!("[Sidecar] A critical task panicked: {}. Terminating process.", e);
                } else {
                    error!("[Sidecar] A critical task failed to join: {}. Terminating process.", e);
                }
            }
        }
        std::process::exit(1);
    }
    
    Ok(())
}
