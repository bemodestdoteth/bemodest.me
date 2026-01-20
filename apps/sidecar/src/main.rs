mod auth;
mod config;
mod websocket;

use crate::config::Config;
use log::info;
use std::error::Error;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Initialize logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    
    // Load config
    dotenvy::dotenv().ok();
    let config = Config::from_env();
    
    info!("Starting Sidecar on port {}", config.port);
    
    // Start WebSocket Server
    websocket::run_server(config.port, config.jwt_secret).await;
    
    Ok(())
}
