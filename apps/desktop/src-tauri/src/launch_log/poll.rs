//! Shared types for emitting structured progress events from health-poll
//! loops (orchestrator + AuroWork server). Callers pass a closure to the
//! wait_for_* functions; on first reply and on heartbeat ticks the loop
//! invokes the closure with a [`PollUpdate`] so it can be translated into
//! launch-log entries with the appropriate tag.

/// A function pointer convenience alias for poll-progress callbacks.
#[allow(dead_code)]
pub type PollEvent<'a> = &'a dyn Fn(PollUpdate);

/// A single progress event emitted by a wait_for_* polling loop.
pub enum PollUpdate {
    /// Fired exactly once for the first response (Ok or Err) from the
    /// polled endpoint.
    FirstReply {
        elapsed_ms: u128,
        status: PollReplyStatus,
    },
    /// Fired periodically while the loop is still polling (typically every
    /// ~5 seconds). `last_error` is the most recent error or unhealthy
    /// status message recorded so far.
    Heartbeat {
        attempts: u32,
        elapsed_ms: u128,
        last_error: String,
    },
}

/// Classification of an individual HTTP poll attempt.
pub enum PollReplyStatus {
    /// A 2xx response from the endpoint.
    HttpOk(u16),
    /// A non-2xx HTTP response.
    HttpNonOk(u16),
    /// Transport-level error (DNS, TCP, TLS, timeout, …).
    Error(String),
}

#[cfg(test)]
mod tests {
    use super::{PollReplyStatus, PollUpdate};

    #[test]
    fn poll_reply_status_variants_construct() {
        let ok = PollReplyStatus::HttpOk(200);
        let nok = PollReplyStatus::HttpNonOk(503);
        let err = PollReplyStatus::Error("dns failed".to_string());
        assert!(matches!(ok, PollReplyStatus::HttpOk(200)));
        assert!(matches!(nok, PollReplyStatus::HttpNonOk(503)));
        assert!(matches!(err, PollReplyStatus::Error(_)));
    }

    #[test]
    fn poll_update_variants_construct() {
        let first = PollUpdate::FirstReply {
            elapsed_ms: 10,
            status: PollReplyStatus::HttpOk(200),
        };
        let hb = PollUpdate::Heartbeat {
            attempts: 25,
            elapsed_ms: 5_000,
            last_error: "boom".to_string(),
        };
        assert!(matches!(first, PollUpdate::FirstReply { .. }));
        assert!(matches!(hb, PollUpdate::Heartbeat { .. }));
    }
}
