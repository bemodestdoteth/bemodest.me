pub fn translate_annotation<'a>(value: &'a str, from: &str, to: &str) -> &'a str {
    match (from, to, value) {
        ("kyberswap", "coingecko", "bsc") => "binance-smart-chain",
        _ => value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_bnb_kyberswap_to_coingecko_platform() {
        assert_eq!(
            translate_annotation("bsc", "kyberswap", "coingecko"),
            "binance-smart-chain"
        );
    }

    #[test]
    fn keeps_matching_platform_keys_unchanged() {
        assert_eq!(
            translate_annotation("ethereum", "kyberswap", "coingecko"),
            "ethereum"
        );
        assert_eq!(
            translate_annotation("base", "kyberswap", "coingecko"),
            "base"
        );
    }

    #[test]
    fn keeps_unrelated_namespace_values_unchanged() {
        assert_eq!(translate_annotation("BSC", "kyberswap", "binance"), "BSC");
    }
}
