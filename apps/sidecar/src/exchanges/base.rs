use futures_util::{StreamExt, SinkExt};
use tokio::time::{sleep, Duration, interval};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use log::{info, error};
use tokio::sync::broadcast;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use crate::config::Config;
use crate::cache::lvc::LatestValueCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::cache::EligibilityFilter;

pub struct WsSessionContext {
    pub source: String,
    pub url: String,
    pub verbose: bool,
    pub reconnect_delay: Duration,
    pub tx: broadcast::Sender<String>,
    pub connected: Arc<AtomicBool>,
    pub running: Arc<AtomicBool>,
    pub lvc: Arc<LatestValueCache>,
    pub config: Arc<Config>,
    pub refresh_tx: Option<broadcast::Sender<()>>,
    pub ping_interval: Option<Duration>,
    pub ping_text: Option<String>,
    /// Optional closure to generate a dynamic ping message.
    pub ping_factory: Option<Arc<dyn Fn() -> Option<serde_json::Value> + Send + Sync>>,
    /// Optional closure to generate a dynamic connection URL (e.g. for Kucoin tokens).
    /// If provided, this takes precedence over the fixed url field.
    pub url_factory: Option<Arc<dyn Fn() -> FutString + Send + Sync>>,
}

pub type FutString = std::pin::Pin<Box<dyn std::future::Future<Output = Option<String>> + Send>>;

pub struct WsSession;

impl WsSession {
    pub async fn run_loop<F, S, Fut>(
        ctx: WsSessionContext,
        subscription_factory: S,
        message_handler: F,
    ) where
        S: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Option<Vec<serde_json::Value>>> + Send,
        F: Fn(&str, &mut TickerBatcher) + Send + Sync + 'static,
    {
        loop {
            let url = if let Some(ref factory) = ctx.url_factory {
                match factory().await {
                    Some(u) => u,
                    None => {
                        error!("[{}] url_factory failed, retrying connection in {:?}", ctx.source, ctx.reconnect_delay);
                        sleep(ctx.reconnect_delay).await;
                        continue;
                    }
                }
            } else {
                ctx.url.clone()
            };

            if ctx.verbose {
                info!("[{}] Connecting to WebSocket: {}", ctx.source, url);
            }

            match connect_async(&url).await {
                Ok((ws_stream, _)) => {
                    if ctx.verbose {
                        info!("[{}] WebSocket connected.", ctx.source);
                    }
                    ctx.connected.store(true, Ordering::SeqCst);

                    let status = serde_json::json!({
                        "type": "status",
                        "source": ctx.source,
                        "connected": true
                    });
                    let _ = ctx.tx.send(status.to_string());

                    let (mut write, mut read) = ws_stream.split();

                    // Handle subscription if factory provided
                    if let Some(sub_msgs) = subscription_factory().await {
                        for sub_msg in sub_msgs {
                            if let Err(e) = write.send(Message::Text(sub_msg.to_string().into())).await {
                                error!("[{}] Failed to send subscription: {}", ctx.source, e);
                                ctx.connected.store(false, Ordering::SeqCst);
                                sleep(ctx.reconnect_delay).await;
                                continue;
                            }
                        }
                    }

                    let filter = EligibilityFilter::new(
                        ctx.config.filter_min_sources,
                        ctx.config.filter_min_spread_pct,
                        ctx.config.pinlist.clone(),
                    );
                    let mut batcher = TickerBatcher::new(ctx.tx.clone(), ctx.source.clone(), ctx.lvc.clone(), filter);
                    let mut flush_interval = interval(Duration::from_millis(ctx.config.batch_duration_ms));

                    let mut refresh_rx = ctx.refresh_tx.as_ref().map(|tx| tx.subscribe());
                    let mut ping_interval = ctx.ping_interval.map(tokio::time::interval);

                    loop {
                        tokio::select! {
                            _ = async {
                                if let Some(ref mut pi) = ping_interval {
                                    pi.tick().await;
                                    true
                                } else {
                                    futures_util::future::pending::<()>().await;
                                    false
                                }
                            } => {
                                if let Some(ref factory) = ctx.ping_factory {
                                    if let Some(val) = factory() {
                                        if let Err(e) = write.send(Message::Text(val.to_string().into())).await {
                                            error!("[{}] Failed to send factory ping: {}", ctx.source, e);
                                            break;
                                        }
                                    }
                                } else if let Some(ref text) = ctx.ping_text {
                                    if let Err(e) = write.send(Message::Text(text.clone().into())).await {
                                        error!("[{}] Failed to send text ping: {}", ctx.source, e);
                                        break;
                                    }
                                } else {
                                    // Default WebSocket Ping
                                    if let Err(e) = write.send(Message::Ping(Vec::new().into())).await {
                                        error!("[{}] Failed to send ping: {}", ctx.source, e);
                                        break;
                                    }
                                }
                            }
                            _ = async {
                                if let Some(ref mut rx) = refresh_rx {
                                    let _ = rx.recv().await;
                                    true
                                } else {
                                    futures_util::future::pending::<()>().await;
                                    false
                                }
                            } => {
                                if let Some(sub_msgs) = subscription_factory().await {
                                    for sub_msg in sub_msgs {
                                        if let Err(e) = write.send(Message::Text(sub_msg.to_string().into())).await {
                                            error!("[{}] Failed to send subscription refresh: {}", ctx.source, e);
                                            break;
                                        }
                                    }
                                    if ctx.verbose {
                                        info!("[{}] Subscription refreshed.", ctx.source);
                                    }
                                }
                            }
                            _ = flush_interval.tick() => {
                                batcher.flush();
                            }
                            msg_res = read.next() => {
                                let msg_res = match msg_res {
                                    Some(m) => m,
                                    None => break,
                                };
                                match msg_res {
                                    Ok(Message::Text(text)) => {
                                        message_handler(&text, &mut batcher);
                                    }
                                    Ok(Message::Binary(data)) => {
                                        if let Ok(text) = String::from_utf8(data.to_vec()) {
                                            message_handler(&text, &mut batcher);
                                        } else {
                                            error!("[{}] Received non-UTF8 binary message.", ctx.source);
                                        }
                                    }
                                    Ok(Message::Ping(payload)) => {
                                        if let Err(e) = write.send(Message::Pong(payload)).await {
                                            error!("[{}] Failed to send pong: {}", ctx.source, e);
                                            break;
                                        }
                                    }
                                    Ok(Message::Close(_)) => {
                                        if ctx.verbose {
                                            info!("[{}] Connection closed by server.", ctx.source);
                                        }
                                        break;
                                    }
                                    Err(e) => {
                                        if ctx.verbose {
                                            error!("[{}] WebSocket error: {}.", ctx.source, e);
                                        }
                                        break;
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    let status = serde_json::json!({
                        "type": "status",
                        "source": ctx.source,
                        "connected": false
                    });
                    let _ = ctx.tx.send(status.to_string());

                    if ctx.verbose {
                        error!("[{}] Failed to connect: {}. Reconnecting...", ctx.source, e);
                    }
                }
            }

            ctx.connected.store(false, Ordering::SeqCst);
            sleep(ctx.reconnect_delay).await;
        }
    }
}
