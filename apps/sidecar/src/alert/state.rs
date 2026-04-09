use redis::AsyncCommands;
use log::warn;
use crate::alert::types::{AlertState, AlertStatus};

/// Redis-backed store for per-rule alert state and cooldown locks.
///
/// Uses a `MultiplexedConnection` so the same connection can be shared
/// across concurrent callers without a mutex on the call site.
///
/// Key scheme (matches PRICE_ALERT_PLAN.md):
/// - State hash : `alert:state:{rule_id}`   — HSET fields: status, triggered_at, cooldown_until, last_value
/// - Dedup lock : `alert:lock:{rule_id}`    — SET NX EX {cooldown_secs}
pub struct AlertStateStore {
    conn: redis::aio::MultiplexedConnection,
}

impl AlertStateStore {
    /// Connect to Redis and return an `AlertStateStore`.
    ///
    /// Panics on connection failure — the sidecar cannot operate without
    /// Redis (alert state would be lost), so a hard fail on startup is
    /// preferred over silently degrading.
    pub async fn new(redis_url: &str) -> Self {
        let client = redis::Client::open(redis_url)
            .expect("[AlertStateStore] Invalid Redis URL");
        let conn = client
            .get_multiplexed_async_connection()
            .await
            .expect("[AlertStateStore] Could not connect to Redis");
        Self { conn }
    }

    // -----------------------------------------------------------------------
    // Cooldown / dedup lock
    // -----------------------------------------------------------------------

    /// Attempt to acquire the atomic cooldown lock for `rule_id`.
    ///
    /// Issues `SET alert:lock:{rule_id} 1 NX EX {cooldown_secs}`.
    /// Returns `true` if the lock was newly set (i.e. the alert may fire),
    /// or `false` if the key already existed (still within cooldown).
    pub async fn try_acquire_lock(&mut self, rule_id: &str, cooldown_secs: u64, suffix: Option<&str>) -> bool {
        let key = if let Some(s) = suffix {
            format!("alert:lock:{}:{}", rule_id, s)
        } else {
            format!("alert:lock:{}", rule_id)
        };
        let result: redis::RedisResult<Option<String>> = redis::cmd("SET")
            .arg(&key)
            .arg(1)
            .arg("NX")
            .arg("EX")
            .arg(cooldown_secs)
            .query_async(&mut self.conn)
            .await;
        match result {
            Ok(Some(_)) => true,   // lock acquired — "OK" response
            Ok(None) => false,     // key already existed — within cooldown
            Err(e) => {
                warn!("[AlertStateStore] try_acquire_lock failed for {}: {}", rule_id, e);
                false // fail safe — do not fire on Redis errors
            }
        }
    }

    // -----------------------------------------------------------------------
    // Alert state HSET
    // -----------------------------------------------------------------------

    /// Persist the current `AlertState` for `rule_id` into
    /// `HSET alert:state:{rule_id}`.
    pub async fn set_state(&mut self, rule_id: &str, state: &AlertState) {
        let key = format!("alert:state:{}", rule_id);
        let status_str = match state.status {
            AlertStatus::Triggered => "triggered",
            AlertStatus::Recovered => "recovered",
        };
        let result: redis::RedisResult<()> = self.conn.hset_multiple(
            &key,
            &[
                ("status",         status_str.to_string()),
                ("triggered_at",   state.triggered_at.to_string()),
                ("cooldown_until", state.cooldown_until.to_string()),
                ("last_value",     state.last_value.clone()),
            ],
        ).await;
        if let Err(e) = result {
            warn!("[AlertStateStore] set_state failed for {}: {}", rule_id, e);
        }
    }

    /// Read back the persisted `AlertState` for `rule_id`, if present.
    ///
    /// Returns `None` when the key does not exist or any field is missing /
    /// malformed (logs a warning and fails gracefully).
    pub async fn get_state(&mut self, rule_id: &str) -> Option<AlertState> {
        let key = format!("alert:state:{}", rule_id);
        let fields: redis::RedisResult<std::collections::HashMap<String, String>> =
            self.conn.hgetall(&key).await;
        match fields {
            Ok(map) if !map.is_empty() => {
                let status = match map.get("status").map(|s| s.as_str()) {
                    Some("triggered") => AlertStatus::Triggered,
                    Some("recovered") => AlertStatus::Recovered,
                    other => {
                        warn!("[AlertStateStore] unknown status {:?} for {}", other, rule_id);
                        return None;
                    }
                };
                let triggered_at = map.get("triggered_at")?.parse::<i64>().ok()?;
                let cooldown_until = map.get("cooldown_until")?.parse::<i64>().ok()?;
                let last_value = map.get("last_value")?.clone();
                Some(AlertState { status, triggered_at, cooldown_until, last_value })
            }
            Ok(_) => None, // empty map — key does not exist
            Err(e) => {
                warn!("[AlertStateStore] get_state failed for {}: {}", rule_id, e);
                None
            }
        }
    }

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    /// Delete both the state hash and the cooldown lock for `rule_id`.
    ///
    /// Called when a rule is deleted via the Node API so stale Redis keys
    /// don't accumulate.
    pub async fn clear_state(&mut self, rule_id: &str) {
        let state_key = format!("alert:state:{}", rule_id);
        let lock_key  = format!("alert:lock:{}", rule_id);
        let result: redis::RedisResult<()> = self.conn.del(&[state_key, lock_key]).await;
        if let Err(e) = result {
            warn!("[AlertStateStore] clear_state failed for {}: {}", rule_id, e);
        }
    }

    /// Publish real-time leader prices to a central Redis hash for the API.
    /// Key: `lvc:prices`, Fields: `TICKER` -> `PRICE`
    pub async fn publish_lvc_prices(&mut self, prices: Vec<(String, String)>) {
        if prices.is_empty() {
            return;
        }
        let result: redis::RedisResult<()> = self.conn.hset_multiple("lvc:prices", &prices).await;
        if let Err(e) = result {
            warn!("[AlertStateStore] publish_lvc_prices failed: {}", e);
        }
    }
}
