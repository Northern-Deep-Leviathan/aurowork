# OpenCode → Auro Rename — Design Spec

**Date:** 2026-04-28
**Branch:** `personal/mazziruso/enhance-log-build`
**Scope:** Desktop Tauri shell + dependent components (frontend, aurowork-server, aurowork-orchestrator daemon, CI). Excludes upstream `opencode` binary contracts and the `@opencode-ai/sdk` package.

## Goal

Rename every `opencode`-flavored identifier under our ownership to `auro`, preserving letter-case conventions, while leaving the embedded upstream OpenCode binary's contract surface (env vars it consumes, on-disk workspace layout it owns, its SDK package, its HTTP API) untouched.

## Rename Taxonomy (the rules)

Every identifier containing `opencode` (case-insensitive) belongs to exactly one bucket. The action for each is fixed:

| # | Bucket | Definition | Action |
|---|---|---|---|
| 1 | **Internal** | Symbols that never cross a process boundary: Rust struct fields, function names, local vars, module names, comments, internal TS types. | Rename `opencode` → `auro` preserving case. |
| 2 | **Tauri command surface** | `#[tauri::command]` fns, their argument names, the `Serialize`-derived return types consumed by the frontend. | Rename in Rust + lockstep update in `apps/app/src/app/lib/tauri.ts` (invoke string, payload keys, TS types). |
| 3 | **Cross-binary contracts we own** | CLI flags & env vars exchanged between desktop ↔ aurowork-server, desktop ↔ aurowork-orchestrator daemon; JSON shape of state files written by the orchestrator daemon. | Rename in lockstep across `apps/desktop/src-tauri`, `apps/server/src`, and the orchestrator daemon repo. |
| 4 | **External opencode-binary contracts** | `OPENCODE_SERVER_USERNAME/PASSWORD`, `OPENCODE_CLIENT`, `OPENCODE_BIN_PATH` *as consumed by the opencode binary itself*, the `.opencode/` workspace dir, `opencode.json[c]`, `opencode.db`, `@opencode-ai/sdk`, opencode subprocess CLI flags. | **Do not rename.** |
| 5 | **User-visible terminology / docs** | Strings shown in UI; references in `CODEBASE.md`, `ARCHITECTURE.md`, etc. | Rename "OpenCode" → "Auro" only when it brands AuroWork's embedded engine. Keep "OpenCode" when it refers to the upstream project (`@opencode-ai/sdk`, "based on OpenCode", "the opencode binary"). |

### Case-mapping convention

| Old form | New form | Example |
|---|---|---|
| `opencode` | `auro` | `opencode_username` → `auro_username` |
| `Opencode` | `Auro` | `OrchestratorOpencodeState` → `OrchestratorAuroState` |
| `OPENCODE` | `AURO` | `OPENCODE_BIN_PATH` → `AURO_BIN_PATH` |
| `OpenCode` (PascalCase brand) | `Auro` | "OpenCode sidecar" → "Auro sidecar" (in our docs only) |

## Cross-Binary Contract Inventory (bucket 3)

These items require lockstep changes. Every row must change in every listed component in the same release; otherwise startup breaks. **No migration shim.** Existing dev installs must wipe state — see "Clean-break note" below.

### 3a. Desktop ↔ aurowork-server sidecar

| Old | New | Producer | Consumer |
|---|---|---|---|
| `--opencode-base-url` (CLI flag) | `--auro-base-url` | `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` | `apps/server/src/cli.ts` |
| `--opencode-directory` (CLI flag) | `--auro-directory` | `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` | `apps/server/src/cli.ts` |
| `AUROWORK_OPENCODE_USERNAME` (env) | `AUROWORK_AURO_USERNAME` | `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` | `apps/server/src/{config,server}.ts` |
| `AUROWORK_OPENCODE_PASSWORD` (env) | `AUROWORK_AURO_PASSWORD` | same | same |

Server-internal symbols (file names `opencode-connection.ts`, `opencode-db.ts`, `portable-opencode.ts`, function/var names) are bucket 1 and renamed in the same PR. Code inside those files that talks to the upstream opencode binary's HTTP API or reads `opencode.db`'s schema is bucket 4 and stays untouched.

### 3b. Desktop ↔ aurowork-orchestrator daemon

| Old (JSON key, camelCase) | New | Where it appears |
|---|---|---|
| `opencodeUsername` | `auroUsername` | `aurowork-orchestrator-auth.json` |
| `opencodePassword` | `auroPassword` | `aurowork-orchestrator-auth.json` |
| `opencode` (object) | `auro` | `OrchestratorHealth` payload |
| `opencode` (object) | `auro` | `OrchestratorBinaries` payload |
| `opencodeSource` | `auroSource` | `OrchestratorSidecarInfo` payload |
| any orchestrator HTTP route/field containing `opencode` | `auro` | orchestrator HTTP API |

**On-disk file paths are unchanged** (`aurowork-orchestrator-state.json`, `aurowork-orchestrator-auth.json` — already auro-prefixed). Only the JSON content shape changes.

The desktop's `apps/desktop/src-tauri/src/orchestrator/mod.rs` Rust struct field identifiers rename in lockstep (`opencode_username` → `auro_username`, `opencode` → `auro`, etc.). With the existing `#[serde(rename_all = "camelCase")]`, no explicit `#[serde(rename = "...")]` is required.

### 3c. Items explicitly NOT renamed (still bucket 4)

- `~/.aurowork/aurowork-orchestrator-dev/aurowork-dev-data/xdg/data/opencode/opencode.db` — opencode binary owns the file.
- Workspace `.opencode/` directory and `opencode.jsonc` — opencode binary reads these.
- `OPENCODE_SERVER_USERNAME`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_CLIENT` env vars — opencode binary consumes them (set in `engine/spawn.rs` lines 807, 814 and elsewhere).
- `@opencode-ai/sdk` npm package and all its types/methods.
- Any HTTP route or JSON field exposed by the opencode binary itself.

## Tauri Command Surface (bucket 2)

### Command renames

| Old `#[tauri::command]` | New | Frontend wrapper rename |
|---|---|---|
| `opencode_command_list` | `auro_command_list` | `opencodeCommandList` → `auroCommandList` |
| `opencode_command_write` | `auro_command_write` | `opencodeCommandWrite` → `auroCommandWrite` |
| `opencode_command_delete` | `auro_command_delete` | `opencodeCommandDelete` → `auroCommandDelete` |
| `read_opencode_config` | `read_auro_config` | `readOpencodeConfig` → `readAuroConfig` |
| `write_opencode_config` | `write_auro_config` | `writeOpencodeConfig` → `writeAuroConfig` |
| `nuke_aurowork_and_opencode_config_and_exit` | `nuke_aurowork_and_auro_config_and_exit` | `nukeAuroworkAndOpencodeConfigAndExit` → `nukeAuroworkAndAuroConfigAndExit` |
| `reset_opencode_cache` | `reset_auro_cache` | `resetOpencodeCache` → `resetAuroCache` |
| `opencode_db_migrate` | `auro_db_migrate` | `opencodeDbMigrate` → `auroDbMigrate` |
| `opencode_mcp_auth` | `auro_mcp_auth` | `opencodeMcpAuth` → `auroMcpAuth` |

### Argument & payload-key renames

Tauri's serde camelCase conversion auto-renames JSON keys when the Rust arg renames. Frontend `invoke()` payloads must update in lockstep.

| Rust arg | JSON key (old) | JSON key (new) |
|---|---|---|
| `opencode_bin_path` | `opencodeBinPath` | `auroBinPath` |
| `opencode_enable_exa` | `opencodeEnableExa` | `auroEnableExa` |

The frontend option-bag interface field `EngineStartOptions.opencodeBinPath` (and `.opencodeEnableExa`) renames to `auroBinPath` / `auroEnableExa` for internal consistency.

### Returned struct field renames

| Rust field | JSON key (old) | JSON key (new) |
|---|---|---|
| `EngineInfo.opencode_username` | `opencodeUsername` | `auroUsername` |
| `EngineInfo.opencode_password` | `opencodePassword` | `auroPassword` |

The TS interface `EngineInfo` in `apps/app/src/app/lib/opencode.ts` (and any consumers) renames matching fields.

### Frontend file & type renames (bucket 1, frontend)

| Old | New |
|---|---|
| `apps/app/src/app/lib/opencode.ts` | `apps/app/src/app/lib/auro.ts` |
| TS types `Opencode*` | `Auro*` |
| `OpencodeConfigFile` (Rust + TS) | `AuroConfigFile` |
| `OrchestratorOpencodeState` | `OrchestratorAuroState` |
| `RemoteType::Opencode` enum variant | `RemoteType::Auro` (subject to serialized-form check, see below) |

### `RemoteType::Opencode` precondition

Before renaming, grep the codebase for the serialized string `"opencode"` produced by `RemoteType`. If it appears in any state file, settings JSON, or HTTP payload that crosses a process boundary, add `#[serde(rename = "opencode")]` to preserve wire format. If grep is clean, free rename.

## Execution Order & Verification

Ordering principle: rename leaves first (no consumers), then producer/consumer pairs in lockstep within a single commit per pair, frontend last so the typecheck error surface stays narrow.

### Phase A — Bucket 1 internals (no behavior change)
- A1. Rename remaining `opencode_*` Rust struct fields, fns, modules, comments in `apps/desktop/src-tauri/src/` (excluding bucket-3/4 items). Files: `config.rs`, `commands/config.rs`, `commands/misc.rs`, `commands/orchestrator.rs`, `engine/spawn.rs` (local var `opencode_config_dir`), `lib.rs`, `types.rs` (`OpencodeConfigFile`, `OrchestratorOpencodeState`, `OpencodeCommand`, `RemoteType::Opencode`), `workspace/watch.rs` (vars only — keep string literals `.opencode/` and `opencode.json[c]`).
- A2. `RemoteType::Opencode` precondition check (above).
- A3. Verify: `cargo check` + `cargo test` for the desktop crate.

### Phase B — Bucket 2 Tauri command surface (lockstep)
- B1. Rename Rust commands per "Command renames" in `apps/desktop/src-tauri/src/commands/*.rs` and the `tauri::generate_handler!` registration in `lib.rs`.
- B2. Rename Rust args per "Argument & payload-key renames" and complete `EngineInfo` frontend-facing field renames.
- B3. Update `apps/app/src/app/lib/tauri.ts`: invoke strings, payload keys, wrapper fn names, option-bag interface fields.
- B4. Rename `apps/app/src/app/lib/opencode.ts` → `auro.ts`; rename TS types `Opencode*` → `Auro*`; update all import sites.
- B5. Verify: `pnpm typecheck` + `cargo check`. Smoke-run `pnpm dev` and exercise: engine start, config read/write, command list, db migrate, mcp auth, nuke-and-exit, reset cache.

### Phase C — Bucket 3a aurowork-server (lockstep desktop ↔ server)
- C1. `apps/server/src/cli.ts`: rename CLI flag parsers `--opencode-base-url` → `--auro-base-url`, `--opencode-directory` → `--auro-directory`.
- C2. `apps/server/src/{config,server}.ts`: rename env reads `AUROWORK_OPENCODE_USERNAME/PASSWORD` → `AUROWORK_AURO_USERNAME/PASSWORD`.
- C3. Rename internal symbols across `apps/server/src/`. Rename files: `opencode-connection.ts` → `auro-connection.ts`, `opencode-db.ts` → `auro-db.ts`, `portable-opencode.ts` → `portable-auro.ts`. Keep all references to `.opencode/`, `opencode.jsonc`, `opencode.db`, `@opencode-ai/sdk`, `OPENCODE_SERVER_USERNAME/PASSWORD`, `OPENCODE_CLIENT` untouched.
- C4. Desktop `apps/desktop/src-tauri/src/aurowork_server/{spawn.rs,mod.rs}`: rename the flags it pushes and the env vars it sets to match C1/C2.
- C5. Rebuild server binary: `pnpm --filter aurowork-server build:bin`.
- C6. Verify: `pnpm --filter aurowork-server typecheck && pnpm --filter aurowork-server test`; `cargo check`; smoke test desktop → server connection.

### Phase D — Bucket 3b orchestrator daemon (separate repo, coordinated)
- D1. In the orchestrator daemon repo: rename JSON serialization keys per §3b (auth file, health, binaries, sidecar). Rename HTTP API field/route names containing `opencode`.
- D2. Bump orchestrator binary version; update `constants.json` pin to that version.
- D3. Desktop `apps/desktop/src-tauri/src/orchestrator/mod.rs`: rename Rust struct fields so `#[serde(rename_all = "camelCase")]` aligns with the new JSON.
- D4. Verify: `cargo check`; smoke run end-to-end (kill all processes, wipe state per "Clean-break note", start fresh, observe orchestrator handshake + auth persist).

### Phase E — Documentation sweep (bucket 5)
- E1. `CODEBASE.md`, `ARCHITECTURE.md`, `AGENTS.md`, `PRODUCT.md`, `INFRASTRUCTURE.md`, `.claude/CLAUDE.md`, `DEV_PROGRESS.md`: replace "OpenCode" → "Auro" only where it brands AuroWork's embedded engine. Keep "OpenCode" for upstream-project references.
- E2. Comment cleanups in code that drift from the rules.

### Phase F — CI & release
- F1. `.github/workflows/build-desktop.yml`: already largely renamed in the unstaged diff. Asset URL `Northern-Deep-Leviathan/auro` is confirmed publishing `auro-windows-x64-baseline.zip` etc.
- F2. Set GitHub repo variable `AURO_GITHUB_REPO` (or rely on the default `Northern-Deep-Leviathan/auro`).
- F3. Trigger a build on a throwaway branch to confirm green.

### Verification gates per phase
After each phase: `cargo check && cargo test && pnpm typecheck && pnpm --filter aurowork-server test`. After Phases B/C/D: manual smoke test (engine_start → workspace open → command create → restart desktop → engine_info reattaches).

## Clean-break note for existing dev installs

After Phase D ships, every developer must run:

```bash
pkill -f 'AuroWork-Dev|aurowork|opencode'
rm -rf ~/.aurowork/aurowork-orchestrator-dev/
rm -rf ~/Library/Application\ Support/com.nld.aurowork.dev/
```

Document this in `DEV_PROGRESS.md` and the PR description.

## Out of Scope

- Renaming `.opencode/` workspace directory or `opencode.jsonc` (would break upstream opencode binary).
- Renaming the `@opencode-ai/sdk` package or anything inside it.
- Renaming `opencode.db` or its schema.
- Renaming `OPENCODE_SERVER_USERNAME/PASSWORD`, `OPENCODE_CLIENT` (consumed by upstream binary).
- Migration shims for existing on-disk state — clean break.

## Risks

- **Forgotten contract surface.** Any opencode-named field/flag/env we miss when classifying becomes a startup failure. Mitigation: phase-gate verification + final `grep -rn opencode` audit.
- **Orchestrator daemon coordination.** The orchestrator lives in a separate repo and must ship a matching version. Phase D explicitly couples them and updates `constants.json`.
- **`RemoteType::Opencode` serialized form.** Renaming the variant could change a JSON enum string somewhere. The Phase A2 grep is the gate.
- **CI asset availability.** Already confirmed by user that `Northern-Deep-Leviathan/auro` publishes the required assets.
