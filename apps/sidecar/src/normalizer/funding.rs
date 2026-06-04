use crate::types::NormalizedTicker;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FundingUpdate {
    pub funding_rate: Option<f64>,
    pub funding_interval_hours: Option<f64>,
    pub next_funding_time_ms: Option<i64>,
    pub funding_timestamp_ms: Option<i64>,
}

impl FundingUpdate {
    pub fn from_existing(ticker: &NormalizedTicker) -> Self {
        Self {
            funding_rate: ticker.funding_rate,
            funding_interval_hours: ticker.funding_interval_hours,
            next_funding_time_ms: ticker.next_funding_time_ms,
            funding_timestamp_ms: ticker.funding_timestamp_ms,
        }
    }

    pub fn apply_to(self, ticker: &mut NormalizedTicker) {
        if self.funding_rate.is_some() {
            ticker.funding_rate = self.funding_rate;
        }
        if self.funding_interval_hours.is_some() {
            ticker.funding_interval_hours = self.funding_interval_hours;
        }
        if self.next_funding_time_ms.is_some() {
            ticker.next_funding_time_ms = self.next_funding_time_ms;
        }
        if self.funding_timestamp_ms.is_some() {
            ticker.funding_timestamp_ms = self.funding_timestamp_ms;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Exchange, NormalizedTicker};

    fn ticker() -> NormalizedTicker {
        NormalizedTicker {
            exchange: Exchange::BinanceF,
            base: "BTC".to_string(),
            raw_base: "BTC".to_string(),
            quote: "USDT".to_string(),
            o: 100.0,
            h: 110.0,
            l: 90.0,
            c: 105.0,
            v_base: 1.0,
            v_quote: 105.0,
            timestamp_ms: 1,
            market_state: None,
            ingest_time_us: 1,
            o_krw: None,
            h_krw: None,
            l_krw: None,
            c_krw: None,
            v_quote_krw: None,
            change_24h: None,
            liquidity: None,
            funding_rate: Some(0.0001),
            funding_interval_hours: Some(8.0),
            next_funding_time_ms: Some(1700006400000),
            funding_timestamp_ms: Some(1700000000000),
        }
    }

    #[test]
    fn applies_only_present_funding_fields() {
        let mut ticker = ticker();
        FundingUpdate {
            funding_rate: Some(0.0002),
            funding_interval_hours: None,
            next_funding_time_ms: Some(1700010000000),
            funding_timestamp_ms: None,
        }
        .apply_to(&mut ticker);

        assert_eq!(ticker.funding_rate, Some(0.0002));
        assert_eq!(ticker.funding_interval_hours, Some(8.0));
        assert_eq!(ticker.next_funding_time_ms, Some(1700010000000));
        assert_eq!(ticker.funding_timestamp_ms, Some(1700000000000));
    }

    #[test]
    fn copies_existing_funding_fields() {
        let ticker = ticker();

        assert_eq!(
            FundingUpdate::from_existing(&ticker),
            FundingUpdate {
                funding_rate: Some(0.0001),
                funding_interval_hours: Some(8.0),
                next_funding_time_ms: Some(1700006400000),
                funding_timestamp_ms: Some(1700000000000),
            }
        );
    }
}
