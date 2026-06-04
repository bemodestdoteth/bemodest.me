use crate::api;
use crate::auth;
use crate::cache::lvc::LatestValueCache;
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;

use crate::config::Config;
use crate::exchanges::kyberswap;
use crate::exchanges::ExchangeManager;
use std::sync::{Arc, OnceLock};
use tokio::sync::{Mutex, Semaphore};
use tokio::time::{timeout, Duration};

const MAX_CONNECTIONS: usize = 256;
const AUTH_TIMEOUT_SECS: u64 = 10;
static CONNECTION_LIMITER: OnceLock<Arc<Semaphore>> = OnceLock::new();

pub async fn run_server(
    port: u16,
    jwt_secret: String,
    tx: tokio::sync::broadcast::Sender<String>,
    manager: Arc<Mutex<ExchangeManager>>,
    lvc: Arc<LatestValueCache>,
    config: Arc<Config>,
) {
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await.expect("Failed to bind port");
    info!("WebSocket server listening on (IPv4): {}", addr);

    let limiter = CONNECTION_LIMITER
        .get_or_init(|| Arc::new(Semaphore::new(MAX_CONNECTIONS)))
        .clone();

    while let Ok((stream, addr)) = listener.accept().await {
        let permit = match limiter.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                warn!(
                    "Rejecting WebSocket connection from {}: connection limit reached",
                    addr
                );
                continue;
            }
        };

        info!("Incoming connection from: {}", addr);
        let secret = jwt_secret.clone();
        let tx = tx.clone();
        let manager = manager.clone();
        let lvc = lvc.clone();
        let config = config.clone();
        tokio::spawn(async move {
            let _permit = permit;
            handle_connection(stream, secret, tx, manager, lvc, config).await;
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    secret: String,
    tx: tokio::sync::broadcast::Sender<String>,
    manager: Arc<Mutex<ExchangeManager>>,
    lvc: Arc<LatestValueCache>,
    config: Arc<Config>,
) {
    // Basic handshake
    let ws_stream = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            error!("Error during websocket handshake: {}", e);
            return;
        }
    };

    let (mut write, mut read) = ws_stream.split();

    // Auth State
    let mut authenticated = false;
    let mut user_id = String::new();
    let mut rx: Option<tokio::sync::broadcast::Receiver<String>> = None;

    loop {
        tokio::select! {
            msg_option = async {
                if authenticated {
                    read.next().await
                } else {
                    match timeout(Duration::from_secs(AUTH_TIMEOUT_SECS), read.next()).await {
                        Ok(msg) => msg,
                        Err(_) => {
                            warn!("WebSocket authentication timed out");
                            None
                        }
                    }
                }
            } => {
                match msg_option {
                    Some(Ok(msg)) => {
                        if msg.is_text() {
                            let text = msg.to_text().unwrap();
                            if !authenticated {
                                // Validate Token
                                // Expected format: "Bearer <token>" or just "<token>"
                                let token = text.trim_start_matches("Bearer ").trim();

                                match auth::validate_token(token, &secret) {
                                    Ok(claims) => {
                                        user_id = claims.sub;
                                        info!("User authenticated: {}", user_id);
                                        authenticated = true;
                                        rx = Some(tx.subscribe());

                                        // Send Ack
                                        if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text("AUTH_OK".into())).await {
                                            error!("Failed to send AUTH_OK: {}", e);
                                            break;
                                        }

                                        // Push Initial State (LVC Snapshot)
                                        // This ensures the client starts with a ground truth for all tickers/sources
                                        let snapshot = api::handle_command(&serde_json::json!({"cmd": "snapshot"}), &lvc, &config);
                                        let _ = send_json(&mut write, &snapshot).await;

                                        // Trigger Lazy Exchange Connections
                                        trigger_lazy_connections(&manager, &mut write, &user_id).await;
                                    },
                                    Err(e) => {
                                        warn!("Authentication failed: {}", e);
                                        let _ = write.send(tokio_tungstenite::tungstenite::Message::Text("AUTH_FAILED".into())).await;
                                        return; // Close connection
                                    }
                                }
                            } else {
                                // Handle API commands from authenticated clients
                                if let Ok(cmd) = serde_json::from_str::<serde_json::Value>(text) {
                                    if cmd.get("cmd").is_some() {
                                        let response = if cmd.get("cmd").and_then(|v| v.as_str()) == Some("dex_quote_refresh") {
                                            match kyberswap::quote_handle() {
                                                Some(handle) => {
                                                    let symbols = cmd
                                                        .get("symbols")
                                                        .and_then(|v| v.as_array())
                                                        .map(|items| {
                                                            items
                                                                .iter()
                                                                .filter_map(|item| item.as_str().map(str::to_string))
                                                                .collect::<Vec<_>>()
                                                        })
                                                        .unwrap_or_default();
                                                    handle.enqueue_symbols(symbols).await
                                                }
                                                None => serde_json::json!({
                                                    "type": "api_error",
                                                    "cmd": "dex_quote_refresh",
                                                    "error": "kyberswap exchange is not initialized"
                                                }),
                                            }
                                        } else {
                                            api::handle_command(&cmd, &lvc, &config)
                                        };
                                        if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(response.to_string().into())).await {
                                            error!("Failed to send API response: {}", e);
                                            break;
                                        }
                                    }
                                }
                            }
                        } else if msg.is_close() {
                            info!("Client disconnected: {}", user_id);
                            break;
                        }
                    }
                    Some(Err(e)) => {
                         error!("WebSocket error: {}", e);
                         break;
                    }
                    None => {
                        break;
                    }
                }
            }
            msg = async {
                if let Some(rx) = rx.as_mut() {
                    rx.recv().await
                } else {
                    futures_util::future::pending::<Result<String, tokio::sync::broadcast::error::RecvError>>().await
                }
            }, if authenticated => {
                match msg {
                    Ok(data) => {
                        if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(data.into())).await {
                            // Client might have disconnected
                            debug!("Failed to send broadcast message: {}", e);
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!("Client {} lagged behind by {} messages, continuing...", user_id, n);
                        // RecvError::Lagged means slow client; continue to catch up
                    }
                    Err(e) => {
                        error!("Broadcast channel error: {}", e);
                        break;
                    }
                }
            }
        }
    }
}

const LAZY_EXCHANGES: &[&str] = &[
    "binance",
    "upbit",
    "bithumb",
    "binance_f",
    "bybit",
    "bybit_f",
    "gateio",
    "bitget",
    "bitget_f",
    "coinbase",
    "kraken",
    "kucoin",
    "okx",
    "okx_f",
    "hyperliquid_f",
    "kyberswap",
];

async fn trigger_lazy_connections(
    manager: &Arc<Mutex<ExchangeManager>>,
    write: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<TcpStream>,
        tokio_tungstenite::tungstenite::Message,
    >,
    user_id: &str,
) {
    info!("Triggering lazy exchange connections for user: {}", user_id);
    let mut mgr = manager.lock().await;

    for &exchange_name in LAZY_EXCHANGES {
        mgr.ensure_connected(exchange_name).await;

        if let Some((connected, total)) = mgr.get_shard_stats(exchange_name) {
            let status = serde_json::json!({
                "type": "shard_status",
                "source": exchange_name,
                "connected": connected,
                "total": total
            });
            let _ = send_json(write, &status).await;
        } else if mgr.is_connected(exchange_name) {
            let status = serde_json::json!({
                "type": "status",
                "source": exchange_name,
                "connected": true
            });
            let _ = send_json(write, &status).await;
        }
    }
    info!("Exchange connections trigger completed");
}

async fn send_json(
    write: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<TcpStream>,
        tokio_tungstenite::tungstenite::Message,
    >,
    value: &serde_json::Value,
) -> Result<(), tokio_tungstenite::tungstenite::Error> {
    write
        .send(tokio_tungstenite::tungstenite::Message::Text(
            value.to_string().into(),
        ))
        .await
}
