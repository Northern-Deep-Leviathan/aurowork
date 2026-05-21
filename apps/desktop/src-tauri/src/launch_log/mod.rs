//! Dev-mode-only unified launch log aggregator.
//!
//! When `dev_mode::is_enabled()` is true, all launch-phase code paths
//! append timestamped, tagged log lines to a per-launch file under
//! Tauri's `app_log_dir`. When disabled, every entry point is a no-op
//! (no file, no allocations).

pub mod format;

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use chrono::Local;

use crate::dev_mode;
use format::{format_header, format_line, Level};

pub const KEEP_LATEST_N: usize = 10;
const FILE_PREFIX: &str = "launch-";
const FILE_SUFFIX: &str = ".log";

static GLOBAL: OnceLock<LaunchLogAggregator> = OnceLock::new();

/// Returns the process-wide aggregator if one was installed via [`install_global`].
pub fn global() -> Option<LaunchLogAggregator> {
    GLOBAL.get().cloned()
}

/// Registers `aggregator` as the process-wide aggregator. Idempotent.
pub fn install_global(aggregator: LaunchLogAggregator) {
    let _ = GLOBAL.set(aggregator);
}

/// Tauri-managed state. Always present; when dev mode is off, the inner
/// `Option<Inner>` is `None` and all append calls are cheap no-ops.
#[derive(Clone, Default)]
pub struct LaunchLogAggregator {
    inner: Arc<Mutex<Option<Inner>>>,
}

struct Inner {
    writer: BufWriter<File>,
    path: PathBuf,
    started_at: std::time::Instant,
}

impl LaunchLogAggregator {
    /// Initialize the aggregator. Safe to call when dev mode is off — it
    /// becomes a no-op (no file created, no allocation).
    pub fn init(
        &self,
        log_dir: &Path,
        app_version: &str,
        auro_version: &str,
        platform: &str,
    ) {
        if !dev_mode::is_enabled() {
            return;
        }

        if let Err(err) = fs::create_dir_all(log_dir) {
            eprintln!(
                "[launch_log] failed to create log dir {}: {err}",
                log_dir.display()
            );
            return;
        }

        let _ = prune_old_logs(log_dir, KEEP_LATEST_N);

        let now = Local::now();
        let filename = format!(
            "{FILE_PREFIX}{}{FILE_SUFFIX}",
            now.format("%Y%m%d-%H%M%S")
        );
        let mut path = log_dir.join(&filename);
        // Same-second collision: append pid.
        if path.exists() {
            let pid = std::process::id();
            path = log_dir.join(format!(
                "{FILE_PREFIX}{}-{pid}{FILE_SUFFIX}",
                now.format("%Y%m%d-%H%M%S")
            ));
        }

        let file = match OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            Ok(f) => f,
            Err(err) => {
                eprintln!(
                    "[launch_log] failed to open log file {}: {err}",
                    path.display()
                );
                return;
            }
        };

        let mut writer = BufWriter::new(file);
        let header = format_header(
            now,
            app_version,
            auro_version,
            platform,
            &path.to_string_lossy(),
        );
        if let Err(err) = writer.write_all(header.as_bytes()) {
            eprintln!("[launch_log] failed to write header: {err}");
            return;
        }
        let _ = writer.flush();

        if let Ok(mut guard) = self.inner.lock() {
            *guard = Some(Inner {
                writer,
                path,
                started_at: std::time::Instant::now(),
            });
        }
    }

    /// Append a single log entry. No-op when dev mode is off or init failed.
    pub fn append(
        &self,
        level: Level,
        tag: &str,
        pid: Option<u32>,
        message: &str,
        stack: Option<&str>,
    ) {
        if !dev_mode::is_enabled() {
            return;
        }
        let Ok(mut guard) = self.inner.lock() else { return };
        let Some(inner) = guard.as_mut() else { return };
        let line = format_line(Local::now(), level, tag, pid, message, stack);
        if let Err(err) = inner.writer.write_all(line.as_bytes()) {
            eprintln!("[launch_log] write failed: {err}; disabling");
            *guard = None;
            return;
        }
        let _ = inner.writer.flush();
    }

    /// Returns the current log file path, or None when dev mode is off.
    pub fn path(&self) -> Option<PathBuf> {
        let guard = self.inner.lock().ok()?;
        guard.as_ref().map(|inner| inner.path.clone())
    }

    /// Elapsed ms since aggregator init; None when dev mode is off.
    pub fn elapsed_ms(&self) -> Option<u128> {
        let guard = self.inner.lock().ok()?;
        guard.as_ref().map(|inner| inner.started_at.elapsed().as_millis())
    }
}

/// Install a `std::panic::set_hook` that appends panics to the global
/// aggregator (when present) as an ERROR launch:shell entry with a
/// captured backtrace. Idempotent — only the first call wins.
pub fn install_panic_hook() {
    use std::backtrace::Backtrace;
    use std::sync::Once;

    static INSTALLED: Once = Once::new();
    INSTALLED.call_once(|| {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            // Always preserve the default stderr behaviour first.
            default_hook(info);

            let Some(agg) = global() else { return };
            let payload = info
                .payload()
                .downcast_ref::<&'static str>()
                .map(|s| (*s).to_string())
                .or_else(|| info.payload().downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "(non-string panic payload)".to_string());
            let location = info
                .location()
                .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                .unwrap_or_else(|| "<unknown>".to_string());
            let backtrace = Backtrace::force_capture().to_string();
            agg.append(
                Level::Error,
                "launch:shell",
                Some(std::process::id()),
                &format!("panic at {location}: {payload}"),
                Some(&backtrace),
            );
        }));
    });
}

/// Delete the oldest `launch-*.log` files in `dir`, keeping the newest
/// `keep` (by file mtime). Returns the number deleted (0 on error).
pub fn prune_old_logs(dir: &Path, keep: usize) -> usize {
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(_) => return 0,
    };

    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with(FILE_PREFIX) || !name.ends_with(FILE_SUFFIX) {
            continue;
        }
        let mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .unwrap_or(std::time::UNIX_EPOCH);
        entries.push((path, mtime));
    }

    if entries.len() <= keep {
        return 0;
    }

    // Sort oldest-first so we can drain the first (len - keep) entries.
    entries.sort_by_key(|(_, mtime)| *mtime);
    let to_remove = entries.len() - keep;
    let mut removed = 0;
    for (path, _) in entries.into_iter().take(to_remove) {
        if fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::{prune_old_logs, FILE_PREFIX, FILE_SUFFIX};
    use std::fs::{self, File};
    use std::path::PathBuf;
    use std::thread::sleep;
    use std::time::Duration;
    use uuid::Uuid;

    fn temp_dir() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("aurowork-launch-log-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn create_log(dir: &PathBuf, name: &str) {
        let path = dir.join(format!("{FILE_PREFIX}{name}{FILE_SUFFIX}"));
        File::create(path).unwrap();
        // Ensure mtimes differ
        sleep(Duration::from_millis(10));
    }

    #[test]
    fn prune_keeps_latest_n_files() {
        let dir = temp_dir();
        for i in 0..12 {
            create_log(&dir, &format!("20260521-10000{i:02}"));
        }

        let removed = prune_old_logs(&dir, 10);
        assert_eq!(removed, 2);

        let remaining: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with(FILE_PREFIX)
            })
            .collect();
        assert_eq!(remaining.len(), 10);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn prune_noop_when_at_or_below_keep_count() {
        let dir = temp_dir();
        for i in 0..5 {
            create_log(&dir, &format!("20260521-10000{i:02}"));
        }
        let removed = prune_old_logs(&dir, 10);
        assert_eq!(removed, 0);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn prune_ignores_non_matching_files() {
        let dir = temp_dir();
        File::create(dir.join("random.txt")).unwrap();
        File::create(dir.join("launch-bad.json")).unwrap();
        File::create(dir.join("not-launch-20260521.log")).unwrap();
        for i in 0..12 {
            create_log(&dir, &format!("20260521-10000{i:02}"));
        }
        let removed = prune_old_logs(&dir, 10);
        assert_eq!(removed, 2);
        // Non-matching survives.
        assert!(dir.join("random.txt").exists());
        assert!(dir.join("launch-bad.json").exists());
        assert!(dir.join("not-launch-20260521.log").exists());
        let _ = fs::remove_dir_all(dir);
    }
}
