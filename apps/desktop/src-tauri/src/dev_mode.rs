//! Single source of truth for AUROWORK_DEV_MODE.
//!
//! Reads the env var once and caches it for the lifetime of the process so
//! callers don't repeatedly hit `std::env::var`. Debug builds default to
//! true (matching historical behavior); release builds require explicit
//! opt-in via `AUROWORK_DEV_MODE=1`.

use std::sync::OnceLock;

static ENABLED: OnceLock<bool> = OnceLock::new();

pub fn is_enabled() -> bool {
    *ENABLED.get_or_init(|| {
        match std::env::var("AUROWORK_DEV_MODE") {
            Ok(value) => value == "1",
            Err(_) => cfg!(debug_assertions),
        }
    })
}

#[cfg(test)]
mod tests {
    // We can't reliably toggle the env in tests because OnceLock caches
    // the first read, but we can at least verify the function returns
    // a stable bool and matches itself on repeated calls.
    use super::is_enabled;

    #[test]
    fn is_enabled_is_stable_across_calls() {
        let first = is_enabled();
        let second = is_enabled();
        assert_eq!(first, second);
    }
}
