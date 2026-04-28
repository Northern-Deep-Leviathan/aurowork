# OpenCode → Auro Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename every `opencode`-flavored identifier under our ownership to `auro` (preserving case), in lockstep across the desktop Tauri shell, frontend, aurowork-server sidecar, and aurowork-orchestrator daemon, without disturbing the upstream OpenCode binary's contract surface.

**Architecture:** Phased lockstep rename. Phase A renames pure Rust internals in the desktop crate. Phase B renames the Tauri command surface in lockstep with the SolidJS frontend. Phase C renames the desktop ↔ aurowork-server CLI/env contract in lockstep with `apps/server`. Phase D renames the desktop ↔ orchestrator daemon JSON contract in lockstep with the daemon repo and a constants pin bump. Phase E sweeps docs. Phase F validates CI. No on-disk migration shim — existing dev installs wipe state.

**Tech Stack:** Rust (Tauri 2.x), TypeScript (SolidJS, Bun), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-04-28-opencode-to-auro-rename-design.md`

**Branch context:** Work continues from `personal/mazziruso/build-rename-auro` (the unstaged-then-committed work-in-progress on top of `personal/mazziruso/enhance-log-build`). Tasks assume the diff in that branch is already present.

**Bucket-4 string allowlist (NEVER rename in any task):**
- `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_CLIENT` env-var literals
- The substring `.opencode/` and the filenames `opencode.json`, `opencode.jsonc`, `opencode.db`
- The npm package `@opencode-ai/sdk` and any of its exports
- The `providerID: "opencode"` literal in `apps/app/src/app/constants.ts:11`
- The serialized JSON string value `"opencode"` for `RemoteType` (the *Rust enum variant* renames; the wire string stays via `#[serde(rename = "opencode")]`)
- Path segments inside opencode XDG dirs (`.config/opencode`, `Library/Caches/opencode`, etc. in `commands/misc.rs`, `commands/skills.rs`, `commands/command_files.rs`, `engine/spawn.rs`, `apps/server/src/{commands,skills,plugins,opencode-db,mcp}.ts`)

If a task tells you to rename one of these, stop and re-read the spec.

---

## File Inventory

### Rust crate (`apps/desktop/src-tauri/`)
- **Modify:** `src/types.rs`, `src/config.rs`, `src/lib.rs`, `src/commands/config.rs`, `src/commands/misc.rs`, `src/commands/orchestrator.rs`, `src/commands/engine.rs`, `src/commands/aurowork_server.rs`, `src/engine/spawn.rs`, `src/engine/manager.rs`, `src/engine/doctor.rs`, `src/orchestrator/mod.rs`, `src/aurowork_server/spawn.rs`, `src/aurowork_server/mod.rs`, `src/workspace/watch.rs`

### Frontend (`apps/app/`)
- **Modify:** `src/app/lib/tauri.ts`
- **Rename:** `src/app/lib/opencode.ts` → `src/app/lib/auro.ts` (+ all importers)

### Server (`apps/server/`)
- **Modify:** `src/cli.ts`, `src/config.ts`, `src/server.ts`, `src/types.ts`
- **Rename:** `src/opencode-connection.ts` → `src/auro-connection.ts`, `src/opencode-db.ts` → `src/auro-db.ts`, `src/portable-opencode.ts` → `src/portable-auro.ts` (+ corresponding `.test.ts` files + all importers)

### Build / CI / docs
- **Modify:** `constants.json` (orchestrator version pin bump in Phase D), `CODEBASE.md`, `ARCHITECTURE.md`, `AGENTS.md`, `PRODUCT.md`, `INFRASTRUCTURE.md`, `.claude/CLAUDE.md`, `.claude/DEV_PROGRESS.md`
- **Verify:** `.github/workflows/build-desktop.yml` (already renamed in WIP)

---

## Phase A — Bucket 1 internals (desktop Rust, no behavior change)

### Task A1: Rename `OpencodeConfigFile` struct + consumers

**Files:**
- Modify: `apps/desktop/src-tauri/src/types.rs` (struct `OpencodeConfigFile` ~line 212)
- Modify: `apps/desktop/src-tauri/src/config.rs` (fns `read_opencode_config`, `write_opencode_config`, `resolve_opencode_config_path`, `opencode_config_candidates`, `OpencodeConfigFile` import)
- Modify: `apps/desktop/src-tauri/src/commands/config.rs` (imports + Tauri command fns — rename here even though command surface rename is Phase B; bodies just call inner fns)

- [ ] **Step 1: Rename the struct in `types.rs`**

In `apps/desktop/src-tauri/src/types.rs`, change:
```rust
pub struct OpencodeConfigFile {
```
to:
```rust
pub struct AuroConfigFile {
```
Leave `#[serde(rename_all = "camelCase")]` and all field names unchanged (no `opencode` substrings in fields per current code).

- [ ] **Step 2: Rename inner config fns in `config.rs`**

In `apps/desktop/src-tauri/src/config.rs`:
- `use crate::types::{ExecResult, OpencodeConfigFile};` → `use crate::types::{ExecResult, AuroConfigFile};`
- `fn opencode_config_candidates(` → `fn auro_config_candidates(`
- `pub fn resolve_opencode_config_path(` → `pub fn resolve_auro_config_path(`
- inside it: `let (jsonc_path, json_path) = opencode_config_candidates(...)` → `auro_config_candidates(...)`
- `pub fn read_opencode_config(` → `pub fn read_auro_config(`
- inside it: `resolve_opencode_config_path(...)` → `resolve_auro_config_path(...)`; `Ok(OpencodeConfigFile { ... })` → `Ok(AuroConfigFile { ... })`
- `pub fn write_opencode_config(` → `pub fn write_auro_config(`
- inside it: `resolve_opencode_config_path(...)` → `resolve_auro_config_path(...)`

**Do NOT change** the string literals `"opencode.jsonc"`, `"opencode.json"`, `.join("opencode")` (lines ~17, 28, 29) — those are bucket 4 (the upstream binary owns the file layout).

- [ ] **Step 3: Update `commands/config.rs` imports and inner calls**

In `apps/desktop/src-tauri/src/commands/config.rs`, change:
```rust
use crate::config::{read_opencode_config as read_inner, write_opencode_config as write_inner};
use crate::types::{ExecResult, OpencodeConfigFile};
```
to:
```rust
use crate::config::{read_auro_config as read_inner, write_auro_config as write_inner};
use crate::types::{ExecResult, AuroConfigFile};
```
And update both Tauri command fn return-type annotations from `Result<OpencodeConfigFile, String>` → `Result<AuroConfigFile, String>`. Leave the `#[tauri::command]` fn names (`read_opencode_config`, `write_opencode_config`) unchanged in this task — they rename in Phase B.

- [ ] **Step 4: Verify**

Run: `cargo check -p aurowork`
Expected: clean compile. If `OpencodeConfigFile` is referenced from another file, fix the import there too.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/types.rs apps/desktop/src-tauri/src/config.rs apps/desktop/src-tauri/src/commands/config.rs
git commit -m "refactor(desktop): rename OpencodeConfigFile and config fns to Auro"
```

---

### Task A2: Rename `OrchestratorOpencodeState` and orchestrator type fields

**Files:**
- Modify: `apps/desktop/src-tauri/src/types.rs` (struct `OrchestratorOpencodeState` ~line 124, and fields `opencode` in `OrchestratorBinaries` ~143, `opencode_source` ~154, `opencode` in `OrchestratorHealth` ~177)
- Modify: `apps/desktop/src-tauri/src/orchestrator/mod.rs` (struct `OrchestratorAuthFile` already has `auro_username/auro_password` from WIP; ensure `OrchestratorHealth.opencode` reference matches — update the field name there)

> **Bucket-3 note:** These struct field renames are paired with the orchestrator daemon JSON contract (Phase D). Doing the Rust-side rename now is harmless because `#[serde(rename_all = "camelCase")]` will look for `auro*` keys — the daemon will still write `opencode*` until Phase D. **This means orchestrator handshake will be broken between this task and Phase D completion.** Accept that or hold this task until Phase D — see Plan note at top of Phase D. We do it now to keep the desktop crate compiling cleanly.

Actually: **defer this task to Phase D (D3)**. We do not modify these structs in Phase A.

- [ ] **Step 1: No-op — task moved to Phase D3**

Skip this task. Mark complete and proceed to A3.

---

### Task A3: Rename `OpencodeCommand` struct

**Files:**
- Modify: `apps/desktop/src-tauri/src/types.rs` (struct `OpencodeCommand` ~line 347)
- Modify: any consumers (grep first)

- [ ] **Step 1: Locate consumers**

Run: `grep -rn "OpencodeCommand" apps/desktop/src-tauri/src`
Expected: usages in `types.rs` and likely `commands/command_files.rs` or similar.

- [ ] **Step 2: Rename**

In `types.rs`: `pub struct OpencodeCommand {` → `pub struct AuroCommand {`. In every consumer found in Step 1, replace `OpencodeCommand` → `AuroCommand`.

Leave `#[serde(rename_all = "camelCase")]` and all field names unchanged (assuming none contain `opencode`; verify with `grep "opencode" apps/desktop/src-tauri/src/types.rs` after edit and confirm only the struct names remain in scope).

- [ ] **Step 3: Verify and commit**

```bash
cargo check -p aurowork
git add -A apps/desktop/src-tauri/src/
git commit -m "refactor(desktop): rename OpencodeCommand to AuroCommand"
```

---

### Task A4: Rename `RemoteType::Opencode` enum variant (preserving wire string)

**Files:**
- Modify: `apps/desktop/src-tauri/src/types.rs` (enum `RemoteType` ~line 285, default impl ~line 291)

**Critical:** The serialized form `"opencode"` MUST be preserved (`apps/server/src/types.ts:3` defines `type RemoteType = "opencode" | "aurowork"` — this is a cross-process contract and is bucket 4 for the *string value*). We rename the Rust identifier only.

- [ ] **Step 1: Rename the enum variant with explicit serde rename**

In `apps/desktop/src-tauri/src/types.rs`, find:
```rust
pub enum RemoteType {
    ...
    Opencode,
    ...
}
```
and change to:
```rust
pub enum RemoteType {
    ...
    #[serde(rename = "opencode")]
    Auro,
    ...
}
```

(Preserve any other variants and their existing serde attributes. If the enum already has `#[serde(rename_all = "...")]` at the container level, the per-variant `#[serde(rename = "opencode")]` overrides it for this variant.)

- [ ] **Step 2: Update the default impl and any other internal references**

In the same file (~line 291), change `RemoteType::Opencode` → `RemoteType::Auro`. Then:

Run: `grep -rn "RemoteType::Opencode" apps/desktop/src-tauri/src`
Expected: empty.

Run: `grep -rn "RemoteType::Auro\b" apps/desktop/src-tauri/src` (to confirm the new variant compiles where the old was used).

- [ ] **Step 3: Verify wire compatibility**

Add a serde round-trip test to `apps/desktop/src-tauri/src/types.rs` (or its test module if one exists; otherwise create `#[cfg(test)] mod tests` at the bottom of the file):

```rust
#[cfg(test)]
mod remote_type_serde_tests {
    use super::RemoteType;

    #[test]
    fn auro_variant_serializes_as_opencode_string() {
        let json = serde_json::to_string(&RemoteType::Auro).expect("serialize");
        assert_eq!(json, "\"opencode\"");
    }

    #[test]
    fn opencode_string_deserializes_to_auro_variant() {
        let value: RemoteType = serde_json::from_str("\"opencode\"").expect("deserialize");
        assert!(matches!(value, RemoteType::Auro));
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p aurowork remote_type_serde_tests -- --nocapture`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/types.rs
git commit -m "refactor(desktop): rename RemoteType::Opencode to Auro, preserve wire string"
```

---

### Task A5: Rename `engine/spawn.rs` local `opencode_config_dir` var

**Files:**
- Modify: `apps/desktop/src-tauri/src/engine/spawn.rs` (~lines 18, 36, 45)

- [ ] **Step 1: Rename the field on the local struct**

In `apps/desktop/src-tauri/src/engine/spawn.rs`, locate the struct holding `opencode_config_dir: PathBuf` (~line 18). Rename:
- field declaration: `opencode_config_dir: PathBuf,` → `auro_config_dir: PathBuf,`
- the constructor literal at ~line 36: `opencode_config_dir: root_dir.join("config").join("opencode"),` → `auro_config_dir: root_dir.join("config").join("opencode"),` (the path-segment string `"opencode"` is bucket 4 — keep it; only the field name changes)
- the consumer at ~line 45 referencing `&paths.opencode_config_dir` → `&paths.auro_config_dir`

- [ ] **Step 2: Verify and commit**

```bash
cargo check -p aurowork
git add apps/desktop/src-tauri/src/engine/spawn.rs
git commit -m "refactor(desktop): rename engine spawn opencode_config_dir field to auro_config_dir"
```

---

### Task A6: Final desktop-internal grep audit

**Files:**
- Read-only: `apps/desktop/src-tauri/src/`

- [ ] **Step 1: Grep for remaining bucket-1 strings**

Run:
```bash
grep -rn "opencode" apps/desktop/src-tauri/src \
  | grep -vE 'OPENCODE_SERVER_USERNAME|OPENCODE_SERVER_PASSWORD|OPENCODE_CLIENT|@opencode-ai|"opencode"|opencode\.json|opencode\.jsonc|opencode\.db|\.opencode/|join\("opencode"\)|join\("\.opencode"\)|//.*[Oo]penCode'
```

Categorize each hit:
- If it's a Tauri command name, command arg, or `Serialize`-derived field → defer to Phase B.
- If it's an aurowork-server flag/env producer (in `aurowork_server/spawn.rs`/`mod.rs`) → defer to Phase C.
- If it's an orchestrator struct field (in `orchestrator/mod.rs` or `types.rs` orchestrator structs) → defer to Phase D.
- If it's a comment, internal var, or internal struct field with no cross-process consumer → rename now in this task.

- [ ] **Step 2: Apply remaining bucket-1 renames**

For each hit categorized "rename now": apply the case-preserving rename (`opencode`→`auro`, `Opencode`→`Auro`, `OPENCODE`→`AURO`).

- [ ] **Step 3: Verify and commit**

```bash
cargo check -p aurowork && cargo test -p aurowork
git add -A apps/desktop/src-tauri/src/
git commit -m "refactor(desktop): final bucket-1 internal rename sweep"
```

---

## Phase B — Bucket 2 Tauri command surface (lockstep desktop ↔ frontend)

> **Lockstep rule:** Each task in Phase B updates BOTH the Rust command and its frontend invoke wrapper in the SAME commit. Don't split — the app won't run between them.

### Task B1: Rename `opencode_command_*` Tauri commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/command_files.rs` (where the three `#[tauri::command] fn opencode_command_{list,write,delete}` live — verify with `grep -n "fn opencode_command_" apps/desktop/src-tauri/src/commands/`)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (imports at line 21, generate_handler! at lines 185-187)
- Modify: `apps/app/src/app/lib/tauri.ts` (invoke calls at lines 379, 390, 402; wrapper fn names)
- Modify: any frontend caller of `opencodeCommandList/Write/Delete` (grep `apps/app/src` for those identifiers)

- [ ] **Step 1: Rename Rust fns**

In the file containing the three commands (`commands/command_files.rs` per grep), rename:
- `pub fn opencode_command_list(` → `pub fn auro_command_list(`
- `pub fn opencode_command_write(` → `pub fn auro_command_write(`
- `pub fn opencode_command_delete(` → `pub fn auro_command_delete(`

Keep all `#[tauri::command]` attributes and arg lists unchanged.

- [ ] **Step 2: Update `lib.rs` import + generate_handler**

In `apps/desktop/src-tauri/src/lib.rs`:
- Line 21: `opencode_command_delete, opencode_command_list, opencode_command_write,` → `auro_command_delete, auro_command_list, auro_command_write,`
- Lines 185-187 inside `tauri::generate_handler![...]`: rename the same three identifiers.

- [ ] **Step 3: Update frontend invoke + wrappers**

In `apps/app/src/app/lib/tauri.ts`:
- Line 379: `invoke<string[]>("opencode_command_list", {` → `invoke<string[]>("auro_command_list", {`
- Line 390: `invoke<ExecResult>("opencode_command_write", {` → `invoke<ExecResult>("auro_command_write", {`
- Line 402: `invoke<ExecResult>("opencode_command_delete", {` → `invoke<ExecResult>("auro_command_delete", {`
- Rename the exported wrapper fns: `export async function opencodeCommandList(...)` → `auroCommandList`, same for `Write` and `Delete`.

- [ ] **Step 4: Update frontend callers**

Run: `grep -rn "opencodeCommand\(List\|Write\|Delete\)" apps/app/src`
For each hit, rename to `auroCommand{List,Write,Delete}`.

- [ ] **Step 5: Verify and commit**

```bash
cargo check -p aurowork
pnpm --filter @aurowork/app typecheck
git add apps/desktop/src-tauri/src/ apps/app/src/
git commit -m "refactor(commands): rename opencode_command_* to auro_command_*"
```

---

### Task B2: Rename `read_opencode_config` and `write_opencode_config` Tauri commands

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/config.rs` (the two `#[tauri::command] fn` names)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (imports at line 23, generate_handler at lines 196-197)
- Modify: `apps/app/src/app/lib/tauri.ts` (invoke calls at lines 642, 650)
- Modify: any frontend caller (grep `readOpencodeConfig`, `writeOpencodeConfig`)

- [ ] **Step 1: Rename Rust commands**

In `apps/desktop/src-tauri/src/commands/config.rs`:
- `pub fn read_opencode_config(` → `pub fn read_auro_config(`
- `pub fn write_opencode_config(` → `pub fn write_auro_config(`

The return types should already be `Result<AuroConfigFile, String>` from Task A1.

- [ ] **Step 2: Update `lib.rs`**

Line 23: `use commands::config::{read_opencode_config, write_opencode_config};` → `use commands::config::{read_auro_config, write_auro_config};`

Lines 196-197 inside `generate_handler!`: rename matching identifiers.

- [ ] **Step 3: Update frontend**

In `apps/app/src/app/lib/tauri.ts`:
- Line 642: `invoke<OpencodeConfigFile>("read_opencode_config", { scope, projectDir });` → `invoke<AuroConfigFile>("read_auro_config", { scope, projectDir });`
- Line 650: `invoke<ExecResult>("write_opencode_config", { scope, projectDir, content });` → `invoke<ExecResult>("write_auro_config", { ... });`
- Rename wrappers `readOpencodeConfig` → `readAuroConfig`, `writeOpencodeConfig` → `writeAuroConfig`.
- The TS interface `OpencodeConfigFile` (likely declared in `tauri.ts` or `apps/app/src/app/lib/opencode.ts`) — rename to `AuroConfigFile`. Update import sites accordingly.

- [ ] **Step 4: Update frontend callers**

Run: `grep -rn "readOpencodeConfig\|writeOpencodeConfig\|OpencodeConfigFile" apps/app/src`
Rename each hit.

- [ ] **Step 5: Verify and commit**

```bash
cargo check -p aurowork && pnpm --filter @aurowork/app typecheck
git add apps/desktop/src-tauri/src/ apps/app/src/
git commit -m "refactor(commands): rename read/write_opencode_config to read/write_auro_config"
```

---

### Task B3: Rename misc Tauri commands (`reset_opencode_cache`, `opencode_db_migrate`, `opencode_mcp_auth`, `nuke_*`)

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/misc.rs` (the four command fns)
- Modify: `apps/desktop/src-tauri/src/lib.rs` (lines 30-31, 200-204)
- Modify: `apps/app/src/app/lib/tauri.ts` (lines 453, 664, 677, 695)
- Modify: any frontend caller

- [ ] **Step 1: Rename Rust commands and helper**

In `apps/desktop/src-tauri/src/commands/misc.rs`:
- `pub fn nuke_aurowork_and_opencode_config_and_exit(` → `pub fn nuke_aurowork_and_auro_config_and_exit(`
- `pub fn reset_opencode_cache(` → `pub fn reset_auro_cache(`
- `pub fn opencode_db_migrate(` → `pub fn auro_db_migrate(`
- `pub fn opencode_mcp_auth(` → `pub fn auro_mcp_auth(`
- Helper `fn resolve_opencode_program(` → `fn resolve_auro_program(`. Update its sole caller (in this same file).

Leave all path-segment string literals (`.join("opencode")` etc.) unchanged — bucket 4.

- [ ] **Step 2: Update `lib.rs`**

Lines 30-31:
```rust
use commands::misc::{
    app_build_info, nuke_aurowork_and_opencode_config_and_exit, opencode_db_migrate,
    opencode_mcp_auth, reset_aurowork_state, reset_opencode_cache,
```
to:
```rust
use commands::misc::{
    app_build_info, nuke_aurowork_and_auro_config_and_exit, auro_db_migrate,
    auro_mcp_auth, reset_aurowork_state, reset_auro_cache,
```

Lines 200-204 inside `generate_handler!`: rename matching identifiers.

- [ ] **Step 3: Update frontend**

In `apps/app/src/app/lib/tauri.ts`:
- Line 453: `invoke<void>("nuke_aurowork_and_opencode_config_and_exit");` → `invoke<void>("nuke_aurowork_and_auro_config_and_exit");`
- Line 664: `invoke<CacheResetResult>("reset_opencode_cache");` → `invoke<CacheResetResult>("reset_auro_cache");`
- Line 677: `invoke<ExecResult>("opencode_db_migrate", {` → `invoke<ExecResult>("auro_db_migrate", {`
- Line 695: `invoke<ExecResult>("opencode_mcp_auth", {` → `invoke<ExecResult>("auro_mcp_auth", {`
- Rename wrappers to camelCase auro forms (`nukeAuroworkAndAuroConfigAndExit`, `resetAuroCache`, `auroDbMigrate`, `auroMcpAuth`).

- [ ] **Step 4: Update frontend callers**

Run: `grep -rn "nukeAuroworkAndOpencodeConfigAndExit\|resetOpencodeCache\|opencodeDbMigrate\|opencodeMcpAuth" apps/app/src`
Rename each hit.

- [ ] **Step 5: Verify and commit**

```bash
cargo check -p aurowork && pnpm --filter @aurowork/app typecheck
git add apps/desktop/src-tauri/src/ apps/app/src/
git commit -m "refactor(commands): rename misc opencode_* commands to auro_*"
```

---

### Task B4: Reconcile `engine_start` arg names and `EngineInfo` field names

The WIP commit already renamed Rust args `opencode_bin_path`/`opencode_enable_exa` and struct fields `opencode_username`/`opencode_password` → `auro_*`. But `apps/app/src/app/lib/tauri.ts:163` still passes the *old TS option-bag field names*:

```ts
invoke<EngineInfo>("engine_start", {
  ...
  auroBinPath: options?.opencodeBinPath ?? null,
  auroEnableExa: options?.opencodeEnableExa ?? null,
  ...
});
```

The TS `EngineStartOptions` interface field names must rename so callers stop using the old names.

**Files:**
- Modify: `apps/app/src/app/lib/tauri.ts` (~line 163 invoke + the `EngineStartOptions` interface declaration)
- Modify: `apps/app/src/app/lib/opencode.ts` (likely site of `EngineInfo`/`EngineStartOptions` types — verify with grep)
- Modify: any frontend caller passing `opencodeBinPath`/`opencodeEnableExa`/`opencodeUsername`/`opencodePassword`

- [ ] **Step 1: Rename TS interface fields**

Run: `grep -rn "opencodeBinPath\|opencodeEnableExa\|opencodeUsername\|opencodePassword" apps/app/src`

For each interface declaration, rename `opencodeBinPath` → `auroBinPath`, `opencodeEnableExa` → `auroEnableExa`, `opencodeUsername` → `auroUsername`, `opencodePassword` → `auroPassword`.

- [ ] **Step 2: Update `tauri.ts` engine_start payload**

In `apps/app/src/app/lib/tauri.ts` ~line 163, change:
```ts
auroBinPath: options?.opencodeBinPath ?? null,
auroEnableExa: options?.opencodeEnableExa ?? null,
```
to:
```ts
auroBinPath: options?.auroBinPath ?? null,
auroEnableExa: options?.auroEnableExa ?? null,
```

- [ ] **Step 3: Update all callers**

For every grep hit from Step 1 outside an interface declaration (i.e., property access or object literal), rename the property name to its `auro*` equivalent.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @aurowork/app typecheck
git add apps/app/src/
git commit -m "refactor(frontend): rename EngineStartOptions/EngineInfo opencode* fields to auro*"
```

---

### Task B5: Rename `apps/app/src/app/lib/opencode.ts` → `auro.ts`

**Files:**
- Rename: `apps/app/src/app/lib/opencode.ts` → `apps/app/src/app/lib/auro.ts`
- Modify: every importer (grep `from .*lib/opencode`)

- [ ] **Step 1: Move the file**

```bash
git mv apps/app/src/app/lib/opencode.ts apps/app/src/app/lib/auro.ts
```

- [ ] **Step 2: Rename internal symbols inside the file**

Open `apps/app/src/app/lib/auro.ts`. Rename every `Opencode*` type → `Auro*`, every `opencodeXxx` fn/var → `auroXxx`. **Do not** rename:
- string literals matching the bucket-4 allowlist
- the `providerID: "opencode"` literal
- any reference to `@opencode-ai/sdk` package or its exports

- [ ] **Step 3: Update importers**

Run: `grep -rn 'from ["'\''].*lib/opencode["'\'']' apps/app/src`
Rewrite each path: `lib/opencode` → `lib/auro`. Also rewrite imported symbol names according to Step 2.

Run a second sweep for renamed symbols still imported by old name:
`grep -rn "Opencode\|opencode" apps/app/src/app | grep -vE 'opencode-ai|"opencode"|//.*[Oo]penCode|\.opencode/'`

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @aurowork/app typecheck
git add apps/app/src/
git commit -m "refactor(frontend): rename lib/opencode.ts to lib/auro.ts and internal symbols"
```

---

### Task B6: Phase B smoke test

- [ ] **Step 1: Build and run desktop in dev mode**

```bash
cargo check -p aurowork
pnpm --filter @aurowork/app typecheck
pnpm dev
```

- [ ] **Step 2: Manual smoke checklist**

Exercise each renamed command in the running app:
1. Engine starts (engine_start invoked) — verify in devtools that the payload uses `auroBinPath` / `auroEnableExa` (network/IPC tab or `console.log` patch if needed).
2. Read & write `.opencode/aurowork.json` config (calls `read_auro_config`, `write_auro_config`).
3. List/write/delete a custom command file (calls `auro_command_*`).
4. Reset cache (calls `reset_auro_cache`).
5. Kill the app cleanly via the menu — exercises `nuke_aurowork_and_auro_config_and_exit` if the user invokes the "nuke" path; otherwise just verify the symbol still exists in the bundled JS.

If any step throws "command not found", the lockstep rename was incomplete — re-grep and fix.

- [ ] **Step 3: Commit smoke test result**

If green:
```bash
git commit --allow-empty -m "test(desktop): manual smoke verification after Phase B rename"
```
If red, fix and re-test before proceeding to Phase C.

---

## Phase C — Bucket 3a aurowork-server contract (lockstep desktop ↔ server)

> **Lockstep rule:** Each task that changes a CLI flag or env var name updates BOTH the desktop producer and the server consumer in the SAME commit. Otherwise the server fails to parse args at startup.

### Task C1: Rename `--opencode-base-url` and `--opencode-directory` CLI flags

**Files:**
- Modify: `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` (~lines 121, 122, 151, 153, 158, 160)
- Modify: `apps/desktop/src-tauri/src/aurowork_server/mod.rs` (~lines 314, 348 — function arg names producing the flags)
- Modify: `apps/desktop/src-tauri/src/commands/aurowork_server.rs` (~lines 17, 37, 60-65 — caller already uses `auro_connect_url` from WIP, but inner var naming may still reference `opencode`)
- Modify: `apps/server/src/cli.ts` (the flag parser)

- [ ] **Step 1: Grep the server CLI parser**

Run: `grep -n "opencode-base-url\|opencode-directory" apps/server/src/cli.ts`
Note the parser entries to rename.

- [ ] **Step 2: Rename in server `cli.ts`**

In `apps/server/src/cli.ts`, replace each occurrence:
- `--opencode-base-url` → `--auro-base-url`
- `--opencode-directory` → `--auro-directory`

If the parsed value is stored under a property like `opts.opencodeBaseUrl`, rename that property to `opts.auroBaseUrl` (and `opencodeDirectory` → `auroDirectory`) and update every consumer in `apps/server/src/`. Run `grep -rn "opencodeBaseUrl\|opencodeDirectory" apps/server/src` to find them.

- [ ] **Step 3: Rename desktop producers**

In `apps/desktop/src-tauri/src/aurowork_server/spawn.rs`:
- Rename fn args `opencode_base_url`, `opencode_directory` → `auro_base_url`, `auro_directory` everywhere they appear (~lines 121, 122, 151, 158, 175, 176, 191, 192).
- Rename the pushed flag strings: `args.push("--opencode-base-url".to_string());` → `"--auro-base-url"`, same for `--opencode-directory` → `--auro-directory`.

In `apps/desktop/src-tauri/src/aurowork_server/mod.rs`:
- Rename fn args `opencode_base_url` → `auro_base_url` (~line 314, ~line 348).

In `apps/desktop/src-tauri/src/commands/aurowork_server.rs`:
- Update any local var or arg referencing `opencode_base_url` to `auro_base_url`. (The WIP commit already renamed `opencode_url` to `auro_connect_url` here.)

In `apps/desktop/src-tauri/src/commands/engine.rs` (~line 391, ~line 430-441):
- The local `opencode_connect_url` was renamed to `auro_connect_url` partly in WIP — finish any remaining occurrences. Update the call site `start_aurowork_server(...)` to pass renamed args correctly.

- [ ] **Step 4: Rebuild the server binary**

```bash
pnpm --filter aurowork-server build:bin
```
Expected: clean build under `apps/server/dist/`.

- [ ] **Step 5: Verify and commit**

```bash
cargo check -p aurowork
pnpm --filter aurowork-server typecheck
pnpm --filter aurowork-server test
git add apps/desktop/src-tauri/src/ apps/server/src/
git commit -m "refactor(server,desktop): rename --opencode-{base-url,directory} CLI flags to --auro-*"
```

---

### Task C2: Rename `AUROWORK_OPENCODE_USERNAME/PASSWORD` env vars

**Files:**
- Modify: `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` (~lines 177, 178, 200, 202, 206, 208 — fn args + `command.env(...)` calls)
- Modify: `apps/desktop/src-tauri/src/aurowork_server/mod.rs` (~lines 315-316, 354-355)
- Modify: `apps/desktop/src-tauri/src/commands/aurowork_server.rs` (~lines 27, 38-39, 62-63 — local var names already partly renamed in WIP)
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs` (any caller passing the credentials)
- Modify: `apps/server/src/config.ts` and/or `apps/server/src/server.ts` (env reads)

- [ ] **Step 1: Grep the server env reads**

Run: `grep -rn "AUROWORK_OPENCODE_USERNAME\|AUROWORK_OPENCODE_PASSWORD" apps/server/src`
Note every read.

- [ ] **Step 2: Rename env reads in server**

For each hit from Step 1, replace:
- `process.env.AUROWORK_OPENCODE_USERNAME` (or `Bun.env.AUROWORK_OPENCODE_USERNAME`) → `AUROWORK_AURO_USERNAME`
- `process.env.AUROWORK_OPENCODE_PASSWORD` → `AUROWORK_AURO_PASSWORD`

If the env values are exported under JS identifiers like `opencodeUsername`/`opencodePassword`, rename those identifiers too and update consumers in the server.

- [ ] **Step 3: Rename desktop env writers**

In `apps/desktop/src-tauri/src/aurowork_server/spawn.rs`:
- Fn args at ~line 177-178: `opencode_username` → `auro_username`, `opencode_password` → `auro_password`.
- Environment-set calls at ~line 200-208:
  ```rust
  command = command.env("AUROWORK_OPENCODE_USERNAME", username);
  // → command.env("AUROWORK_AURO_USERNAME", username);
  command = command.env("AUROWORK_OPENCODE_PASSWORD", password);
  // → command.env("AUROWORK_AURO_PASSWORD", password);
  ```
  Rename both the env-var string and the surrounding fn-arg variable name.

In `apps/desktop/src-tauri/src/aurowork_server/mod.rs`:
- Fn args at ~lines 315-316 and ~lines 354-355: rename `opencode_username/_password` → `auro_username/_password`.

In `apps/desktop/src-tauri/src/commands/aurowork_server.rs` and `apps/desktop/src-tauri/src/commands/engine.rs`:
- The WIP commit already renamed local vars `opencode_username`/`_password` → `auro_username`/`_password` in many places. Run `grep -n "opencode_username\|opencode_password" apps/desktop/src-tauri/src/commands/` and rename any remaining occurrences.

> **Do NOT rename** `OPENCODE_SERVER_USERNAME`/`OPENCODE_SERVER_PASSWORD` in `apps/desktop/src-tauri/src/engine/spawn.rs` (~lines 807, 814) — those are bucket 4 (consumed by the upstream opencode binary).

- [ ] **Step 4: Verify and commit**

```bash
cargo check -p aurowork
pnpm --filter aurowork-server typecheck && pnpm --filter aurowork-server test
pnpm --filter aurowork-server build:bin
git add apps/desktop/src-tauri/src/ apps/server/src/
git commit -m "refactor(server,desktop): rename AUROWORK_OPENCODE_* env vars to AUROWORK_AURO_*"
```

---

### Task C3: Rename server-internal files (`opencode-connection.ts`, `opencode-db.ts`, `portable-opencode.ts`)

**Files:**
- Rename: `apps/server/src/opencode-connection.ts` → `apps/server/src/auro-connection.ts`
- Rename: `apps/server/src/opencode-connection.test.ts` → `apps/server/src/auro-connection.test.ts`
- Rename: `apps/server/src/opencode-db.ts` → `apps/server/src/auro-db.ts`
- Rename: `apps/server/src/opencode-db.test.ts` → `apps/server/src/auro-db.test.ts`
- Rename: `apps/server/src/portable-opencode.ts` → `apps/server/src/portable-auro.ts`
- Rename: `apps/server/src/portable-opencode.test.ts` → `apps/server/src/portable-auro.test.ts`
- Modify: every importer in `apps/server/src/`

- [ ] **Step 1: Move the files**

```bash
git mv apps/server/src/opencode-connection.ts apps/server/src/auro-connection.ts
git mv apps/server/src/opencode-connection.test.ts apps/server/src/auro-connection.test.ts
git mv apps/server/src/opencode-db.ts apps/server/src/auro-db.ts
git mv apps/server/src/opencode-db.test.ts apps/server/src/auro-db.test.ts
git mv apps/server/src/portable-opencode.ts apps/server/src/portable-auro.ts
git mv apps/server/src/portable-opencode.test.ts apps/server/src/portable-auro.test.ts
```

- [ ] **Step 2: Update import paths**

Run:
```bash
grep -rn 'from ["'\''].*\(opencode-connection\|opencode-db\|portable-opencode\)["'\'']' apps/server/src
```
For each hit, rewrite the path: `opencode-connection` → `auro-connection`, `opencode-db` → `auro-db`, `portable-opencode` → `portable-auro`.

- [ ] **Step 3: Rename internal symbols inside the moved files**

For each renamed file, scan for symbols containing `opencode`/`Opencode` (var names, fn names, types, classes). Rename to `auro`/`Auro` UNLESS the symbol is part of the bucket-4 allowlist:
- The string literals `".opencode"`, `"opencode.json"`, `"opencode.jsonc"`, `"opencode.db"` and path joins like `join(..., "opencode", ...)` (these address the upstream binary's data dirs)
- Imports from `@opencode-ai/sdk`
- Any `OPENCODE_*` env-var literal

Sample (from `opencode-db.ts`):
- A fn `opencodeDataDirs()` → `auroDataDirs()` (it just lists XDG dirs; the path strings inside stay as `"opencode"`).
- Var `let opencodeRoot = ...` → `let auroRoot = ...`.

After editing each file, run `grep "[Oo]pencode" <file>` and confirm only allowlisted occurrences remain.

- [ ] **Step 4: Update consumers of renamed symbols**

Run: `grep -rn "opencodeDataDirs\|opencodeRoot\|<other renamed symbols>" apps/server/src apps/desktop/src-tauri/src`
Rename each consumer hit.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter aurowork-server typecheck
pnpm --filter aurowork-server test
pnpm --filter aurowork-server build:bin
git add apps/server/src/
git commit -m "refactor(server): rename opencode-{connection,db,portable} files to auro-*"
```

---

### Task C4: Server `RemoteType` and other shared TS types

**Files:**
- Modify: `apps/server/src/types.ts` (line 3 `RemoteType` keep wire string; line 99 `source: "aurowork" | "opencode"` keep; line 99 surrounding type names)
- Modify: `apps/server/src/server.ts` (line 99 `proxyService?: "opencode" | "opencode-router"` — these are bucket-4 string values, KEEP)

- [ ] **Step 1: Audit `apps/server/src/types.ts`**

Run: `grep -n "opencode\|Opencode" apps/server/src/types.ts`

For each hit, classify:
- TS type *identifier* containing `Opencode` → rename to `Auro`. Update consumers.
- String literal `"opencode"` used as a discriminant value → KEEP (bucket 4).

`RemoteType = "opencode" | "aurowork"`: this is a string-literal union — KEEP both literals as-is. The TS type alias name `RemoteType` already uses neither; no rename needed. Same for `source: "aurowork" | "opencode"` at line 99.

- [ ] **Step 2: Audit `apps/server/src/server.ts`**

Run: `grep -n "opencode\|Opencode" apps/server/src/server.ts`

The `proxyService?: "opencode" | "opencode-router"` at line 99 is a string-literal union — KEEP both literals (these names refer to the upstream opencode service identifier).

For any TS *identifier* (variable, function, type) named `opencodeXxx`/`OpencodeXxx`, rename to `auroXxx`/`AuroXxx` per Task C3 step 3 rules. Skip if it's already part of a Phase C rename in earlier tasks.

- [ ] **Step 3: Verify and commit**

```bash
pnpm --filter aurowork-server typecheck && pnpm --filter aurowork-server test
git add apps/server/src/
git commit -m "refactor(server): rename internal Opencode* TS identifiers to Auro*; preserve wire strings"
```

---

### Task C5: Phase C smoke test

- [ ] **Step 1: Rebuild server binary and start desktop dev**

```bash
pnpm --filter aurowork-server build:bin
pnpm dev
```

- [ ] **Step 2: Verify desktop ↔ server handshake**

In the running app:
1. Create or open a workspace — desktop spawns the server with the new `--auro-base-url`, `--auro-directory` flags and the new env vars.
2. Inspect the server process: on macOS, `ps -ef | grep aurowork-server` should show the new flag names.
3. Check server logs for any "unknown option" or env-var warnings.
4. Issue an authenticated request through the UI to confirm the server received the credentials via `AUROWORK_AURO_USERNAME`/`AUROWORK_AURO_PASSWORD`.

If any handshake step fails, re-grep both sides for stale `opencode` strings and fix.

- [ ] **Step 3: Commit smoke result**

```bash
git commit --allow-empty -m "test(server,desktop): manual smoke verification after Phase C rename"
```

---

## Phase D — Bucket 3b orchestrator daemon contract (in-repo lockstep)

> **Correction from earlier draft:** The orchestrator daemon source lives in **this repo** at `apps/orchestrator/` (TypeScript/Bun, package `aurowork-orchestrator`). It is built locally via `pnpm --filter aurowork-orchestrator build:bin` and bundled as the `aurowork-orchestrator` Tauri sidecar. There is no separate-repo coordination, no GitHub release pin in `constants.json` for it, and no version bump required for cross-repo compatibility — everything ships together in this single PR.
>
> **Lockstep rule:** Each task in Phase D updates the JSON producer (in `apps/orchestrator/src/`) AND the JSON consumer (Rust deserializers in `apps/desktop/src-tauri/src/orchestrator/mod.rs` + `types.rs`) in the SAME commit. Then the orchestrator sidecar must be rebuilt for the desktop to pick up the new shape.

### Task D1: Rename JSON-emitting fields in the orchestrator daemon source

**Files:**
- Modify: `apps/orchestrator/src/cli.ts` (the daemon entry — emits state and auth JSON; grep for `opencode_username`, `opencode_password`, `opencode`, `opencodeUsername`, `opencodePassword`, `opencodeSource`)
- Modify: `apps/orchestrator/src/tui/app.tsx` (only if it shares types with the daemon's emitted JSON; the TUI's *display* fields like `state.connect.opencodePassword` are bucket-1 internal *if* they originate from a shared type that also feeds the JSON writer; otherwise treat them as Phase B/internal renames)

- [ ] **Step 1: Locate every JSON producer**

Run:
```bash
grep -rn "opencode_username\|opencode_password\|opencodeUsername\|opencodePassword\|opencodeSource\|opencode_source" apps/orchestrator/src
grep -rn "writeFile.*aurowork-orchestrator-\(state\|auth\)\.json" apps/orchestrator/src
```

Note every site. The daemon writes `aurowork-orchestrator-state.json` and `aurowork-orchestrator-auth.json`; track the object literals that are serialized and the property names they emit.

- [ ] **Step 2: Rename the producer property names**

For each emitted JSON object, rename the property keys per the spec §3b table:
- `opencodeUsername` → `auroUsername`
- `opencodePassword` → `auroPassword`
- `opencode` (when used as an object key inside health / binaries / state) → `auro`
- `opencodeSource` → `auroSource`

Do NOT rename:
- The object key under `binaries.opencode` *if* it represents a slot for the upstream opencode binary metadata — wait, this IS the slot per spec §3b; rename to `auro`. The metadata it holds (path, version) is opaque to this rename.
- Any string-literal value `"opencode"` used as a discriminant (e.g., `service: "opencode"` in a switch). Bucket 4.
- Path segments addressing opencode dirs (`join(".opencode", ...)`, `"opencode.db"`).
- Env var literals `OPENCODE_*`.

Run a follow-up grep on each touched file to confirm only allowlisted occurrences remain.

- [ ] **Step 3: Update intra-daemon consumers**

Run: `grep -rn "opencodeUsername\|opencodePassword\|\.opencode\b\|opencodeSource" apps/orchestrator/src`

For each remaining hit (intra-daemon read of the renamed keys), rename to the `auro*` form. This includes the TUI's `state.connect.opencodePassword` reads if they originate from the same shared type — rename them too so the daemon's internal type stays consistent.

- [ ] **Step 4: Rebuild the sidecar**

```bash
pnpm --filter aurowork-orchestrator build:bin
```

Expected: produces `apps/orchestrator/dist/bin/aurowork` (or platform-target equivalent). The desktop's `tauri.conf.json` consumes this via the prepare-sidecar pipeline.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter aurowork-orchestrator typecheck
git add apps/orchestrator/src/
git commit -m "refactor(orchestrator): rename emitted JSON keys opencode* to auro*"
```

---

### Task D2: Verify the desktop build pipeline picks up the new sidecar

**Files:**
- Read-only: `apps/desktop/src-tauri/build.rs` (orchestrator sidecar copy step), `apps/desktop/scripts/prepare-sidecar.mjs`, `apps/orchestrator/scripts/build-sidecars.mjs`

- [ ] **Step 1: Confirm the desktop build copies the freshly-built sidecar**

```bash
ls -la apps/orchestrator/dist/bin/
ls -la apps/desktop/src-tauri/sidecars/
```

If `apps/desktop/src-tauri/sidecars/aurowork-orchestrator-<target>` is older than `apps/orchestrator/dist/bin/aurowork`, run the desktop's prepare-sidecar step (or `cargo build` triggers `build.rs` which copies it):

```bash
cargo check -p aurowork
ls -la apps/desktop/src-tauri/sidecars/
```

- [ ] **Step 2: No version pin to bump**

`constants.json` only pins `auroVersion` (the upstream opencode binary). The orchestrator is built locally; no pin update needed in this task.

- [ ] **Step 3: No commit needed** if Step 1 confirms the sidecar is current.

---

### Task D3: Apply deferred A2 — rename `OrchestratorOpencodeState` and orchestrator JSON-bound fields in desktop

**Files:**
- Modify: `apps/desktop/src-tauri/src/types.rs` (struct `OrchestratorOpencodeState` ~line 124; field `opencode` in `OrchestratorBinaries` ~143; field `opencode_source` ~154; field `opencode` in `OrchestratorHealth` ~177; possibly other orchestrator-bound structs)
- Modify: `apps/desktop/src-tauri/src/orchestrator/mod.rs` (struct `OrchestratorAuthFile` already auro_*; struct `OrchestratorHealth` field `opencode` rename ~line 49; ensure all consumer `state.opencode` accesses become `state.auro`)
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs` (~line 268, ~line 273 — uses `opencode` from health/state struct)
- Modify: `apps/desktop/src-tauri/src/commands/orchestrator.rs` (any access of `.opencode` on health/state structs)

- [ ] **Step 1: Rename struct definitions in `types.rs`**

In `apps/desktop/src-tauri/src/types.rs`:
- `pub struct OrchestratorOpencodeState {` → `pub struct OrchestratorAuroState {`
- In `OrchestratorBinaries` (~line 143), rename field `pub opencode: Option<OrchestratorBinaryInfo>,` → `pub auro: Option<OrchestratorBinaryInfo>,`
- In whatever struct holds `opencode_source` (~line 154), rename `pub opencode_source: Option<String>,` → `pub auro_source: Option<String>,`
- In `OrchestratorHealth` (~line 177), rename field `pub opencode: Option<OrchestratorOpencodeState>,` → `pub auro: Option<OrchestratorAuroState>,`

Keep `#[serde(rename_all = "camelCase")]` on each struct — that maps `auro_source` → `"auroSource"` and bare `auro` → `"auro"`, matching the daemon's new JSON shape.

- [ ] **Step 2: Mirror the rename in `orchestrator/mod.rs`**

In `apps/desktop/src-tauri/src/orchestrator/mod.rs`:
- The struct `OrchestratorHealth` (~line 47) has `pub opencode: Option<OrchestratorOpencodeState>,` (this file may re-declare or mirror the type — check both this file and `types.rs` and rename consistently). Rename field name and the type reference: `pub auro: Option<OrchestratorAuroState>,`.
- Update import statements at the top of the file if `OrchestratorOpencodeState` is imported.

- [ ] **Step 3: Update consumers**

Run: `grep -rn "OrchestratorOpencodeState\|\.opencode\b\|opencode_source" apps/desktop/src-tauri/src`

For each hit:
- Type reference `OrchestratorOpencodeState` → `OrchestratorAuroState`
- Field access `.opencode` on a health/binaries/state struct → `.auro`
- Field access `.opencode_source` → `.auro_source`

Be careful NOT to rename `.opencode` on unrelated structs (e.g., a config struct). When unsure, follow the type chain.

- [ ] **Step 4: Verify and commit**

```bash
cargo check -p aurowork && cargo test -p aurowork
git add apps/desktop/src-tauri/src/
git commit -m "refactor(desktop): rename orchestrator JSON-bound fields opencode* to auro*"
```

---

### Task D4: Phase D end-to-end smoke test (clean-slate)

> **Destructive:** wipes existing dev workspaces and orchestrator state. Coordinate with team before running.

- [ ] **Step 1: Kill all related processes**

```bash
pkill -f 'AuroWork-Dev|aurowork|opencode'
```

- [ ] **Step 2: Wipe state**

```bash
rm -rf ~/.aurowork/aurowork-orchestrator-dev/
rm -rf ~/Library/Application\ Support/com.nld.aurowork.dev/
```

(Linux equivalent: `rm -rf ~/.local/share/com.nld.aurowork.dev/ ~/.config/com.nld.aurowork.dev/`. Adjust if your desktop runs elsewhere.)

- [ ] **Step 3: Rebuild and start desktop**

```bash
pnpm --filter aurowork-server build:bin
pnpm dev
```

- [ ] **Step 4: Walk through onboarding**

1. Create a new workspace.
2. Verify orchestrator state file is written: `cat ~/.aurowork/aurowork-orchestrator-dev/aurowork-orchestrator-auth.json`. Confirm keys are `auroUsername`, `auroPassword` (not `opencodeUsername/Password`).
3. Verify the desktop deserializes it on restart: kill `pnpm dev`, restart, confirm engine_info reattaches without re-prompting credentials.
4. Hit any UI surface that consumes `OrchestratorHealth` (the doctor / diagnostics panel). Confirm no "missing field" deserialization errors in logs.

If steps 2-4 fail, the daemon may not be using the new version — verify `constants.json` and `~/.aurowork/aurowork-orchestrator-dev/` binary version.

- [ ] **Step 5: Commit smoke result**

```bash
git commit --allow-empty -m "test: end-to-end smoke verification after Phase D rename"
```

---

## Phase E — Documentation sweep (bucket 5)

### Task E1: Update repo-level docs

**Files:**
- Modify: `CODEBASE.md`, `ARCHITECTURE.md`, `AGENTS.md`, `PRODUCT.md`, `INFRASTRUCTURE.md`, `README.md` (if it exists at repo root)

- [ ] **Step 1: For each doc, classify each `OpenCode`/`opencode` mention**

Run for each file: `grep -n "OpenCode\|opencode\|OPENCODE" <file>`

For each hit:
- **Brand reference to AuroWork's embedded engine** (e.g., "the OpenCode sidecar process bundled with AuroWork", "OpenCode binary lifecycle", `OPENCODE_BIN_PATH` in our table) → rename to "Auro"/`AURO_BIN_PATH`. Note: in `CODEBASE.md` lines 392-398 and 1350, the WIP commit already did this for `OPENCODE_BIN_PATH` — verify and extend.
- **Reference to the upstream OpenCode project** (e.g., "based on OpenCode", "the upstream OpenCode CLI", `@opencode-ai/sdk`, "OpenCode v1.2.27") → KEEP as `OpenCode`.
- **Path or file literal** (`.opencode/`, `opencode.jsonc`, `opencode.db`) → KEEP as-is (bucket 4).
- **Env var literal** (`OPENCODE_SERVER_USERNAME/PASSWORD`, `OPENCODE_CLIENT`) → KEEP (bucket 4); rename `OPENCODE_BIN_PATH` → `AURO_BIN_PATH` (we own this one).

- [ ] **Step 2: Apply the renames**

Edit each file accordingly. When a paragraph mixes both meanings, split or clarify so the distinction is obvious to a future reader.

- [ ] **Step 3: Commit**

```bash
git add CODEBASE.md ARCHITECTURE.md AGENTS.md PRODUCT.md INFRASTRUCTURE.md
git commit -m "docs: rename embedded-engine references to Auro; preserve upstream OpenCode references"
```

---

### Task E2: Update Claude/dev tracking docs

**Files:**
- Modify: `.claude/CLAUDE.md`, `.claude/DEV_PROGRESS.md`

- [ ] **Step 1: Apply the same E1 classification to these files**

Same rules as E1. Pay particular attention to `.claude/CLAUDE.md` Workspace Local Storage section — keep `~/.aurowork/aurowork-orchestrator-dev/` paths (already auro-prefixed), keep `opencode.db` and `.opencode/` references (bucket 4), but reword any narrative description of "opencode" the engine to "Auro".

- [ ] **Step 2: Add a DEV_PROGRESS.md entry documenting the rename**

Append to `.claude/DEV_PROGRESS.md`:
```markdown
## 2026-04-28: OpenCode → Auro rename complete

- Renamed all owned identifiers per spec `docs/superpowers/specs/2026-04-28-opencode-to-auro-rename-design.md`.
- Existing developers must wipe state once: `rm -rf ~/.aurowork/aurowork-orchestrator-dev/ ~/Library/Application\ Support/com.nld.aurowork.dev/`
- Orchestrator daemon bumped to vX.Y.Z (see constants.json).
- Bucket-4 strings (`OPENCODE_SERVER_*`, `.opencode/`, `opencode.jsonc`, `@opencode-ai/sdk`) intentionally preserved.
```

Replace `vX.Y.Z` with the actual version.

- [ ] **Step 3: Commit**

```bash
git add .claude/CLAUDE.md .claude/DEV_PROGRESS.md
git commit -m "docs(claude): note OpenCode → Auro rename and clean-break instructions"
```

---

### Task E3: Code-comment sweep

**Files:**
- Modify: any `.rs` or `.ts` file in scope where comments still say "OpenCode" referring to AuroWork's engine

- [ ] **Step 1: Grep**

```bash
grep -rn "// .*[Oo]penCode\|/\* .*[Oo]penCode\|# .*[Oo]penCode" apps/desktop/src-tauri/src apps/server/src apps/app/src
```

- [ ] **Step 2: Apply E1 classification per comment**

For each hit, follow E1 rules. Keep upstream-project references; rename brand references to Auro.

- [ ] **Step 3: Commit**

```bash
git add -A apps/
git commit -m "docs(comments): rename embedded-engine comments to Auro"
```

---

## Phase F — CI & release verification

### Task F1: Verify CI workflow already-renamed bits

**Files:**
- Read-only verify: `.github/workflows/build-desktop.yml`

- [ ] **Step 1: Confirm WIP renames are intact**

Run: `grep -n "opencode\|auro\|OPENCODE\|AURO" .github/workflows/build-desktop.yml`

Expected: every previously-`opencode`-prefixed CI variable, asset name, and step ID is now `auro`-prefixed (per the WIP commit). The default repo `Northern-Deep-Leviathan/auro` is correct and confirmed publishing the required assets.

- [ ] **Step 2: Confirm any leftover ASCII art or comments are renamed**

Comments like `# ── Download Auro sidecar ────` should be present (already renamed). If any `# ── Download OpenCode sidecar ────` survives, rename.

- [ ] **Step 3: No commit needed** if Step 1 and 2 are clean.

---

### Task F2: Set GitHub repo variable + dry-run build

- [ ] **Step 1: Set `AURO_GITHUB_REPO` repo variable (if overriding default)**

In GitHub repo settings → Variables → Actions → New variable:
- Name: `AURO_GITHUB_REPO`
- Value: `Northern-Deep-Leviathan/auro`

(Or rely on the workflow default — already `Northern-Deep-Leviathan/auro`.)

- [ ] **Step 2: Trigger a workflow dispatch on a throwaway branch**

Push the rename branch and trigger the desktop build workflow:
```bash
git push origin personal/mazziruso/build-rename-auro
gh workflow run build-desktop.yml --ref personal/mazziruso/build-rename-auro
```

- [ ] **Step 3: Watch the run**

```bash
gh run watch
```
Expected: green build. The download step should pull `auro-windows-x64-baseline.zip` from `Northern-Deep-Leviathan/auro/releases/download/v0.1.0/`.

If the download 404s, verify the asset filename and version in the upstream auro release.

- [ ] **Step 4: Commit any fixups**

If the workflow needed adjustments, commit them:
```bash
git add .github/workflows/build-desktop.yml
git commit -m "ci: fix asset download path after rename"
```

---

## Final Verification

### Task Z1: Full repo grep audit

- [ ] **Step 1: Grep the codebase for residual `opencode` outside the bucket-4 allowlist**

```bash
grep -rn "opencode\|Opencode\|OPENCODE\|OpenCode" \
  apps/ packages/ ee/ docs/ .github/ constants.json CODEBASE.md ARCHITECTURE.md \
  AGENTS.md PRODUCT.md INFRASTRUCTURE.md .claude/ 2>/dev/null \
  | grep -vE 'OPENCODE_SERVER_USERNAME|OPENCODE_SERVER_PASSWORD|OPENCODE_CLIENT|@opencode-ai|node_modules|target/|\.opencode/|opencode\.json|opencode\.jsonc|opencode\.db|"opencode"|providerID: "opencode"|join\("opencode"\)|join\("\.opencode"\)|//.*upstream OpenCode|opencodeVersion'
```

- [ ] **Step 2: For each surviving hit, classify**

If it's a legitimate bucket-4 reference not yet on the allowlist (e.g., a comment about the upstream OpenCode project), extend the grep allowlist locally and re-run.

If it's a missed bucket-1/2/3 rename, fix it and append a follow-up commit:
```bash
git commit -am "refactor: rename missed opencode reference in <file>"
```

- [ ] **Step 3: Run all test suites**

```bash
cargo test -p aurowork
pnpm --filter aurowork-server test
pnpm --filter @aurowork/app typecheck
pnpm typecheck   # workspace-wide
```

Expected: all green.

- [ ] **Step 4: Final commit + push**

```bash
git push origin personal/mazziruso/build-rename-auro
```

Open the PR. PR description should include:
- Link to spec
- Link to plan
- Clean-break wipe instructions for reviewers

---

## Self-Review Notes

**Spec coverage check:**
- §1 Taxonomy (5 buckets) → enforced by per-task bucket-4 allowlist + final Z1 audit
- §2a Desktop ↔ aurowork-server contracts → Phase C tasks C1, C2
- §2b Desktop ↔ orchestrator daemon contracts → Phase D tasks D1-D4
- §2c Bucket-4 preservation → enforced inline in every task that touches relevant files
- §3 Tauri command surface → Phase B tasks B1-B5
- §3 RemoteType wire compatibility → Task A4 with serde test
- §4 Phases A-F → mapped 1:1 onto Phase A-F task groups
- Clean-break note → Task D4 step 2, Task E2 step 2

**Type-consistency check:**
- `AuroConfigFile` introduced in A1, consumed in B2 — consistent.
- `AuroCommand` (A3) — no later task references it, consistent.
- `RemoteType::Auro` (A4) — no later task references the variant, consistent.
- `OrchestratorAuroState`, `.auro` field — introduced in D3, no earlier reference. Consistent.
- TS `Auro*` symbols — renamed in B5 (file move), consumed by callers via Step 3 grep — consistent.

**Risk callouts already in plan:**
- A4 wire-compat test prevents serialization break.
- D1-D4 explicitly gate on daemon-repo PR being merged first.
- D4 destructive smoke test is flagged as such with team-coordination instruction.
- F2 dry-run catches asset-download regressions before merge.
