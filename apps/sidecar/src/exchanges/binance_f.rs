use log::trace;
use serde_json::Value;
use std::sync::Arc;

use crate::cache::lvc::LatestValueCache;
use crate::cache::TokenAnnotationCache;
use crate::config::Config;
use crate::exchanges::batcher::TickerBatcher;
use crate::normalizer::binance::normalize_binance_ticker_array;
use crate::types::Exchange as ExchangeType;

pub const TICKER_STREAM_URL: &str =
    "wss://fstream.binancefuture.com/stream?streams=!miniTicker@arr";

pub fn handle_message(
    text: &str,
    batcher: &mut TickerBatcher,
    tac: &Arc<TokenAnnotationCache>,
    config: &Arc<Config>,
    lvc: &Arc<LatestValueCache>,
) {
    if let Ok(mut json_val) = serde_json::from_str::<Value>(text) {
        let data_content = if let Some(inner_data) = json_val.get_mut("data") {
            inner_data.take()
        } else {
            json_val.clone()
        };

        let normalized = normalize_binance_ticker_array(&data_content, ExchangeType::BinanceF);
        for mut ticker in normalized {
            if config
                .excludelist
                .read()
                .unwrap()
                .iter()
                .any(|ex| ticker.base.starts_with(ex))
            {
                continue;
            }
            ticker.base = tac.resolve_ticker_base(&ticker.exchange, &ticker.raw_base, &ticker.base);
            trace!(
                "[BinanceF] Normalized: {}/{} c={}",
                ticker.base,
                ticker.quote,
                ticker.c
            );
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
