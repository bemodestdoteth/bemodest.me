use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;
use futures_util::{StreamExt, SinkExt};
use log::{info, error, warn};
use crate::auth;

pub async fn run_server(port: u16, jwt_secret: String) {
    let addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&addr).await.expect("Failed to bind port");
    info!("WebSocket server listening on: {}", addr);

    while let Ok((stream, addr)) = listener.accept().await {
        info!("Incoming connection from: {}", addr);
        let secret = jwt_secret.clone();
        tokio::spawn(handle_connection(stream, secret));
    }
}

async fn handle_connection(stream: TcpStream, secret: String) {
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
    
    // Auth Loop / Handshake
    // We expect the first message to be the JWT token
    while let Some(msg) = read.next().await {
        match msg {
            Ok(msg) => {
                if msg.is_text() {
                    let text = msg.to_text().unwrap();
                    if !authenticated {
                        // Validate Token
                        // Expected format: "Bearer <token>" or just "<token>"
                        // We'll strip "Bearer " if present
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
                            },
                            Err(e) => {
                                warn!("Authentication failed: {}", e);
                                let _ = write.send(tokio_tungstenite::tungstenite::Message::Text("AUTH_FAILED".into())).await;
                                return; // Close connection
                            }
                        }
                    } else {
                        // Authenticated session - Echo for now (Phase 1)
                        // In future phases, this will receive data from the exchange stream
                         if let Err(e) = write.send(tokio_tungstenite::tungstenite::Message::Text(format!("Echo: {}", text).into())).await {
                            error!("Failed to send echo: {}", e);
                            break;
                         }
                    }
                } else if msg.is_close() {
                    info!("Client disconnected: {}", user_id);
                    break;
                }
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
        }
    }
}
