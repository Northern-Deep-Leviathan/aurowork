# Windows Launch Performance & Launch-log Tag Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 launch-log defects and add spawn observability so the next Windows diagnostic log surfaces where the 70 s cold-start time is being spent.

**Architecture:** Six independent fixes in the launch-log subsystem and the three sidecar spawn paths (server, orchestrator, engine). Fix 1 corrects a frontend gating bug. Fix 2 re-tags forwarded child-process lines by `[opencode]` prefix. Fix 3 adds tokio heartbeat tasks during spawn. Fix 4 adds substage logs around `wait_for_orchestrator`. Fix 5 adds shell-side checkpoints. Fix 6 introduces a "launch phase complete" marker that filters post-launch `/health` DEBUG noise.

**Tech Stack:** Rust (Tauri 2 backend), TypeScript (SolidJS frontend), tokio async runtime, existing `LaunchLogAggregator` + `SidecarLineClassifier` primitives.

**Spec:** `docs/superpowers/specs/2026-05-24-windows-launch-perf-and-tags-design.md`

---

## File Structure

| File | Role |
|---|---|
| `apps/desktop/src-tauri/src/commands/launch_log.rs` | Fix 1: extend `dev_mode_info` to OR in `armed_on_startup`; Fix 6: add `launch_log_mark_complete` command |
| `apps/desktop/src-tauri/src/launch_log/sidecar.rs` | Fix 2: add `classify_sidecar_tag` helper + tests |
| `apps/desktop/src-tauri/src/launch_log/mod.rs` | Fix 6: `complete` flag + DEBUG filter in `append` |
| `apps/desktop/src-tauri/src/launch_log/heartbeat.rs` (new) | Fix 3: shared spawn-heartbeat helper |
| `apps/desktop/src-tauri/src/aurowork_server/mod.rs` | Fix 2 call site + Fix 3 heartbeat use |
| `apps/desktop/src-tauri/src/orchestrator/mod.rs` | (uses helpers via call sites in `commands/engine.rs`) |
| `apps/desktop/src-tauri/src/commands/engine.rs` | Fix 2 call sites (orch/engine forwarders) + Fix 3 heartbeats + Fix 4 substage logs |
| `apps/desktop/src-tauri/src/engine/spawn.rs` | Fix 3 heartbeat in engine spawn path |
| `apps/desktop/src-tauri/src/lib.rs` | Fix 5 setup checkpoints + Fix 6 register `mark_complete` command |
| `apps/app/src/lib/launch-log.ts` | Fix 6: `markLaunchComplete()` helper |
| `apps/app/src/app/app.tsx` | Fix 6: dispatch `markLaunchComplete()` after first paint + workspace resolution |

---

## Task 1: Fix 1 — `dev_mode_info` reflects diagnostic-armed state

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/launch_log.rs:101-107`

- [ ] **Step 1: Update `dev_mode_info` signature and body**

Replace lines 101-107 with:

```rust
#[tauri::command]
pub fn dev_mode_info(
    aggregator: State<'_, LaunchLogAggregator>,
    diagnostic_status: State<'_, LaunchDiagnosticStatus>,
) -> DevModeInfo {
    DevModeInfo {
        // `enabled` reports whether the launch log is recording for this
        // session — true whenever dev mode is on OR this launch was
        // triggered by an armed diagnostic. The frontend uses this to
        // decide whether to ship UI entries via IPC.
        enabled: dev_mode::is_enabled() || diagnostic_status.armed_on_startup,
        log_file_path: aggregator.path().map(|p| p.to_string_lossy().to_string()),
    }
}
```

- [ ] **Step 2: Build to confirm signature compiles**

Run: `cargo check -p aurowork-desktop`
Expected: build succeeds (the `LaunchDiagnosticStatus` type is already managed state in `lib.rs`).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/launch_log.rs
git commit -m "fix(launch-log): dev_mode_info reports diagnostic-armed sessions

Frontend short-circuited UI entries when dev_mode was off even though
the Rust aggregator was active for diagnostic launches. Now reports
enabled=true whenever either flag is set."
```

---

## Task 2: Fix 2 — `classify_sidecar_tag` helper

**Files:**
- Modify: `apps/desktop/src-tauri/src/launch_log/sidecar.rs`

- [ ] **Step 1: Add failing tests at bottom of `mod tests` (above closing `}`)**

```rust
    #[test]
    fn classify_tag_opencode_prefix_routes_to_engine() {
        let (tag, stripped) = classify_sidecar_tag(
            "[opencode] opencode server listening on http://127.0.0.1:55779",
            "launch:orchestr",
        );
        assert_eq!(tag, "launch:engine");
        assert_eq!(stripped, "opencode server listening on http://127.0.0.1:55779");
    }

    #[test]
    fn classify_tag_orchestrator_prefix_keeps_orchestr() {
        let (tag, stripped) = classify_sidecar_tag(
            "[aurowork-orchestrator] daemon running on 127.0.0.1:55782",
            "launch:orchestr",
        );
        assert_eq!(tag, "launch:orchestr");
        assert_eq!(stripped, "daemon running on 127.0.0.1:55782");
    }

    #[test]
    fn classify_tag_orchestrator_router_prefix_keeps_orchestr() {
        let (tag, stripped) = classify_sidecar_tag(
            "[aurowork-orchestrator-router] GET /health",
            "launch:orchestr",
        );
        assert_eq!(tag, "launch:orchestr");
        assert_eq!(stripped, "GET /health");
    }

    #[test]
    fn classify_tag_no_prefix_uses_default() {
        let (tag, stripped) = classify_sidecar_tag("plain line", "launch:server");
        assert_eq!(tag, "launch:server");
        assert_eq!(stripped, "plain line");
    }

    #[test]
    fn classify_tag_unknown_bracket_uses_default() {
        let (tag, stripped) = classify_sidecar_tag("[other] hi", "launch:orchestr");
        assert_eq!(tag, "launch:orchestr");
        assert_eq!(stripped, "[other] hi");
    }

    #[test]
    fn classify_tag_default_for_server() {
        let (tag, stripped) =
            classify_sidecar_tag("aurowork-server: listening", "launch:server");
        assert_eq!(tag, "launch:server");
        assert_eq!(stripped, "aurowork-server: listening");
    }
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cargo test -p aurowork-desktop --lib launch_log::sidecar::tests::classify_tag`
Expected: FAIL — `classify_sidecar_tag` not found.

- [ ] **Step 3: Add the helper above `#[cfg(test)]` in `sidecar.rs`**

```rust
/// Re-tag a sidecar-forwarded line based on its bracketed prefix and
/// strip the prefix from the message. Returns `(tag, stripped_message)`.
///
/// The orchestrator forwards multiple child streams over its own stdout,
/// each prefixed with `[opencode]`, `[aurowork-orchestrator]`, etc. We
/// reroute `[opencode]` lines to `launch:engine` so the launch log
/// reflects which subsystem the line actually came from.
pub fn classify_sidecar_tag<'a>(
    line: &'a str,
    default_tag: &'static str,
) -> (&'static str, &'a str) {
    if let Some(rest) = line.strip_prefix("[opencode] ") {
        return ("launch:engine", rest);
    }
    if let Some(rest) = line.strip_prefix("[aurowork-orchestrator-router] ") {
        return ("launch:orchestr", rest);
    }
    if let Some(rest) = line.strip_prefix("[aurowork-orchestrator] ") {
        return ("launch:orchestr", rest);
    }
    (default_tag, line)
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo test -p aurowork-desktop --lib launch_log::sidecar`
Expected: all tests pass (3 existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/launch_log/sidecar.rs
git commit -m "feat(launch-log): add classify_sidecar_tag helper

Re-routes [opencode]-prefixed lines forwarded through orchestrator
stdout to the launch:engine tag, strips the prefix from the message."
```

---

## Task 3: Apply `classify_sidecar_tag` at sidecar forwarders

**Files:**
- Modify: `apps/desktop/src-tauri/src/aurowork_server/mod.rs:394-435`
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs` (orchestrator stdout/stderr forwarders around lines 459, 480, 497; engine forwarders around lines 668, 692, 712)

- [ ] **Step 1: Replace forwarder body in `aurowork_server/mod.rs`**

Find the existing block at lines 400-414 (stdout case) and replace the inner `agg.append(level, "launch:server", ...)` with the classified version:

```rust
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes).to_string();
                    if let Some(agg) =
                        app_handle.try_state::<crate::launch_log::LaunchLogAggregator>()
                    {
                        let stripped = line.trim_end().to_string();
                        match clf_stdout.feed(&stripped, crate::launch_log::format::Level::Debug) {
                            crate::launch_log::sidecar::Classified::Pending => {}
                            crate::launch_log::sidecar::Classified::Emit { level, message, stack } => {
                                if !message.is_empty() || stack.is_some() {
                                    let (tag, msg) =
                                        crate::launch_log::sidecar::classify_sidecar_tag(
                                            &message,
                                            "launch:server",
                                        );
                                    agg.append(level, tag, child_pid, msg, stack.as_deref());
                                }
                            }
                        }
                    }
```

- [ ] **Step 2: Apply same pattern to the stderr arm (lines ~421-435)**

Replace the inner `agg.append(level, "launch:server", ...)` for the stderr branch with the same classify+strip pattern (default tag still `"launch:server"`).

- [ ] **Step 3: Apply same pattern to terminator flush (lines ~446-450)**

Replace `agg.append(level, "launch:server", child_pid, &message, stack.as_deref())` inside the `clf.flush()` loop with:

```rust
                                let (tag, msg) =
                                    crate::launch_log::sidecar::classify_sidecar_tag(
                                        &message,
                                        "launch:server",
                                    );
                                agg.append(level, tag, child_pid, msg, stack.as_deref());
```

- [ ] **Step 4: Apply same pattern to orchestrator forwarders in `commands/engine.rs`**

For each occurrence where the orchestrator's stdout/stderr is forwarded via `clf.feed(...)` → `agg.append(level, "launch:orchestr", ...)`, replace with the classify+strip pattern using `"launch:orchestr"` as the default tag.

For each occurrence where the engine's direct stdout/stderr is forwarded with `"launch:engine"`, replace with the classify+strip pattern using `"launch:engine"` as the default tag.

(Use `grep -n 'launch:orchestr"\|launch:engine"' apps/desktop/src-tauri/src/commands/engine.rs` to locate every `agg.append(...)` call inside the spawn forwarder closures.)

- [ ] **Step 5: Build and run tests**

Run: `cargo test -p aurowork-desktop`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/aurowork_server/mod.rs apps/desktop/src-tauri/src/commands/engine.rs
git commit -m "fix(launch-log): re-tag forwarded [opencode] lines as launch:engine

Server and orchestrator forwarders now route by bracket prefix instead
of hardcoding the parent tag, so engine output no longer appears under
launch:orchestr."
```

---

## Task 4: Fix 3 — spawn heartbeat helper

**Files:**
- Create: `apps/desktop/src-tauri/src/launch_log/heartbeat.rs`
- Modify: `apps/desktop/src-tauri/src/launch_log/mod.rs` (add `pub mod heartbeat;`)
- Modify: `apps/desktop/src-tauri/src/aurowork_server/mod.rs` (use helper around stdout-loop spawn site)
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs` (use helper around orchestrator + engine forwarder spawn sites)

- [ ] **Step 1: Create `heartbeat.rs`**

```rust
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
```

- [ ] **Step 2: Register module in `launch_log/mod.rs`**

Add after the existing `pub mod sidecar;` line:

```rust
pub mod heartbeat;
```

- [ ] **Step 3: Run cargo check**

Run: `cargo check -p aurowork-desktop`
Expected: compiles.

- [ ] **Step 4: Use helper in `aurowork_server/mod.rs`**

Just before the existing `tauri::async_runtime::spawn(async move { while let Some(event) = rx.recv().await { ... } })`, insert:

```rust
    let heartbeat_cancel = if let (Some(agg), Some(pid)) = (
        app.try_state::<crate::launch_log::LaunchLogAggregator>()
            .map(|s| s.inner().clone()),
        child_pid,
    ) {
        Some(crate::launch_log::heartbeat::spawn_heartbeat(
            agg, "launch:server", pid, "aurowork-server",
        ))
    } else {
        None
    };
```

> Note: `LaunchLogAggregator` is already `Clone` (it's `Arc<Mutex<...>>`). Use `app.try_state::<...>().map(|s| (*s).clone())` rather than reaching into private fields — adjust to:

```rust
    let heartbeat_cancel = match (
        app.try_state::<crate::launch_log::LaunchLogAggregator>(),
        child_pid,
    ) {
        (Some(agg), Some(pid)) => Some(crate::launch_log::heartbeat::spawn_heartbeat(
            (*agg).clone(),
            "launch:server",
            pid,
            "aurowork-server",
        )),
        _ => None,
    };
    let heartbeat_for_task = heartbeat_cancel.clone();
```

Inside the spawned `while let Some(event)` loop, on the FIRST `CommandEvent::Stdout` or `CommandEvent::Stderr`, call `if let Some(c) = &heartbeat_for_task { c.notify_one(); }` (guarded so we only call it once — use a `bool` local).

Concretely, at the top of the `async move {` block add:

```rust
        let mut heartbeat_cancelled = false;
        let cancel_heartbeat = |hb_cancelled: &mut bool| {
            if !*hb_cancelled {
                if let Some(c) = &heartbeat_for_task {
                    c.notify_one();
                }
                *hb_cancelled = true;
            }
        };
```

(Inline the call as `cancel_heartbeat(&mut heartbeat_cancelled);` on the first line of each `Stdout` and `Stderr` arm.)

- [ ] **Step 5: Apply the same pattern in `commands/engine.rs` around the orchestrator spawn forwarder and the engine spawn forwarder**

For the orchestrator forwarder spawn site (after `spawn_orchestrator_daemon` returns and before `tauri::async_runtime::spawn` on its `rx`), use:

```rust
            crate::launch_log::heartbeat::spawn_heartbeat(
                (*agg).clone(), "launch:orchestr", child.pid(), "aurowork-orchestrator",
            )
```

For the engine forwarder spawn site (after `engine::spawn::spawn_engine` returns), use tag `"launch:engine"` and label `"opencode"`.

In both cases wire the same first-output cancellation pattern as in Step 4.

- [ ] **Step 6: Build and run all tests**

Run: `cargo test -p aurowork-desktop`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src-tauri/src/launch_log/heartbeat.rs apps/desktop/src-tauri/src/launch_log/mod.rs apps/desktop/src-tauri/src/aurowork_server/mod.rs apps/desktop/src-tauri/src/commands/engine.rs
git commit -m "feat(launch-log): heartbeat task during sidecar spawn

Logs pid alive at 1s/3s/5s/10s/15s/30s while waiting for first stdout
from server/orchestrator/engine. Cancels on first child output. Lets us
distinguish 'binary is starting slowly' from 'stdout is buffered'."
```

---

## Task 5: Fix 4 — orchestrator ready-gap substages

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs` (around the `wait_for_orchestrator` call site)

- [ ] **Step 1: Add substage log right BEFORE the `poll_start = Instant::now()` line**

Insert above existing line 555:

```rust
        if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
            agg.append(
                crate::launch_log::format::Level::Info,
                "launch:orchestr",
                None,
                "beginning /health poll",
                None,
            );
        }
```

- [ ] **Step 2: Add substage log AFTER `wait_for_orchestrator` succeeds (between the existing "orchestrator ready" line and `health.auro` extraction, around line 580)**

Insert immediately after the `orchestrator ready in {elapsed}ms` block:

```rust
        if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
            agg.append(
                crate::launch_log::format::Level::Info,
                "launch:orchestr",
                None,
                "beginning workspace bootstrap (extracting opencode endpoint)",
                None,
            );
        }
        let bootstrap_start = std::time::Instant::now();
```

- [ ] **Step 3: Add substage log AFTER `state.last_stderr = None;` (end of `if let Ok(mut state) = manager.inner.lock()` block, around line 600)**

Insert before the `if let Err(error) = start_aurowork_server(...)` block:

```rust
        if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
            agg.append(
                crate::launch_log::format::Level::Info,
                "launch:orchestr",
                None,
                &format!(
                    "workspace bootstrap OK in {}ms (opencode_port={opencode_port})",
                    bootstrap_start.elapsed().as_millis()
                ),
                None,
            );
        }
```

- [ ] **Step 4: Build**

Run: `cargo check -p aurowork-desktop`
Expected: compiles.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/engine.rs
git commit -m "feat(launch-log): orchestrator ready-substage breakdowns

Add 'beginning /health poll', 'beginning workspace bootstrap', and
'workspace bootstrap OK in Xms' entries so the 25s gap between daemon-up
and orchestrator-ready is attributable to a specific substage."
```

---

## Task 6: Fix 5 — shell setup checkpoints

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs` (in the `setup()` closure)
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs` (top of `engine_start` command)

- [ ] **Step 1: Find the `.setup(|app| { ... })` block in `lib.rs` and add a checkpoint immediately before its `Ok(())` return**

```rust
            if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
                agg.append(
                    crate::launch_log::format::Level::Info,
                    "launch:shell",
                    Some(std::process::id()),
                    "tauri setup complete, awaiting first webview event",
                    None,
                );
            }
            Ok(())
```

- [ ] **Step 2: At the very top of `pub fn engine_start(...)` in `commands/engine.rs` (after the function signature `{`), add**

```rust
    if let Some(agg) = app.try_state::<crate::launch_log::LaunchLogAggregator>() {
        agg.append(
            crate::launch_log::format::Level::Info,
            "launch:shell",
            Some(std::process::id()),
            "engine_start invoked",
            None,
        );
    }
```

- [ ] **Step 3: Build**

Run: `cargo check -p aurowork-desktop`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/commands/engine.rs
git commit -m "feat(launch-log): shell-side setup + engine_start checkpoints

Add 'tauri setup complete' and 'engine_start invoked' entries to
attribute the pre-orchestrator gap to webview cold-start vs frontend
init."
```

---

## Task 7: Fix 6 — launch-phase complete marker + post-launch filter

**Files:**
- Modify: `apps/desktop/src-tauri/src/launch_log/mod.rs` (add `complete: AtomicBool` to `Inner`, filter in `append`, add `mark_complete()` method)
- Modify: `apps/desktop/src-tauri/src/commands/launch_log.rs` (add `launch_log_mark_complete` command)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (register the command in `invoke_handler`)
- Modify: `apps/app/src/lib/launch-log.ts` (add `markLaunchComplete()` helper)
- Modify: `apps/app/src/app/app.tsx` (call helper after first paint + workspace resolution)

- [ ] **Step 1: Add failing test in `launch_log/mod.rs::tests`**

```rust
    #[test]
    fn mark_complete_filters_debug_on_filtered_tags() {
        let dir = temp_dir();
        let agg = super::LaunchLogAggregator::default();
        agg.init(&dir, "0.0.0", "0.0.0", "test", true);
        agg.mark_complete();
        // Debug on filtered tags is dropped.
        agg.append(super::format::Level::Debug, "launch:server", None, "filtered debug", None);
        agg.append(super::format::Level::Debug, "launch:orchestr", None, "filtered debug", None);
        // Info on filtered tags still passes.
        agg.append(super::format::Level::Info, "launch:server", None, "kept info", None);
        // Debug on unfiltered tag still passes.
        agg.append(super::format::Level::Debug, "launch:shell", None, "kept shell debug", None);

        let path = agg.path().expect("path");
        let body = std::fs::read_to_string(path).expect("read");
        assert!(!body.contains("filtered debug"), "debug on filtered tag must be dropped");
        assert!(body.contains("kept info"));
        assert!(body.contains("kept shell debug"));
        let _ = std::fs::remove_dir_all(dir);
    }
```

- [ ] **Step 2: Run test to verify failure**

Run: `cargo test -p aurowork-desktop --lib launch_log::tests::mark_complete_filters_debug_on_filtered_tags`
Expected: FAIL — `mark_complete` not found.

- [ ] **Step 3: Modify `Inner` and `append` in `launch_log/mod.rs`**

Add to `Inner`:

```rust
struct Inner {
    writer: BufWriter<File>,
    path: PathBuf,
    started_at: std::time::Instant,
    complete: bool,
}
```

Update `Inner` construction in `init` (the `Some(Inner { ... })` literal) to include `complete: false,`.

Modify `append` body — replace existing body with:

```rust
    pub fn append(
        &self,
        level: Level,
        tag: &str,
        pid: Option<u32>,
        message: &str,
        stack: Option<&str>,
    ) {
        let Ok(mut guard) = self.inner.lock() else { return };
        let Some(inner) = guard.as_mut() else { return };
        if inner.complete
            && matches!(level, Level::Debug)
            && (tag == "launch:server" || tag == "launch:orchestr")
        {
            return;
        }
        let line = format_line(Local::now(), level, tag, pid, message, stack);
        if let Err(err) = inner.writer.write_all(line.as_bytes()) {
            eprintln!("[launch_log] write failed: {err}; disabling");
            *guard = None;
            return;
        }
        let _ = inner.writer.flush();
    }
```

Add new method on the `impl LaunchLogAggregator` block:

```rust
    /// Mark the launch phase complete. Subsequent DEBUG entries on
    /// `launch:server` and `launch:orchestr` tags are dropped. Writes a
    /// one-shot summary line with elapsed ms.
    pub fn mark_complete(&self) {
        let Ok(mut guard) = self.inner.lock() else { return };
        let Some(inner) = guard.as_mut() else { return };
        if inner.complete {
            return;
        }
        let elapsed_ms = inner.started_at.elapsed().as_millis();
        let line = format_line(
            Local::now(),
            Level::Info,
            "launch:shell",
            Some(std::process::id()),
            &format!("=== launch phase complete after {elapsed_ms}ms ==="),
            None,
        );
        let _ = inner.writer.write_all(line.as_bytes());
        let _ = inner.writer.flush();
        inner.complete = true;
    }
```

- [ ] **Step 4: Run test to verify pass**

Run: `cargo test -p aurowork-desktop --lib launch_log`
Expected: all launch_log tests pass.

- [ ] **Step 5: Add `launch_log_mark_complete` command to `commands/launch_log.rs`**

Append to the end of the file:

```rust
#[tauri::command]
pub fn launch_log_mark_complete(aggregator: State<'_, LaunchLogAggregator>) -> Result<(), String> {
    aggregator.mark_complete();
    Ok(())
}
```

- [ ] **Step 6: Register the command in `lib.rs` `invoke_handler!` block**

Add `commands::launch_log::launch_log_mark_complete,` next to the other `launch_log_*` commands inside `tauri::generate_handler![ ... ]`.

- [ ] **Step 7: Build**

Run: `cargo check -p aurowork-desktop`
Expected: compiles.

- [ ] **Step 8: Add `markLaunchComplete` in `apps/app/src/lib/launch-log.ts`**

Append a new exported function (after the existing exports):

```typescript
let launchComplete = false;

export async function markLaunchComplete(): Promise<void> {
  if (launchComplete) return;
  launchComplete = true;
  try {
    await invoke("launch_log_mark_complete");
  } catch {
    // Non-fatal: aggregator may not be enabled.
  }
}
```

- [ ] **Step 9: Wire dispatch in `apps/app/src/app/app.tsx`**

In the root component, inside the existing `onMount` (or wrapped in `createEffect` that runs after workspace resolution), add a `requestAnimationFrame` + microtask defer so it runs after first paint:

```typescript
import { markLaunchComplete } from "../lib/launch-log";

onMount(() => {
  // existing body...
  requestAnimationFrame(() => {
    queueMicrotask(() => {
      void markLaunchComplete();
    });
  });
});
```

If the file already has a more specific "workspace ready" effect, hook the call there instead and remove the `onMount` version.

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck`
Expected: passes.

- [ ] **Step 11: Commit**

```bash
git add apps/desktop/src-tauri/src/launch_log/mod.rs apps/desktop/src-tauri/src/commands/launch_log.rs apps/desktop/src-tauri/src/lib.rs apps/app/src/lib/launch-log.ts apps/app/src/app/app.tsx
git commit -m "feat(launch-log): launch-phase complete marker + post-launch filter

Frontend signals end-of-launch via launch_log_mark_complete. After the
marker, DEBUG entries from launch:server/launch:orchestr (the chatty
/health polls) are dropped. INFO and above still pass. If the frontend
crashes pre-marker, full DEBUG continues — preserving crash diagnostics."
```

---

## Task 8: Manual verification on Windows + macOS

**Goal:** Confirm all 6 fixes work end-to-end on a real diagnostic launch.

- [ ] **Step 1: Build the desktop app**

Run (on each platform): `pnpm build` (or `pnpm dev:windows` / `pnpm dev` for a dev build).

- [ ] **Step 2: Trigger a diagnostic launch**

Settings → Debug → "Run launch diagnostic" → confirm restart prompt.

- [ ] **Step 3: Open the resulting `launch-*.log`**

Locate via Settings → Debug → "Open launch log folder".

- [ ] **Step 4: Verify checklist**

For Fix 1 — log contains entries with tag `launch:ui` (e.g., `[launch:ui] ui-bootstrap-started`).

For Fix 2 — lines like `opencode server listening on http://...` appear under `[launch:engine]`, not `[launch:orchestr]`. No `[opencode] [opencode] ...` doubled prefixes.

For Fix 3 — when a sidecar's first stdout is delayed, lines like `pid=N alive (aurowork-server), awaiting first stdout` appear at 1s/3s/etc. On a fast launch, none appear (cancellation works).

For Fix 4 — between "spawning orchestrator daemon" and "orchestrator ready in Xms" you can see `beginning /health poll`, `beginning workspace bootstrap`, `workspace bootstrap OK in Yms`.

For Fix 5 — early lines include `tauri setup complete, awaiting first webview event` and `engine_start invoked`.

For Fix 6 — log contains exactly one `=== launch phase complete after Xms ===` line, and after that line DEBUG entries from `launch:server`/`launch:orchestr` (the `/health` polls) stop while INFO/WARN still pass.

- [ ] **Step 5: If all pass, push branch and open PR**

```bash
git push -u origin fix/windows-launch-perf-and-tags
gh pr create --title "Windows launch perf & launch-log tag fixes" --body "Implements docs/superpowers/specs/2026-05-24-windows-launch-perf-and-tags-design.md. Six independent fixes for launch-log observability."
```
