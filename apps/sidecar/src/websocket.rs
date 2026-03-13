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
                                        if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(snapshot.to_string().into())).await {
                                            error!("Failed to send initial LVC snapshot: {}", e);
                                        }

                                        // Trigger Binance Connection (Lazy)
                                        info!("Triggering lazy Binance connection for user: {}", user_id);
                                        {
                                            let mut mgr = manager.lock().await;
                                            mgr.ensure_connected("binance").await;

                                            // If already connected (e.g. second client), send status immediately
                                            // because the broadcast logic in BinanceExchange only fires on *change*
                                            if mgr.is_connected("binance") {
                                                info!("Binance is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "binance",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Binance status: {}", e);
                                                }
                                            }

                                            // Trigger Upbit Connection (Lazy)
                                            info!("Triggering lazy Upbit connection for user: {}", user_id);
                                            mgr.ensure_connected("upbit").await;

                                            // If already connected, send status immediately
                                            if mgr.is_connected("upbit") {
                                                info!("Upbit is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "upbit",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Upbit status: {}", e);
                                                }
                                            }

                                            // Trigger Bithumb Connection (Lazy)
                                            info!("Triggering lazy Bithumb connection for user: {}", user_id);
                                            mgr.ensure_connected("bithumb").await;

                                            // If already connected, send status immediately
                                            if mgr.is_connected("bithumb") {
                                                info!("Bithumb is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "bithumb",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Bithumb status: {}", e);
                                                }
                                            }

                                            // Trigger Binance Futures Connection (Lazy)
                                            info!("Triggering lazy Binance Futures connection for user: {}", user_id);
                                            mgr.ensure_connected("binance_f").await;

                                            if mgr.is_connected("binance_f") {
                                                info!("Binance Futures is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "binance_f",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Binance Futures status: {}", e);
                                                }
                                            }

                                            // Trigger Bybit Spot Connection (Lazy)
                                            info!("Triggering lazy Bybit connection for user: {}", user_id);
                                            mgr.ensure_connected("bybit").await;

                                            if mgr.is_connected("bybit") {
                                                info!("Bybit is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "bybit",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Bybit status: {}", e);
                                                }
                                            }

                                            // Trigger Bybit Futures Connection (Lazy)
                                            info!("Triggering lazy Bybit Futures connection for user: {}", user_id);
                                            mgr.ensure_connected("bybit_f").await;

                                            if mgr.is_connected("bybit_f") {
                                                info!("Bybit Futures is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "bybit_f",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Bybit Futures status: {}", e);
                                                }
                                            }

                                            // Trigger Gate.io Connection (Lazy)
                                            info!("Triggering lazy Gateio connection for user: {}", user_id);
                                            mgr.ensure_connected("gateio").await;

                                            if mgr.is_connected("gateio") {
                                                info!("Gateio is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "gateio",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Gateio status: {}", e);
                                                }
                                            }

                                            // Trigger Bitget Spot Connection (Lazy)
                                            info!("Triggering lazy Bitget connection for user: {}", user_id);
                                            mgr.ensure_connected("bitget").await;

                                            if mgr.is_connected("bitget") {
                                                info!("Bitget is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "bitget",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Bitget status: {}", e);
                                                }
                                            }

                                            // Trigger Bitget Futures Connection (Lazy)
                                            info!("Triggering lazy Bitget Futures connection for user: {}", user_id);
                                            mgr.ensure_connected("bitget_f").await;

                                            if mgr.is_connected("bitget_f") {
                                                info!("Bitget Futures is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "bitget_f",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Bitget Futures status: {}", e);
                                                }
                                            }

                                            // Trigger Coinbase Spot Connection (Lazy)
                                            info!("Triggering lazy Coinbase connection for user: {}", user_id);
                                            mgr.ensure_connected("coinbase").await;

                                            if mgr.is_connected("coinbase") {
                                                info!("Coinbase is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "coinbase",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Coinbase status: {}", e);
                                                }
                                            }

                                            // Trigger Kraken Spot Connection (Lazy)
                                            info!("Triggering lazy Kraken connection for user: {}", user_id);
                                            mgr.ensure_connected("kraken").await;

                                            if mgr.is_connected("kraken") {
                                                info!("Kraken is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "kraken",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial Kraken status: {}", e);
                                                }
                                            }

                                            // Trigger KuCoin Spot Connection (Lazy)
                                            info!("Triggering lazy KuCoin connection for user: {}", user_id);
                                            mgr.ensure_connected("kucoin").await;

                                            if mgr.is_connected("kucoin") {
                                                info!("KuCoin is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "kucoin",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial KuCoin status: {}", e);
                                                }
                                            }

                                            // Trigger OKX Spot Connection (Lazy)
                                            info!("Triggering lazy OKX connection for user: {}", user_id);
                                            mgr.ensure_connected("okx").await;

                                            if mgr.is_connected("okx") {
                                                info!("OKX is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "okx",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial OKX status: {}", e);
                                                }
                                            }

                                            // Trigger OKX Futures Connection (Lazy)
                                            info!("Triggering lazy OKX Futures connection for user: {}", user_id);
                                            mgr.ensure_connected("okx_f").await;

                                            if mgr.is_connected("okx_f") {
                                                info!("OKX Futures is already connected, sending initial status to client.");
                                                let status = serde_json::json!({
                                                    "type": "status",
                                                    "source": "okx_f",
                                                    "connected": true
                                                });
                                                if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(status.to_string().into())).await {
                                                    error!("Failed to send initial OKX Futures status: {}", e);
                                                }
                                            }

                                        }
                                        info!("Exchange connections trigger completed");
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
