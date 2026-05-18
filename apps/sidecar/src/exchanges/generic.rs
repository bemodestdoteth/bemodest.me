use super::Exchange;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::base::{WsSession, WsSessionContext};
use crate::exchanges::batcher::TickerBatcher;
use async_trait::async_trait;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::time::Duration;

pub type MessageHandler = Arc<dyn Fn(&str, &mut TickerBatcher) + Send + Sync>;
pub type SubscriptionFactory = Arc<
    dyn Fn() -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Option<Vec<serde_json::Value>>> + Send>,
        > + Send
        + Sync,
>;
pub type UrlFactory = Arc<
    dyn Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = Option<String>> + Send>>
        + Send
        + Sync,
>;
pub type PingFactory = Arc<dyn Fn() -> Option<serde_json::Value> + Send + Sync>;

pub struct GenericExchange {
    source: String,
    url: String,
    verbose: bool,
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    tac: Arc<TokenAnnotationCache>,
    config: Arc<Config>,
    message_handler: MessageHandler,
    subscription_factory: Option<SubscriptionFactory>,
    refresh_tx: broadcast::Sender<()>,
    reconnect_on_refresh: bool,

    // Optional specialized fields
    ping_interval: Option<Duration>,
    ping_text: Option<String>,
    ping_factory: Option<PingFactory>,
    url_factory: Option<UrlFactory>,
}

impl GenericExchange {
    pub fn new(
        source: &str,
        url: &str,
        tx: broadcast::Sender<String>,
        verbose: bool,
        lvc: Arc<LatestValueCache>,
        tac: Arc<TokenAnnotationCache>,
        config: Arc<Config>,
        message_handler: MessageHandler,
        subscription_factory: Option<SubscriptionFactory>,
    ) -> Self {
        let (refresh_tx, _) = broadcast::channel(16);
        Self {
            source: source.to_string(),
            url: url.to_string(),
            tx,
            verbose,
            connected: Arc::new(AtomicBool::new(false)),
            running: Arc::new(AtomicBool::new(false)),
            lvc,
            tac,
            config,
            message_handler,
            subscription_factory,
            refresh_tx,
            reconnect_on_refresh: false,
            ping_interval: None,
            ping_text: None,
            ping_factory: None,
            url_factory: None,
        }
    }

    pub fn with_ping_interval(mut self, interval: Duration) -> Self {
        self.ping_interval = Some(interval);
        self
    }

    pub fn with_ping_text(mut self, text: String) -> Self {
        self.ping_text = Some(text);
        self
    }

    pub fn with_ping_factory(mut self, factory: PingFactory) -> Self {
        self.ping_factory = Some(factory);
        self
    }

    pub fn with_url_factory(mut self, factory: UrlFactory) -> Self {
        self.url_factory = Some(factory);
        self
    }

    pub fn with_reconnect_on_refresh(mut self) -> Self {
        self.reconnect_on_refresh = true;
        self
    }
}

#[async_trait]
impl Exchange for GenericExchange {
    async fn connect(&mut self) {
        if self.running.load(Ordering::SeqCst) {
            return;
        }
        self.running.store(true, Ordering::SeqCst);

        let ctx = WsSessionContext {
            source: self.source.clone(),
            url: self.url.clone(),
            verbose: self.verbose,
            reconnect_delay: Duration::from_secs(5),
            tx: self.tx.clone(),
            connected: self.connected.clone(),
            running: self.running.clone(),
            lvc: self.lvc.clone(),
            config: self.config.clone(),
            refresh_tx: Some(self.refresh_tx.clone()),
            reconnect_on_refresh: self.reconnect_on_refresh,
            ping_interval: self.ping_interval,
            ping_text: self.ping_text.clone(),
            ping_factory: self.ping_factory.clone(),
            url_factory: self.url_factory.clone(),
        };

        let handler = self.message_handler.clone();
        let sub_factory = self.subscription_factory.clone();

        tokio::spawn(async move {
            WsSession::run_loop(
                ctx,
                move || {
                    let sf = sub_factory.clone();
                    async move {
                        if let Some(ref factory) = sf {
                            factory().await
                        } else {
                            None
                        }
                    }
                },
                move |text, batcher| {
                    handler(text, batcher);
                },
            )
            .await;
        });
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }

    async fn refresh_subscriptions(&self) {
        let _ = self.refresh_tx.send(());
    }
}
