use async_trait::async_trait;
use futures_util::TryStreamExt;
use log::{error, info, warn};
use mongodb::{bson::doc, Client};
use primp::{Client as ImpersonateClient, Impersonate, ImpersonateOS};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, Mutex, RwLock};

use crate::cache::LatestValueCache;
use crate::chain_annotations::translate_annotation;
use crate::config::Config;
use crate::exchanges::Exchange;
use crate::types::{now_micros, Exchange as ExchangeType, MarketState, NormalizedTicker};

const KYBERSWAP_HOST: &str = "https://aggregator-api.kyberswap.com";
const CONFIG_COLLECTION: &str = "kyberswapQuoteConfig";
const CHAINS_COLLECTION: &str = "chains";
const RANK_COLLECTION: &str = "coingeckoTop2000";
const LIST_COLLECTION: &str = "coingeckoCoinList";
const CONFIG_RELOAD_SECS: u64 = 60;
const DEFAULT_REQUESTS_PER_SECOND: u64 = 1;
const DEFAULT_COOLDOWN_ON_429_SECS: u64 = 60;
const BACKGROUND_SYMBOL_LIMIT: i64 = 2000;

static QUOTE_HANDLE: OnceLock<Arc<KyberswapQuoteHandle>> = OnceLock::new();

#[derive(Clone)]
pub struct KyberswapQuoteHandle {
    state: Arc<KyberswapState>,
}

impl KyberswapQuoteHandle {
    pub async fn enqueue_symbols(&self, symbols: Vec<String>) -> Value {
        let mut queued = Vec::new();
        let mut already_queued = Vec::new();
        let mut skipped = Vec::new();
        let configs = self.state.configs.read().await;

        if configs.is_empty() {
            return json!({
                "type": "api",
                "cmd": "dex_quote_refresh",
                "data": {
                    "queued": queued,
                    "alreadyQueued": already_queued,
                    "skipped": [{ "reason": "no_enabled_kyberswap_config" }]
                }
            });
        }

        let mut queues = self.state.queues.lock().await;
        for raw in symbols {
            let symbol = raw.trim().to_uppercase();
            if symbol.is_empty() {
                skipped.push(json!({ "symbol": raw, "reason": "empty_symbol" }));
                continue;
            }

            for chain in configs.keys() {
                let key = QuoteJobKey {
                    chain: chain.clone(),
                    symbol: symbol.clone(),
                };
                if queues.queued.contains(&key) {
                    if let Some(index) = queues.background.iter().position(|queued| queued == &key)
                    {
                        queues.background.remove(index);
                        queues.priority.push_back(key);
                        queued.push(json!({ "chain": chain, "symbol": symbol }));
                    } else {
                        already_queued.push(json!({ "chain": chain, "symbol": symbol }));
                    }
                    continue;
                }
                queues.queued.insert(key.clone());
                queues.priority.push_back(key);
                queued.push(json!({ "chain": chain, "symbol": symbol }));
            }
        }

        json!({
            "type": "api",
            "cmd": "dex_quote_refresh",
            "data": {
                "queued": queued,
                "alreadyQueued": already_queued,
                "skipped": skipped
            }
        })
    }
}

pub fn quote_handle() -> Option<Arc<KyberswapQuoteHandle>> {
    QUOTE_HANDLE.get().cloned()
}

pub struct KyberswapExchange {
    tx: broadcast::Sender<String>,
    connected: Arc<AtomicBool>,
    lvc: Arc<LatestValueCache>,
    config: Arc<Config>,
    state: Arc<KyberswapState>,
}

impl KyberswapExchange {
    pub fn new(
        tx: broadcast::Sender<String>,
        lvc: Arc<LatestValueCache>,
        config: Arc<Config>,
    ) -> Self {
        let state = Arc::new(KyberswapState::new(config.mongo_uri.clone()));
        let _ = QUOTE_HANDLE.set(Arc::new(KyberswapQuoteHandle {
            state: state.clone(),
        }));
        Self {
            tx,
            connected: Arc::new(AtomicBool::new(false)),
            lvc,
            config,
            state,
        }
    }
}

#[async_trait]
impl Exchange for KyberswapExchange {
    async fn connect(&mut self) {
        if self.connected.swap(true, Ordering::SeqCst) {
            return;
        }

        let state = self.state.clone();
        let tx = self.tx.clone();
        let lvc = self.lvc.clone();
        let config = self.config.clone();
        let connected = self.connected.clone();

        tokio::spawn(async move {
            if let Err(e) = run_worker(state, tx, lvc, config).await {
                connected.store(false, Ordering::SeqCst);
                error!("[KyberSwap] worker stopped: {}", e);
            }
        });
    }

    fn is_connected(&self) -> bool {
        self.connected.load(Ordering::SeqCst)
    }
}

struct KyberswapState {
    mongo_uri: Option<String>,
    configs: RwLock<HashMap<String, ChainQuoteConfig>>,
    queues: Mutex<QuoteQueues>,
    rate_state: Mutex<HashMap<String, ChainRateState>>,
}

impl KyberswapState {
    fn new(mongo_uri: Option<String>) -> Self {
        Self {
            mongo_uri,
            configs: RwLock::new(HashMap::new()),
            queues: Mutex::new(QuoteQueues::default()),
            rate_state: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Default)]
struct QuoteQueues {
    priority: VecDeque<QuoteJobKey>,
    background: VecDeque<QuoteJobKey>,
    queued: HashSet<QuoteJobKey>,
}

#[derive(Default)]
struct ChainRateState {
    next_allowed_at: Option<Instant>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct QuoteJobKey {
    chain: String,
    symbol: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChainQuoteConfig {
    kyberswap_chain: String,
    enabled: bool,
    quote: QuoteAsset,
    default_notional: String,
    rate_limit: Option<RateLimitConfig>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuoteAsset {
    symbol: String,
    contract_address: String,
    decimals: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimitConfig {
    requests_per_second: Option<u64>,
    cooldown_seconds_on429: Option<u64>,
}

#[derive(Clone)]
struct ResolvedToken {
    coingecko_id: String,
    symbol: String,
    contract_address: String,
    decimals: u32,
}

async fn run_worker(
    state: Arc<KyberswapState>,
    tx: broadcast::Sender<String>,
    lvc: Arc<LatestValueCache>,
    config: Arc<Config>,
) -> Result<(), String> {
    let mongo_uri = state
        .mongo_uri
        .clone()
        .ok_or_else(|| "MONGO_URI is required for KyberSwap quotes".to_string())?;
    let mongo = Client::with_uri_str(&mongo_uri)
        .await
        .map_err(|e| format!("MongoDB connection failed: {}", e))?;
    let http = ImpersonateClient::builder()
        .timeout(Duration::from_secs(20))
        .impersonate(Impersonate::ChromeV148)
        .impersonate_os(ImpersonateOS::Linux)
        .build()
        .map_err(|e| format!("HTTP client build failed: {}", e))?;

    reload_configs(&state, &mongo).await;
    fill_background_queue(&state, &mongo).await;
    let mut config_tick = tokio::time::interval(Duration::from_secs(CONFIG_RELOAD_SECS));

    info!("[KyberSwap] quote worker started");
    loop {
        tokio::select! {
            _ = config_tick.tick() => {
                reload_configs(&state, &mongo).await;
                fill_background_queue(&state, &mongo).await;
            }
            _ = tokio::time::sleep(Duration::from_millis(250)) => {
                if let Some(job) = pop_next_job(&state).await {
                    process_job(&state, &mongo, &http, &tx, &lvc, &config, job).await;
                }
            }
        }
    }
}

async fn reload_configs(state: &KyberswapState, mongo: &Client) {
    let db = mongo.database("codys");
    let valid_chains = load_valid_kyberswap_chains(mongo).await;
    let collection = db.collection::<mongodb::bson::Document>(CONFIG_COLLECTION);
    let mut cursor = match collection.find(doc! { "enabled": true }).await {
        Ok(cursor) => cursor,
        Err(e) => {
            error!("[KyberSwap] Failed to load config: {}", e);
            return;
        }
    };

    let mut configs = HashMap::new();
    while let Ok(Some(doc)) = cursor.try_next().await {
        match mongodb::bson::from_document::<ChainQuoteConfig>(doc) {
            Ok(cfg) => {
                if !valid_chains.contains(&cfg.kyberswap_chain) {
                    warn!(
                        "[KyberSwap] Skipping invalid chain slug: {}",
                        cfg.kyberswap_chain
                    );
                    continue;
                }
                if !is_evm_address(&cfg.quote.contract_address) {
                    warn!(
                        "[KyberSwap] Skipping invalid quote address for {}",
                        cfg.kyberswap_chain
                    );
                    continue;
                }
                configs.insert(cfg.kyberswap_chain.clone(), cfg);
            }
            Err(e) => warn!("[KyberSwap] Skipping malformed config document: {}", e),
        }
    }

    let count = configs.len();
    *state.configs.write().await = configs;
    info!("[KyberSwap] Loaded {} enabled quote configs", count);
}

async fn load_valid_kyberswap_chains(mongo: &Client) -> HashSet<String> {
    let collection = mongo
        .database("codys")
        .collection::<mongodb::bson::Document>(CHAINS_COLLECTION);
    let mut cursor = match collection
        .find(doc! { "annotation.kyberswap": { "$exists": true } })
        .await
    {
        Ok(cursor) => cursor,
        Err(e) => {
            error!("[KyberSwap] Failed to load chain annotations: {}", e);
            return HashSet::new();
        }
    };

    let mut chains = HashSet::new();
    while let Ok(Some(doc)) = cursor.try_next().await {
        if let Ok(annotation) = doc.get_document("annotation") {
            if let Ok(kyberswap) = annotation.get_str("kyberswap") {
                chains.insert(kyberswap.to_string());
            }
        }
    }
    chains
}

async fn fill_background_queue(state: &KyberswapState, mongo: &Client) {
    let configs = state.configs.read().await.clone();
    if configs.is_empty() {
        return;
    }

    let collection = mongo
        .database("codys")
        .collection::<mongodb::bson::Document>(RANK_COLLECTION);
    let options = mongodb::options::FindOptions::builder()
        .sort(doc! { "market_cap_rank": 1 })
        .limit(BACKGROUND_SYMBOL_LIMIT)
        .build();
    let mut cursor = match collection.find(doc! {}).with_options(options).await {
        Ok(cursor) => cursor,
        Err(e) => {
            warn!("[KyberSwap] Failed to load background symbols: {}", e);
            return;
        }
    };

    let mut queues = state.queues.lock().await;
    while let Ok(Some(doc)) = cursor.try_next().await {
        let symbol = match doc.get_str("symbol") {
            Ok(symbol) => symbol.to_uppercase(),
            Err(_) => continue,
        };
        for chain in configs.keys() {
            let key = QuoteJobKey {
                chain: chain.clone(),
                symbol: symbol.clone(),
            };
            if queues.queued.insert(key.clone()) {
                queues.background.push_back(key);
            }
        }
    }
}

async fn pop_next_job(state: &KyberswapState) -> Option<QuoteJobKey> {
    let mut queues = state.queues.lock().await;
    let job = queues
        .priority
        .pop_front()
        .or_else(|| queues.background.pop_front());
    if let Some(job) = &job {
        queues.queued.remove(job);
    }
    job
}

async fn process_job(
    state: &KyberswapState,
    mongo: &Client,
    http: &ImpersonateClient,
    tx: &broadcast::Sender<String>,
    lvc: &LatestValueCache,
    config: &Config,
    job: QuoteJobKey,
) {
    let cfg = match state.configs.read().await.get(&job.chain).cloned() {
        Some(cfg) => cfg,
        None => return,
    };

    apply_rate_limit(state, &cfg).await;

    let coingecko_platform = translate_annotation(&cfg.kyberswap_chain, "kyberswap", "coingecko");
    let token = match resolve_token(mongo, &job.symbol, coingecko_platform).await {
        Some(token) => token,
        None => return,
    };

    if token
        .contract_address
        .eq_ignore_ascii_case(&cfg.quote.contract_address)
    {
        return;
    }

    match fetch_quote(http, &cfg, &token).await {
        Ok(ticker) => emit_ticker(tx, lvc, config, &cfg, ticker),
        Err(QuoteError::RateLimited) => {
            set_429_cooldown(state, &cfg).await;
            warn!("[KyberSwap] 429 cooldown set for {}", cfg.kyberswap_chain);
        }
        Err(QuoteError::UnsupportedRoute) => info!(
            "[KyberSwap] no route for {} {}",
            cfg.kyberswap_chain, job.symbol
        ),
        Err(QuoteError::Other(msg)) => warn!(
            "[KyberSwap] quote failed for {} {}: {}",
            cfg.kyberswap_chain, job.symbol, msg
        ),
    }
}

async fn apply_rate_limit(state: &KyberswapState, cfg: &ChainQuoteConfig) {
    let mut rates = state.rate_state.lock().await;
    let entry = rates.entry(cfg.kyberswap_chain.clone()).or_default();
    if let Some(next) = entry.next_allowed_at {
        let now = Instant::now();
        if next > now {
            tokio::time::sleep(next - now).await;
        }
    }

    let rps = cfg
        .rate_limit
        .as_ref()
        .and_then(|r| r.requests_per_second)
        .unwrap_or(DEFAULT_REQUESTS_PER_SECOND)
        .max(1);
    entry.next_allowed_at = Some(Instant::now() + Duration::from_secs_f64(1.0 / rps as f64));
}

async fn set_429_cooldown(state: &KyberswapState, cfg: &ChainQuoteConfig) {
    let seconds = cfg
        .rate_limit
        .as_ref()
        .and_then(|r| r.cooldown_seconds_on429)
        .unwrap_or(DEFAULT_COOLDOWN_ON_429_SECS);
    let mut rates = state.rate_state.lock().await;
    rates
        .entry(cfg.kyberswap_chain.clone())
        .or_default()
        .next_allowed_at = Some(Instant::now() + Duration::from_secs(seconds));
}

async fn resolve_token(mongo: &Client, symbol: &str, chain: &str) -> Option<ResolvedToken> {
    let db = mongo.database("codys");
    let rank_collection = db.collection::<mongodb::bson::Document>(RANK_COLLECTION);
    let rank_doc = rank_collection
        .find_one(doc! { "symbol": symbol.to_lowercase() })
        .sort(doc! { "market_cap_rank": 1 })
        .await
        .ok()??;
    let coingecko_id = rank_doc.get_str("id").ok()?.to_string();

    let list_collection = db.collection::<mongodb::bson::Document>(LIST_COLLECTION);
    let coin_doc = list_collection
        .find_one(doc! { "id": &coingecko_id })
        .await
        .ok()??;
    let platforms = coin_doc.get_document("platforms").ok()?;
    let platform = platforms.get_document(chain).ok()?;
    let contract_address = platform.get_str("contract_address").ok()?.to_string();
    if !is_evm_address(&contract_address) {
        return None;
    }
    let decimals = platform
        .get_i32("decimal_place")
        .ok()
        .and_then(|v| u32::try_from(v).ok())?;

    Some(ResolvedToken {
        coingecko_id,
        symbol: symbol.to_string(),
        contract_address,
        decimals,
    })
}

enum QuoteError {
    RateLimited,
    UnsupportedRoute,
    Other(String),
}

async fn fetch_quote(
    http: &ImpersonateClient,
    cfg: &ChainQuoteConfig,
    token: &ResolvedToken,
) -> Result<NormalizedTicker, QuoteError> {
    let amount_in_units = decimal_to_units(&cfg.default_notional, cfg.quote.decimals)
        .ok_or_else(|| QuoteError::Other("invalid defaultNotional".to_string()))?;
    let url = format!(
        "{}/{}/api/v1/routes?tokenIn={}&tokenOut={}&amountIn={}",
        KYBERSWAP_HOST,
        cfg.kyberswap_chain,
        urlencoding::encode(&cfg.quote.contract_address),
        urlencoding::encode(&token.contract_address),
        urlencoding::encode(&amount_in_units)
    );
    let response = http
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| QuoteError::Other(e.to_string()))?;

    let status = response.status();
    if status.as_u16() == 429 {
        return Err(QuoteError::RateLimited);
    }
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        if is_unsupported_route_response(status.as_u16(), &body) {
            return Err(QuoteError::UnsupportedRoute);
        }
        return Err(QuoteError::Other(format!(
            "status {}: {}",
            status,
            truncate_error_body(&body)
        )));
    }

    let body = response
        .json::<Value>()
        .await
        .map_err(|e| QuoteError::Other(e.to_string()))?;
    let amount_out_units = body
        .get("data")
        .and_then(|v| v.get("routeSummary"))
        .or_else(|| body.get("routeSummary"))
        .and_then(|v| v.get("amountOut"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| QuoteError::Other("missing routeSummary.amountOut".to_string()))?;

    build_ticker(cfg, token, &amount_in_units, amount_out_units)
        .ok_or_else(|| QuoteError::Other("invalid amountOut".to_string()))
}

fn build_ticker(
    cfg: &ChainQuoteConfig,
    token: &ResolvedToken,
    amount_in_units: &str,
    amount_out_units: &str,
) -> Option<NormalizedTicker> {
    let quote_amount = units_to_decimal(amount_in_units, cfg.quote.decimals)?;
    let base_amount = units_to_decimal(amount_out_units, token.decimals)?;
    if base_amount <= 0.0 {
        return None;
    }

    let price = quote_amount / base_amount;
    let now_ms = chrono::Utc::now().timestamp_millis();
    Some(NormalizedTicker {
        exchange: ExchangeType::Dex,
        base: token.symbol.clone(),
        raw_base: token.contract_address.clone(),
        quote: cfg.quote.symbol.to_uppercase(),
        o: price,
        h: price,
        l: price,
        c: price,
        v_base: base_amount,
        v_quote: quote_amount,
        liquidity: None,
        timestamp_ms: now_ms,
        market_state: Some(MarketState::Active),
        ingest_time_us: now_micros(),
        o_krw: None,
        h_krw: None,
        l_krw: None,
        c_krw: None,
        v_quote_krw: None,
        change_24h: None,
        funding_rate: None,
        funding_interval_hours: None,
        next_funding_time_ms: None,
        funding_timestamp_ms: None,
    })
}

fn emit_ticker(
    tx: &broadcast::Sender<String>,
    lvc: &LatestValueCache,
    config: &Config,
    cfg: &ChainQuoteConfig,
    ticker: NormalizedTicker,
) {
    lvc.upsert(ticker.clone());
    if !config
        .visibility
        .is_base_visible(&ticker.base, &config.pinlist)
    {
        return;
    }

    let payload = json!({
        "type": "normalized_ticker",
        "source": format!("dex_{}", cfg.kyberswap_chain),
        "data": ticker
    });
    let _ = tx.send(payload.to_string());
}

fn is_unsupported_route_response(status: u16, body: &str) -> bool {
    if status != 400 {
        return false;
    }

    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|body| {
            let code = body.get("code").and_then(|value| value.as_i64())?;
            let message = body.get("message").and_then(|value| value.as_str())?;
            Some(code == 4008 && message.eq_ignore_ascii_case("route not found"))
        })
        .unwrap_or(false)
}

fn truncate_error_body(body: &str) -> String {
    const MAX_ERROR_BODY_CHARS: usize = 500;
    let mut chars = body.chars();
    let mut snippet: String = chars.by_ref().take(MAX_ERROR_BODY_CHARS).collect();
    if chars.next().is_some() {
        snippet.push_str("...");
    }
    snippet
}

fn decimal_to_units(value: &str, decimals: u32) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return None;
    }
    let mut parts = trimmed.split('.');
    let whole = parts.next().unwrap_or("0");
    let frac = parts.next().unwrap_or("");
    if parts.next().is_some()
        || !whole.chars().all(|c| c.is_ascii_digit())
        || !frac.chars().all(|c| c.is_ascii_digit())
    {
        return None;
    }

    let scale = 10u128.checked_pow(decimals)?;
    let whole_units = whole.parse::<u128>().ok()?.checked_mul(scale)?;
    let decimals_usize = usize::try_from(decimals).ok()?;
    let frac_padded = if frac.len() > decimals_usize {
        &frac[..decimals_usize]
    } else {
        frac
    };
    let frac_units = if frac_padded.is_empty() {
        0
    } else {
        let mut padded = frac_padded.to_string();
        padded.extend(std::iter::repeat('0').take(decimals_usize.saturating_sub(padded.len())));
        padded.parse::<u128>().ok()?
    };
    Some(whole_units.checked_add(frac_units)?.to_string())
}

fn units_to_decimal(value: &str, decimals: u32) -> Option<f64> {
    let units = value.parse::<f64>().ok()?;
    Some(units / 10f64.powi(i32::try_from(decimals).ok()?))
}

fn is_evm_address(value: &str) -> bool {
    value.len() == 42
        && value.starts_with("0x")
        && value[2..].chars().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_price_from_quote_notional_and_amount_out() {
        let cfg = ChainQuoteConfig {
            kyberswap_chain: "base".to_string(),
            enabled: true,
            quote: QuoteAsset {
                symbol: "USDC".to_string(),
                contract_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913".to_string(),
                decimals: 6,
            },
            default_notional: "1000".to_string(),
            rate_limit: None,
        };
        let token = ResolvedToken {
            coingecko_id: "token".to_string(),
            symbol: "TOKEN".to_string(),
            contract_address: "0x1111111111111111111111111111111111111111".to_string(),
            decimals: 18,
        };

        let ticker = build_ticker(&cfg, &token, "1000000000", "250000000000000000000").unwrap();

        assert_eq!(ticker.exchange, ExchangeType::Dex);
        assert_eq!(ticker.base, "TOKEN");
        assert_eq!(ticker.quote, "USDC");
        assert_eq!(ticker.v_quote, 1000.0);
        assert_eq!(ticker.v_base, 250.0);
        assert_eq!(ticker.c, 4.0);
    }

    #[test]
    fn converts_decimal_notional_to_base_units() {
        assert_eq!(decimal_to_units("1000", 6).as_deref(), Some("1000000000"));
        assert_eq!(decimal_to_units("1.25", 6).as_deref(), Some("1250000"));
    }

    #[test]
    fn validates_evm_addresses() {
        assert!(is_evm_address("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"));
        assert!(!is_evm_address("https://example.com"));
        assert!(!is_evm_address(
            "0xzz3589fcd6edb6e08f4c7c32d4f71b54bda02913"
        ));
    }

    #[test]
    fn promotes_background_jobs_to_priority_on_refresh() {
        let key = QuoteJobKey {
            chain: "bsc".to_string(),
            symbol: "ESPORTS".to_string(),
        };
        let mut queues = QuoteQueues::default();
        queues.queued.insert(key.clone());
        queues.background.push_back(key.clone());

        if let Some(index) = queues.background.iter().position(|queued| queued == &key) {
            queues.background.remove(index);
            queues.priority.push_back(key.clone());
        }

        assert!(queues.background.is_empty());
        assert_eq!(queues.priority.pop_front(), Some(key));
    }

    #[test]
    fn classifies_kyberswap_route_not_found_as_unsupported() {
        let body = r#"{"code":4008,"message":"route not found","details":null}"#;

        assert!(is_unsupported_route_response(400, body));
    }

    #[test]
    fn leaves_other_kyberswap_errors_generic() {
        let rate_limit = r#"{"code":429,"message":"rate limited"}"#;
        let malformed = "route not found";

        assert!(!is_unsupported_route_response(400, rate_limit));
        assert!(!is_unsupported_route_response(400, malformed));
        assert!(!is_unsupported_route_response(
            500,
            r#"{"code":4008,"message":"route not found"}"#
        ));
    }
}
