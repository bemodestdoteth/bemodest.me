pub mod generated {
    #![allow(clippy::all, unused_imports, non_camel_case_types, non_snake_case)]
    include!(concat!(env!("OUT_DIR"), "/generated.rs"));
}

pub use generated::*;
pub use generated::{
    NormalizedTickerExchange as Exchange, 
    NormalizedTickerMarketState as MarketState,
    AlertRuleCondition as Condition,
    SidecarConfigPayloadType as Type,
};





// ============================================================================
// Helper Functions
// ============================================================================

pub fn parse_decimal(s: &str) -> Option<rust_decimal::Decimal> {
    use std::str::FromStr;
    rust_decimal::Decimal::from_str(s).ok()
}

pub fn parse_binance_symbol(symbol: &str) -> Option<(String, String)> {
    const QUOTES: &[&str] = &[
        "USDT", "BUSD", "USDC", "TUSD", "FDUSD",
        "BTC", "ETH", "BNB", "EUR", "TRY", "GBP", "USD",
    ];
    for quote in QUOTES {
        if symbol.ends_with(quote) && symbol.len() > quote.len() {
            let base = &symbol[..symbol.len() - quote.len()];
            return Some((base.to_string(), quote.to_string()));
        }
    }
    None
}

pub fn parse_korean_symbol(code: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = code.split('-').collect();
    if parts.len() == 2 {
        Some((parts[1].to_string(), parts[0].to_string()))
    } else {
        None
    }
}

pub fn now_micros() -> i64 {
    chrono::Utc::now().timestamp_micros()
}

pub fn strip_scale_factor(base: &str) -> (String, rust_decimal::Decimal) {
    const PREFIXES: &[(&str, u64)] = &[
        ("1000000", 1_000_000), ("100000", 100_000), ("10000", 10_000), ("1000", 1_000),
    ];
    const SUFFIXES: &[(&str, u64)] = &[
        ("1000000", 1_000_000), ("100000", 100_000), ("10000", 10_000), ("1000", 1_000),
    ];
    for (prefix, divisor) in PREFIXES {
        if let Some(stripped) = base.strip_prefix(prefix) {
            if !stripped.is_empty() { return (stripped.to_string(), rust_decimal::Decimal::from(*divisor)); }
        }
    }
    for (suffix, divisor) in SUFFIXES {
        if let Some(stripped) = base.strip_suffix(suffix) {
            if !stripped.is_empty() { return (stripped.to_string(), rust_decimal::Decimal::from(*divisor)); }
        }
    }
    (base.to_string(), rust_decimal::Decimal::ONE)
}
