//! Dev-mode-only unified launch log aggregator.
//!
//! When `dev_mode::is_enabled()` is true, all launch-phase code paths
//! append timestamped, tagged log lines to a per-launch file under
//! Tauri's `app_log_dir`. When disabled, every entry point is a no-op
//! (no file, no allocations).

pub mod format;
