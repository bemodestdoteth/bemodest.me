use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Unified ticker structure for all exchanges
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NormalizedTicker {
    pub exchange: Exchange,
    pub base: String,
    pub quote: String,
    /// Open price — USD-denominated for KRW pairs (when forex rate available), else native quote
    pub o: Decimal,
    /// High price — USD-denominated for KRW pairs (when forex rate available), else native quote
    pub h: Decimal,
    /// Low price — USD-denominated for KRW pairs (when forex rate available), else native quote
    pub l: Decimal,
    /// Close price — USD-denominated for KRW pairs (when forex rate available), else native quote
    pub c: Decimal,
    pub v_base: Decimal,
    /// Quote volume — USD-denominated for KRW pairs (when forex rate available), else native quote
    pub v_quote: Decimal,
    pub timestamp_ms: i64,
    pub market_state: Option<MarketState>,
    pub ingest_time_us: i64,
    // KRW originals — only Some() for Upbit/Bithumb KRW-quote pairs
    #[serde(skip_serializing_if = "Option::is_none")]
    pub o_krw: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h_krw: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub l_krw: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub c_krw: Option<Decimal>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub v_quote_krw: Option<Decimal>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Exchange {
    Binance,
    BinanceFutures,
    Upbit,
    Bithumb,
    Bybit,
    BybitFutures,
    Gateio,
    Bitget,
    BitgetFutures,
    Coinbase,
    Kraken,
    Kucoin,
    Okx,
    OkxFutures,
    Dex,
}

impl fmt::Display for Exchange {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Exchange::Binance => write!(f, "binance"),
            Exchange::BinanceFutures => write!(f, "binance_f"),
            Exchange::Upbit => write!(f, "upbit"),
            Exchange::Bithumb => write!(f, "bithumb"),
            Exchange::Bybit => write!(f, "bybit"),
            Exchange::BybitFutures => write!(f, "bybit_f"),
            Exchange::Gateio => write!(f, "gateio"),
            Exchange::Bitget => write!(f, "bitget"),
            Exchange::BitgetFutures => write!(f, "bitget_f"),
            Exchange::Coinbase => write!(f, "coinbase"),
            Exchange::Kraken => write!(f, "kraken"),
            Exchange::Kucoin => write!(f, "kucoin"),
            Exchange::Okx => write!(f, "okx"),
            Exchange::OkxFutures => write!(f, "okx_f"),
            Exchange::Dex => write!(f, "dex"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MarketState {
    Preview,
    Active,
    Suspended,
}

impl FromStr for MarketState {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "PREVIEW" => Ok(MarketState::Preview),
            "ACTIVE" | "TRADE" => Ok(MarketState::Active),
            "SUSPENDED" | "HALT" => Ok(MarketState::Suspended),
            _ => Err(()),
        }
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Parse a string to Decimal, returning None on failure
pub fn parse_decimal(s: &str) -> Option<Decimal> {
    Decimal::from_str(s).ok()
}

/// Parse Binance symbol format: "BTCUSDT" -> ("BTC", "USDT")
/// Note: This is a simplified version. Full implementation needs quote list lookup.
pub fn parse_binance_symbol(symbol: &str) -> Option<(String, String)> {
    // Common quote currencies in order of length (longest first to avoid partial matches)
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

/// Parse Korean exchange symbol format: "KRW-BTC" -> ("BTC", "KRW")
pub fn parse_korean_symbol(code: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = code.split('-').collect();
    if parts.len() == 2 {
        Some((parts[1].to_string(), parts[0].to_string()))
    } else {
        None
    }
}

/// Get current timestamp in microseconds
pub fn now_micros() -> i64 {
    chrono::Utc::now().timestamp_micros()
}

/// For futures exchanges, some tickers represent a scaled contract (e.g. 1000SHIB, 1000PEPE).
/// This function detects a leading or trailing numeric scale factor in the base symbol,
/// strips it, and returns `(clean_base, scale_divisor)`.
///
/// Supported patterns (prefix): 1000*, 10000*, 100000*, 1000000*
/// Supported patterns (suffix): *1000, *10000, *100000, *1000000
///
/// Returns `(original_base, Decimal::ONE)` when no known scale factor is found.
pub fn strip_scale_factor(base: &str) -> (String, Decimal) {
    // Patterns to try — longest first to avoid partial matches
    const PREFIXES: &[(&str, u64)] = &[
        ("1000000", 1_000_000),
        ("100000",  100_000),
        ("10000",   10_000),
        ("1000",    1_000),
    ];
    const SUFFIXES: &[(&str, u64)] = &[
        ("1000000", 1_000_000),
        ("100000",  100_000),
        ("10000",   10_000),
        ("1000",    1_000),
    ];

    for (prefix, divisor) in PREFIXES {
        if let Some(stripped) = base.strip_prefix(prefix) {
            if !stripped.is_empty() {
                return (stripped.to_string(), Decimal::from(*divisor));
            }
        }
    }

    for (suffix, divisor) in SUFFIXES {
        if let Some(stripped) = base.strip_suffix(suffix) {
            if !stripped.is_empty() {
                return (stripped.to_string(), Decimal::from(*divisor));
            }
        }
    }

    (base.to_string(), Decimal::ONE)
}
