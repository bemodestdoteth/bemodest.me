pub mod generated;
pub use generated::{AlertRule, SidecarConfigPayload, NormalizedTicker, Exchange, MarketState};

impl std::str::FromStr for MarketState {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "ACTIVE" => Ok(MarketState::Active),
            "PREVIEW" => Ok(MarketState::Preview),
            "SUSPENDED" => Ok(MarketState::Suspended),
            _ => Err(()),
        }
    }
}

use rust_decimal::Decimal;
use std::str::FromStr;

impl std::fmt::Display for Exchange {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = serde_json::to_string(self).map_err(|_| std::fmt::Error)?;
        write!(f, "{}", s.trim_matches('"'))
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

pub fn parse_decimal(s: &str) -> Option<Decimal> {
    Decimal::from_str(s).ok()
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

pub fn strip_scale_factor(base: &str) -> (String, Decimal) {
    const PREFIXES: &[(&str, u64)] = &[
        ("1000000", 1_000_000), ("100000", 100_000), ("10000", 10_000), ("1000", 1_000),
    ];
    const SUFFIXES: &[(&str, u64)] = &[
        ("1000000", 1_000_000), ("100000", 100_000), ("10000", 10_000), ("1000", 1_000),
    ];
    for (prefix, divisor) in PREFIXES {
        if let Some(stripped) = base.strip_prefix(prefix) {
            if !stripped.is_empty() { return (stripped.to_string(), Decimal::from(*divisor)); }
        }
    }
    for (suffix, divisor) in SUFFIXES {
        if let Some(stripped) = base.strip_suffix(suffix) {
            if !stripped.is_empty() { return (stripped.to_string(), Decimal::from(*divisor)); }
        }
    }
    (base.to_string(), Decimal::ONE)
}
