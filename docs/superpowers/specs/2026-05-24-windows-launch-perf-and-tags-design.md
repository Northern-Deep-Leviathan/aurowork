# Windows Launch Performance & Launch-log Tag Fixes — Design

**Date:** 2026-05-24
**Branch:** `fix/windows-launch-perf-and-tags`
**Trigger:** real-world Windows launch log (`launch-20260524-092851.log`, 70 s cold start) revealed several launch-log bugs and large dead zones.

## Problem

A diagnostic-armed launch on Windows produced these symptoms:

| # | Symptom | Severity |
|---|---|---|
| 1 | `[launch:ui]` tag completely missing from the log | P0 |
| 2 | engine (`opencode`) output appears under `[launch:orchestr]` instead of `[launch:engine]` | P0 |
| 3 | aurowork-server: spawn → `listening` gap of **30.2 s** with zero forwarded stdout | P1 |
| 4 | orchestrator: daemon `running` → shell-reported `ready` gap of **24.9 s** | P1 |
| 5 | shell `starting` → orchestrator `spawning` gap of **9.1 s** with no intermediate events | P1 |
| 6 | After ready, log fills with periodic `/health` + `/capabilities` polls — high noise | P2 |

### Root cause findings (verified from code)

**(1) Missing `[launch:ui]`** — direct bug. `dev_mode_info` Tauri command (`commands/launch_log.rs:102`) returns `enabled = dev_mode::is_enabled()`. When dev mode is OFF but `diagnostic_armed=true`, the Rust aggregator IS active (file is being written), but the frontend `initLaunchLog()` (`apps/app/src/lib/launch-log.ts:46-54`) caches `devModeCached = false` and `launchLog()` short-circuits at line 104-106. **All UI entries are dropped.** The dev_mode_info command needs to return whether the log is actually enabled (dev_mode OR diagnostic_armed), not just dev_mode.

**(2) engine output under wrong tag** — direct bug. Orchestrator's spawned `opencode` child writes to the orchestrator's stdout, which `aurowork_server`/`orchestrator` forward via `SidecarLineClassifier` with the tag `launch:orchestr`. Lines like `[opencode] opencode server listening on http://127.0.0.1:55779` are clearly engine events but are tagged `launch:orchestr`. Need: re-tag based on the `[opencode]` line prefix that the orchestrator already prints.

**(3) server 30 s spawn gap** — observability bug, possibly behavior bug. Either:
- (a) `aurowork-server.exe` IS up but its stdout is not flushed/forwarded until 30 s later (PE startup + Windows Defender first-run scan), OR
- (b) the Bun binary really takes 30 s to bind a port.
Without intermediate heartbeats (e.g. "server pid alive at +1s", "+5s", "+10s") we cannot distinguish (a) from (b). Spec adds heartbeats so future logs disambiguate.

**(4) orchestrator 25 s ready gap** — observability bug. Between `orchestrator daemon running on 127.0.0.1:55782` (sidecar reports healthy) and `orchestrator ready in 30249ms` (shell confirms), 25 s passes silently. `wait_for_orchestrator()` (`orchestrator/mod.rs:171`) polls `/health` every 200 ms — fast — so the gap is not in this poll. It is in whatever the shell does between "daemon up" and "ready" (likely workspace bootstrap or auth round-trip). Need: log the substages.

**(5) shell 9 s pre-orchestrator gap** — observability bug. Tauri webview/window initialization before `engine_start` is called. Need: log a `setup_complete` / `before_engine_start` checkpoint, and also log when `launch_log_append` first receives a UI entry (this naturally measures UI bootstrap latency).

**(6) post-ready noise** — quality-of-life. The launch log keeps filling with polls forever (current log is +5 min from start, 90 % of lines are polls). Need: an explicit "launch phase complete" marker after which DEBUG-level entries from `launch:server` poll endpoints are filtered.

## Scope

This is a **single subsystem** (launch logging + spawn observability), appropriate for one spec → plan → implementation cycle. Six independent fixes, but they touch overlapping files (`launch_log/`, `aurowork_server/`, `orchestrator/`, `engine/`, `commands/launch_log.rs`, `apps/app/src/lib/launch-log.ts`) and share verification (re-run a Windows diagnostic, compare logs).

Out of scope:
- Actually speeding up server / orchestrator startup. We're fixing **visibility** of where the time goes. Real perf fixes (Windows Defender exclusion docs, Bun binary preload, etc.) come after we have clean per-stage breakdowns.
- Web UI changes. This is all about the launch log on desktop.

## Design

### Fix 1 — `dev_mode_info` reflects actual log-enabled state

**File:** `apps/desktop/src-tauri/src/commands/launch_log.rs`

```rust
#[tauri::command]
pub fn dev_mode_info(
    aggregator: State<'_, LaunchLogAggregator>,
    diagnostic_status: State<'_, LaunchDiagnosticStatus>,
) -> DevModeInfo {
    let log_path = aggregator.path();
    DevModeInfo {
        // `enabled` here means "the launch log is recording for this
        // session" — true whenever either dev mode is on, OR this launch
        // was triggered by an armed diagnostic. The frontend uses this
        // to decide whether to ship UI entries via IPC.
        enabled: dev_mode::is_enabled() || diagnostic_status.armed_on_startup,
        log_file_path: log_path.map(|p| p.to_string_lossy().to_string()),
    }
}
```

The frontend (`apps/app/src/lib/launch-log.ts`) needs no changes — once `enabled = true`, the existing buffer/flush logic ships UI entries.

**Note:** the `DevModeInfo` field name `enabled` is slightly misleading after this change (it conflates dev mode with diagnostic). We'll leave the name (no breaking churn) but document the semantics in the rustdoc.

### Fix 2 — Re-tag forwarded `[opencode]` lines as `launch:engine`

**File:** `apps/desktop/src-tauri/src/launch_log/sidecar.rs`

Add a tag-rewrite step in the forwarder, OR (simpler) at the call site where the orchestrator's stdout is forwarded. The orchestrator already prefixes its own log lines with `[aurowork-orchestrator]`, `[aurowork-orchestrator-router]`, `[opencode]`, etc. Map prefix → tag:

| Prefix | Tag |
|---|---|
| `[opencode]` | `launch:engine` |
| `[aurowork-orchestrator]`, `[aurowork-orchestrator-router]` | `launch:orchestr` |
| (no prefix) | `launch:orchestr` (fallback) |

Implementation: add a free function `classify_sidecar_tag(line: &str, default_tag: &'static str) -> &'static str` in `launch_log/sidecar.rs` and call it from the orchestrator/server forwarders right before `agg.append(...)`. Strip the prefix from the forwarded message so we don't get `[opencode] [opencode] foo` in the log.

### Fix 3 — Server spawn heartbeats

**File:** `apps/desktop/src-tauri/src/aurowork_server/mod.rs`

After spawn but before `listening`, schedule a periodic heartbeat task that logs `pid=N alive at +Xs` every 1 s, 3 s, 5 s, 10 s, 15 s, 30 s. Stops on the first stdout/stderr event from the child (which means the binary is past its cold-start). Implementation: a tokio task spawned alongside the existing stdio forwarder.

Pseudocode:

```rust
let heartbeat = tokio::spawn(async move {
    for delay_ms in [1000, 2000, 2000, 5000, 5000, 15000] {
        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        if heartbeat_cancel.is_cancelled() { return; }
        agg.append(Level::Debug, "launch:server", Some(pid),
            &format!("pid={pid} alive, awaiting first stdout"), None);
    }
});
// In the stdio loop: on the FIRST CommandEvent::Stdout/Stderr, cancel heartbeat.
```

Apply the same pattern to orchestrator and engine spawn paths.

### Fix 4 — Orchestrator ready-gap visibility

**Files:** `apps/desktop/src-tauri/src/commands/engine.rs` (or wherever `wait_for_orchestrator` is called from), `apps/desktop/src-tauri/src/orchestrator/mod.rs`

Add per-substage logging in the orchestrator startup path:

1. `[launch:orchestr] daemon http reachable, fetching first /health` (before first poll)
2. `[launch:orchestr] /health OK after Xms (Y polls)` (after `wait_for_orchestrator` succeeds)
3. `[launch:orchestr] beginning workspace bootstrap` (before workspace registration round-trip)
4. `[launch:orchestr] workspace bootstrap OK in Yms` (after)
5. `[launch:orchestr] ready in Tms` (existing — keep)

Without these, when a 25 s gap appears between (2) and the existing (5), we'll know which substage was slow.

### Fix 5 — Shell-side checkpoints before engine start

**File:** `apps/desktop/src-tauri/src/lib.rs`

In the `setup()` closure, add explicit checkpoints:

- `[launch:shell] aggregator initialized` (already exists implicitly via the existing "aurowork desktop starting" line)
- `[launch:shell] tauri setup complete, awaiting first webview event` (right before `setup()` returns)

In the existing `engine_start` Tauri command (or its callers), at the very top:

- `[launch:shell] engine_start invoked` (this measures the gap between webview-ready and the first frontend call)

This will surface where the 9 s went (webview cold start vs. frontend initialization).

### Fix 6 — "Launch phase complete" marker and post-launch filtering

**Files:** `apps/desktop/src-tauri/src/launch_log/mod.rs`, `apps/desktop/src-tauri/src/commands/launch_log.rs`, `apps/app/src/lib/launch-log.ts`

Add a frontend signal: when UI considers itself fully loaded (after first paint + workspace selected OR onboarding shown), call a new `launch_log_mark_complete()` Tauri command. The aggregator records:

```
[launch:shell] === launch phase complete after Xms ===
```

After this marker, the aggregator filters `DEBUG`-level entries from `launch:server` and `launch:orchestr` tags. INFO and above still pass. Log entries from `launch:ui`, `launch:shell`, `launch:engine` are unaffected.

Implementation: a `complete: AtomicBool` field on the aggregator's `Inner`. `append()` checks: if `complete && level == Debug && (tag in ["launch:server", "launch:orchestr"])`, drop.

If the frontend never calls `mark_complete()` (e.g. crash during launch), full DEBUG continues to be captured — which is exactly what we want for crash diagnosis.

## Files Touched

| File | Why |
|---|---|
| `apps/desktop/src-tauri/src/commands/launch_log.rs` | Fix 1 (dev_mode_info), Fix 6 (mark_complete command) |
| `apps/desktop/src-tauri/src/launch_log/mod.rs` | Fix 6 (complete flag + filter in append) |
| `apps/desktop/src-tauri/src/launch_log/sidecar.rs` | Fix 2 (classify_sidecar_tag helper + tests) |
| `apps/desktop/src-tauri/src/aurowork_server/mod.rs` | Fix 2 (use helper), Fix 3 (heartbeat) |
| `apps/desktop/src-tauri/src/orchestrator/mod.rs` | Fix 2 (use helper), Fix 3 (heartbeat), Fix 4 (substage logs) |
| `apps/desktop/src-tauri/src/engine/spawn.rs` | Fix 3 (heartbeat) |
| `apps/desktop/src-tauri/src/commands/engine.rs` | Fix 4 (substage logs around wait_for_orchestrator + workspace bootstrap) |
| `apps/desktop/src-tauri/src/lib.rs` | Fix 5 (setup checkpoints), Fix 6 (register mark_complete) |
| `apps/app/src/lib/launch-log.ts` | Fix 6 (call mark_complete after first paint + initial route resolved) |
| `apps/app/src/app/app.tsx` OR `apps/app/src/index.tsx` | Fix 6 (one-shot dispatch of mark_complete in onMount of root) |

## Testing Strategy

**Unit (Rust):**
- `sidecar::classify_sidecar_tag` — table-driven test with 6+ cases covering each prefix and the fallback
- `LaunchLogAggregator::append` post-complete filtering — verify DEBUG dropped on filtered tags, INFO passes, other tags pass

**Unit (TS):** none required (frontend changes are wiring).

**Manual (Windows + macOS):**
1. Trigger a diagnostic launch (Settings → Debug → Run launch diagnostic)
2. Open the resulting `launch-*.log`
3. Verify all 5 tags present: `launch:shell`, `launch:ui`, `launch:engine`, `launch:orchestr`, `launch:server`
4. Verify `[launch:engine]` lines come from opencode (e.g. "opencode server listening on http://...")
5. Verify heartbeat lines like `pid=N alive at +Xs, awaiting first stdout` appear when any sidecar's first output is delayed
6. Verify "=== launch phase complete after Xms ===" marker appears
7. After the marker, verify DEBUG entries from `launch:server` (the noisy `/health` polls) stop, but INFO/WARN/ERROR still pass

**Non-goal:** automated end-to-end (would require spawning a real desktop binary in CI). Manual dogfood + the existing cargo tests provide enough coverage.

## Risk & Rollback

- Fix 1 changes behavior of `dev_mode_info` — but only in the diagnostic-armed case (returns `true` instead of `false`). Frontend never uses the `enabled` flag for anything except deciding whether to ship UI launch-log entries. No other consumer in the codebase. Low risk.
- Fix 2 only relabels existing entries — no behavior change. Lowest risk.
- Fix 3 adds tokio tasks that self-cancel on first child output. Bounded heartbeat count (max 6 entries). Negligible risk.
- Fix 4 only adds log lines. Lowest risk.
- Fix 5 only adds log lines. Lowest risk.
- Fix 6 introduces conditional drop in `append`. Risk: if `mark_complete()` is called too early (e.g. before workspace is actually loaded), legitimate launch-phase DEBUG might be dropped. **Mitigation:** call from a defensive checkpoint (after workspace fetch completes + first paint), not just after first paint.

Rollback per fix is independent — each is a separate commit.

## Open Questions

None. The Windows log gave us enough signal to design every fix concretely.
