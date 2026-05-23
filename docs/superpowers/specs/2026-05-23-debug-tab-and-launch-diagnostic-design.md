# Debug Tab Consolidation + Launch Diagnostic Design

**Status**: Draft
**Date**: 2026-05-23
**Branch**: TBD (next: `feat/debug-tab-launch-diagnostic`)

## Goal

1. Consolidate developer/debug-only UI under a single **Debug** Settings tab (gated by an in-app "Developer Mode" toggle).
2. Replace the existing "Launch log" panel with a **Launch 阶段诊断 (Launch diagnostics)** panel that lets production-build users capture one full startup log on demand by triggering a restart.
3. Move "Open Deeplink" out of the Advanced tab and into the Debug tab.

## Background

After landing the unified launch log (PR #34), three issues emerged:

1. **Two "dev mode" concepts confuse users.** The in-app *Developer Mode* toggle (transient signal) only shows UI affordances; the launch log + several panels also require the backend `AUROWORK_DEV_MODE=1` environment variable, which production `.exe` users cannot set. Toggling Developer Mode in a production build appears to "do nothing" because the gated panels also require the env var.
2. **Debug tooling is scattered.** "Open Deeplink" and the launch log panel live in the Advanced tab; reset/nuke/migrate live in a separate Debug tab.
3. **Production users have no path to capture a launch log.** Launch logs are the most valuable artifact for debugging startup crashes, yet the only way to enable them is to relaunch via the dev CLI script.

## Scope

**In scope**

- Move "Open Deeplink" panel from Advanced → Debug tab.
- Move "Launch log" panel from Advanced → Debug tab.
- Rewrite the Launch log panel as **Launch 阶段诊断**: one button to arm + restart, one button to open the log folder, plus a "Last diagnostic" display.
- Add a one-shot persistent flag (`launch-diagnostic.flag`) under app data dir to signal "next launch should write a launch log file even if dev mode is off".
- Add `arm_launch_diagnostic` and `launch_diagnostic_status` Tauri commands.
- Show a corner toast on the next launch when armed-on-startup is true.
- Group Debug tab into two sections: **Diagnostics** and **Reset & Recovery**.
- Microcopy update on the Developer Mode toggle in Advanced.

**Out of scope** (explicitly rejected during brainstorming)

- Renaming `AUROWORK_DEV_MODE` env var.
- Persistent / sticky launch-log toggle (Q1-A: one-shot only).
- Auto-opening the log folder after restart (Q3-B: toast only).
- Crash-detection / "last diagnostic = pending" state machine (Q8-A: rely on file presence).
- Hiding the diagnostic button in dev binaries (Q9-C: identical behavior in dev/prod).

## Architecture

### Lifecycle

```
T0  User: Settings → Advanced → toggle "Enable Developer Mode"
       └─ developerMode() = true (frontend signal, not persisted)
       └─ Settings tab bar gains a "Debug" tab

T1  User: switch to Debug tab
       └─ Sees "Launch 阶段诊断" panel
       └─ Panel invokes launch_diagnostic_status to populate "Last diagnostic"

T2  User: clicks ▶ Run launch diagnostic
       └─ Frontend shows confirm dialog
       └─ On confirm:
              invoke("arm_launch_diagnostic")  → writes flag file
              invoke("plugin:process|restart") → app exits + relaunches

T3  Restart → lib::run().setup():
       └─ diagnostic_armed = diagnostic_flag::take(&app_data_dir)
                              ^ reads flag, deletes it (atomic for our purposes)
       └─ log_enabled = dev_mode::is_enabled() OR diagnostic_armed
       └─ LaunchLogAggregator::init(..., log_enabled)
       └─ app.manage(LaunchDiagnosticStatus { armed_on_startup: diagnostic_armed })

T4  Frontend bootstrap completes:
       └─ <LaunchDiagnosticToast/> mounts, invokes launch_diagnostic_status
       └─ If armed_on_startup: show bottom-right toast for 8s
              "Launch diagnostic captured  [View] [Open folder] [×]"
       └─ [View] navigates to Settings → Debug

T5  Subsequent normal launch:
       └─ diagnostic_flag::take() = false (already consumed at T3)
       └─ log_enabled = false → no launch log written, no toast
```

### Invariants

1. **Flag is one-shot.** `take()` reads + deletes in a single function. The next launch sees no flag.
2. **Identical behavior in dev/prod binaries.** In a dev binary (`AUROWORK_DEV_MODE=1`), pressing the button still arms + restarts; `log_enabled` evaluates to `true OR true`; the resulting log file is indistinguishable from any other dev-mode launch log.
3. **launch_log infrastructure untouched in its core.** The only change is to `init()`'s signature — it now accepts an `enabled: bool` parameter computed by the caller instead of internally calling `dev_mode::is_enabled()`.
4. **Toast is per-launch, never persisted.** If the user closes the app and reopens, the toast does not return.

## Components

### Backend (4 units)

#### B1 — `diagnostic_flag` module (new)

`src-tauri/src/diagnostic_flag.rs`:

```rust
//! One-shot flag persisted between app launches to signal
//! "the next launch should write a launch log file even if dev mode is off".

use std::fs;
use std::path::{Path, PathBuf};

const FLAG_FILENAME: &str = "launch-diagnostic.flag";

pub fn flag_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(FLAG_FILENAME)
}

/// Set the flag. Idempotent — overwrites if already present.
pub fn set(app_data_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(app_data_dir)?;
    fs::write(flag_path(app_data_dir), b"1")
}

/// Atomically consume the flag: returns true if it existed (and deletes it).
/// Returns false if the flag was not set.
pub fn take(app_data_dir: &Path) -> bool {
    let path = flag_path(app_data_dir);
    if !path.exists() {
        return false;
    }
    // Best-effort delete; even if delete fails, return true so the launch
    // still gets logged (we'll just clear next time).
    let _ = fs::remove_file(&path);
    true
}
```

Responsibilities: pure IO, no business logic. Three functions.

Tests: `set_then_take_returns_true_and_deletes`, `take_on_missing_returns_false`, `take_twice_in_a_row_second_returns_false`.

#### B2 — `launch_log::mod` signature change

Change `LaunchLogAggregator::init`:

```rust
// Before
pub fn init(&self, log_dir: &Path, app_version: &str, auro_version: &str, platform: &str) {
    if !dev_mode::is_enabled() { return; }
    // ...
}

// After
pub fn init(&self, log_dir: &Path, app_version: &str, auro_version: &str,
            platform: &str, enabled: bool) {
    if !enabled { return; }
    // ...
}
```

Also remove the `if !dev_mode::is_enabled() { return; }` check inside `append()` — the `guard.as_ref().is_some()` check already short-circuits when init was a no-op, so this is dead-weight that would now incorrectly drop entries during diagnostic launches when `dev_mode` is off.

Test added: `init_with_enabled_false_makes_append_noop` — call `init(..., false)` then `append(...)`, verify no file created and `path()` returns None.

#### B3 — `lib.rs::run().setup()` integration

```rust
let aggregator = LaunchLogAggregator::default();

let diagnostic_armed = if let Ok(data_dir) = app.path().app_data_dir() {
    diagnostic_flag::take(&data_dir)
} else {
    false
};
let log_enabled = dev_mode::is_enabled() || diagnostic_armed;

if let Ok(log_dir) = app.path().app_log_dir() {
    let app_version = env!("CARGO_PKG_VERSION");
    let auro_version = option_env!("AUROWORK_AURO_VERSION").unwrap_or("unknown");
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    aggregator.init(&log_dir, app_version, auro_version, &platform, log_enabled);
}

aggregator.append(/* shell starting line, unchanged */);
app.manage(aggregator.clone());
app.manage(LaunchDiagnosticStatus { armed_on_startup: diagnostic_armed });
launch_log::install_global(aggregator);
```

`LaunchDiagnosticStatus` struct (defined in `commands/launch_log.rs` alongside the command):

```rust
pub struct LaunchDiagnosticStatus {
    pub armed_on_startup: bool,
}
```

#### B4 — Two new Tauri commands

`src-tauri/src/commands/launch_log.rs` additions:

```rust
#[tauri::command]
pub fn arm_launch_diagnostic(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    crate::diagnostic_flag::set(&dir).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct LaunchDiagnosticStatusDto {
    pub armed_on_startup: bool,
    pub log_file_path: Option<String>,
}

#[tauri::command]
pub fn launch_diagnostic_status(
    status: tauri::State<'_, LaunchDiagnosticStatus>,
    agg: tauri::State<'_, LaunchLogAggregator>,
) -> LaunchDiagnosticStatusDto {
    LaunchDiagnosticStatusDto {
        armed_on_startup: status.armed_on_startup,
        log_file_path: agg.path().map(|p| p.to_string_lossy().to_string()),
    }
}
```

Register in `lib.rs` `invoke_handler![]`: `arm_launch_diagnostic, launch_diagnostic_status`.

### Frontend (3 units)

#### F1 — `<LaunchDiagnosticPanel/>` (new)

`apps/app/src/app/pages/settings/launch-diagnostic-panel.tsx`:

```tsx
export function LaunchDiagnosticPanel() {
  const [logPath, setLogPath] = createSignal<string | null>(null);
  const [armed, setArmed] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  onMount(async () => {
    if (!isTauriRuntime()) return;
    const s = await invoke<LaunchDiagnosticStatusDto>("launch_diagnostic_status");
    setLogPath(s.log_file_path);
    setArmed(s.armed_on_startup);
  });

  async function runDiagnostic() {
    const confirmed = await confirm(translate("settings.launch_diag_confirm"));
    if (!confirmed) return;
    setBusy(true);
    try {
      await invoke("arm_launch_diagnostic");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setBusy(false);
      // surface error via existing toast/error path
    }
  }

  return (
    <Panel>
      <Title>{translate("settings.launch_diag_title")}</Title>
      <Description>{translate("settings.launch_diag_description")}</Description>
      <Button variant="primary" disabled={busy()} onClick={runDiagnostic}>
        {busy() ? translate("settings.launch_diag_running") : translate("settings.launch_diag_run")}
      </Button>
      <Divider />
      <Show
        when={logPath()}
        fallback={
          <div>
            <span>{translate("settings.launch_diag_none")}</span>
            <Button onClick={() => invoke("open_launch_log_folder")}>
              {translate("settings.launch_diag_open_folder")}
            </Button>
          </div>
        }
      >
        <LastDiagnosticInfo
          path={logPath()!}
          onOpenFolder={() => invoke("open_launch_log_folder")}
          onCopy={() => navigator.clipboard.writeText(logPath()!)}
        />
      </Show>
    </Panel>
  );
}
```

#### F2 — Settings integration

Changes to `apps/app/src/app/pages/settings.tsx`:

- **Delete** the Advanced-area `<Show when={isTauriRuntime() && opencodeDevModeEnabled() && props.developerMode}>` block currently containing the "Open Deeplink" panel and "Launch log" panel.
- **Keep** the Advanced-area Developer Mode toggle button. Update the description i18n key `settings.developer_mode_description` to reflect that toggling shows the Debug tab.
- **Extract** the "Open Deeplink" panel into a new component `apps/app/src/app/pages/settings/open-deeplink-panel.tsx` to keep `settings.tsx` from growing.
- **In** the Debug tab `<Match when={activeTab() === "debug"}>` block, restructure as:
  ```tsx
  <Match when={activeTab() === "debug"}>
    {/* Diagnostics group */}
    <SectionHeader>{translate("settings.debug_section_diagnostics")}</SectionHeader>
    <LaunchDiagnosticPanel />
    <OpenDeeplinkPanel {...existingProps} />

    {/* Reset & Recovery group */}
    <SectionHeader>{translate("settings.debug_section_recovery")}</SectionHeader>
    {/* Existing reset/nuke/migrate/mcp-auth blocks, unchanged */}
  </Match>
  ```
- `SectionHeader` is a small inline styled `<div>` (sticky to existing tailwind utility classes).

#### F3 — `<LaunchDiagnosticToast/>` (new)

`apps/app/src/app/components/launch-diagnostic-toast.tsx`. Mounted in `app.tsx` near the root:

```tsx
function LaunchDiagnosticToast() {
  const [show, setShow] = createSignal(false);
  const [path, setPath] = createSignal<string | null>(null);

  onMount(async () => {
    if (!isTauriRuntime()) return;
    try {
      const s = await invoke<LaunchDiagnosticStatusDto>("launch_diagnostic_status");
      if (s.armed_on_startup) {
        setPath(s.log_file_path);
        setShow(true);
        setTimeout(() => setShow(false), 8000);
      }
    } catch {}
  });

  return (
    <Show when={show()}>
      <Toast position="bottom-right">
        {translate("settings.launch_diag_toast_title")}
        <ToastAction onClick={navigateToDebugTab}>
          {translate("settings.launch_diag_toast_view")}
        </ToastAction>
        <ToastAction onClick={() => invoke("open_launch_log_folder")}>
          {translate("settings.launch_diag_open_folder")}
        </ToastAction>
        <CloseButton onClick={() => setShow(false)} />
      </Toast>
    </Show>
  );
}
```

`navigateToDebugTab()`: reuse existing routing + `setSettingsTab("debug")`.

### Dependency graph

```
       ┌─────────────────────────┐
       │  diagnostic_flag (B1)   │  ← no deps
       └────────┬────────────────┘
                │
                ▼
       ┌─────────────────────────┐
       │  lib.rs setup (B3)      │  ← takes flag, computes log_enabled
       │  + LaunchDiagnosticStatus│
       └────────┬────────────────┘
                │ Tauri state
                ▼
       ┌─────────────────────────┐
       │  commands::launch_log   │  arm + status
       │  (B4)                   │
       └────────┬────────────────┘
                │ invoke
                ▼
       ┌─────────────────────────┐     ┌─────────────────────────┐
       │  LaunchDiagnosticPanel  │     │  LaunchDiagnosticToast  │
       │  (F1)                   │     │  (F3)                   │
       └─────────────────────────┘     └─────────────────────────┘
                │                                │
                └─────────── settings.tsx ───────┘
                            (F2 integration)
```

## Error Handling

| Failure point | Behavior |
|---------------|----------|
| `app_data_dir()` not available | `take()` returns false (treated as not armed); `set()` command returns Err; frontend toast "Cannot enable diagnostic" |
| `set()` fails (disk full / permission) | Command returns Err; frontend does NOT call relaunch; toast surfaces error |
| `take()` reads flag but `remove_file` fails | Still returns true (capture this launch); next launch will `take()` again — at worst this writes one extra diagnostic log. Self-healing as soon as delete succeeds. |
| `relaunch()` fails | Frontend toast "Restart failed: <msg>". Flag already set, so a manual restart by the user still produces the diagnostic log — behavior remains consistent. |
| `LaunchLogAggregator.init` fails to write file | Existing `eprintln!` path. Toast still shows (armed_on_startup = true) but `logPath` is None; the "Last diagnostic" panel falls back to "log file unavailable". |
| Panic during setup | Flag was consumed; file may be partially written; `install_panic_hook` records the panic. User restarts manually, sees partial log in the panel. |
| Toast active during route change | 8-second timer; `[View]` action dismisses the toast; `[Open folder]` does NOT dismiss (user may still want `[View]`). |

## Testing Strategy

### Rust unit tests (4 new)

- `diagnostic_flag::set_then_take_returns_true_and_deletes`
- `diagnostic_flag::take_on_missing_returns_false`
- `diagnostic_flag::take_twice_in_a_row_second_returns_false`
- `launch_log::init_with_enabled_false_makes_append_noop`

### Manual verification (PR test plan)

1. Production binary (no `AUROWORK_DEV_MODE`) starts → no new launch log file written.
2. Settings → Advanced → toggle Developer Mode → Debug tab appears.
3. Debug tab → Diagnostics section shows Launch 诊断 panel + Open Deeplink panel.
4. Reset & Recovery section shows existing nuke / reset / migrate / mcp-auth buttons.
5. Click Run launch diagnostic → confirm dialog appears.
6. Confirm → app restarts cleanly.
7. After restart, bottom-right toast appears: "Launch diagnostic captured".
8. Log folder contains a new `launch-*.log`; all 5 tags (`shell`, `ui`, `orchestr`, `engine`, `server`) present.
9. Re-open Settings → Debug → "Last diagnostic" shows the new file.
10. Close and re-open the app → no new launch log, no toast.
11. In a dev binary (`pnpm dev`), repeat 5–9 — behavior identical.

## File List + Estimated LOC

**Backend (Rust)**

| File | Operation | LOC |
|------|-----------|-----|
| `src-tauri/src/diagnostic_flag.rs` | new | ~30 + tests ~40 |
| `src-tauri/src/launch_log/mod.rs` | modify `init` signature; remove `dev_mode` check from `append` | ~10 |
| `src-tauri/src/commands/launch_log.rs` | new commands + DTO + status struct | ~30 |
| `src-tauri/src/lib.rs` | setup uses take + `log_enabled`; manage new state; register commands | ~15 |

**Frontend (TS/TSX)**

| File | Operation | LOC |
|------|-----------|-----|
| `apps/app/src/app/pages/settings/launch-diagnostic-panel.tsx` | new | ~120 |
| `apps/app/src/app/pages/settings/open-deeplink-panel.tsx` | extract from settings.tsx | ~80 |
| `apps/app/src/app/pages/settings.tsx` | delete two Advanced blocks; rebuild Debug tab with section headers; description microcopy | -100 / +30 |
| `apps/app/src/app/components/launch-diagnostic-toast.tsx` | new | ~60 |
| `apps/app/src/app/app.tsx` | mount toast at root | ~3 |
| `apps/app/src/i18n/locales/{en,zh,vi,pt-BR,...}.ts` | ~12 keys × 5 locales | ~60 |

**Total**: ~370 LOC net new / ~100 LOC deleted / 4 new Rust unit tests.

## i18n Keys

```
settings.developer_mode_description  → "Show the Debug tab with diagnostic tools."
settings.tab_desc_debug              → "Diagnostics and recovery tools for advanced users."

settings.debug_section_diagnostics   = "Diagnostics"
settings.debug_section_recovery      = "Reset & Recovery"

settings.launch_diag_title           = "Launch diagnostics"  (zh: "Launch 阶段诊断")
settings.launch_diag_description     = "Capture a full startup log (shell / ui / orchestr / engine / server)."
settings.launch_diag_run             = "Run launch diagnostic (will restart app)"
settings.launch_diag_running         = "Restarting..."
settings.launch_diag_confirm         = "This will restart AuroWork to capture a full startup log. Any in-progress work may be lost. Continue?"
settings.launch_diag_last            = "Last diagnostic"
settings.launch_diag_none            = "No diagnostic log yet."
settings.launch_diag_open_file       = "Open file"
settings.launch_diag_open_folder     = "Open folder"
settings.launch_diag_copy_path       = "Copy path"

settings.launch_diag_toast_title     = "Launch diagnostic captured"
settings.launch_diag_toast_view      = "View"
```

## Open Questions

None. All clarifications resolved during brainstorming (Q1–Q9).

## Next Steps

After spec approval: invoke `superpowers:writing-plans` to produce a task-by-task implementation plan.
