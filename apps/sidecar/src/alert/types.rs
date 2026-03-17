pub use crate::types::generated::{Condition as AlertCondition, AlertRule as GeneratedAlertRule};

use rust_decimal::Decimal;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// Re-using the generated structs directly for most cases, but we might need 
// to keep some legacy names or aliases for compatibility.

// Note: AlertRule in engine will now use GeneratedAlertRule or we rename it.
// To minimize breakage, we'll alias it.
pub type AlertRule = GeneratedAlertRule;

fn default_cooldown_secs() -> u64 {
    300
}

// ============================================================================
// Alert State  (persisted in Redis HSET alert:state:{rule_id})
// ============================================================================

/// Runtime state for a single alert rule, persisted in Redis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertState {
    /// `"triggered"` or `"recovered"`
    pub status: AlertStatus,

    /// When the alert last fired (epoch ms)
    pub triggered_at: i64,

    /// Epoch ms after which the cooldown lock will have expired.
    /// Informational — the authoritative lock lives in `alert:lock:{rule_id}`.
    pub cooldown_until: i64,

    /// String-serialised last evaluated metric value (e.g. `"2.31"`)
    pub last_value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertStatus {
    Triggered,
    Recovered,
}

// ============================================================================
// Alert Fired Event  (sent on the internal broadcast channel → webhook sender)
// ============================================================================

/// Produced by the alert engine and consumed by the webhook dispatcher.
/// Contains everything needed to build the JSON POST body and route delivery.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertFiredEvent {
    /// Matches `AlertRule::id`
    pub rule_id: String,

    /// Destination webhook URL — copied from `AlertRule::webhook_url`
    pub webhook_url: String,

    pub label: String,
    pub condition: AlertCondition,
    pub ticker: String,
    pub quote: String,

    /// Exchange ids that were part of this comparison
    pub exchanges: Vec<String>,

    /// The computed metric value that triggered the alert (e.g. spread %)
    pub value: f64,

    /// The configured threshold that was crossed
    pub threshold: f64,

    /// Exchange with the highest price in this comparison (for spread alerts)
    pub highest_exchange: Option<String>,

    /// Exchange with the lowest price in this comparison (for spread alerts)
    pub lowest_exchange: Option<String>,

    /// Price at the highest exchange (USD)
    pub price_high: Option<f64>,

    /// Price at the lowest exchange (USD)
    pub price_low: Option<f64>,

    /// When the alert fired (UTC)
    pub triggered_at: DateTime<Utc>,
}
