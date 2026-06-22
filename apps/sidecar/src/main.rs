#![allow(dead_code)]
mod alert;
mod api;
mod auth;
mod cache;
mod chain_annotations;
mod comparison;
mod config;
mod errors;
mod exchanges;
mod market_summary;
mod normalizer;
mod redis_sub;
mod types;
mod websocket;

use crate::alert::engine::load_alert_runtime_config;
use crate::alert::state::AlertStateStore;
use crate::alert::types::AlertFiredEvent;
use crate::cache::ForexCache;
use crate::cache::LatestValueCache;
use crate::cache::MarketCache;
use crate::cache::PriceHistoryCache;
use crate::cache::TokenAnnotationCache;
use crate::cache::TokenCache;
use crate::config::Config;
use crate::exchanges::generic::GenericExchange;
use crate::exchanges::ExchangeManager;
use crate::types::now_micros;
use log::{error, info, warn};
use redis::AsyncCommands;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::sync::{broadcast, RwLock};
use tokio::time::interval;

#[tokio::main]
async fn main() -> crate::errors::Result<()> {
    let mut set = tokio::task::JoinSet::new();

    // Initialize logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // Load environment variables
    let node_env = std::env::var("NODE_ENV").unwrap_or_else(|_| "dev".to_string());

    // Try .env.dev if in dev mode, otherwise fallback to .env
    if node_env == "dev" {
        if let Err(_) = dotenvy::from_filename(".env.dev") {
            let _ = dotenvy::dotenv(); // Fallback to standard .env
        }
    } else {
        let _ = dotenvy::dotenv();
    }

    if std::env::var("JWT_SECRET").is_err() {
        if node_env == "dev" {
            let _ = dotenvy::from_path("../api/.env.dev");
        }
        if std::env::var("JWT_SECRET").is_err() {
            let _ = dotenvy::dotenv(); // Recursive search up for .env
        }
    }

    info!(
        "Configuration environment initialized (NODE_ENV={})",
        node_env
    );

    let config = Arc::new(Config::from_env());

    // Pre-declare alert runtime config Arc so the pubsub task can reload it on alertrules_updated
    let alert_runtime_config: Arc<RwLock<crate::alert::types::AlertRuntimeConfig>> = Arc::new(
        RwLock::new(crate::alert::types::AlertRuntimeConfig::default()),
    );

    // Initialize Exchange Manager
    let manager = ExchangeManager::new();
    let manager = Arc::new(Mutex::new(manager));

    // Start Redis configuration subscriber for dynamically updating excludelist
    let pubsub_client_res = redis::Client::open(config.redis_url.clone());
    if let Ok(client) = pubsub_client_res {
        let config_clone = config.clone();
        let alert_runtime_config_clone = alert_runtime_config.clone();
        let manager_redis = manager.clone();
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
                                                        if let Ok(json) = serde_json::from_str::<crate::types::SidecarConfigPayload>(payload) {
                                                            match json.type_ {
                                                                 crate::types::Type::ExcludelistUpdated => {
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
                                                                 crate::types::Type::PinlistUpdated => {
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
                                                                         manager_redis.lock().await.refresh_all_subscriptions().await;
                                                                     }
                                                                 }
                                                                 crate::types::Type::MarketCacheUpdated => {
                                                                     info!("[Sidecar] market_cache_updated received; refreshing all WebSocket subscriptions");
                                                                     manager_redis.lock().await.refresh_all_subscriptions().await;
                                                                 }
                                                                 crate::types::Type::AlertrulesUpdated => {
                                                                    let reloaded = load_alert_runtime_config(&config_clone).await;
                                                                    let count = reloaded.rules.len();
                                                                    let mut guard = alert_runtime_config_clone.write().await;
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

    // Initialize Token Cache
    let token_cache = TokenCache::new(config.mongo_uri.as_deref()).await;
    let token_cache = Arc::new(token_cache);
    info!(
        "[Sidecar] Token cache initialized with {} entries",
        token_cache.entry_count()
    );

    // Main broadcast channel for ticker data
    let (tx, _) = broadcast::channel(10000);

    // Initialize Latest-Value Cache
    let lvc = Arc::new(LatestValueCache::new());
    info!("[Sidecar] Latest-Value Cache initialized");

    // Initialize Token Annotation Cache
    let tac = Arc::new(TokenAnnotationCache::init(config.mongo_uri.as_deref()).await);
    info!("[Sidecar] Token Annotation Cache initialized");

    // Initialize Forex Rate Cache
    let forex_cache = ForexCache::new();
    ForexCache::start_poller(
        forex_cache.clone(),
        tx.clone(),
        std::time::Duration::from_secs(config.forex_update_interval_sec),
    );
    info!(
        "[Sidecar] Forex Rate Cache initialized (polling every {}s)",
        config.forex_update_interval_sec
    );

    // Initialize Market Cache
    let market_cache = MarketCache::new();
    MarketCache::initial_fetch(&market_cache).await;
    let (market_refresh_tx, _) = tokio::sync::broadcast::channel::<()>(16);

    {
        let manager_refresh = manager.clone();
        let mut market_refresh_rx = market_refresh_tx.subscribe();
        let market_cache_refresh = market_cache.clone();
        let lvc_refresh = lvc.clone();
        let tac_refresh = tac.clone();
        let config_refresh = config.clone();
        let tx_refresh = tx.clone();
        set.spawn(async move {
            while market_refresh_rx.recv().await.is_ok() {
                info!("[Sidecar] local market cache update received; refreshing WebSocket subscriptions");
                manager_refresh.lock().await.refresh_all_subscriptions().await;
                crate::exchanges::binance_f::backfill_missing_markets(
                    &market_cache_refresh,
                    &lvc_refresh,
                    &tac_refresh,
                    &config_refresh,
                    tx_refresh.clone(),
                )
                .await;
            }
        });
    }

    let mc_arc = market_cache.clone();
    MarketCache::start_poller(
        mc_arc.clone(),
        std::time::Duration::from_secs(config.market_cache_update_interval_sec),
        config.redis_url.clone(),
        Some(market_refresh_tx.clone()),
    );
    MarketCache::start_korean_poller(
        mc_arc.clone(),
        std::time::Duration::from_secs(config.korean_market_cache_update_interval_sec),
        config.redis_url.clone(),
        Some(market_refresh_tx.clone()),
    );
    info!(
        "[Sidecar] Market Cache initialized (polling every {}s; Korean markets every {}s)",
        config.market_cache_update_interval_sec, config.korean_market_cache_update_interval_sec
    );

    crate::exchanges::binance_f::backfill_missing_markets(
        &market_cache,
        &lvc,
        &tac,
        &config,
        tx.clone(),
    )
    .await;

    {
        let market_cache_backfill = market_cache.clone();
        let lvc_backfill = lvc.clone();
        let tac_backfill = tac.clone();
        let config_backfill = config.clone();
        let tx_backfill = tx.clone();
        set.spawn(async move {
            let mut tick = interval(Duration::from_secs(30));
            loop {
                tick.tick().await;
                crate::exchanges::binance_f::backfill_missing_markets(
                    &market_cache_backfill,
                    &lvc_backfill,
                    &tac_backfill,
                    &config_backfill,
                    tx_backfill.clone(),
                )
                .await;
            }
        });
    }
    info!("[Sidecar] BinanceF missing-market backfill refresher spawned (30s)");

    // Alert System wiring
    let history_cache = Arc::new(PriceHistoryCache::new());

    {
        let lvc_pruner = lvc.clone();
        let hist_pruner = history_cache.clone();
        set.spawn(async move {
            let mut tick = interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                let removed_lvc = lvc_pruner.prune_stale();
                let removed_history = hist_pruner.prune_stale(now_micros() / 1000);
                if removed_lvc > 0 || removed_history > 0 {
                    info!(
                        "[Sidecar] Pruned stale cache entries: lvc={}, history={}",
                        removed_lvc, removed_history
                    );
                }
            }
        });
    }
    info!("[Sidecar] Cache stale-entry pruner spawned (60s)");

    let initial_alert_config = load_alert_runtime_config(&config).await;
    info!(
        "[Sidecar] Loaded {} alert rules on startup",
        initial_alert_config.rules.len()
    );
    {
        let mut guard = alert_runtime_config.write().await;
        *guard = initial_alert_config;
    }

    let alert_state_store = AlertStateStore::new(&config.redis_url).await;
    info!("[Sidecar] Alert state store connected to Redis");
    let (alert_tx, _) = broadcast::channel::<AlertFiredEvent>(1000);

    {
        let lvc_e = lvc.clone();
        let hist_e = history_cache.clone();
        let forex_e = forex_cache.clone();
        let rules_e = alert_runtime_config.clone();
        let alert_tx_e = alert_tx.clone();
        let tx_e = tx.clone();
        let config_e = config.clone();
        set.spawn(async move {
            crate::alert::engine::run(
                lvc_e,
                hist_e,
                forex_e,
                rules_e,
                alert_state_store,
                alert_tx_e,
                tx_e,
                config_e,
            )
            .await;
        });
    }
    info!("[Sidecar] Alert/visibility engine spawned (1000 ms tick)");

    {
        let rx = alert_tx.subscribe();
        let cfg = config.clone();
        set.spawn(async move {
            crate::alert::webhook::run(rx, cfg).await;
        });
    }
    info!("[Sidecar] Webhook dispatcher spawned");

    {
        let mut mg = manager.lock().await;

        // Register Binance
        mg.register(
            "binance",
            Box::new(GenericExchange::new(
                "binance",
                crate::exchanges::binance::TICKER_STREAM_URL,
                tx.clone(),
                true,
                lvc.clone(),
                tac.clone(),
                config.clone(),
                Arc::new({
                    let tac = tac.clone();
                    let cfg = config.clone();
                    let lvc = lvc.clone();
                    move |t, b| crate::exchanges::binance::handle_message(t, b, &tac, &cfg, &lvc)
                }),
                None,
            )),
        );

        // Register Upbit
        mg.register(
            "upbit",
            Box::new(
                GenericExchange::new(
                    "upbit",
                    crate::exchanges::upbit::TICKER_STREAM_URL,
                    tx.clone(),
                    true,
                    lvc.clone(),
                    tac.clone(),
                    config.clone(),
                    Arc::new({
                        let lvc = lvc.clone();
                        let tac = tac.clone();
                        let forex = forex_cache.clone();
                        let cfg = config.clone();
                        move |t, b| {
                            crate::exchanges::upbit::handle_message(t, b, &lvc, &tac, &forex, &cfg)
                        }
                    }),
                    Some(Arc::new({
                        let mc = mc_arc.clone();
                        move || {
                            Box::pin({
                                let mc = mc.clone();
                                async move {
                                    crate::exchanges::upbit::wait_for_market_cache(&mc).await;
                                    crate::exchanges::upbit::subscription_factory(mc).await
                                }
                            })
                        }
                    })),
                )
                .with_reconnect_on_refresh(),
            ),
        );

        // Register Bithumb
        mg.register(
            "bithumb",
            Box::new(
                GenericExchange::new(
                    "bithumb",
                    crate::exchanges::bithumb::TICKER_STREAM_URL,
                    tx.clone(),
                    true,
                    lvc.clone(),
                    tac.clone(),
                    config.clone(),
                    Arc::new({
                        let lvc = lvc.clone();
                        let tac = tac.clone();
                        let forex = forex_cache.clone();
                        let cfg = config.clone();
                        move |t, b| {
                            crate::exchanges::bithumb::handle_message(
                                t, b, &lvc, &tac, &forex, &cfg,
                            )
                        }
                    }),
                    Some(Arc::new({
                        let mc = mc_arc.clone();
                        move || {
                            Box::pin({
                                let mc = mc.clone();
                                async move {
                                    crate::exchanges::bithumb::wait_for_market_cache(&mc).await;
                                    crate::exchanges::bithumb::subscription_factory(mc).await
                                }
                            })
                        }
                    })),
                )
                .with_reconnect_on_refresh(),
            ),
        );

        // Register Binance Futures
        mg.register(
            "binance_f",
            Box::new(GenericExchange::new(
                "binance_f",
                crate::exchanges::binance_f::TICKER_STREAM_URL,
                tx.clone(),
                true,
                lvc.clone(),
                tac.clone(),
                config.clone(),
                Arc::new({
                    let tac = tac.clone();
                    let cfg = config.clone();
                    let lvc = lvc.clone();
                    move |t, b| crate::exchanges::binance_f::handle_message(t, b, &tac, &cfg, &lvc)
                }),
                None,
            )),
        );

        // Register Bybit Spot
        mg.register(
            "bybit",
            Box::new(GenericExchange::new(
                "bybit",
                crate::exchanges::bybit::TICKER_STREAM_URL,
                tx.clone(),
                true,
                lvc.clone(),
                tac.clone(),
                config.clone(),
                Arc::new({
                    let tac = tac.clone();
                    let cfg = config.clone();
                    let lvc = lvc.clone();
                    move |t, b| crate::exchanges::bybit::handle_message(t, b, &tac, &cfg, &lvc)
                }),
                Some(Arc::new({
                    let mc = mc_arc.clone();
                    move || {
                        Box::pin({
                            let mc = mc.clone();
                            async move {
                                crate::exchanges::bybit::wait_for_market_cache(&mc).await;
                                crate::exchanges::bybit::subscription_factory(mc).await
                            }
                        })
                    }
                })),
            )),
        );

        // Register Bybit Futures
        mg.register(
            "bybit_f",
            Box::new(GenericExchange::new(
                "bybit_f",
                crate::exchanges::bybit_f::FUTURES_STREAM_URL,
                tx.clone(),
                true,
                lvc.clone(),
                tac.clone(),
                config.clone(),
                Arc::new({
                    let tac = tac.clone();
                    let cfg = config.clone();
                    let lvc = lvc.clone();
                    move |t, b| crate::exchanges::bybit_f::handle_message(t, b, &tac, &cfg, &lvc)
                }),
                Some(Arc::new({
                    let mc = mc_arc.clone();
                    move || {
                        Box::pin({
                            let mc = mc.clone();
                            async move {
                                crate::exchanges::bybit_f::wait_for_market_cache(&mc).await;
                                crate::exchanges::bybit_f::subscription_factory(mc).await
                            }
                        })
                    }
                })),
            )),
        );

        mg.register(
            "gateio",
            Box::new(
                GenericExchange::new(
                    "gateio",
                    crate::exchanges::gateio::TICKER_STREAM_URL,
                    tx.clone(),
                    true,
                    lvc.clone(),
                    tac.clone(),
                    config.clone(),
                    Arc::new({
                        let tac = tac.clone();
                        let cfg = config.clone();
                        let lvc = lvc.clone();
                        move |t, b| crate::exchanges::gateio::handle_message(t, b, &tac, &cfg, &lvc)
                    }),
                    Some(Arc::new({
                        let mc = mc_arc.clone();
                        move || {
                            Box::pin({
                                let mc = mc.clone();
                                async move {
                                    crate::exchanges::gateio::wait_for_market_cache(&mc).await;
                                    crate::exchanges::gateio::subscription_factory(mc).await
                                }
                            })
                        }
                    })),
                )
                .with_ping_factory(Arc::new(crate::exchanges::gateio::ping_factory)),
            ),
        );

        // Register Bitget Spot
        mg.register(
            "bitget",
            Box::new(GenericExchange::new(
                "bitget",
                crate::exchanges::bitget::TICKER_STREAM_URL,
                tx.clone(),
                true,
                lvc.clone(),
                tac.clone(),
                config.clone(),
                Arc::new({
                    let tac = tac.clone();
                    let cfg = config.clone();
                    let lvc = lvc.clone();
                    move |t, b| crate::exchanges::bitget::handle_message(t, b, &tac, &cfg, &lvc)
                }),
                Some(Arc::new({
                    let mc = mc_arc.clone();
                    move || {
                        Box::pin({
                            let mc = mc.clone();
                            async move {
                                crate::exchanges::bitget::wait_for_market_cache(&mc).await;
                                crate::exchanges::bitget::subscription_factory(mc).await
                            }
                        })
                    }
                })),
            )),
        );

        // Register Bitget Futures
        mg.register(
            "bitget_f",
            Box::new(GenericExchange::new(
                "bitget_f",
                crate::exchanges::bitget_f::TICKER_STREAM_URL,
                tx.clone(),
                true,
                lvc.clone(),
                tac.clone(),
                config.clone(),
                Arc::new({
                    let tac = tac.clone();
                    let cfg = config.clone();
                    let lvc = lvc.clone();
                    move |t, b| crate::exchanges::bitget_f::handle_message(t, b, &tac, &cfg, &lvc)
                }),
                Some(Arc::new({
                    let mc = mc_arc.clone();
                    move || {
                        Box::pin({
                            let mc = mc.clone();
                            async move {
                                crate::exchanges::bitget_f::wait_for_market_cache(&mc).await;
                                crate::exchanges::bitget_f::subscription_factory(mc).await
                            }
                        })
                    }
                })),
            )),
        );

        // Register Hyperliquid Futures
        mg.register(
            "hyperliquid_f",
            Box::new(GenericExchange::new(
                "hyperliquid_f",
                crate::exchanges::hyperliquid_f::WS_URL,
                tx.clone(),
                true,
                lvc.clone(),
                tac.clone(),
                config.clone(),
                Arc::new({
                    let tac = tac.clone();
                    let cfg = config.clone();
                    let lvc = lvc.clone();
                    move |t, b| {
                        crate::exchanges::hyperliquid_f::handle_message(t, b, &tac, &cfg, &lvc)
                    }
                }),
                Some(Arc::new({
                    let mc = mc_arc.clone();
                    move || {
                        Box::pin({
                            let mc = mc.clone();
                            async move {
                                crate::exchanges::hyperliquid_f::wait_for_market_cache(&mc).await;
                                crate::exchanges::hyperliquid_f::subscription_factory(mc).await
                            }
                        })
                    }
                })),
            )),
        );

        // Register Coinbase
        mg.register(
            "coinbase",
            Box::new(GenericExchange::new(
                "coinbase",
                crate::exchanges::coinbase::TICKER_STREAM_URL,
                tx.clone(),
                true,
                lvc.clone(),
                tac.clone(),
                config.clone(),
                Arc::new({
                    let tac = tac.clone();
                    let cfg = config.clone();
                    let lvc = lvc.clone();
                    move |t, b| crate::exchanges::coinbase::handle_message(t, b, &tac, &cfg, &lvc)
                }),
                Some(Arc::new({
                    let mc = mc_arc.clone();
                    move || {
                        Box::pin({
                            let mc = mc.clone();
                            async move {
                                crate::exchanges::coinbase::wait_for_market_cache(&mc).await;
                                crate::exchanges::coinbase::subscription_factory(mc).await
                            }
                        })
                    }
                })),
            )),
        );

        // Register Kraken
        mg.register(
            "kraken",
            Box::new(GenericExchange::new(
                "kraken",
                crate::exchanges::kraken::TICKER_STREAM_URL,
                tx.clone(),
                true,
                lvc.clone(),
                tac.clone(),
                config.clone(),
                Arc::new({
                    let tac = tac.clone();
                    let cfg = config.clone();
                    let lvc = lvc.clone();
                    move |t, b| crate::exchanges::kraken::handle_message(t, b, &tac, &cfg, &lvc)
                }),
                Some(Arc::new({
                    let mc = mc_arc.clone();
                    move || {
                        Box::pin({
                            let mc = mc.clone();
                            async move {
                                crate::exchanges::kraken::wait_for_market_cache(&mc).await;
                                crate::exchanges::kraken::subscription_factory(mc).await
                            }
                        })
                    }
                })),
            )),
        );

        // Register Kucoin (Sharded)
        let (kc_tx, kc_lvc, kc_tac, kc_cfg, kc_mc) = (
            tx.clone(),
            lvc.clone(),
            tac.clone(),
            config.clone(),
            mc_arc.clone(),
        );
        let kc_manager = manager.clone();
        tokio::spawn(async move {
            let symbols = crate::exchanges::kucoin::wait_for_market_cache(&kc_mc).await;
            for (shard_idx, chunk) in symbols
                .chunks(crate::exchanges::kucoin::MAX_SYMBOLS_PER_CONN)
                .enumerate()
            {
                let shard_name = format!("kucoin_shard_{}", shard_idx);
                let (s_tx, s_lvc, s_tac, s_cfg, s_chunk) = (
                    kc_tx.clone(),
                    kc_lvc.clone(),
                    kc_tac.clone(),
                    kc_cfg.clone(),
                    chunk.to_vec(),
                );
                let exchange = Box::new(
                    GenericExchange::new(
                        &shard_name,
                        "",
                        s_tx.clone(),
                        true,
                        s_lvc.clone(),
                        s_tac.clone(),
                        s_cfg.clone(),
                        Arc::new({
                            let s_tac = s_tac.clone();
                            let s_cfg = s_cfg.clone();
                            let s_lvc = s_lvc.clone();
                            move |t, b| {
                                crate::exchanges::kucoin::handle_message(
                                    t, b, &s_tac, &s_cfg, &s_lvc,
                                )
                            }
                        }),
                        Some(Arc::new({
                            let inner_chunk = s_chunk.clone();
                            move || {
                                Box::pin({
                                    let chunk = inner_chunk.clone();
                                    async move {
                                        crate::exchanges::kucoin::subscription_factory(chunk).await
                                    }
                                })
                            }
                        })),
                    )
                    .with_url_factory(Arc::new(|| {
                        Box::pin(async move {
                            crate::exchanges::kucoin::get_ws_token()
                                .await
                                .map(|(e, t, _)| {
                                    let cid = uuid::Uuid::new_v4().to_string().replace('-', "");
                                    format!("{}?token={}&connectId={}", e, t, cid)
                                })
                        })
                    }))
                    .with_ping_factory(Arc::new(crate::exchanges::kucoin::ping_factory))
                    .with_ping_interval(Duration::from_millis(
                        crate::exchanges::kucoin::DEFAULT_PING_INTERVAL_MS,
                    )),
                );

                kc_manager.lock().await.register(&shard_name, exchange);
                let _ = kc_manager.lock().await.ensure_connected(&shard_name).await;
            }
        });

        // Register OKX (Sharded)
        let (ok_tx, ok_lvc, ok_tac, ok_cfg, ok_mc) = (
            tx.clone(),
            lvc.clone(),
            tac.clone(),
            config.clone(),
            mc_arc.clone(),
        );
        let ok_manager = manager.clone();
        tokio::spawn(async move {
            let symbols = crate::exchanges::okx::wait_for_market_cache(&ok_mc).await;
            for (shard_idx, chunk) in symbols
                .chunks(crate::exchanges::okx::MAX_SYMBOLS_PER_CONN)
                .enumerate()
            {
                let shard_name = format!("okx_shard_{}", shard_idx);
                let (s_tx, s_lvc, s_tac, s_cfg, s_chunk) = (
                    ok_tx.clone(),
                    ok_lvc.clone(),
                    ok_tac.clone(),
                    ok_cfg.clone(),
                    chunk.to_vec(),
                );
                let exchange = Box::new(
                    GenericExchange::new(
                        &shard_name,
                        crate::exchanges::okx::WS_URL,
                        s_tx.clone(),
                        true,
                        s_lvc.clone(),
                        s_tac.clone(),
                        s_cfg.clone(),
                        Arc::new({
                            let s_tac = s_tac.clone();
                            let s_cfg = s_cfg.clone();
                            let s_lvc = s_lvc.clone();
                            move |t, b| {
                                crate::exchanges::okx::handle_message(t, b, &s_tac, &s_cfg, &s_lvc)
                            }
                        }),
                        Some(Arc::new({
                            let inner_chunk = s_chunk.clone();
                            move || {
                                Box::pin({
                                    let chunk = inner_chunk.clone();
                                    async move {
                                        crate::exchanges::okx::subscription_factory(
                                            chunk, shard_idx,
                                        )
                                        .await
                                    }
                                })
                            }
                        })),
                    )
                    .with_ping_interval(Duration::from_secs(
                        crate::exchanges::okx::PING_INTERVAL_SECS,
                    ))
                    .with_ping_text("ping".to_string()),
                );

                ok_manager.lock().await.register(&shard_name, exchange);
                let _ = ok_manager.lock().await.ensure_connected(&shard_name).await;
            }
        });

        // Register OKX Futures (Sharded)
        let (okf_tx, okf_lvc, okf_tac, okf_cfg, okf_mc) = (
            tx.clone(),
            lvc.clone(),
            tac.clone(),
            config.clone(),
            mc_arc.clone(),
        );
        let okf_manager = manager.clone();
        tokio::spawn(async move {
            let symbols = crate::exchanges::okx_f::wait_for_market_cache(&okf_mc).await;
            for (shard_idx, chunk) in symbols
                .chunks(crate::exchanges::okx_f::MAX_SYMBOLS_PER_CONN)
                .enumerate()
            {
                let shard_name = format!("okx_f_shard_{}", shard_idx);
                let (s_tx, s_lvc, s_tac, s_cfg, s_chunk) = (
                    okf_tx.clone(),
                    okf_lvc.clone(),
                    okf_tac.clone(),
                    okf_cfg.clone(),
                    chunk.to_vec(),
                );
                let exchange = Box::new(
                    GenericExchange::new(
                        &shard_name,
                        crate::exchanges::okx_f::WS_URL,
                        s_tx.clone(),
                        true,
                        s_lvc.clone(),
                        s_tac.clone(),
                        s_cfg.clone(),
                        Arc::new({
                            let s_tac = s_tac.clone();
                            let s_cfg = s_cfg.clone();
                            let s_lvc = s_lvc.clone();
                            move |t, b| {
                                crate::exchanges::okx_f::handle_message(
                                    t, b, &s_tac, &s_cfg, &s_lvc,
                                )
                            }
                        }),
                        Some(Arc::new({
                            let inner_chunk = s_chunk.clone();
                            move || {
                                Box::pin({
                                    let chunk = inner_chunk.clone();
                                    async move {
                                        crate::exchanges::okx_f::subscription_factory(
                                            chunk, shard_idx,
                                        )
                                        .await
                                    }
                                })
                            }
                        })),
                    )
                    .with_ping_interval(Duration::from_secs(
                        crate::exchanges::okx_f::PING_INTERVAL_SECS,
                    ))
                    .with_ping_text("ping".to_string()),
                );

                okf_manager.lock().await.register(&shard_name, exchange);
                let _ = okf_manager.lock().await.ensure_connected(&shard_name).await;
            }
        });

        // Register Geckoterminal
        mg.register(
            "geckoterminal",
            Box::new(crate::exchanges::geckoterminal::GeckoterminalExchange::new(
                tx.clone(),
                lvc.clone(),
                tac.clone(),
                config.clone(),
            )),
        );

        // Register KyberSwap DEX quote poller
        mg.register(
            "kyberswap",
            Box::new(crate::exchanges::kyberswap::KyberswapExchange::new(
                tx.clone(),
                lvc.clone(),
                config.clone(),
            )),
        );

        let _ = mg.ensure_connected("binance").await;
    }

    // Start DEX Redis subscriber (forwards dex_prices channel into broadcast tx)
    let dex_tx = tx.clone();
    let dex_redis_url = config.redis_url.clone();
    let dex_channel = config.dex_redis_channel.clone();
    let dex_lvc = lvc.clone();
    let dex_config = config.clone();

    set.spawn(async move {
        redis_sub::run_dex_subscriber(dex_redis_url, dex_channel, dex_tx, dex_lvc, dex_config)
            .await;
    });
    info!("[Sidecar] DEX Redis subscriber task spawned");

    // Start WebSocket Server
    let ws_tx = tx.clone();
    let ws_manager = manager.clone();
    set.spawn(async move {
        websocket::run_server(
            config.port,
            config.jwt_secret.clone(),
            ws_tx,
            ws_manager,
            lvc,
            config,
        )
        .await;
    });

    // Start Shard Status Monitor task
    // It listens for shard-level "status" messages and broadcasts aggregated "shard_status"
    let monitor_mgr = manager.clone();
    let monitor_tx = tx.clone();
    let mut status_rx = tx.subscribe();
    set.spawn(async move {
        loop {
            match status_rx.recv().await {
                Ok(msg) => {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&msg) {
                        if val.get("type") == Some(&serde_json::json!("status")) {
                            if let Some(source) = val.get("source").and_then(|s| s.as_str()) {
                                if source.contains("_shard_") {
                                    let base_name = source.split("_shard_").next().unwrap();
                                    let mgr = monitor_mgr.lock().await;
                                    if let Some((connected, total)) = mgr.get_shard_stats(base_name)
                                    {
                                        let shard_status = serde_json::json!({
                                            "type": "shard_status",
                                            "source": base_name,
                                            "connected": connected,
                                            "total": total
                                        });
                                        let _ = monitor_tx.send(shard_status.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!("[ShardMonitor] task lagged by {} messages", n);
                }
                Err(e) => {
                    error!("[ShardMonitor] task encountered error: {}", e);
                    break;
                }
            }
        }
    });
    info!("[Sidecar] Shard status monitor task spawned");

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
