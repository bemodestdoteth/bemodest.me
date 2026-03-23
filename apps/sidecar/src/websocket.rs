use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;
use futures_util::{StreamExt, SinkExt};
use log::{info, error, warn, debug};
use crate::auth;
use crate::api;
use crate::cache::lvc::LatestValueCache;

use std::sync::Arc;
use tokio::sync::Mutex;
use crate::exchanges::ExchangeManager;

pub async fn run_server(port: u16, jwt_secret: String, tx: tokio::sync::broadcast::Sender<String>, manager: Arc<Mutex<ExchangeManager>>, lvc: Arc<LatestValueCache>) {
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await.expect("Failed to bind port");
    info!("WebSocket server listening on (IPv4): {}", addr);

    while let Ok((stream, addr)) = listener.accept().await {
        info!("Incoming connection from: {}", addr);
        let secret = jwt_secret.clone();
        let tx = tx.clone();
        let manager = manager.clone();
        let lvc = lvc.clone();
        tokio::spawn(handle_connection(stream, secret, tx, manager, lvc));
    }
}

async fn handle_connection(stream: TcpStream, secret: String, tx: tokio::sync::broadcast::Sender<String>, manager: Arc<Mutex<ExchangeManager>>, lvc: Arc<LatestValueCache>) {
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
    
    let mut rx = tx.subscribe();

    loop {
        tokio::select! {
            msg_option = read.next() => {
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
                                        
                                        // Send Ack
                                        if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text("AUTH_OK".into())).await {
                                            error!("Failed to send AUTH_OK: {}", e);
                                            break;
                                        }

                                        // Push Initial State (LVC Snapshot)
                                        // This ensures the client starts with a ground truth for all tickers/sources
                                        let snapshot = api::handle_command(&serde_json::json!({"cmd": "snapshot"}), &lvc);
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
                                        let response = api::handle_command(&cmd, &lvc);
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
            msg = rx.recv() => {
                if authenticated {
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
}

const LAZY_EXCHANGES: &[&str] = &[
    "binance", "upbit", "bithumb", "binance_f", "bybit", "bybit_f", 
    "gateio", "bitget", "bitget_f", "coinbase", "kraken", "kucoin", "okx", "okx_f"
];

async fn trigger_lazy_connections(manager: &Arc<Mutex<ExchangeManager>>, write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<TcpStream>, tokio_tungstenite::tungstenite::Message>, user_id: &str) {
    info!("Triggering lazy exchange connections for user: {}", user_id);
    let mut mgr = manager.lock().await;
    
    for &exchange_name in LAZY_EXCHANGES {
        mgr.ensure_connected(exchange_name).await;

        if mgr.is_connected(exchange_name) {
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

async fn send_json(write: &mut futures_util::stream::SplitSink<tokio_tungstenite::WebSocketStream<TcpStream>, tokio_tungstenite::tungstenite::Message>, value: &serde_json::Value) -> Result<(), tokio_tungstenite::tungstenite::Error> {
    write.send(tokio_tungstenite::tungstenite::Message::Text(value.to_string().into())).await
}
