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

pub mod exchange_ext;
pub use exchange_ext::ExchangeExt;





// ============================================================================
// Helper Functions
// ============================================================================

pub fn parse_decimal(s: &str) -> Option<rust_decimal::Decimal> {
    use std::str::FromStr;
    rust_decimal::Decimal::from_str(s).ok()
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
