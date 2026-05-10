# AuroWork Backend Reference

> Symbol-based reference for AuroWork's backend layers. Symbols (function/type names) are stable; line numbers are not, so this document avoids them.
>
> Last verified against code: 2026-05-07.

The backend spans **two distinct codebases**:

| Layer | Language | Path | Role |
| --- | --- | --- | --- |
| **Desktop shell** | Rust (Tauri) | `apps/desktop/src-tauri/` | Local process supervision, native commands, workspace registry on disk |
| **AuroWork Server** | TypeScript (Bun) | `apps/server/` | HTTP API consumed by the UI; proxies OpenCode; auth/approval/audit |
| **Orchestrator** | TypeScript (Bun) | `apps/orchestrator/` | CLI/daemon that spawns OpenCode + AuroWork Server, manages workspace activation |

Sections are grouped by codebase to keep Rust vs TypeScript boundaries clear.

---

## Part A — Desktop Shell (Rust)

Tauri commands live in `apps/desktop/src-tauri/src/commands/`. Each is registered via `#[tauri::command]` and wired through `tauri::generate_handler!`.

### A.1 Workspace commands (`commands/workspace.rs`)

#### `workspace_create_remote`

Creates a new **remote** workspace registry entry.

```rust
#[tauri::command]
pub fn workspace_create_remote(
    app: tauri::AppHandle,
    base_url: String,
    directory: Option<String>,
    display_name: Option<String>,
    remote_type: Option<RemoteType>,
    aurowork_host_url: Option<String>,
    aurowork_token: Option<String>,
    aurowork_client_token: Option<String>,
    aurowork_host_token: Option<String>,
    aurowork_workspace_id: Option<String>,
    aurowork_workspace_name: Option<String>,
    sandbox_backend: Option<String>,
    sandbox_run_id: Option<String>,
    sandbox_container_name: Option<String>,
    watch_state: State<WorkspaceWatchState>,
) -> Result<WorkspaceList, String>
```

Behavior:
- Validates `base_url` (must start with `http://` or `https://`).
- For `RemoteType::Aurowork`, requires `aurowork_host_url`.
- Generates stable workspace ID via `stable_workspace_id_for_aurowork()` or `stable_workspace_id_for_remote()` (SHA256 of normalized URL+token).
- Builds a `WorkspaceInfo` and persists it through `save_workspace_state()`.

Stored remote fields: `base_url`, `remote_type`, `aurowork_host_url`, `aurowork_token`, `aurowork_client_token`, `aurowork_host_token`, `aurowork_workspace_id`, `aurowork_workspace_name`, `sandbox_backend`, `sandbox_run_id`, `sandbox_container_name`.

#### `workspace_update_remote`

Patches an existing remote workspace. Validates `workspace_id` exists and is of `Remote` type; updates only fields supplied (`Option::Some(_)`); re-validates URL formats; persists.

#### `workspace_export_config` / `workspace_import_config`

Export builds a ZIP containing `manifest.json` plus the workspace's `.opencode/**` files and `opencode.jsonc` / `opencode.json`. Import is the inverse — reads the manifest, restores files into the chosen workspace root.

### A.2 AuroWork Server lifecycle (`aurowork_server/mod.rs`, `aurowork_server/spawn.rs`)

The desktop shell spawns the AuroWork Server binary as a managed child process and stores its tokens locally.

Constants of interest:

| Constant | Value | Source |
| --- | --- | --- |
| `AUROWORK_PORT_RANGE_START` | `48_000` | `aurowork_server/spawn.rs` |
| `AUROWORK_PORT_RANGE_END` | `51_000` | `aurowork_server/spawn.rs` |
| `AUROWORK_SERVER_TOKEN_STORE_VERSION` | `1` | `aurowork_server/mod.rs` |

Token persistence struct:

```rust
struct PersistedAuroworkServerTokens {
    version: u32,
    workspaces: BTreeMap<String, WorkspaceTokens>,
}
```

Tokens are generated as `Uuid::new_v4().to_string()` and persisted to `aurowork-server-tokens.json` under the Tauri app data directory (`~/Library/Application Support/com.nld.aurowork[.dev]/` on macOS).

Health is verified by polling the server's `/health` endpoint after launch.

### A.3 Tauri command surface (registration)

Commands relevant to the backend layer (prefix-grouped):

- `engine_*` — `engine_info`, `engine_start`, `engine_stop`, `engine_restart`, `engine_doctor`, `engine_install` (`commands/engine.rs`)
- `orchestrator_*` — `orchestrator_status`, `orchestrator_workspace_activate`, `orchestrator_instance_dispose`, `orchestrator_start_detached` (`commands/orchestrator.rs`)
- `aurowork_server_*` — `aurowork_server_info`, `aurowork_server_restart` (`commands/aurowork_server.rs`)
- `workspace_*` — workspace registry CRUD, including the remote variants above (`commands/workspace.rs`)
- `opkg_*` — OpenPackage CLI invocations (`commands/opkg.rs`)

### A.4 Desktop type surface (`src-tauri/src/types.rs`)

Defines Rust counterparts to the wire types the UI consumes: `WorkspaceInfo`, `WorkspaceList`, `RemoteType`, `AuroworkServerInfo`, `EngineRuntime`, etc. These shapes are mirrored (independently) by TypeScript types in `apps/server/src/types.ts` and `apps/app/src/app/types.ts`.

---

## Part B — AuroWork Server (TypeScript)

`apps/server/` is a Bun TypeScript service compiled to a single binary (`pnpm --filter aurowork-server build:bin`). It is the canonical API surface for filesystem-backed and OpenCode-proxied operations.

### B.1 Configuration (`config.ts`)

Configuration is layered: **CLI flags → env vars → file → defaults**.

CLI flags parsed:

| Flag | Purpose |
| --- | --- |
| `--host <addr>` | Bind address (default: loopback) |
| `--port <n>` | Listen port |
| `--token <value>` | Owner-equivalent token (legacy "single-token" mode) |
| `--host-token <value>` | Host token (used by orchestrator/desktop for privileged calls) |
| `--approval <mode>` | Approval mode override |
| `--workspace <path>` | Bind server to a single workspace root |
| `--cors <origin>` | CORS allow-list entries (repeatable) |
| `--read-only` | Refuse mutating routes |

Environment variables:

| Var | Purpose |
| --- | --- |
| `AUROWORK_TOKEN` | Owner-equivalent token (env equivalent of `--token`) |
| `AUROWORK_HOST_TOKEN` | Host token |
| `AUROWORK_TOKEN_STORE` | Override path to the token store file |
| `AUROWORK_APPROVAL_MODE` | Approval mode |
| `AUROWORK_OPENCODE_BASE_URL` | URL of the OpenCode server to proxy to |

### B.2 Token service (`tokens.ts`)

Exports `TokenService`, file-backed scoped-token CRUD.

Token format and storage:
- Generated as `owt_${shortId().replace(/-/g, "")}` (a random UUID with dashes stripped, prefixed `owt_`).
- Only the **hash** is stored on disk; plaintext is returned to the caller exactly once.
- Store path resolves in this order: `AUROWORK_TOKEN_STORE` env → server `config.configPath` adjacency → `~/.config/aurowork/`.

Key methods on `TokenService`:
- `create({ scope, label? })` — issue a new token of the given scope, persist its hash.
- `list()` — list non-secret metadata for all tokens.
- `revoke(id)` — remove a token.
- `scopeForToken(rawToken)` — resolve a presented bearer token to its scope; the legacy `config.token` is treated as `"collaborator"`.

Scopes: `"owner" | "collaborator" | "viewer"` (defined in `types.ts` as `TokenScope`).

### B.3 Auth helpers (`server.ts`)

Two helpers gate every protected route:

- `requireClient(req)` — extracts the `Authorization: Bearer <token>` header, resolves a scope via `TokenService.scopeForToken()`, and returns an `Actor` (`{ type, clientId, tokenHash, scope }`). Throws 401 on missing/invalid tokens.
- `requireHost(req)` — accepts either an `X-AuroWork-Host-Token` header **or** an owner-scoped Bearer token. Used for privileged operations the desktop/orchestrator initiates on behalf of the user.

The `Actor` interface is defined in `apps/server/src/types.ts`.

### B.4 Approvals (`approvals.ts`)

`ApprovalService` is an in-memory approval gate keyed by request ID. Routes that mutate workspace state submit a request, wait for an `allow`/`deny` response, and proceed or fail accordingly. Approval mode (`auto`, `prompt`, `deny`) is set via `--approval` / `AUROWORK_APPROVAL_MODE`.

### B.5 Routes (`server.ts`)

Routes are registered against a Bun `Bun.serve()` handler. Conventions:

- All workspace-scoped routes live under `/workspace/:id/...`.
- Most return JSON; SSE streaming is used for OpenCode event proxying.
- Response status codes: 200 for read, 201 for create, 204 for delete, 4xx with structured error body otherwise.

Categories (non-exhaustive — see `server.ts` for the authoritative list):

- **Workspace lifecycle** — create, get, list, update, delete workspaces; reload (`POST /workspace/:id/engine/reload` → triggers OpenCode `POST /instance/dispose`).
- **OpenCode proxy** — sessions, messages, prompts, events, permissions, file ops, search.
- **Workspace files** — `.opencode/**` browse/read/write through approval gate.
- **AgentLab automations** — see `docs/architecture/automation.md`.
- **Tokens** — issue/list/revoke (owner scope only).
- **Health** — `GET /health` returns liveness + version.

### B.6 Workspace initialization (`workspace-init.ts`)

`initializeWorkspace()` materializes a fresh workspace from a **preset**:

| Preset | Plugins | Notes |
| --- | --- | --- |
| `starter` | `["opencode-scheduler"]` | Default first-run preset |
| `automation` | `["opencode-scheduler"]` | Automation-focused preset |
| `minimal` | `[]` | No plugins; hand-tuned setups |

It writes:
- `opencode.jsonc` (preferred) with the preset's seed model + plugin list (model is now session-scoped at runtime; the value in `opencode.jsonc` only seeds new sessions).
- `.opencode/aurowork.json` (workspace metadata: name, preset, blueprint, reload config).
- Optional `.opencode/agents/`, `.opencode/skills/`, `.opencode/commands/` from the preset blueprint.

### B.7 Workspace files (`workspace-files.ts`)

When reading the OpenCode config file, the server prefers `opencode.jsonc` and falls back to `opencode.json` if only the latter exists. Writes always go to `opencode.jsonc`.

### B.8 Type definitions (`types.ts`)

Public wire types used across server, desktop and UI:

- `WorkspaceType` = `"local" | "remote"`
- `RemoteType` = `"opencode" | "aurowork"`
- `TokenScope` = `"owner" | "collaborator" | "viewer"`
- `WorkspaceInfo` — full record persisted in the workspace registry
- `Actor` — auth context returned by `requireClient`/`requireHost`

> Note: the desktop shell defines mirrored Rust shapes in `apps/desktop/src-tauri/src/types.rs`. Keep both in sync when changing wire schemas.

---

## Part C — Orchestrator (TypeScript)

`apps/orchestrator/` is a Bun TypeScript CLI/daemon compiled to a binary (`pnpm --filter aurowork-orchestrator build:bin`). It is the **process owner** for OpenCode and (in host modes) for the AuroWork Server.

### C.1 Modes

- `aurowork daemon run` — long-lived daemon that the desktop shell talks to; manages workspace activation and OpenCode lifecycle.
- `aurowork start` / `aurowork serve` — host-mode entrypoints that spin up AuroWork Server + OpenCode together for headless / remote use.

### C.2 OpenCode connection

`createOpencodeClient` from `@opencode-ai/sdk/v2/client` is used to connect to the spawned OpenCode HTTP server (loopback, dynamic port). The orchestrator does NOT use `createOpencode()` (in-process server creation) — process lifecycle is owned by the orchestrator's own supervisor, not by the SDK.

OpenCode credentials (username/password) are randomly generated per launch by the desktop shell and passed to the orchestrator via `aurowork-orchestrator-auth.json`; they are short-lived and discarded on shutdown.

### C.3 State files

| File | Contents |
| --- | --- |
| `~/.aurowork/aurowork-orchestrator[-dev]/aurowork-orchestrator-state.json` | PIDs, ports, baseUrl, sidecar config, binary version, active workspace IDs |
| `~/.aurowork/aurowork-orchestrator[-dev]/aurowork-orchestrator-auth.json` | OpenCode auth credentials (ephemeral) |
| `~/.aurowork/aurowork-orchestrator[-dev]/aurowork-dev-data/xdg/data/opencode/opencode.db` | OpenCode SQLite DB (sessions, messages, workspaces) |

(See root `CLAUDE.md` "Workspace 本地存储" for the full lifecycle map.)

### C.4 What the orchestrator does NOT do

- **No scheduling / cron** — automations are executed by the `opencode-scheduler` plugin loaded inside OpenCode itself, not by the orchestrator. See `docs/architecture/automation.md`.
- **No HTTP route handling** — the orchestrator does not expose an HTTP API; it only manages child processes and IPC with the desktop shell.

---

## Part D — Build & dev commands

| Goal | Command |
| --- | --- |
| Run desktop dev (Tauri + UI + orchestrator) | `pnpm dev` |
| Run UI only (web dev) | `pnpm dev:ui` |
| Type-check UI | `pnpm typecheck` |
| Build AuroWork Server binary (after editing `apps/server/src/`) | `pnpm --filter aurowork-server build:bin` |
| Build orchestrator binary | `pnpm --filter aurowork-orchestrator build:bin` |
| Build orchestrator sidecar bundles | `pnpm --filter aurowork-orchestrator build:sidecars` |

> Reminder: the orchestrator runs the **compiled** AuroWork Server binary, not the TS sources. After editing `apps/server/src/*` you must rebuild before changes take effect end-to-end.

---

## Cross-references

- Architecture and runtime flow → `docs/architecture/overview.md`
- Codebase layout and tech stack → `docs/architecture/codebase.md`
- Automation system specifics → `docs/architecture/automation.md`
- Deployment / infra → `docs/architecture/infrastructure.md`
