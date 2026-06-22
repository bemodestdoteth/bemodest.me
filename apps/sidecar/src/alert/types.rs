pub use crate::types::{AlertRule as GeneratedAlertRule, Condition as AlertCondition};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// Sentinel: Integrated with shared schema pipeline.
pub type AlertRule = GeneratedAlertRule;

fn default_cooldown_secs() -> u64 {
    300
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertType {
    Normal,
    Urgent,
}

impl AlertType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AlertType::Normal => "normal",
            AlertType::Urgent => "urgent",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlertOperator {
    Gt,
    Gte,
    Lt,
    Lte,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertTypeRule {
    pub alert_type: AlertType,
    pub operator: AlertOperator,
    pub value: f64,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DestinationAssignment {
    pub destination_id: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub dead: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlertDestination {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub url: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(rename = "supported_alert_types", default)]
    pub alert_types: Vec<AlertType>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeAlertRule {
    #[serde(flatten)]
    pub rule: AlertRule,
}

#[derive(Debug, Clone, Default)]
pub struct AlertRuntimeConfig {
    pub rules: Vec<RuntimeAlertRule>,
    pub destinations: std::collections::HashMap<String, AlertDestination>,
}

fn default_enabled() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_alert_rule_deserializes_current_schema_fields() {
        let rule: RuntimeAlertRule = serde_json::from_value(serde_json::json!({
            "_id": "market-watch-global-visibility",
            "scope": "market_watch",
            "condition": "spread_pct",
            "cooldown_secs": 300,
            "enabled": true,
            "exchanges": [],
            "label": "Market Watch Global Visibility",
            "minSources": 2,
            "quote": "USDT",
            "recovery_value": 0,
            "ticker": "*",
            "value": 10,
            "volumeFloorUsd": 30000,
            "destination_assignments": [{
                "destination_id": "builtin-api-ingest",
                "enabled": true,
                "dead": false
            }],
            "alert_type_rules": [{
                "alert_type": "normal",
                "operator": "gt",
                "value": 10
            }]
        }))
        .expect("current-schema alert rule should deserialize");

        assert_eq!(rule.rule.destination_assignments.len(), 1);
        assert_eq!(rule.rule.alert_type_rules.len(), 1);
    }

    #[test]
    fn webhook_template_is_selected_from_url_path_suffix() {
        assert_eq!(
            WebhookTemplate::from_url("https://alerts.example.ts.net/hooks/price-spike"),
            Some(WebhookTemplate::PriceSpike)
        );
        assert_eq!(
            WebhookTemplate::from_url("https://alerts.example.ts.net/hooks/new-entry/"),
            Some(WebhookTemplate::NewEntry)
        );
        assert_eq!(
            WebhookTemplate::from_url("https://alerts.example.ts.net/hooks/other"),
            None
        );
    }
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
    pub alert_event_id: String,

    /// Matches `AlertRule::id`
    pub rule_id: String,

    pub assignment_id: String,
    pub destination_id: String,
    pub destination_label: String,
    pub destination_kind: String,

    /// Destination webhook URL — copied from `alertDestinations.url`
    pub webhook_url: String,

    pub alert_type: AlertType,

    pub label: String,
    pub scope: String,
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

    /// Korean venue whose forex premium was applied to this spread alert.
    pub premium_exchange: Option<String>,

    /// Signed premium adjustment percentage applied to the raw spread.
    pub premium_adjustment_pct: Option<f64>,

    /// When the alert fired (UTC)
    pub triggered_at: DateTime<Utc>,

    /// Destination URL path suffix selects the external Telegram template schema.
    pub webhook_template: Option<WebhookTemplate>,

    /// Template-specific payload for the destination. Missing source data is explicit null.
    pub template_payload: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookTemplate {
    PriceSpike,
    NewEntry,
}

impl WebhookTemplate {
    pub fn from_url(url: &str) -> Option<Self> {
        let parsed = reqwest::Url::parse(url).ok()?;
        match parsed.path().trim_end_matches('/').rsplit('/').next()? {
            "price-spike" => Some(Self::PriceSpike),
            "new-entry" => Some(Self::NewEntry),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PriceSpike => "price_spike",
            Self::NewEntry => "new_entry",
        }
    }
}
