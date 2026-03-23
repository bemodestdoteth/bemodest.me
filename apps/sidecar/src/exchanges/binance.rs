use crate::normalizer::binance::normalize_binance_ticker_array;
use crate::types::Exchange as ExchangeType;
use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::exchanges::batcher::TickerBatcher;
use crate::config::Config;
use std::sync::Arc;

pub const TICKER_STREAM_URL: &str = "wss://stream.binance.com:9443/ws/!miniTicker@arr";

pub fn handle_message(
    text: &str,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) {
    if let Ok(raw) = serde_json::from_str::<serde_json::Value>(text) {
        let usdt_only: serde_json::Value = match raw.as_array() {
            Some(arr) => serde_json::Value::Array(
                arr.iter()
                    .filter(|item| {
                        item.get("s")
                            .and_then(|s| s.as_str())
                            .map(|s| s.ends_with("USDT"))
                            .unwrap_or(false)
                    })
                    .cloned()
                    .collect()
            ),
            None => raw,
        };

        let normalized = normalize_binance_ticker_array(&usdt_only, ExchangeType::Binance);

        for mut ticker in normalized {
            if config.excludelist.read().unwrap().iter().any(|ex| ticker.base.starts_with(ex)) {
                continue;
            }
            ticker.base = tac.resolve_ticker_base(&ticker.exchange, &ticker.raw_base, &ticker.base);
            
            let payload = serde_json::json!({
                "type": "normalized_ticker",
                "source": ticker.exchange.to_string(),
                "data": &ticker
            });
            
            batcher.push(ticker.base.clone(), ticker.quote.clone(), payload);
            lvc.upsert(ticker);
        }
    }
}

