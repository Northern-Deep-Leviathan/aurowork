//! Spawn-time heartbeat task. Emits periodic "pid=N alive at +Xs" entries
//! while we wait for a sidecar's first stdout/stderr line. Cancels on the
//! first child output (which means the binary is past cold-start).

use std::sync::Arc;

use tokio::sync::Notify;
use tokio::time::{sleep, Duration};

use crate::launch_log::format::Level;
use crate::launch_log::LaunchLogAggregator;

/// Returns a `Notify` handle. The caller invokes `notify_one()` on the
/// FIRST stdout/stderr event from the child to cancel further beats.
pub fn spawn_heartbeat(
    aggregator: LaunchLogAggregator,
    tag: &'static str,
    pid: u32,
    label: &'static str,
) -> Arc<Notify> {
    let cancel = Arc::new(Notify::new());
    let cancel_clone = cancel.clone();
    tauri::async_runtime::spawn(async move {
        // Cumulative wait points: 1s, 3s, 5s, 10s, 15s, 30s.
        for delay_ms in [1000u64, 2000, 2000, 5000, 5000, 15000] {
            tokio::select! {
                _ = cancel_clone.notified() => return,
                _ = sleep(Duration::from_millis(delay_ms)) => {}
            }
            aggregator.append(
                Level::Debug,
                tag,
                Some(pid),
                &format!("pid={pid} alive ({label}), awaiting first stdout"),
                None,
            );
        }
    });
    cancel
}
