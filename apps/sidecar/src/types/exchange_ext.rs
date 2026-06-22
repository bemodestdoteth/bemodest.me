use super::Exchange;

/// Extension trait for the Exchange enum to provide metadata and parsing logic
pub trait ExchangeExt {
    /// Parse exchange-specific symbol into (base, quote)
    fn parse_symbol(&self, symbol: &str) -> Option<(String, String)>;

    /// Get the market data source name used in config/logs
    fn source_name(&self) -> &'static str;

    /// Is this exchange included in the MarketCache?
    fn needs_market_cache(&self) -> bool;

    /// Try to get Exchange from source name string
    fn from_source_name(name: &str) -> Option<Exchange>;
}

impl ExchangeExt for Exchange {
    fn parse_symbol(&self, symbol: &str) -> Option<(String, String)> {
        match self {
            Exchange::Binance
            | Exchange::BinanceF
            | Exchange::Bybit
            | Exchange::BybitF
            | Exchange::Bitget
            | Exchange::BitgetF => parse_binance_symbol(symbol),
            Exchange::HyperliquidF => Some((symbol.to_string(), "USDC".to_string())),
            Exchange::Upbit | Exchange::Bithumb => parse_korean_symbol(symbol),
            Exchange::Gateio => {
                let parts: Vec<&str> = symbol.split('_').collect();
                if parts.len() == 2 {
                    Some((parts[0].to_string(), parts[1].to_string()))
                } else {
                    None
                }
            }
            Exchange::Coinbase | Exchange::Kucoin | Exchange::Okx | Exchange::OkxF => {
                let parts: Vec<&str> = symbol.splitn(2, '-').collect();
                if parts.len() == 2 {
                    Some((parts[0].to_string(), parts[1].to_string()))
                } else {
                    None
                }
            }
            Exchange::Kraken => {
                let parts: Vec<&str> = symbol.splitn(2, '/').collect();
                if parts.len() == 2 {
                    Some((parts[0].to_string(), parts[1].to_string()))
                } else {
                    None
                }
            }
            Exchange::Dex => None,
        }
    }

    fn source_name(&self) -> &'static str {
        match self {
            Exchange::Binance => "binance",
            Exchange::BinanceF => "binance_f",
            Exchange::Upbit => "upbit",
            Exchange::Bithumb => "bithumb",
            Exchange::Bybit => "bybit",
            Exchange::BybitF => "bybit_f",
            Exchange::Gateio => "gateio",
            Exchange::Bitget => "bitget",
            Exchange::BitgetF => "bitget_f",
            Exchange::Coinbase => "coinbase",
            Exchange::Kraken => "kraken",
            Exchange::Kucoin => "kucoin",
            Exchange::Okx => "okx",
            Exchange::OkxF => "okx_f",
            Exchange::HyperliquidF => "hyperliquid_f",
            Exchange::Dex => "dex",
        }
    }

    fn needs_market_cache(&self) -> bool {
        match self {
            Exchange::Binance | Exchange::BinanceF | Exchange::Dex => false,
            _ => true,
        }
    }

    fn from_source_name(name: &str) -> Option<Exchange> {
        match name {
            "binance" => Some(Exchange::Binance),
            "binance_f" => Some(Exchange::BinanceF),
            "upbit" => Some(Exchange::Upbit),
            "bithumb" => Some(Exchange::Bithumb),
            "bybit" => Some(Exchange::Bybit),
            "bybit_f" => Some(Exchange::BybitF),
            "gateio" => Some(Exchange::Gateio),
            "bitget" => Some(Exchange::Bitget),
            "bitget_f" => Some(Exchange::BitgetF),
            "coinbase" => Some(Exchange::Coinbase),
            "kraken" => Some(Exchange::Kraken),
            "kucoin" => Some(Exchange::Kucoin),
            "okx" => Some(Exchange::Okx),
            "okx_f" => Some(Exchange::OkxF),
            "hyperliquid_f" => Some(Exchange::HyperliquidF),
            "dex" => Some(Exchange::Dex),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_binance() {
        let ex = Exchange::Binance;
        assert_eq!(
            ex.parse_symbol("BTCUSDT"),
            Some(("BTC".to_string(), "USDT".to_string()))
        );
        assert_eq!(
            ex.parse_symbol("ETHBTC"),
            Some(("ETH".to_string(), "BTC".to_string()))
        );
    }

    #[test]
    fn test_parse_upbit() {
        let ex = Exchange::Upbit;
        assert_eq!(
            ex.parse_symbol("KRW-BTC"),
            Some(("BTC".to_string(), "KRW".to_string()))
        );
    }

    #[test]
    fn test_parse_hyperliquid_qualified_coin() {
        let ex = Exchange::HyperliquidF;
        assert_eq!(
            ex.parse_symbol("xyz:SKHX"),
            Some(("xyz:SKHX".to_string(), "USDC".to_string()))
        );
    }

    #[test]
    fn test_parse_gateio() {
        let ex = Exchange::Gateio;
        assert_eq!(
            ex.parse_symbol("BTC_USDT"),
            Some(("BTC".to_string(), "USDT".to_string()))
        );
    }

    #[test]
    fn test_parse_coinbase() {
        let ex = Exchange::Coinbase;
        assert_eq!(
            ex.parse_symbol("BTC-USD"),
            Some(("BTC".to_string(), "USD".to_string()))
        );
    }

    #[test]
    fn test_parse_kraken() {
        let ex = Exchange::Kraken;
        assert_eq!(
            ex.parse_symbol("XBT/USD"),
            Some(("XBT".to_string(), "USD".to_string()))
        );
    }
}

// ============================================================================
// Internal Helper Functions
// ============================================================================

fn parse_binance_symbol(symbol: &str) -> Option<(String, String)> {
    const QUOTES: &[&str] = &[
        "USDT", "BUSD", "USDC", "TUSD", "FDUSD", "BTC", "ETH", "BNB", "EUR", "TRY", "GBP", "USD",
    ];
    for quote in QUOTES {
        if symbol.ends_with(quote) && symbol.len() > quote.len() {
            let base = &symbol[..symbol.len() - quote.len()];
            return Some((base.to_string(), quote.to_string()));
        }
    }
    None
}

fn parse_korean_symbol(code: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = code.split('-').collect();
    if parts.len() == 2 {
        Some((parts[1].to_string(), parts[0].to_string()))
    } else {
        None
    }
}
