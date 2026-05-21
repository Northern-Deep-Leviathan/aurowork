# AuroWork Launch-Phase Logging + Dev Mode Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dev-mode-only unified launch log (per-launch file under `app_log_dir`, keep latest 10) with 5 tag namespaces (`[launch:shell|orchestr|engine|server|ui]`) across Rust desktop shell, sidecar event readers, and SolidJS frontend; consolidate `AUROWORK_DEV_MODE` reads to a single helper; add Settings UI to open the log folder.

**Architecture:** A new Rust module `launch_log` exposes a process-global `LaunchLogAggregator` (`Mutex<BufWriter<File>>`) initialized at the very start of `lib::run()` when `dev_mode::is_enabled()` is true. All Rust spawn sites + sidecar stdout/stderr event loops append to it; the frontend appends via batched Tauri `invoke` (`launch_log_append_batch`). When dev mode is disabled, the aggregator is a no-op stub (no file, no allocations) and existing 8KB truncation behavior is preserved.

**Tech Stack:**
- Rust (Tauri 2.x, `std::sync::Mutex`, `BufWriter<File>`, `chrono` for ISO 8601 timestamps — newly added)
- SolidJS / TypeScript (Tauri `invoke`, throttled batch flush via `setTimeout`)
- Manual dogfood verification + a few `cargo test` unit tests for pure functions

**Spec reference:** `docs/superpowers/specs/2026-05-21-launch-logging-design.md`

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `apps/desktop/src-tauri/src/dev_mode.rs` | Single source of truth for `AUROWORK_DEV_MODE` (cached via `OnceLock`); export `is_enabled() -> bool`. |
| `apps/desktop/src-tauri/src/launch_log/mod.rs` | `LaunchLogAggregator` (init + Tauri-managed state), `init_for_app`, `append`, `summary`, `path`, prune-old-logs helper. |
| `apps/desktop/src-tauri/src/launch_log/format.rs` | Pure formatting: timestamp, level enum, line format, header builder, stack-rendering helper. |
| `apps/desktop/src-tauri/src/commands/launch_log.rs` | Tauri commands: `launch_log_append`, `launch_log_append_batch`, `launch_log_path`, `launch_log_summary`, `dev_mode_info`, `open_launch_log_folder`. |
| `apps/app/src/lib/launch-log.ts` | Frontend client: dev-mode gate cache + throttled batch flush. |

### Modified files

| Path | Why |
|---|---|
| `apps/desktop/src-tauri/Cargo.toml` | Add `chrono = { version = "0.4", features = ["clock"] }` dependency. |
| `apps/desktop/src-tauri/src/lib.rs` | Modules + commands registration; `setup()` initializes aggregator + emits `[launch:shell]` entries; replace `AUROWORK_DEV_MODE` env read in `set_dev_app_name` with `dev_mode::is_enabled()`. |
| `apps/desktop/src-tauri/src/orchestrator/mod.rs` | Replace direct `dev_mode` field comparison source w/ `dev_mode::is_enabled()` at callsite (still pass `dev_mode` through options); add `[launch:orchestr]` entry at spawn. |
| `apps/desktop/src-tauri/src/commands/engine.rs` | Emit `[launch:orchestr]` polling logs (start/poll-fail/success/timeout); dev-mode-only forward sidecar stdout/stderr to aggregator (in addition to existing 8KB truncation). |
| `apps/desktop/src-tauri/src/engine/spawn.rs` | Emit `[launch:engine]` entries (sandbox path, auth prepared, spawn args, pid). |
| `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` | Emit `[launch:server]` entries (port resolved, spawn args, pid). |
| `apps/desktop/src-tauri/src/aurowork_server/manager.rs` | Forward stdout/stderr to aggregator in dev mode at the sidecar event loop (consult current event-reader location; if reader lives in `commands/engine.rs`, modify there instead). |
| `apps/app/src/index.tsx` | Emit `[launch:ui]` entries during bootstrap. |
| `apps/app/src/app/entry.tsx` | Emit `[launch:ui]` entry on first render (`onMount`). |
| `apps/app/src/components/settings.tsx` | Add "Open launch log folder" button + show current launch log path. |

---

## Task Decomposition Overview

Tasks are ordered so each is small, testable, and committable independently.

1. **Add `chrono` dependency**
2. **Implement `dev_mode::is_enabled()` + tests**
3. **Implement `launch_log::format` pure functions + tests**
4. **Implement `LaunchLogAggregator` (no-op when disabled) + prune helper + tests**
5. **Wire aggregator init into `lib::run()` setup + `[launch:shell]` entries**
6. **Add Tauri commands `launch_log_*` + `dev_mode_info` + `open_launch_log_folder`**
7. **Migrate `set_dev_app_name` to `dev_mode::is_enabled()`**
8. **Emit `[launch:orchestr]` entries in spawn + health polling**
9. **Dev-mode forward orchestrator stdout/stderr to aggregator**
10. **Emit `[launch:engine]` entries in spawn**
11. **Dev-mode forward engine stdout/stderr to aggregator (if direct-spawn path)**
12. **Emit `[launch:server]` entries in spawn + forward stdout/stderr**
13. **Frontend `lib/launch-log.ts` client (batched, throttled)**
14. **Emit `[launch:ui]` entries in `index.tsx` + `entry.tsx`**
15. **Settings UI: "Open launch log folder" + path display**
16. **Manual dogfood verification + add result to `.claude/DEV_PROGRESS.md`**

---

### Task 1: Add `chrono` dependency

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml:19-42`

- [ ] **Step 1: Add chrono to `[dependencies]`**

Open `apps/desktop/src-tauri/Cargo.toml`. Below `serde_json = "1"` (line 24), add:

```toml
chrono = { version = "0.4", default-features = false, features = ["clock", "std"] }
```

- [ ] **Step 2: Build to fetch dependency**

Run from repo root:
```bash
cd apps/desktop/src-tauri && cargo check
```
Expected: builds successfully, downloads `chrono` and its transitive deps.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git commit -m "build(desktop): add chrono dependency for launch log timestamps"
```

---

### Task 2: Implement `dev_mode::is_enabled()` + tests

**Files:**
- Create: `apps/desktop/src-tauri/src/dev_mode.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs:1-14` (add `mod dev_mode;`)

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/src-tauri/src/dev_mode.rs` with content:

```rust
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
```

- [ ] **Step 2: Register the module**

In `apps/desktop/src-tauri/src/lib.rs`, after line 4 (`mod config;`), add:

```rust
mod dev_mode;
```

- [ ] **Step 3: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test --lib dev_mode
```
Expected: 1 test passes (`tests::is_enabled_is_stable_across_calls`).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/dev_mode.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add dev_mode::is_enabled() single source of truth"
```

---

### Task 3: Implement `launch_log::format` pure functions + tests

**Files:**
- Create: `apps/desktop/src-tauri/src/launch_log/format.rs`
- Create: `apps/desktop/src-tauri/src/launch_log/mod.rs` (skeleton — full impl in Task 4)

- [ ] **Step 1: Create directory + module skeleton**

Create `apps/desktop/src-tauri/src/launch_log/mod.rs` with:

```rust
//! Dev-mode-only unified launch log aggregator.
//!
//! When `dev_mode::is_enabled()` is true, all launch-phase code paths
//! append timestamped, tagged log lines to a per-launch file under
//! Tauri's `app_log_dir`. When disabled, every entry point is a no-op
//! (no file, no allocations).

pub mod format;
```

- [ ] **Step 2: Write failing tests for format module**

Create `apps/desktop/src-tauri/src/launch_log/format.rs` with content:

```rust
//! Pure formatting helpers for launch log lines. No I/O.

use chrono::{DateTime, Local};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Trace => "TRACE",
            Level::Debug => "DEBUG",
            Level::Info => "INFO ",
            Level::Warn => "WARN ",
            Level::Error => "ERROR",
        }
    }
}

/// Render a single log line.
///
/// Format: `<ISO 8601 local ts>  <LEVEL>  <tag (padded to 18)>  [pid=N  ]<message>`
/// If `stack` is `Some`, append a second-line indented stack block.
pub fn format_line(
    ts: DateTime<Local>,
    level: Level,
    tag: &str,
    pid: Option<u32>,
    message: &str,
    stack: Option<&str>,
) -> String {
    let ts_str = ts.format("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string();
    let tag_padded = format!("{:<18}", tag);
    let pid_part = match pid {
        Some(pid) => format!("pid={pid}  "),
        None => String::new(),
    };
    let mut out = format!(
        "{ts_str}  {level}  {tag_padded}  {pid_part}{message}\n",
        level = level.as_str()
    );
    if let Some(stack) = stack {
        for line in stack.lines() {
            out.push_str("    └─ ");
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Render the file header written once at aggregator init.
pub fn format_header(
    started_at: DateTime<Local>,
    app_version: &str,
    auro_version: &str,
    platform: &str,
    log_file: &str,
) -> String {
    let ts = started_at.format("%Y-%m-%dT%H:%M:%S%.3f%:z");
    format!(
        "=== AuroWork Launch Log ===\n\
         started_at:    {ts}\n\
         app_version:   {app_version}\n\
         auro_version:  {auro_version}\n\
         platform:      {platform}\n\
         dev_mode:      true\n\
         log_file:      {log_file}\n\
         ============================\n\n"
    )
}

#[cfg(test)]
mod tests {
    use super::{format_header, format_line, Level};
    use chrono::TimeZone;

    fn fixed_ts() -> chrono::DateTime<chrono::Local> {
        chrono::Local
            .with_ymd_and_hms(2026, 5, 21, 10, 23, 45)
            .unwrap()
    }

    #[test]
    fn format_line_with_pid_and_no_stack() {
        let line = format_line(
            fixed_ts(),
            Level::Info,
            "launch:engine",
            Some(12345),
            "spawning opencode serve",
            None,
        );
        assert!(line.contains("INFO "));
        assert!(line.contains("launch:engine"));
        assert!(line.contains("pid=12345"));
        assert!(line.contains("spawning opencode serve"));
        assert!(line.ends_with('\n'));
        assert!(!line.contains("└─"));
    }

    #[test]
    fn format_line_without_pid_omits_pid_field() {
        let line = format_line(
            fixed_ts(),
            Level::Debug,
            "launch:ui",
            None,
            "theme bootstrapping",
            None,
        );
        assert!(!line.contains("pid="));
    }

    #[test]
    fn format_line_with_stack_renders_indented_block() {
        let line = format_line(
            fixed_ts(),
            Level::Error,
            "launch:server",
            Some(1),
            "port allocation failed",
            Some("frame_a at a.rs:1\nframe_b at b.rs:2"),
        );
        assert!(line.contains("ERROR"));
        assert!(line.contains("└─ frame_a at a.rs:1"));
        assert!(line.contains("└─ frame_b at b.rs:2"));
    }

    #[test]
    fn level_strings_are_five_chars() {
        for l in [Level::Trace, Level::Debug, Level::Info, Level::Warn, Level::Error] {
            assert_eq!(l.as_str().len(), 5, "{:?}", l);
        }
    }

    #[test]
    fn header_contains_required_fields() {
        let header = format_header(
            fixed_ts(),
            "0.14.1",
            "v0.1.0",
            "macos-aarch64",
            "/tmp/launch.log",
        );
        assert!(header.contains("=== AuroWork Launch Log ==="));
        assert!(header.contains("app_version:   0.14.1"));
        assert!(header.contains("auro_version:  v0.1.0"));
        assert!(header.contains("platform:      macos-aarch64"));
        assert!(header.contains("dev_mode:      true"));
        assert!(header.contains("log_file:      /tmp/launch.log"));
        assert!(header.ends_with("\n\n"));
    }
}
```

- [ ] **Step 3: Register the module**

In `apps/desktop/src-tauri/src/lib.rs`, after `mod dev_mode;`, add:

```rust
mod launch_log;
```

- [ ] **Step 4: Run tests, expect them to pass**

```bash
cd apps/desktop/src-tauri && cargo test --lib launch_log::format
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/launch_log/ apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): add launch_log::format pure formatting helpers"
```

---

### Task 4: Implement `LaunchLogAggregator` + prune helper + tests

**Files:**
- Modify: `apps/desktop/src-tauri/src/launch_log/mod.rs`

- [ ] **Step 1: Write failing tests for prune helper**

In `apps/desktop/src-tauri/src/launch_log/mod.rs`, replace the placeholder content with:

```rust
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
use std::sync::Mutex;

use chrono::Local;

use crate::dev_mode;
use format::{format_header, format_line, Level};

pub const KEEP_LATEST_N: usize = 10;
const FILE_PREFIX: &str = "launch-";
const FILE_SUFFIX: &str = ".log";

/// Tauri-managed state. Always present; when dev mode is off, the inner
/// `Option<Inner>` is `None` and all append calls are cheap no-ops.
pub struct LaunchLogAggregator {
    inner: Mutex<Option<Inner>>,
}

struct Inner {
    writer: BufWriter<File>,
    path: PathBuf,
    started_at: std::time::Instant,
}

impl Default for LaunchLogAggregator {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
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
```

- [ ] **Step 2: Run tests**

```bash
cd apps/desktop/src-tauri && cargo test --lib launch_log
```
Expected: 8 tests pass (5 format + 3 prune).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/launch_log/mod.rs
git commit -m "feat(desktop): add LaunchLogAggregator with dev-mode gate and prune helper"
```

---

### Task 5: Wire aggregator into `lib::run()` setup + emit `[launch:shell]` entries

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs:117-150`

- [ ] **Step 1: Add imports**

In `apps/desktop/src-tauri/src/lib.rs`, after line 50 (`use workspace::watch::WorkspaceWatchState;`), add:

```rust
use launch_log::format::Level;
use launch_log::LaunchLogAggregator;
use tauri::Manager as _;
```

(Note: `tauri::Manager` may already be in scope — keep one import only.)

- [ ] **Step 2: Initialize aggregator in `setup`**

Replace the `setup` block in `lib.rs` (currently lines 146-150):

```rust
        .setup(|_| {
            set_dev_app_name();
            Ok(())
        })
```

with:

```rust
        .setup(|app| {
            set_dev_app_name();

            let aggregator = LaunchLogAggregator::default();
            if let Ok(log_dir) = app.path().app_log_dir() {
                let app_version = env!("CARGO_PKG_VERSION");
                let auro_version = option_env!("AUROWORK_AURO_VERSION").unwrap_or("unknown");
                let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
                aggregator.init(&log_dir, app_version, auro_version, &platform);
            }
            aggregator.append(
                Level::Info,
                "launch:shell",
                Some(std::process::id()),
                &format!(
                    "aurowork desktop starting, version={}, dev_mode={}",
                    env!("CARGO_PKG_VERSION"),
                    dev_mode::is_enabled()
                ),
                None,
            );
            app.manage(aggregator);
            Ok(())
        })
```

- [ ] **Step 3: Emit shutdown entry**

In `stop_managed_services` (line 117-127), at the top of the function, add:

```rust
    if let Some(agg) = app_handle.try_state::<LaunchLogAggregator>() {
        agg.append(
            Level::Info,
            "launch:shell",
            Some(std::process::id()),
            "shutdown requested, stopping managed services",
            None,
        );
    }
```

- [ ] **Step 4: Build and verify**

```bash
cd apps/desktop/src-tauri && cargo build
```
Expected: builds successfully, no warnings about unused imports.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): initialize LaunchLogAggregator in setup and emit shell entries"
```

---

### Task 6: Add Tauri commands `launch_log_*` + `dev_mode_info` + `open_launch_log_folder`

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/launch_log.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs` (add `pub mod launch_log;`)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Create the commands module**

Create `apps/desktop/src-tauri/src/commands/launch_log.rs`:

```rust
//! Tauri commands exposing the launch log to the frontend.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::dev_mode;
use crate::launch_log::format::Level;
use crate::launch_log::LaunchLogAggregator;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchLogEntry {
    pub tag: String,
    pub level: String, // "trace" | "debug" | "info" | "warn" | "error"
    pub message: String,
    pub stack: Option<String>,
}

fn parse_level(value: &str) -> Level {
    match value.to_ascii_lowercase().as_str() {
        "trace" => Level::Trace,
        "debug" => Level::Debug,
        "warn" | "warning" => Level::Warn,
        "error" => Level::Error,
        _ => Level::Info,
    }
}

#[tauri::command]
pub fn launch_log_append(
    aggregator: State<'_, LaunchLogAggregator>,
    entry: LaunchLogEntry,
) -> Result<(), String> {
    aggregator.append(
        parse_level(&entry.level),
        &entry.tag,
        None,
        &entry.message,
        entry.stack.as_deref(),
    );
    Ok(())
}

#[tauri::command]
pub fn launch_log_append_batch(
    aggregator: State<'_, LaunchLogAggregator>,
    entries: Vec<LaunchLogEntry>,
) -> Result<(), String> {
    for entry in entries {
        aggregator.append(
            parse_level(&entry.level),
            &entry.tag,
            None,
            &entry.message,
            entry.stack.as_deref(),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn launch_log_path(aggregator: State<'_, LaunchLogAggregator>) -> Option<String> {
    aggregator.path().map(|p| p.to_string_lossy().to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchSummary {
    pub shell_ms: Option<u128>,
    pub orchestr_ms: Option<u128>,
    pub engine_ms: Option<u128>,
    pub server_ms: Option<u128>,
    pub ui_ms: Option<u128>,
}

#[tauri::command]
pub fn launch_log_summary(
    aggregator: State<'_, LaunchLogAggregator>,
    summary: LaunchSummary,
) -> Result<(), String> {
    let total_ms = aggregator.elapsed_ms().unwrap_or(0);
    let msg = format!(
        "=== launch summary === shell={s:?}ms orchestr={o:?}ms engine={e:?}ms server={sv:?}ms ui={u:?}ms total={total_ms}ms",
        s = summary.shell_ms,
        o = summary.orchestr_ms,
        e = summary.engine_ms,
        sv = summary.server_ms,
        u = summary.ui_ms,
    );
    aggregator.append(Level::Info, "launch:shell", Some(std::process::id()), &msg, None);
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevModeInfo {
    pub enabled: bool,
    pub log_file_path: Option<String>,
}

#[tauri::command]
pub fn dev_mode_info(aggregator: State<'_, LaunchLogAggregator>) -> DevModeInfo {
    DevModeInfo {
        enabled: dev_mode::is_enabled(),
        log_file_path: aggregator.path().map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn open_launch_log_folder(app: AppHandle) -> Result<(), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log dir: {e}"))?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(log_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Failed to open log folder: {e}"))
}
```

- [ ] **Step 2: Register the module**

In `apps/desktop/src-tauri/src/commands/mod.rs`, add to the module list:

```rust
pub mod launch_log;
```

(Read the existing `mod.rs` first if you're unsure where to put it — keep alphabetical order with the other `pub mod` lines if that's the existing pattern.)

- [ ] **Step 3: Register commands in invoke handler**

In `apps/desktop/src-tauri/src/lib.rs`, after line 22 (`use commands::debug_log::{...};`), add:

```rust
use commands::launch_log::{
    dev_mode_info, launch_log_append, launch_log_append_batch, launch_log_path,
    launch_log_summary, open_launch_log_folder,
};
```

Then in the `invoke_handler` macro (lines 156-210), append before the closing `]` (after `fs_close_file`):

```rust
            ,
            launch_log_append,
            launch_log_append_batch,
            launch_log_path,
            launch_log_summary,
            dev_mode_info,
            open_launch_log_folder
```

(Note: the existing list does not have a trailing comma on `fs_close_file`; insert a comma after it before the new entries.)

- [ ] **Step 4: Build and verify**

```bash
cd apps/desktop/src-tauri && cargo build
```
Expected: builds successfully.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/launch_log.rs apps/desktop/src-tauri/src/commands/mod.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): expose launch_log Tauri commands and dev_mode_info"
```

---

### Task 7: Migrate `set_dev_app_name` to `dev_mode::is_enabled()`

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs:54-66`

- [ ] **Step 1: Replace env var read**

Locate the `set_dev_app_name` function (lines 54-66 of `lib.rs`). Replace:

```rust
    if std::env::var("AUROWORK_DEV_MODE").ok().as_deref() != Some("1") {
        return;
    }
```

with:

```rust
    if !crate::dev_mode::is_enabled() {
        return;
    }
```

- [ ] **Step 2: Build**

```bash
cd apps/desktop/src-tauri && cargo build
```
Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs
git commit -m "refactor(desktop): use dev_mode::is_enabled() in set_dev_app_name"
```

---

### Task 8: Emit `[launch:orchestr]` entries in spawn + health polling

**Files:**
- Modify: `apps/desktop/src-tauri/src/orchestrator/mod.rs:213-295` (spawn)
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs:399-497` (orchestrator path + health polling)

- [ ] **Step 1: Add log entry in `spawn_orchestrator_daemon`**

In `apps/desktop/src-tauri/src/orchestrator/mod.rs`, modify the end of `spawn_orchestrator_daemon` (around line 292-295). Replace:

```rust
    command
        .spawn()
        .map_err(|e| format!("Failed to start orchestrator: {e}"))
}
```

with:

```rust
    if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
        agg.append(
            crate::launch_log::format::Level::Info,
            "launch:orchestr",
            None,
            &format!(
                "spawning orchestrator daemon, port={}, data_dir={}",
                options.daemon_port, options.data_dir
            ),
            None,
        );
    }

    let result = command
        .spawn()
        .map_err(|e| format!("Failed to start orchestrator: {e}"))?;

    if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
        agg.append(
            crate::launch_log::format::Level::Info,
            "launch:orchestr",
            Some(result.1.pid()),
            "orchestrator spawned",
            None,
        );
    }

    Ok(result)
}
```

- [ ] **Step 2: Add polling start/success/failure logs**

In `apps/desktop/src-tauri/src/commands/engine.rs`, locate the `let health = orchestrator::wait_for_orchestrator(...)` call (around line 494-497). Wrap it as:

```rust
        if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
            agg.append(
                crate::launch_log::format::Level::Debug,
                "launch:orchestr",
                None,
                &format!(
                    "polling {daemon_base_url}/health, timeout={}ms",
                    health_timeout_ms
                ),
                None,
            );
        }
        let poll_start = std::time::Instant::now();

        let health = orchestrator::wait_for_orchestrator(&daemon_base_url, health_timeout_ms)
            .map_err(|e| {
                if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
                    agg.append(
                        crate::launch_log::format::Level::Error,
                        "launch:orchestr",
                        None,
                        &format!("health timeout after {health_timeout_ms}ms: {e}"),
                        None,
                    );
                }
                format!("Failed to start orchestrator (waited {health_timeout_ms}ms): {e}")
            })?;

        if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
            let elapsed = poll_start.elapsed().as_millis();
            agg.append(
                crate::launch_log::format::Level::Info,
                "launch:orchestr",
                None,
                &format!("orchestrator ready in {elapsed}ms"),
                None,
            );
        }
```

- [ ] **Step 3: Build**

```bash
cd apps/desktop/src-tauri && cargo build
```
Expected: builds successfully. (`CommandChild::pid()` returns `u32`, matching `Option<u32>`.)

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/orchestrator/mod.rs apps/desktop/src-tauri/src/commands/engine.rs
git commit -m "feat(desktop): emit [launch:orchestr] entries for spawn and health polling"
```

---

### Task 9: Dev-mode forward orchestrator stdout/stderr to aggregator

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs:443-478` (event reader)

- [ ] **Step 1: Capture aggregator handle before spawning reader**

In `apps/desktop/src-tauri/src/commands/engine.rs`, just before the `tauri::async_runtime::spawn(async move { ... })` block (around line 442), capture the aggregator handle:

```rust
        let agg_for_reader = app.try_state::<crate::launch_log::LaunchLogAggregator>()
            .map(|s| s.inner().clone());
```

Wait — `LaunchLogAggregator` is not `Clone`. Use an `Arc` instead. Since the existing pattern manages it via `.manage(...)` and Tauri stores it in an `Arc<dyn Any>`, the cleanest approach is to retrieve a fresh `State` inside the spawned task via `app_handle` clone. Replace the section starting `let orchestrator_state_handle = orchestrator_manager.inner.clone();` (line 442) through the end of the spawn block (line 478) with:

```rust
        let orchestrator_state_handle = orchestrator_manager.inner.clone();
        let app_handle_for_reader = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes).to_string();
                        if let Some(agg) =
                            app_handle_for_reader.try_state::<crate::launch_log::LaunchLogAggregator>()
                        {
                            agg.append(
                                crate::launch_log::format::Level::Debug,
                                "launch:orchestr",
                                None,
                                line.trim_end_matches('\n'),
                                None,
                            );
                        }
                        if let Ok(mut state) = orchestrator_state_handle.try_lock() {
                            let next = state.last_stdout.as_deref().unwrap_or_default().to_string()
                                + &line;
                            state.last_stdout = Some(truncate_output(&next, 8000));
                        }
                    }
                    CommandEvent::Stderr(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes).to_string();
                        if let Some(agg) =
                            app_handle_for_reader.try_state::<crate::launch_log::LaunchLogAggregator>()
                        {
                            agg.append(
                                crate::launch_log::format::Level::Warn,
                                "launch:orchestr",
                                None,
                                line.trim_end_matches('\n'),
                                None,
                            );
                        }
                        if let Ok(mut state) = orchestrator_state_handle.try_lock() {
                            let next = state.last_stderr.as_deref().unwrap_or_default().to_string()
                                + &line;
                            state.last_stderr = Some(truncate_output(&next, 8000));
                        }
                    }
                    CommandEvent::Terminated(_) => {
                        if let Ok(mut state) = orchestrator_state_handle.try_lock() {
                            state.child_exited = true;
                        }
                    }
                    CommandEvent::Error(message) => {
                        if let Some(agg) =
                            app_handle_for_reader.try_state::<crate::launch_log::LaunchLogAggregator>()
                        {
                            agg.append(
                                crate::launch_log::format::Level::Error,
                                "launch:orchestr",
                                None,
                                &format!("error: {message}"),
                                None,
                            );
                        }
                        if let Ok(mut state) = orchestrator_state_handle.try_lock() {
                            state.child_exited = true;
                            let next = state.last_stderr.as_deref().unwrap_or_default().to_string()
                                + &message;
                            state.last_stderr = Some(truncate_output(&next, 8000));
                        }
                    }
                    _ => {}
                }
            }
        });
```

The `LaunchLogAggregator::append` is already a no-op when dev mode is off, so the existing 8KB truncation continues to work unchanged in release builds.

- [ ] **Step 2: Build**

```bash
cd apps/desktop/src-tauri && cargo build
```
Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/engine.rs
git commit -m "feat(desktop): forward orchestrator stdio to launch log in dev mode"
```

---

### Task 10: Emit `[launch:engine]` entries in spawn

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/spawn.rs:74-167`

- [ ] **Step 1: Emit sandbox + auth + spawn entries**

In `apps/desktop/src-tauri/src/engine/spawn.rs`, locate the `spawn_engine` function. Just after the `let args = build_engine_args(...)` line (line 86), add:

```rust
    if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
        agg.append(
            crate::launch_log::format::Level::Info,
            "launch:engine",
            None,
            &format!(
                "spawning engine on {}:{} (use_sidecar={}, dev_mode={})",
                hostname, port, use_sidecar, dev_mode
            ),
            None,
        );
    }
```

In the `if dev_mode { ... }` block (line 98-107), after the `command = command.env("OPENCODE_CONFIG_DIR", dev_paths.auro_config_dir);` line, add:

```rust
        if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
            agg.append(
                crate::launch_log::format::Level::Debug,
                "launch:engine",
                None,
                &format!(
                    "dev sandbox: XDG_DATA_HOME={}, XDG_CACHE_HOME={}",
                    dev_paths.xdg_data_home.display(),
                    dev_paths.xdg_cache_home.display()
                ),
                None,
            );
        }
```

(Note: `dev_paths.xdg_data_home` was moved into `command.env(...)` above. Re-bind by keeping a `let xdg_data_home_str = dev_paths.xdg_data_home.display().to_string();` *before* the `command = command.env("XDG_DATA_HOME", dev_paths.xdg_data_home);` line, and similarly for `xdg_cache_home`. Then use those strings in both the env call and the log message. Concretely, replace lines 103-107 with:

```rust
        let xdg_data_home_log = dev_paths.xdg_data_home.display().to_string();
        let xdg_cache_home_log = dev_paths.xdg_cache_home.display().to_string();
        command = command.env("XDG_CONFIG_HOME", dev_paths.xdg_config_home);
        command = command.env("XDG_DATA_HOME", dev_paths.xdg_data_home);
        command = command.env("XDG_CACHE_HOME", dev_paths.xdg_cache_home);
        command = command.env("XDG_STATE_HOME", dev_paths.xdg_state_home);
        command = command.env("OPENCODE_CONFIG_DIR", dev_paths.auro_config_dir);
        if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
            agg.append(
                crate::launch_log::format::Level::Debug,
                "launch:engine",
                None,
                &format!(
                    "dev sandbox: XDG_DATA_HOME={xdg_data_home_log}, XDG_CACHE_HOME={xdg_cache_home_log}"
                ),
                None,
            );
        }
```
)

Right after the `command = command.env("OPENCODE_SERVER_PASSWORD", password);` block (around line 161), add an auth-prepared log:

```rust
    if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
        let user_len = auro_username.map(|s| s.len()).unwrap_or(0);
        let pass_len = auro_password.map(|s| s.len()).unwrap_or(0);
        agg.append(
            crate::launch_log::format::Level::Debug,
            "launch:engine",
            None,
            &format!("auth credentials prepared (username_len={user_len}, password_len={pass_len})"),
            None,
        );
    }
```

Finally, replace the final `command.spawn()...` (lines 164-166) with:

```rust
    let result = command
        .spawn()
        .map_err(|e| format!("Failed to start opencode: {e}"))?;

    if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
        agg.append(
            crate::launch_log::format::Level::Info,
            "launch:engine",
            Some(result.1.pid()),
            "engine spawned",
            None,
        );
    }

    Ok(result)
```

- [ ] **Step 2: Build**

```bash
cd apps/desktop/src-tauri && cargo build
```
Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/engine/spawn.rs
git commit -m "feat(desktop): emit [launch:engine] entries for sandbox, auth, spawn"
```

---

### Task 11: Dev-mode forward engine stdout/stderr to aggregator (direct-spawn path)

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs` (around line 549+ — the direct-spawn engine path that calls `spawn_engine` directly, outside the orchestrator branch)

- [ ] **Step 1: Locate the direct-spawn reader**

The direct-spawn path starts after the `return Ok(EngineInfo { ... });` block of the orchestrator branch (around line 547). Read lines 548-680 of `commands/engine.rs` to find the `tauri::async_runtime::spawn(async move { while let Some(event) = rx.recv().await { ... } })` block for the engine's `rx`. Apply the same pattern as Task 9: inside the `CommandEvent::Stdout`, `Stderr`, and `Error` arms, call the aggregator with the `launch:engine` tag at `Debug`, `Warn`, and `Error` levels respectively, in addition to the existing 8KB truncation logic.

Concretely, before the `tauri::async_runtime::spawn(async move { ... })` block in the direct-spawn path, clone the app handle:

```rust
    let app_handle_for_engine_reader = app.clone();
```

Then, inside the reader (mirroring the engine state mutex pattern that's already there), add at the top of each match arm:

```rust
                    CommandEvent::Stdout(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes).to_string();
                        if let Some(agg) =
                            app_handle_for_engine_reader.try_state::<crate::launch_log::LaunchLogAggregator>()
                        {
                            agg.append(
                                crate::launch_log::format::Level::Debug,
                                "launch:engine",
                                None,
                                line.trim_end_matches('\n'),
                                None,
                            );
                        }
                        // ... existing 8KB truncation ...
                    }
                    CommandEvent::Stderr(line_bytes) => {
                        let line = String::from_utf8_lossy(&line_bytes).to_string();
                        if let Some(agg) =
                            app_handle_for_engine_reader.try_state::<crate::launch_log::LaunchLogAggregator>()
                        {
                            agg.append(
                                crate::launch_log::format::Level::Warn,
                                "launch:engine",
                                None,
                                line.trim_end_matches('\n'),
                                None,
                            );
                        }
                        // ... existing 8KB truncation ...
                    }
```

Keep the existing truncation logic as-is below each `agg.append` call.

- [ ] **Step 2: Build**

```bash
cd apps/desktop/src-tauri && cargo build
```
Expected: builds successfully.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/engine.rs
git commit -m "feat(desktop): forward engine stdio to launch log in dev mode"
```

---

### Task 12: Emit `[launch:server]` entries in aurowork-server spawn + forward stdio

**Files:**
- Modify: `apps/desktop/src-tauri/src/aurowork_server/spawn.rs:121-173`
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs` (the `start_aurowork_server` helper or its reader — read the file to locate; it likely lives in `commands/engine.rs` or `aurowork_server/manager.rs`)

- [ ] **Step 1: Emit port + spawn entries in `spawn_aurowork_server`**

In `apps/desktop/src-tauri/src/aurowork_server/spawn.rs`, just before the `let command = match app.shell().sidecar("aurowork-server") { ... }` line (line 134), add:

```rust
    if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
        let ws_str = workspace_paths.join(", ");
        agg.append(
            crate::launch_log::format::Level::Info,
            "launch:server",
            None,
            &format!(
                "spawning aurowork-server on {host}:{port}, workspaces=[{ws_str}], token_len={}, host_token_len={}",
                token.len(),
                host_token.len()
            ),
            None,
        );
    }
```

Replace the final `command.spawn()...` (lines 170-173) with:

```rust
    let result = command
        .spawn()
        .map_err(|e| format!("Failed to start AuroWork server: {e}"))?;

    if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
        agg.append(
            crate::launch_log::format::Level::Info,
            "launch:server",
            Some(result.1.pid()),
            "aurowork-server spawned",
            None,
        );
    }

    Ok(result)
```

- [ ] **Step 2: Forward stdio in the server's event reader**

Find where the server's `CommandEvent` reader is created. Search:

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && grep -n "AuroworkServerManager\|aurowork_server.*rx\|spawn_aurowork_server" apps/desktop/src-tauri/src/commands/engine.rs apps/desktop/src-tauri/src/aurowork_server/manager.rs
```

Apply the same forwarding pattern as Task 9/11 with tag `"launch:server"`, levels `Debug` (stdout) / `Warn` (stderr) / `Error` (Error event). Preserve the existing 8KB truncation.

- [ ] **Step 3: Build**

```bash
cd apps/desktop/src-tauri && cargo build
```
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/aurowork_server/spawn.rs apps/desktop/src-tauri/src/commands/engine.rs
git commit -m "feat(desktop): emit [launch:server] entries and forward stdio in dev mode"
```

---

### Task 13: Frontend `lib/launch-log.ts` client (batched, throttled)

**Files:**
- Create: `apps/app/src/lib/launch-log.ts`

- [ ] **Step 1: Create the client**

Create `apps/app/src/lib/launch-log.ts`:

```typescript
/**
 * Frontend client for the dev-mode-only launch log aggregator.
 *
 * Buffers entries and flushes in batches via Tauri `invoke`. When dev mode
 * is disabled (resolved on first call) every entry is dropped without an
 * IPC roundtrip.
 */

import { isTauriRuntime } from "../app/utils";

type LaunchLogLevel = "trace" | "debug" | "info" | "warn" | "error";

interface LaunchLogEntry {
  tag: string;
  level: LaunchLogLevel;
  message: string;
  stack?: string;
}

interface DevModeInfo {
  enabled: boolean;
  logFilePath: string | null;
}

const FLUSH_INTERVAL_MS = 100;

let devModeCached: boolean | null = null;
let logFilePathCached: string | null = null;
let buffer: LaunchLogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initPromise: Promise<DevModeInfo> | null = null;

async function loadDevModeInfo(): Promise<DevModeInfo> {
  if (!isTauriRuntime()) {
    return { enabled: false, logFilePath: null };
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = (await invoke("dev_mode_info")) as DevModeInfo;
    return info;
  } catch {
    return { enabled: false, logFilePath: null };
  }
}

export async function initLaunchLog(): Promise<DevModeInfo> {
  if (initPromise) return initPromise;
  initPromise = loadDevModeInfo().then((info) => {
    devModeCached = info.enabled;
    logFilePathCached = info.logFilePath;
    return info;
  });
  return initPromise;
}

export function getLaunchLogPath(): string | null {
  return logFilePathCached;
}

export function isLaunchLogEnabled(): boolean {
  return devModeCached === true;
}

async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;
  if (!devModeCached) {
    buffer = [];
    return;
  }
  const entries = buffer;
  buffer = [];
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("launch_log_append_batch", { entries });
  } catch {
    // best-effort; drop on failure
  }
}

export function launchLog(
  level: LaunchLogLevel,
  tag: string,
  message: string,
  stack?: string,
): void {
  // If we haven't resolved dev mode yet, buffer and let the first flush
  // either send or drop everything.
  if (devModeCached === false) {
    return;
  }
  buffer.push({ tag, level, message, stack });
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      void flush();
    }, FLUSH_INTERVAL_MS);
  }
}

/** Force flush — call after first paint to ensure early entries land. */
export async function flushLaunchLog(): Promise<void> {
  await flush();
}
```

- [ ] **Step 2: Manual sanity test**

There's no test runner that easily covers this; verify by `pnpm typecheck`:

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm typecheck
```
Expected: passes with no errors related to the new file.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/launch-log.ts
git commit -m "feat(app): add launch-log frontend client with batched flush"
```

---

### Task 14: Emit `[launch:ui]` entries in `index.tsx` + `entry.tsx`

**Files:**
- Modify: `apps/app/src/index.tsx:1-15, 71-73, 146-156`
- Modify: `apps/app/src/app/entry.tsx`

- [ ] **Step 1: Add imports and bootstrap timing in `index.tsx`**

In `apps/app/src/index.tsx`, after line 12 (`import { initLocale } from "./i18n";`), add:

```typescript
import {
  flushLaunchLog,
  initLaunchLog,
  launchLog,
} from "./lib/launch-log";
```

Replace lines 14-15:

```typescript
bootstrapTheme();
initLocale();
```

with:

```typescript
const bootStart = performance.now();
void initLaunchLog().then(() => {
  launchLog(
    "info",
    "launch:ui",
    `ui bootstrap starting (platform=${isTauriRuntime() ? "desktop" : "web"})`,
  );
});

const themeStart = performance.now();
bootstrapTheme();
launchLog(
  "debug",
  "launch:ui",
  `theme ready in ${Math.round(performance.now() - themeStart)}ms`,
);

const i18nStart = performance.now();
initLocale();
launchLog(
  "debug",
  "launch:ui",
  `i18n ready in ${Math.round(performance.now() - i18nStart)}ms`,
);
```

After the `startDeepLinkBridge();` call (line 73), add:

```typescript
launchLog("debug", "launch:ui", "deep-link bridge installed");
```

After the final `render(...)` call (after line 156), add:

```typescript
launchLog(
  "info",
  "launch:ui",
  `ui first paint in ${Math.round(performance.now() - bootStart)}ms`,
);
void flushLaunchLog();

window.addEventListener("error", (ev) => {
  launchLog(
    "error",
    "launch:ui",
    ev.message ?? "uncaught error",
    ev.error?.stack ?? undefined,
  );
  void flushLaunchLog();
});
window.addEventListener("unhandledrejection", (ev) => {
  const reason: unknown = ev.reason;
  const message =
    reason instanceof Error ? reason.message : String(reason ?? "unhandled rejection");
  const stack = reason instanceof Error ? reason.stack : undefined;
  launchLog("error", "launch:ui", message, stack);
  void flushLaunchLog();
});
```

- [ ] **Step 2: Emit provider-ready entry in `entry.tsx`**

Read `apps/app/src/app/entry.tsx` to find the `onMount` or render-completion point. Add an import:

```typescript
import { launchLog } from "../lib/launch-log";
```

In the existing `onMount` (or add one if missing — SolidJS pattern: `import { onMount } from "solid-js"`), emit:

```typescript
onMount(() => {
  launchLog("debug", "launch:ui", "AppEntry mounted (providers initialized)");
});
```

- [ ] **Step 3: Typecheck**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm typecheck
```
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/index.tsx apps/app/src/app/entry.tsx
git commit -m "feat(app): emit [launch:ui] entries during bootstrap"
```

---

### Task 15: Settings UI — "Open launch log folder" + path display

**Files:**
- Modify: `apps/app/src/components/settings.tsx`

- [ ] **Step 1: Locate the Developer Mode section**

Search for the existing developer mode section:

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && grep -n "developer.*mode\|developerMode\|Developer Mode" apps/app/src/components/settings.tsx
```

Confirm the panel exists around lines 2023-2117 (per the spec exploration). Add the new UI element inside that panel, gated on `props.developerMode === true`.

- [ ] **Step 2: Import client + add signals**

Near the top imports of `settings.tsx`, add:

```typescript
import {
  getLaunchLogPath,
  initLaunchLog,
  isLaunchLogEnabled,
} from "../lib/launch-log";
import { createSignal, onMount } from "solid-js";
```

(Adjust path if `settings.tsx` is at a different depth — verify with the existing imports in the file.)

Inside the component body, near the top, add:

```typescript
const [launchLogPath, setLaunchLogPath] = createSignal<string | null>(null);
const [launchLogEnabled, setLaunchLogEnabled] = createSignal(false);

onMount(() => {
  void initLaunchLog().then((info) => {
    setLaunchLogEnabled(info.enabled);
    setLaunchLogPath(info.logFilePath);
  });
});
```

(If the file already uses `onMount` etc., reuse those existing utilities; don't double-import.)

- [ ] **Step 3: Add the UI inside the developer mode panel**

Inside the developer-mode-only panel (between the existing toggle and the deeplink tester), add:

```tsx
<Show when={launchLogEnabled() && props.developerMode}>
  <div class="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-700">
    <div class="text-sm font-medium">Launch log (dev mode)</div>
    <div class="font-mono text-xs text-zinc-600 dark:text-zinc-400 break-all">
      {launchLogPath() ?? "(not initialized)"}
    </div>
    <div class="flex gap-2">
      <button
        type="button"
        class="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
        onClick={() => {
          const path = launchLogPath();
          if (path) {
            void navigator.clipboard.writeText(path).catch(() => undefined);
          }
        }}
      >
        Copy path
      </button>
      <button
        type="button"
        class="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
        onClick={() => {
          void import("@tauri-apps/api/core").then(({ invoke }) =>
            invoke("open_launch_log_folder"),
          );
        }}
      >
        Open log folder
      </button>
    </div>
  </div>
</Show>
```

(Use the existing styling utility classes if the file uses Tailwind variants different from above — match the surrounding panel's class style. Ensure `Show` is imported from `solid-js`.)

- [ ] **Step 4: Typecheck**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm typecheck
```
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/components/settings.tsx
git commit -m "feat(app): add Open launch log folder action + path display in Settings"
```

---

### Task 16: Manual dogfood verification + DEV_PROGRESS update

**Files:**
- Modify: `.claude/DEV_PROGRESS.md`

- [ ] **Step 1: Start the dev app**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm dev
```
Wait for the UI to appear.

- [ ] **Step 2: Verify the log file**

```bash
ls -lt ~/Library/Logs/com.nld.aurowork.dev/
```
Expected: a `launch-YYYYMMDD-HHMMSS.log` file exists.

```bash
head -50 ~/Library/Logs/com.nld.aurowork.dev/launch-*.log | tail -50
```
Expected output shape:

```
=== AuroWork Launch Log ===
started_at:    2026-05-21T...
app_version:   0.14.1
auro_version:  ...
platform:      macos-aarch64
dev_mode:      true
log_file:      /Users/.../launch-*.log
============================

2026-05-21T...  INFO  [launch:shell]      pid=...  aurowork desktop starting, version=0.14.1, dev_mode=true
2026-05-21T...  INFO  [launch:orchestr]   ...  spawning orchestrator daemon, ...
2026-05-21T...  INFO  [launch:orchestr]   pid=...  orchestrator spawned
2026-05-21T...  DEBUG [launch:orchestr]   ...  polling http://127.0.0.1:.../health, timeout=180000ms
2026-05-21T...  INFO  [launch:orchestr]   ...  orchestrator ready in ...ms
2026-05-21T...  INFO  [launch:engine]     ...  spawning engine on 127.0.0.1:...
2026-05-21T...  DEBUG [launch:engine]     ...  dev sandbox: XDG_DATA_HOME=..., XDG_CACHE_HOME=...
2026-05-21T...  INFO  [launch:engine]     pid=...  engine spawned
2026-05-21T...  INFO  [launch:server]     ...  spawning aurowork-server on 127.0.0.1:...
2026-05-21T...  INFO  [launch:server]     pid=...  aurowork-server spawned
2026-05-21T...  INFO  [launch:ui]         ui bootstrap starting (platform=desktop)
2026-05-21T...  DEBUG [launch:ui]         theme ready in ...ms
2026-05-21T...  DEBUG [launch:ui]         i18n ready in ...ms
2026-05-21T...  DEBUG [launch:ui]         deep-link bridge installed
2026-05-21T...  INFO  [launch:ui]         ui first paint in ...ms
```

If any tag is missing, go back to the corresponding task and verify the wiring.

- [ ] **Step 3: Verify the Settings UI**

In the running app: navigate to Settings → Developer Mode. Confirm:
- "Launch log (dev mode)" panel appears.
- The log path is shown and matches the actual file.
- "Open log folder" opens Finder at the correct directory.
- "Copy path" copies to clipboard.

- [ ] **Step 4: Verify prune behavior**

Quit the dev app, then run it 10 more times in succession (or manually create 12 fake log files and re-launch once):

```bash
for i in $(seq 1 12); do touch -t 20260501010${i}.00 ~/Library/Logs/com.nld.aurowork.dev/launch-20260501-01010${i}.log; done
```

Then start the dev app once. After startup:

```bash
ls ~/Library/Logs/com.nld.aurowork.dev/ | wc -l
```

Expected: exactly 10 files (the oldest were pruned; the new launch added one).

- [ ] **Step 5: Verify release-mode no-op**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && unset AUROWORK_DEV_MODE && AUROWORK_DEV_MODE=0 pnpm --filter aurowork-desktop tauri build --debug
```

Then run the produced binary (path printed by tauri). Verify:
- No new `launch-*.log` file is created in `~/Library/Logs/com.nld.aurowork.dev/` since the previous test.
- Existing engine functionality still works.

(If a full release build is too slow for a manual test, alternatively run `AUROWORK_DEV_MODE=0 cargo run --release` from `apps/desktop/src-tauri`.)

- [ ] **Step 6: Update DEV_PROGRESS.md**

Append to `.claude/DEV_PROGRESS.md` a new dated entry summarizing:
- New launch log feature added under `~/Library/Logs/com.nld.aurowork.dev/` (and Linux/Windows equivalents).
- 5 tags: `[launch:shell|orchestr|engine|server|ui]`.
- Toggled by `AUROWORK_DEV_MODE=1` (debug builds: on by default).
- Settings → Developer Mode now has "Open log folder" + path display.
- Files touched: list the 4 new + 7-9 modified paths.

- [ ] **Step 7: Commit**

```bash
git add .claude/DEV_PROGRESS.md
git commit -m "docs(progress): log launch-phase logging + dev mode consolidation rollout"
```

- [ ] **Step 8: Done**

The feature branch `feat/launch-logging-dev-mode` is ready for PR. Refer to `superpowers:finishing-a-development-branch` for next steps.

---

## Plan Self-Review Notes

- **Spec coverage:** All 13 spec sections (background through future-iterations) have at least one task; Section 9 (Settings UI) → Task 15; Section 8 (file mgmt) → Task 4; Section 7 (dev mode) → Task 2 + 7; Section 6 (each stage) → Tasks 5, 8-12, 14.
- **Placeholder scan:** No "TODO" or "TBD". Step 2 of Task 11 directs the implementer to `grep` for the exact line range — this is acceptable because the engine direct-spawn path is large and locating its reader is more reliable than hard-coding a line that may drift; the exact pattern to apply is shown inline.
- **Type/name consistency:** `LaunchLogAggregator`, `launch_log_append_batch`, `dev_mode_info`, `open_launch_log_folder`, `initLaunchLog`, `flushLaunchLog`, `launchLog` are referenced consistently across tasks.
- **Known fragility:** Tasks 9, 11, 12 modify `commands/engine.rs` event readers. If `engine.rs` has been refactored upstream, the line ranges may shift; the implementer should re-grep for `CommandEvent::Stdout` to find the actual blocks. The applied patches are pattern-based and idempotent.
