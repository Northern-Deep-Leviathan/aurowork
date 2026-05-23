# Debug Tab Consolidation + Launch Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move "Open Deeplink" + "Launch log" panels out of Settings → Advanced and into the Debug tab; replace the Launch log panel with a one-shot "Launch 阶段诊断" flow that arms a flag, restarts the app, captures a full startup log, and shows a corner toast on the next launch.

**Architecture:** Add a tiny persisted flag (`launch-diagnostic.flag`) under `app_data_dir`. On startup, `lib::run().setup()` calls `diagnostic_flag::take()` (read-and-delete); `LaunchLogAggregator::init()` now accepts an explicit `enabled: bool` computed as `dev_mode::is_enabled() OR diagnostic_armed`. Two new Tauri commands (`arm_launch_diagnostic`, `launch_diagnostic_status`) bridge the frontend. The frontend adds two extracted panels in the Debug tab + a corner toast mounted at app root.

**Tech Stack:** Rust (Tauri 2 + std), SolidJS 1.9, TailwindCSS, `@tauri-apps/plugin-process` for restart, existing `LaunchLogAggregator` infrastructure.

**Spec:** `docs/superpowers/specs/2026-05-23-debug-tab-and-launch-diagnostic-design.md`

---

## File Structure Overview

**Backend (Rust)**
- `apps/desktop/src-tauri/src/diagnostic_flag.rs` (new) — pure IO module: `set`, `take`, `flag_path`
- `apps/desktop/src-tauri/src/launch_log/mod.rs` (modify) — `init` accepts `enabled: bool`; `append` drops the redundant `dev_mode` check
- `apps/desktop/src-tauri/src/commands/launch_log.rs` (modify) — add `arm_launch_diagnostic`, `launch_diagnostic_status` + `LaunchDiagnosticStatus` state + DTO
- `apps/desktop/src-tauri/src/lib.rs` (modify) — declare module, wire setup, manage state, register commands

**Frontend (SolidJS)**
- `apps/app/src/app/pages/settings/launch-diagnostic-panel.tsx` (new) — the new panel
- `apps/app/src/app/pages/settings/open-deeplink-panel.tsx` (new) — extracted from settings.tsx
- `apps/app/src/app/pages/settings.tsx` (modify) — delete old Advanced blocks; restructure Debug tab with two section headers; microcopy
- `apps/app/src/app/components/launch-diagnostic-toast.tsx` (new) — corner toast component
- `apps/app/src/app/app.tsx` (modify) — mount toast near root
- `apps/app/src/i18n/locales/{en,zh,vi,pt-BR,ja}.ts` (modify) — add ~14 keys per locale

---

## Branch Setup

- [ ] **Step 0: Confirm working branch**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && git status && git branch --show-current`

Expected: branch is `feat/launch-logging-dev-mode` (continuation of PR #34) or a freshly-created `feat/debug-tab-launch-diagnostic` from main. Either is acceptable — the spec was committed to `feat/launch-logging-dev-mode`, and these changes are conceptually a continuation of that PR.

If on `feat/launch-logging-dev-mode`: continue, all commits will append to the same branch (and to PR #34).

---

### Task 1: `diagnostic_flag` module — write + tests first

**Files:**
- Create: `apps/desktop/src-tauri/src/diagnostic_flag.rs`

- [ ] **Step 1: Write the new module with tests**

Create `apps/desktop/src-tauri/src/diagnostic_flag.rs`:

```rust
//! One-shot flag persisted between app launches to signal
//! "the next launch should write a launch log file even if dev mode is off".
//!
//! The flag is a tiny file under the Tauri app_data_dir. The lifecycle is:
//!   1. UI calls `arm_launch_diagnostic` → backend calls [`set`] → file created.
//!   2. UI calls `plugin:process|restart` → app exits and relaunches.
//!   3. On startup, `lib::run().setup()` calls [`take`] → returns true and
//!      deletes the file.
//!   4. If the file is absent, [`take`] returns false (the common case).

use std::fs;
use std::path::{Path, PathBuf};

const FLAG_FILENAME: &str = "launch-diagnostic.flag";

/// Resolve the path to the flag file inside the given app data dir.
pub fn flag_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(FLAG_FILENAME)
}

/// Create (or overwrite) the flag. Creates the parent dir if missing.
pub fn set(app_data_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(app_data_dir)?;
    fs::write(flag_path(app_data_dir), b"1")
}

/// Consume the flag: returns true if it existed (and deletes it),
/// false otherwise. This is the read-and-clear operation called once
/// per app launch in `setup`.
pub fn take(app_data_dir: &Path) -> bool {
    let path = flag_path(app_data_dir);
    if !path.exists() {
        return false;
    }
    // Best-effort delete: even if removal fails (e.g. permission flap),
    // we still return true so the launch IS captured. Next launch will
    // try again — at worst we capture one extra diagnostic log, never
    // miss one.
    let _ = fs::remove_file(&path);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    fn tmp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aurowork-diag-flag-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn set_then_take_returns_true_and_deletes() {
        let dir = tmp_dir();
        set(&dir).unwrap();
        assert!(flag_path(&dir).exists(), "set() must create the file");
        let consumed = take(&dir);
        assert!(consumed, "take() must return true when flag is set");
        assert!(!flag_path(&dir).exists(), "take() must delete the file");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn take_on_missing_returns_false() {
        let dir = tmp_dir();
        let consumed = take(&dir);
        assert!(!consumed, "take() must return false when flag is absent");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn take_twice_in_a_row_second_returns_false() {
        let dir = tmp_dir();
        set(&dir).unwrap();
        assert!(take(&dir), "first take should consume");
        assert!(!take(&dir), "second take should report missing");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn set_creates_parent_dir_if_missing() {
        let base = std::env::temp_dir().join(format!("aurowork-diag-flag-parent-{}", Uuid::new_v4()));
        let nested = base.join("subdir");
        assert!(!nested.exists());
        set(&nested).unwrap();
        assert!(flag_path(&nested).exists());
        let _ = fs::remove_dir_all(&base);
    }
}
```

- [ ] **Step 2: Declare the module + run tests**

Edit `apps/desktop/src-tauri/src/lib.rs` near the top (after `mod dev_mode;`):

```rust
mod diagnostic_flag;
```

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri" && cargo test --lib diagnostic_flag::`

Expected: 4 passed, 0 failed.

- [ ] **Step 3: Commit**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork"
git add apps/desktop/src-tauri/src/diagnostic_flag.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat(desktop): add diagnostic_flag module for one-shot launch capture

Persists a tiny file under app_data_dir to signal "next launch should
write a launch log file even if dev mode is off". 4 unit tests cover
set/take roundtrip, missing-file case, double-take, and parent-dir
creation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 2: `LaunchLogAggregator::init` — accept `enabled: bool`

**Files:**
- Modify: `apps/desktop/src-tauri/src/launch_log/mod.rs:53-125`

- [ ] **Step 1: Write the failing test**

Append to the existing `#[cfg(test)] mod tests` block in `apps/desktop/src-tauri/src/launch_log/mod.rs`:

```rust
    #[test]
    fn init_with_enabled_false_makes_append_noop() {
        let dir = temp_dir();
        let agg = super::LaunchLogAggregator::default();
        agg.init(&dir, "0.0.0", "0.0.0", "test", false);
        agg.append(super::format::Level::Info, "launch:shell", Some(0), "should not write", None);
        assert!(agg.path().is_none(), "path() must be None when init was disabled");
        let entries: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).collect();
        assert_eq!(entries.len(), 0, "no log file should exist");
        let _ = std::fs::remove_dir_all(dir);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri" && cargo test --lib launch_log::tests::init_with_enabled_false`

Expected: FAIL — compile error (init currently takes 4 args, not 5), OR runtime mismatch.

- [ ] **Step 3: Update `init` signature**

In `apps/desktop/src-tauri/src/launch_log/mod.rs`, change `LaunchLogAggregator::init`:

```rust
    /// Initialize the aggregator. The caller passes the resolved enabled
    /// flag (typically `dev_mode::is_enabled() || diagnostic_armed`).
    /// Safe to call with `enabled = false` — becomes a no-op (no file
    /// created, no allocation).
    pub fn init(
        &self,
        log_dir: &Path,
        app_version: &str,
        auro_version: &str,
        platform: &str,
        enabled: bool,
    ) {
        if !enabled {
            return;
        }
        // ... rest of body identical to the existing implementation
        // (the previous `if !dev_mode::is_enabled() { return; }` line is now removed)
```

Also in the same file, update `append()` — remove the redundant `dev_mode` check at the top:

```rust
    /// Append a single log entry. No-op when init was not enabled or write failed.
    pub fn append(
        &self,
        level: Level,
        tag: &str,
        pid: Option<u32>,
        message: &str,
        stack: Option<&str>,
    ) {
        // (previous `if !dev_mode::is_enabled() { return; }` removed —
        // the `Inner` guard below already covers the disabled case.)
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
```

- [ ] **Step 4: Update existing call sites and test helpers**

The single existing call site (in `lib.rs::setup`) will be updated in Task 3. Existing tests in `launch_log/mod.rs` do not call `init()` directly — they only call `prune_old_logs`. No other test helpers need adjusting.

- [ ] **Step 5: Run tests**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri" && cargo test --lib launch_log::`

Expected: all `launch_log::` tests pass (existing 12 + the new 1 = 13). Build may still fail at `lib.rs` because of the now-wrong call site signature — that's expected and fixed in Task 3.

- [ ] **Step 6: Commit**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork"
git add apps/desktop/src-tauri/src/launch_log/mod.rs
git commit -m "$(cat <<'EOF'
refactor(desktop): launch_log::init accepts explicit enabled flag

Moves the "is dev mode on?" decision out of LaunchLogAggregator and
into the caller, so a one-shot launch diagnostic flag can also
enable logging without coupling to AUROWORK_DEV_MODE. Also drops the
redundant dev_mode check inside append() — the Inner guard already
short-circuits when init was a no-op.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 3: Wire flag into `lib::run().setup()`

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs:172-196` (the `.setup` closure)

- [ ] **Step 1: Update setup to take the flag + compute log_enabled**

In `apps/desktop/src-tauri/src/lib.rs`, replace the existing `.setup(|app| { ... })` block. The current block looks like:

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
            aggregator.append( /* shell starting line */ );
            app.manage(aggregator.clone());
            launch_log::install_global(aggregator);
            Ok(())
        })
```

Replace with:

```rust
        .setup(|app| {
            set_dev_app_name();

            // One-shot diagnostic flag: take + delete it so the NEXT launch
            // is back to normal. The launch log is enabled if either
            // dev mode is on, OR a diagnostic was armed before restart.
            let diagnostic_armed = app
                .path()
                .app_data_dir()
                .ok()
                .map(|dir| crate::diagnostic_flag::take(&dir))
                .unwrap_or(false);
            let log_enabled = dev_mode::is_enabled() || diagnostic_armed;

            let aggregator = LaunchLogAggregator::default();
            if let Ok(log_dir) = app.path().app_log_dir() {
                let app_version = env!("CARGO_PKG_VERSION");
                let auro_version = option_env!("AUROWORK_AURO_VERSION").unwrap_or("unknown");
                let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
                aggregator.init(&log_dir, app_version, auro_version, &platform, log_enabled);
            }
            aggregator.append(
                Level::Info,
                "launch:shell",
                Some(std::process::id()),
                &format!(
                    "aurowork desktop starting, version={}, dev_mode={}, diagnostic_armed={}",
                    env!("CARGO_PKG_VERSION"),
                    dev_mode::is_enabled(),
                    diagnostic_armed,
                ),
                None,
            );
            app.manage(aggregator.clone());
            app.manage(commands::launch_log::LaunchDiagnosticStatus {
                armed_on_startup: diagnostic_armed,
            });
            launch_log::install_global(aggregator);
            Ok(())
        })
```

Note: `LaunchDiagnosticStatus` is defined in Task 4. This step intentionally references it ahead of time — the build will fail until Task 4 lands. That's OK; we commit Task 4 right after.

- [ ] **Step 2: Run cargo check (expect failure pointing at Task 4)**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri" && cargo check --lib 2>&1 | tail -20`

Expected: error E0433 or similar pointing at `commands::launch_log::LaunchDiagnosticStatus`. This is the expected failure that Task 4 fixes.

- [ ] **Step 3: Do NOT commit yet** — proceed to Task 4 and commit them together.

---

### Task 4: Add `LaunchDiagnosticStatus` state + two new Tauri commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/launch_log.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (handler registration)

- [ ] **Step 1: Add state struct + commands**

Append to `apps/desktop/src-tauri/src/commands/launch_log.rs`:

```rust
/// Process-wide state recording whether THIS launch was triggered by an
/// armed diagnostic flag. Captured in `lib::run().setup()` before the
/// flag is deleted, then read by the frontend at boot time.
pub struct LaunchDiagnosticStatus {
    pub armed_on_startup: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchDiagnosticStatusDto {
    pub armed_on_startup: bool,
    pub log_file_path: Option<String>,
}

/// Arm the one-shot diagnostic flag. The next launch will write a
/// launch log file regardless of dev mode. Caller is expected to
/// trigger an app restart immediately after.
#[tauri::command]
pub fn arm_launch_diagnostic(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    crate::diagnostic_flag::set(&dir).map_err(|e| format!("Failed to arm diagnostic: {e}"))
}

/// Read whether this launch was diagnostic-triggered, and the current
/// launch log file path (if any). Called by the frontend on boot to
/// decide whether to show the "diagnostic captured" toast, and by the
/// Debug-tab panel to populate the "Last diagnostic" display.
#[tauri::command]
pub fn launch_diagnostic_status(
    status: State<'_, LaunchDiagnosticStatus>,
    aggregator: State<'_, LaunchLogAggregator>,
) -> LaunchDiagnosticStatusDto {
    LaunchDiagnosticStatusDto {
        armed_on_startup: status.armed_on_startup,
        log_file_path: aggregator.path().map(|p| p.to_string_lossy().to_string()),
    }
}
```

- [ ] **Step 2: Register the two new commands in `lib.rs`**

In `apps/desktop/src-tauri/src/lib.rs`, update the imports near the top:

```rust
use commands::launch_log::{
    arm_launch_diagnostic, dev_mode_info, launch_diagnostic_status, launch_log_append,
    launch_log_append_batch, launch_log_path, launch_log_summary, open_launch_log_folder,
};
```

In the `tauri::generate_handler![...]` macro invocation, add the two new command names alongside the existing `launch_log_*` entries:

```rust
            launch_log_append,
            launch_log_append_batch,
            launch_log_path,
            launch_log_summary,
            dev_mode_info,
            open_launch_log_folder,
            arm_launch_diagnostic,
            launch_diagnostic_status,
```

- [ ] **Step 3: Build the whole crate**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri" && cargo build --lib 2>&1 | tail -10`

Expected: clean build (1 pre-existing warning about `format_error_chain` unused is OK).

- [ ] **Step 4: Run all launch_log + diagnostic_flag tests**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri" && cargo test --lib launch_log:: diagnostic_flag::`

Expected: 17 passed (13 launch_log + 4 diagnostic_flag).

- [ ] **Step 5: Commit Task 3 + Task 4 together**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork"
git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/src/commands/launch_log.rs
git commit -m "$(cat <<'EOF'
feat(desktop): wire one-shot diagnostic flag into launch_log

setup() consumes the diagnostic flag (read+delete) before init,
computes log_enabled = dev_mode OR diagnostic_armed, and stashes
the armed-on-startup signal in Tauri state. Two new commands —
arm_launch_diagnostic (UI clicks button) and launch_diagnostic_status
(UI queries after boot) — bridge the frontend.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 5: Add i18n keys (all 5 locales)

**Files:**
- Modify: `apps/app/src/i18n/locales/en.ts`
- Modify: `apps/app/src/i18n/locales/zh.ts`
- Modify: `apps/app/src/i18n/locales/vi.ts`
- Modify: `apps/app/src/i18n/locales/pt-BR.ts`
- Modify: `apps/app/src/i18n/locales/ja.ts`

- [ ] **Step 1: Add keys to `en.ts`**

Append to the object in `apps/app/src/i18n/locales/en.ts` (near the existing `settings.debug_*` section, e.g. after `settings.debug_startup_title`):

```ts
  "settings.debug_section_diagnostics": "Diagnostics",
  "settings.debug_section_recovery": "Reset & Recovery",
  "settings.launch_diag_title": "Launch diagnostics",
  "settings.launch_diag_description": "Capture a full startup log (shell / ui / orchestr / engine / server) for troubleshooting startup problems. Requires an app restart.",
  "settings.launch_diag_run": "Run launch diagnostic",
  "settings.launch_diag_run_hint": "(will restart app)",
  "settings.launch_diag_running": "Restarting...",
  "settings.launch_diag_confirm": "This will restart AuroWork to capture a full startup log. Any in-progress work may be lost. Continue?",
  "settings.launch_diag_last": "Last diagnostic",
  "settings.launch_diag_none": "No diagnostic log yet.",
  "settings.launch_diag_open_folder": "Open log folder",
  "settings.launch_diag_copy_path": "Copy path",
  "settings.launch_diag_toast_title": "Launch diagnostic captured",
  "settings.launch_diag_toast_view": "View",
```

Also UPDATE the existing key `settings.developer_mode_description`:

```ts
  "settings.developer_mode_description": "Shows the Debug tab with diagnostic and recovery tools. Reset on app restart.",
```

- [ ] **Step 2: Add Chinese translations to `zh.ts`**

Append the same keys with Chinese values:

```ts
  "settings.debug_section_diagnostics": "诊断",
  "settings.debug_section_recovery": "重置与恢复",
  "settings.launch_diag_title": "Launch 阶段诊断",
  "settings.launch_diag_description": "捕获一次完整的启动日志（shell / ui / orchestr / engine / server 五个阶段），用于排查启动问题。需要重启应用。",
  "settings.launch_diag_run": "运行启动诊断",
  "settings.launch_diag_run_hint": "（将重启应用）",
  "settings.launch_diag_running": "正在重启……",
  "settings.launch_diag_confirm": "这将重启 AuroWork 以捕获完整的启动日志。正在进行的任务可能丢失。是否继续？",
  "settings.launch_diag_last": "上次诊断",
  "settings.launch_diag_none": "暂无诊断日志。",
  "settings.launch_diag_open_folder": "打开日志文件夹",
  "settings.launch_diag_copy_path": "复制路径",
  "settings.launch_diag_toast_title": "已捕获启动诊断日志",
  "settings.launch_diag_toast_view": "查看",
```

Also UPDATE:

```ts
  "settings.developer_mode_description": "显示包含诊断和恢复工具的"调试"标签页。重启应用后会重置。",
```

- [ ] **Step 3: Add translations to `vi.ts`, `pt-BR.ts`, `ja.ts`**

Use English fallback verbatim for these three locales (translation can be refined later by native speakers). Add the same key-value pairs from Step 1 to each file. Also update `developer_mode_description` in each with the same English string.

- [ ] **Step 4: Verify TypeScript still compiles**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm typecheck 2>&1 | tail -10`

Expected: clean (no missing-key errors from `translate()`).

- [ ] **Step 5: Commit**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork"
git add apps/app/src/i18n/locales/
git commit -m "$(cat <<'EOF'
i18n: add launch-diagnostic + debug-section keys

Adds 14 new keys per locale for the Launch Diagnostic panel and the
Debug tab section headers. Updates settings.developer_mode_description
to reflect that toggling the switch only shows the Debug tab (it does
not by itself enable the diagnostic capture).

vi/pt-BR/ja use English fallback strings; native translation can be
refined in a follow-up.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 6: Extract `<OpenDeeplinkPanel/>` into its own file

**Files:**
- Create: `apps/app/src/app/pages/settings/open-deeplink-panel.tsx`
- Modify: `apps/app/src/app/pages/settings.tsx:2062-2127` (delete) + import the new component

- [ ] **Step 1: Create the extracted component**

Create `apps/app/src/app/pages/settings/open-deeplink-panel.tsx`:

```tsx
import { Show, type Accessor, type Setter } from "solid-js";
import { Button } from "../../components/ui/button";

const settingsPanelSoftClass =
  "rounded-2xl border border-dls-border/40 bg-dls-hover/20";
const compactOutlineActionClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-dls-border px-2.5 py-1 text-xs text-dls-secondary hover:bg-dls-hover transition";

export interface OpenDeeplinkPanelProps {
  busy: boolean;
  open: Accessor<boolean>;
  setOpen: Setter<boolean>;
  input: Accessor<string>;
  setInput: Setter<string>;
  status: Accessor<string | null>;
  setStatus: Setter<string | null>;
  busyLocal: Accessor<boolean>;
  onSubmit: () => void | Promise<void>;
  translate: (key: string) => string;
}

export function OpenDeeplinkPanel(props: OpenDeeplinkPanelProps) {
  return (
    <div class={`${settingsPanelSoftClass} p-4 space-y-3`}>
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-sm font-medium text-dls-text">
            {props.translate("settings.open_deeplink_title")}
          </div>
          <div class="text-xs text-dls-secondary">
            {props.translate("settings.open_deeplink_description")}
          </div>
        </div>
        <button
          type="button"
          class={compactOutlineActionClass}
          onClick={() => {
            props.setOpen((value) => !value);
            props.setStatus(null);
          }}
          disabled={props.busy || props.busyLocal()}
        >
          {props.open()
            ? props.translate("settings.open_deeplink_hide")
            : props.translate("settings.open_deeplink_open")}
        </button>
      </div>

      <Show when={props.open()}>
        <div class="space-y-3">
          <textarea
            value={props.input()}
            onInput={(event) => props.setInput(event.currentTarget.value)}
            rows={3}
            placeholder="aurowork://..."
            class="w-full rounded-xl border border-dls-border bg-dls-surface px-3 py-2 text-xs font-mono text-dls-text outline-none transition focus:border-blue-8"
          />
          <div class="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              class="text-xs h-8 py-0 px-3"
              onClick={() => void props.onSubmit()}
              disabled={props.busy || props.busyLocal() || !props.input().trim()}
            >
              {props.busyLocal()
                ? props.translate("settings.open_deeplink_opening")
                : props.translate("settings.open_deeplink_action")}
            </Button>
            <div class="text-[11px] text-dls-secondary">
              Accepts <span class="font-mono">aurowork://</span>,{" "}
              <span class="font-mono">aurowork-dev://</span>, or a raw supported{" "}
              <span class="font-mono">https://share.example.com/b/...</span> URL.
            </div>
          </div>
        </div>
      </Show>

      <Show when={props.status()}>
        {(value) => <div class="text-xs text-dls-secondary">{value()}</div>}
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: Verify import path resolves**

Look at one existing import for `Button` in `settings.tsx` to confirm the path:

Run: `grep -n 'from.*components/ui/button' "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/app/src/app/pages/settings.tsx"`

If the relative path differs from `"../../components/ui/button"`, update it in the new file to match. (The new file is at `apps/app/src/app/pages/settings/open-deeplink-panel.tsx`, two levels deep from `apps/app/src/app/components/...`, so `../../components/ui/button` is correct.)

- [ ] **Step 3: Typecheck**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm typecheck 2>&1 | tail -5`

Expected: clean (the new file is not yet imported anywhere — that happens in Task 8).

- [ ] **Step 4: Commit**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork"
git add apps/app/src/app/pages/settings/open-deeplink-panel.tsx
git commit -m "$(cat <<'EOF'
feat(app): extract OpenDeeplinkPanel into its own component file

Pure extraction (no behavior change). Sets up the move from Advanced
tab to Debug tab in a follow-up commit. Receives state + handlers
via props so the consuming page (settings.tsx) keeps owning the
debounce/busy/status signals.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 7: Create `<LaunchDiagnosticPanel/>` component

**Files:**
- Create: `apps/app/src/app/pages/settings/launch-diagnostic-panel.tsx`

- [ ] **Step 1: Create the panel**

Create `apps/app/src/app/pages/settings/launch-diagnostic-panel.tsx`:

```tsx
import { Show, createSignal, onMount } from "solid-js";
import { Copy, FolderOpen, Play } from "lucide-solid";
import { Button } from "../../components/ui/button";

const settingsPanelSoftClass =
  "rounded-2xl border border-dls-border/40 bg-dls-hover/20";
const compactOutlineActionClass =
  "inline-flex items-center gap-1.5 rounded-lg border border-dls-border px-2.5 py-1 text-xs text-dls-secondary hover:bg-dls-hover transition";

interface LaunchDiagnosticStatusDto {
  armedOnStartup: boolean;
  logFilePath: string | null;
}

export interface LaunchDiagnosticPanelProps {
  translate: (key: string) => string;
}

export function LaunchDiagnosticPanel(props: LaunchDiagnosticPanelProps) {
  const [logPath, setLogPath] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<LaunchDiagnosticStatusDto>("launch_diagnostic_status");
      setLogPath(status.logFilePath);
    } catch (e) {
      // Not in Tauri runtime or command not registered yet — silent.
      setLogPath(null);
    }
  });

  async function runDiagnostic() {
    setErrorMsg(null);
    const ok = window.confirm(props.translate("settings.launch_diag_confirm"));
    if (!ok) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("arm_launch_diagnostic");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
      // On success the app process exits before this line runs.
    } catch (e) {
      setBusy(false);
      setErrorMsg(String(e));
    }
  }

  async function openFolder() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_launch_log_folder");
    } catch (e) {
      setErrorMsg(String(e));
    }
  }

  async function copyPath() {
    const p = logPath();
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
    } catch {
      // ignore
    }
  }

  return (
    <div class={`${settingsPanelSoftClass} p-4 space-y-3`}>
      <div>
        <div class="text-sm font-medium text-dls-text">
          {props.translate("settings.launch_diag_title")}
        </div>
        <div class="text-xs text-dls-secondary">
          {props.translate("settings.launch_diag_description")}
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          class="text-xs h-8 py-0 px-3"
          onClick={() => void runDiagnostic()}
          disabled={busy()}
        >
          <Play size={13} class="mr-1.5" />
          {busy()
            ? props.translate("settings.launch_diag_running")
            : props.translate("settings.launch_diag_run")}
        </Button>
        <span class="text-[11px] text-dls-secondary">
          {props.translate("settings.launch_diag_run_hint")}
        </span>
      </div>

      <div class="border-t border-dls-border/40 pt-3 space-y-2">
        <div class="text-xs font-medium text-dls-text">
          {props.translate("settings.launch_diag_last")}
        </div>
        <Show
          when={logPath()}
          fallback={
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs text-dls-secondary">
                {props.translate("settings.launch_diag_none")}
              </div>
              <button
                type="button"
                class={compactOutlineActionClass}
                onClick={() => void openFolder()}
              >
                <FolderOpen size={14} class="text-dls-secondary" />
                {props.translate("settings.launch_diag_open_folder")}
              </button>
            </div>
          }
        >
          <div class="text-xs font-mono text-dls-secondary break-all">
            {logPath()}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class={compactOutlineActionClass}
              onClick={() => void copyPath()}
            >
              <Copy size={14} class="text-dls-secondary" />
              {props.translate("settings.launch_diag_copy_path")}
            </button>
            <button
              type="button"
              class={compactOutlineActionClass}
              onClick={() => void openFolder()}
            >
              <FolderOpen size={14} class="text-dls-secondary" />
              {props.translate("settings.launch_diag_open_folder")}
            </button>
          </div>
        </Show>
      </div>

      <Show when={errorMsg()}>
        {(value) => (
          <div class="text-xs text-red-11">{value()}</div>
        )}
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm typecheck 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork"
git add apps/app/src/app/pages/settings/launch-diagnostic-panel.tsx
git commit -m "$(cat <<'EOF'
feat(app): add LaunchDiagnosticPanel component

The panel queries launch_diagnostic_status on mount to fetch the
current launch log file path (if any), shows a "Run launch
diagnostic" primary button that arms the flag and triggers
plugin:process|restart after window.confirm, plus Open folder /
Copy path actions for the last log file.

Not yet wired into settings.tsx — that's the next task.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 8: Restructure Settings tabs — remove Advanced blocks, populate Debug tab

**Files:**
- Modify: `apps/app/src/app/pages/settings.tsx`

- [ ] **Step 1: Delete the two Advanced-area panels**

In `apps/app/src/app/pages/settings.tsx`, locate the `<Show when={isTauriRuntime() && opencodeDevModeEnabled() && props.developerMode}>` block (around line 2061). The block contains:
1. The Open Deeplink panel inline (lines ~2062-2127)
2. The Launch log panel inline (lines ~2128-2166)

DELETE the entire `<Show when={isTauriRuntime() && opencodeDevModeEnabled() && props.developerMode}>...</Show>` outer wrapper and everything inside it.

(The Developer Mode toggle that PRECEDES this Show block, lines ~2028-2060, STAYS in place.)

- [ ] **Step 2: Add new component imports at top of file**

Add to the import block at the top of `settings.tsx`:

```tsx
import { LaunchDiagnosticPanel } from "./settings/launch-diagnostic-panel";
import { OpenDeeplinkPanel } from "./settings/open-deeplink-panel";
```

- [ ] **Step 3: Populate the Debug tab with the new sections**

Locate `<Match when={activeTab() === "debug"}>` (around line 2597). Currently it wraps a `<Show when={props.developerMode}>` block containing the existing debug-report card and other items.

Restructure to insert the new Diagnostics section at the top of the developerMode-guarded section:

```tsx
        <Match when={activeTab() === "debug"}>
          <Show when={props.developerMode}>
            <section>
              {/* === Diagnostics section (new) === */}
              <h3 class="text-sm font-medium text-dls-secondary uppercase tracking-wider mb-4">
                {translate("settings.debug_section_diagnostics")}
              </h3>
              <div class="space-y-4 mb-8">
                <Show when={isTauriRuntime()}>
                  <LaunchDiagnosticPanel translate={translate} />
                </Show>
                <OpenDeeplinkPanel
                  translate={translate}
                  busy={props.busy}
                  open={debugDeepLinkOpen}
                  setOpen={setDebugDeepLinkOpen}
                  input={debugDeepLinkInput}
                  setInput={setDebugDeepLinkInput}
                  status={debugDeepLinkStatus}
                  setStatus={setDebugDeepLinkStatus}
                  busyLocal={debugDeepLinkBusy}
                  onSubmit={submitDebugDeepLink}
                />
              </div>

              {/* === Reset & Recovery section (existing content, regrouped) === */}
              <h3 class="text-sm font-medium text-dls-secondary uppercase tracking-wider mb-4">
                {translate("settings.debug_section_recovery")}
              </h3>

              <div class="space-y-4">
                {/* ... existing debug-report card and everything else stays here UNCHANGED ... */}
```

Keep ALL existing inner content of the Debug tab — debug_report card, debug_startup, sandbox-probe area, etc. Just move them under the new "Reset & Recovery" header.

- [ ] **Step 4: Ensure required state still exists**

The OpenDeeplinkPanel consumes the existing `debugDeepLinkOpen`, `debugDeepLinkInput`, `debugDeepLinkStatus`, `debugDeepLinkBusy` signals and `submitDebugDeepLink` function. These were already declared in settings.tsx (they were used by the Advanced block). Verify they still exist after the Step 1 deletion:

Run: `grep -n 'debugDeepLink\|submitDebugDeepLink' "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/app/src/app/pages/settings.tsx"`

Expected: declarations + the new prop bindings in Step 3 show up; nothing is undefined.

- [ ] **Step 5: Typecheck**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm typecheck 2>&1 | tail -10`

Expected: clean.

- [ ] **Step 6: Commit**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork"
git add apps/app/src/app/pages/settings.tsx
git commit -m "$(cat <<'EOF'
feat(app): consolidate debug tools under Debug tab

Remove the dev-mode-gated panels from the Advanced tab and rebuild
the Debug tab with two sections:
  - Diagnostics: Launch diagnostic + Open Deeplink (newly moved)
  - Reset & Recovery: existing debug report / nuke / migrate buttons

The Developer Mode toggle in Advanced now only controls whether the
Debug tab itself appears. Description microcopy updated accordingly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 9: Add `<LaunchDiagnosticToast/>` and mount in app root

**Files:**
- Create: `apps/app/src/app/components/launch-diagnostic-toast.tsx`
- Modify: `apps/app/src/app/app.tsx` (mount the toast)

- [ ] **Step 1: Create the toast component**

Create `apps/app/src/app/components/launch-diagnostic-toast.tsx`:

```tsx
import { Show, createSignal, onMount } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { FolderOpen, X } from "lucide-solid";
import { isTauriRuntime } from "../utils";
import { useTranslate } from "../../i18n";

interface LaunchDiagnosticStatusDto {
  armedOnStartup: boolean;
  logFilePath: string | null;
}

const TOAST_VISIBLE_MS = 8000;

export function LaunchDiagnosticToast() {
  const [show, setShow] = createSignal(false);
  const translate = useTranslate();
  const navigate = useNavigate();

  onMount(async () => {
    if (!isTauriRuntime()) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const status = await invoke<LaunchDiagnosticStatusDto>(
        "launch_diagnostic_status",
      );
      if (status.armedOnStartup) {
        setShow(true);
        setTimeout(() => setShow(false), TOAST_VISIBLE_MS);
      }
    } catch {
      // Silent — command may not be registered in non-desktop runtime.
    }
  });

  function viewInSettings() {
    setShow(false);
    navigate("/settings?tab=debug");
  }

  async function openFolder() {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_launch_log_folder");
    } catch {
      // ignore
    }
    // Don't dismiss the toast on Open folder — user may still want [View].
  }

  return (
    <Show when={show()}>
      <div class="fixed bottom-4 right-4 z-50 max-w-sm">
        <div class="rounded-2xl border border-dls-border bg-dls-surface shadow-lg p-4 space-y-2">
          <div class="flex items-start justify-between gap-2">
            <div class="text-sm font-medium text-dls-text">
              {translate("settings.launch_diag_toast_title")}
            </div>
            <button
              type="button"
              class="text-dls-secondary hover:text-dls-text"
              onClick={() => setShow(false)}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          <div class="flex items-center gap-2 pt-1">
            <button
              type="button"
              class="text-xs text-blue-11 hover:underline"
              onClick={viewInSettings}
            >
              {translate("settings.launch_diag_toast_view")}
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs text-dls-secondary hover:text-dls-text"
              onClick={() => void openFolder()}
            >
              <FolderOpen size={12} />
              {translate("settings.launch_diag_open_folder")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
```

- [ ] **Step 2: Verify the navigate URL pattern**

Check how settings tab routing works:

Run: `grep -n 'tab=debug\|settingsTab\|setSettingsTab' "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/app/src/app/app.tsx" | head -10`

If the actual URL pattern uses a different query string (e.g. `#settings?tab=debug` or a route param), update the `navigate("/settings?tab=debug")` call accordingly. The Debug tab `"debug"` identifier comes from `tabs.push("debug")` in settings.tsx.

- [ ] **Step 3: Mount the toast in `app.tsx`**

In `apps/app/src/app/app.tsx`, near the root JSX of the main App component (the same level where other globally-mounted elements like dialogs/toast hosts live), import + mount:

```tsx
import { LaunchDiagnosticToast } from "./components/launch-diagnostic-toast";
```

And add `<LaunchDiagnosticToast />` as a sibling at the appropriate root spot (look for existing `<Toaster />`, modal hosts, etc. — group it with them).

If there is no obvious "global UI host" spot in app.tsx, mount it directly inside the top-level returned JSX, e.g. right before the closing tag of the outermost wrapper.

- [ ] **Step 4: Typecheck**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm typecheck 2>&1 | tail -5`

Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork"
git add apps/app/src/app/components/launch-diagnostic-toast.tsx apps/app/src/app/app.tsx
git commit -m "$(cat <<'EOF'
feat(app): add LaunchDiagnosticToast and mount at app root

On boot, queries launch_diagnostic_status. If armedOnStartup is
true (meaning this launch was triggered by Run launch diagnostic),
shows a corner toast for 8 seconds with View / Open folder actions.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

### Task 10: End-to-end manual verification + summary commit

**Files:** none modified — this is a manual test pass.

- [ ] **Step 1: Build the whole project**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm typecheck && cd apps/desktop/src-tauri && cargo build --lib`

Expected: both clean.

- [ ] **Step 2: Run full backend test suite**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri" && cargo test --lib 2>&1 | tail -10`

Expected: all tests pass (17 from launch_log + diagnostic_flag, plus existing).

- [ ] **Step 3: Launch app and walk through the verification checklist**

Run: `cd "/Users/yangxiao/Documents/github repos/Agent/aurowork" && pnpm dev`

Walk through every item from the spec's Testing Strategy / Manual verification section:

1. App starts cleanly.
2. Settings → Advanced → click "Enable Developer Mode" → Debug tab appears in tab bar.
3. Switch to Debug tab → see two sections: **Diagnostics** (containing Launch 阶段诊断 panel + Open Deeplink panel) and **Reset & Recovery** (containing existing debug report card, etc.).
4. Verify Open Deeplink panel works as before (paste a URL, click Open).
5. Click "Run launch diagnostic" button → browser-style `confirm()` dialog appears.
6. Confirm → app restarts cleanly.
7. After restart: bottom-right toast appears with "Launch diagnostic captured" and View / Open folder buttons.
8. Check that `~/Library/Logs/com.nld.aurowork.dev/launch-*.log` (or platform equivalent) contains a NEW file with all 5 tags (`shell`, `ui`, `orchestr`, `engine`, `server`).
9. Settings → Debug → Launch diagnostic panel shows the new log path under "Last diagnostic".
10. Quit the app, restart manually → no toast appears, no new launch log file written (flag was consumed).
11. Click toast `[View]` → should navigate to Settings → Debug tab.

Document any failures here as new commits or issues; expected outcome is all 11 items pass.

- [ ] **Step 4: Update DEV_PROGRESS.md**

Edit `.claude/DEV_PROGRESS.md` to reflect the completed work (append a new section dated today summarizing the spec, plan, and commits).

- [ ] **Step 5: Commit progress note**

```bash
cd "/Users/yangxiao/Documents/github repos/Agent/aurowork"
git add .claude/DEV_PROGRESS.md
git commit -m "docs: record debug-tab + launch-diagnostic implementation progress"
```

- [ ] **Step 6: Push and update PR**

Run: `git push`

If continuing on the existing `feat/launch-logging-dev-mode` branch, PR #34 updates automatically. Otherwise create a new PR with `gh pr create` summarizing the spec.

---

## Self-Review Notes

**Spec coverage:**
- Q1 one-shot capture → Task 1 (`take()` deletes on read) ✓
- Q2 confirm dialog → Task 7 (`window.confirm`) ✓
- Q3 corner toast → Task 9 ✓
- Q5 Debug tab regrouping → Task 8 (two section headers) ✓
- Q6 Developer Mode toggle stays in Advanced → Task 8 Step 1 (only deletes inner Show, not toggle) ✓
- Q7 dedicated flag file → Task 1 ✓
- Q8 file presence → Tasks 7 + 9 (status DTO carries logFilePath) ✓
- Q9 dev/prod parity → Task 3 (`OR` semantics) ✓
- Spec §3 error handling → Task 7 surfaces errors via local errorMsg signal; Task 9 silent-on-failure ✓
- Spec §4 testing strategy → Tasks 1, 2 cover Rust units; Task 10 covers manual ✓

**Placeholders:** none.

**Type consistency:** `LaunchDiagnosticStatus` (Rust struct) and `LaunchDiagnosticStatusDto` (Serialize) defined in Task 4; consumed by Tasks 7 + 9. Field names use `armedOnStartup` / `logFilePath` (camelCase) on the TS side thanks to `#[serde(rename_all = "camelCase")]`.
