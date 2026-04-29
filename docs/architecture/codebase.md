# AuroWork Codebase Reference

> Auto-generated deep-dive documentation of the entire AuroWork codebase.
> Last updated: 2026-04-12

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack](#2-technology-stack)
3. [Repository Structure](#3-repository-structure)
4. [apps/app -- SolidJS Frontend UI](#4-appsapp----solidjs-frontend-ui)
5. [apps/desktop -- Tauri 2 Desktop Shell](#5-appsdesktop----tauri-2-desktop-shell)
6. [apps/server -- AuroWork Server](#6-appsserver----aurowork-server)
7. [apps/orchestrator -- CLI Orchestrator](#7-appsorchestrator----cli-orchestrator)
8. [Enterprise Edition (ee/)](#8-enterprise-edition-ee)
9. [Packages (packages/)](#9-packages-packages)
10. [CI/CD and Release Pipeline](#10-cicd-and-release-pipeline)
11. [Design Assumptions and Principles](#11-design-assumptions-and-principles)
12. [Data Flow Diagrams](#12-data-flow-diagrams)
13. [Configuration Reference](#13-configuration-reference)

---

## 1. Project Overview

AuroWork is an **experience layer** on top of [OpenCode](https://opencode.ai), an agentic coding platform. OpenCode is the **engine**; AuroWork is the **experience**: onboarding, safety, permissions, progress, artifacts, and a premium-feeling UI.

**Mission:** Make your company feel 1000x more productive.

**Current version:** `0.11.193`

**Monorepo manager:** pnpm 10.27.0 (workspace mode)

### Two Runtime Modes

| Mode | Description |
|------|-------------|
| **Mode A -- Desktop** | AuroWork runs locally. Tauri shell hosts the UI. OpenCode + AuroWork server run on loopback (`127.0.0.1`). `aurowork-orchestrator` manages the process lifecycle. |
| **Mode B -- Web/Cloud** | User signs into hosted Den web surface, launches a cloud worker via Den controller, connects via URL + token from any client (desktop, mobile, web). |

### Core Design Principle

**Predictable > Clever** -- Explicit configuration over heuristics. Auto-detection is acceptable as convenience but must be explainable, overrideable, and safe.

---

## 2. Technology Stack

### Frontend (`apps/app/`)

| Concern | Technology |
|---------|-----------|
| UI framework | **SolidJS 1.9** (fine-grained reactivity, no VDOM) |
| Router | **@solidjs/router 0.15** (Hash for Tauri, History for web) |
| Styling | **Tailwind CSS v4** + **Radix color tokens** |
| Code editor | **CodeMirror 6** |
| List virtualization | **@tanstack/solid-virtual** |
| SDK | **@opencode-ai/sdk v2** |
| Bundler | **Vite 6** + `vite-plugin-solid` |
| i18n | Custom signal-based (EN, JA, ZH, VI, PT-BR) |
| Fuzzy search | **fuzzysort** (composer @mentions) |
| Markdown | **marked** |

### Desktop Shell (`apps/desktop/`)

| Concern | Technology |
|---------|-----------|
| Desktop framework | **Tauri 2** |
| Shell language | **Rust** (edition 2021) |
| Native features | notify (file watching), uuid, zip, walkdir, sha2, ureq (HTTP) |
| macOS-specific | `objc2` for native APIs |

### Backend (`apps/server/` + `apps/orchestrator/`)

| Concern | Technology |
|---------|-----------|
| Runtime | **Bun** (TypeScript, compiled to binary) |
| TUI | **@opentui/core** + **@opentui/solid** |
| Agent engine | **OpenCode v1.2.27** via `@opencode-ai/sdk` |
| Config | `jsonc-parser`, `yaml`, `minimatch` |

### Enterprise / Cloud (`ee/`)

| Concern | Technology |
|---------|-----------|
| Web framework | **Next.js 14** (App Router) |
| UI | React 18 + TailwindCSS + framer-motion |
| Auth | **better-auth** (GitHub/Google OAuth, email OTP) |
| Database | **MySQL** / **PlanetScale** via **Drizzle ORM** |
| API server | **Express** (den-controller) |
| Validation | **Zod** |
| Worker provisioner | **Daytona SDK** + Render API |
| Billing | **Polar** |
| Analytics | PostHog |
| Email | Loops.so |

### CI/CD and Tooling

| Tool | Use |
|------|-----|
| **pnpm** | Monorepo workspace package manager |
| **GitHub Actions** | CI tests, desktop builds, releases, AUR validation, Den deployment |
| **Docker / docker-compose** | Dev environment, Den services |
| **Infisical** | Secrets management |
| **Vercel** | Frontend deployment (den-web, landing) |
| **AUR (PKGBUILD)** | Arch Linux distribution |

---

## 3. Repository Structure

```
/workspace/aurowork/
├── apps/
│   ├── app/                  # SolidJS frontend UI (desktop + web)
│   ├── desktop/              # Tauri 2 Rust desktop shell
│   ├── server/               # AuroWork Server (Bun, filesystem-backed API)
│   └── orchestrator/         # CLI host orchestrator + TUI
├── packages/
│   ├── app/                  # Shared app utilities, PR notes
│   └── docs/                 # Mintlify .mdx documentation
├── ee/                       # Enterprise Edition
│   ├── apps/
│   │   ├── den-controller/   # Cloud control plane API (Express + better-auth)
│   │   ├── den-web/          # Den web UI (Next.js 14)
│   │   ├── den-worker-proxy/ # Worker proxy (Hono + Bun)
│   │   ├── den-worker-runtime/ # Worker runtime packaging (Docker/Daytona)
│   │   └── landing/          # Marketing landing page (Next.js 14)
│   └── packages/
│       ├── den-db/           # Drizzle ORM schema + MySQL client
│       └── utils/            # Shared utilities (TypeID)
├── packaging/
│   ├── docker/               # Dockerfiles + docker-compose
│   └── aur/                  # Arch Linux AUR PKGBUILD
├── patches/                  # pnpm patches for dependencies
├── scripts/                  # Build, release, dev utility scripts
├── .github/                  # GitHub Actions CI/CD + issue templates
├── .opencode/                # OpenCode agent config (skills, commands, agents)
├── constants.json            # OpenCode version pin (v1.2.27)
├── opencode.json / opencode.jsonc  # OpenCode configuration
├── pnpm-workspace.yaml       # Monorepo workspace definition
└── package.json              # Root workspace package
```

### Workspace Declaration (`pnpm-workspace.yaml`)

```yaml
packages:
  - apps/*
  - packages/*
  - ee/apps/*
  - ee/packages/*
```

---

## 4. apps/app -- SolidJS Frontend UI

**Package:** `@aurowork/app` v0.11.193

The entire visual interface for desktop and web. Built with SolidJS + Vite + TailwindCSS v4.

### 4.1 Directory Structure

```
src/
├── index.tsx                         # Top-level render entry point
├── styles/
│   ├── colors.css                    # CSS custom properties (Radix color palette)
│   └── tailwind-colors.ts            # Tailwind color token mappings
├── i18n/
│   ├── index.ts                      # i18n engine (signal-based, 5 languages)
│   └── locales/                      # en, ja, zh, vi, pt-BR
└── app/
    ├── entry.tsx                     # Provider tree bootstrap
    ├── app.tsx                       # ~291KB monolith -- all view logic, state wiring
    ├── constants.ts                  # App-wide constants (model keys, MCP list)
    ├── mcp.ts                        # MCP config parsing/validation helpers
    ├── theme.ts                      # Light/dark/system theme management
    ├── types.ts                      # All shared TypeScript types
    ├── pages/                        # View-level page components
    ├── components/                   # All UI components
    │   ├── session/                  # Composer, message-list, sidebar, context-panel
    │   ├── code-editor-panel/        # CodeMirror 6 editor, file tree
    │   ├── part-view.tsx             # Renders a single Part (text/tool/image)
    │   ├── thinking-block.tsx        # Collapsible reasoning block
    │   └── ... (30+ component files)
    ├── context/                      # SolidJS context providers
    ├── state/                        # State store re-exports
    ├── lib/                          # Side-effecting services and API clients
    └── utils/                        # Pure utility functions
```

### 4.2 Entry Point and Routing

There is **no route-level page routing**. The app uses a **single-page view-state machine**.

```tsx
// src/index.tsx
render(() => (
  <PlatformProvider value={platform}>
    <RouterComponent root={AppEntry}>
      <Route path="*all" component={() => null} />
    </RouterComponent>
  </PlatformProvider>
), root)
```

- Desktop (Tauri) uses `HashRouter`; web uses `Router` (from `@solidjs/router`)
- Only one catch-all route -- navigation uses a `View` signal: `"onboarding" | "dashboard" | "session" | "proto"`

View switching inside `app.tsx` with SolidJS `<Switch>/<Match>`:

```tsx
<Switch>
  <Match when={view() === "onboarding"}><OnboardingView /></Match>
  <Match when={view() === "session"}><SessionView /></Match>
  <Match when={view() === "dashboard"}><DashboardView /></Match>
</Switch>
```

### 4.3 Page Components

| Page | File | Purpose |
|------|------|---------|
| **Onboarding** | `pages/onboarding.tsx` | First-run wizard: choose local/server, pick folder, create workspace |
| **Session** | `pages/session.tsx` | Primary AI workspace: Composer, MessageList, Sidebar, ContextPanel, CodeEditor |
| **Dashboard** | `pages/dashboard.tsx` | Tabbed hub: Providers, Settings, Skills, Extensions |
| **Settings** | `pages/settings.tsx` | Model defaults, theme, API keys, authorized folders |
| **Config** | `pages/config.tsx` | Live JSONC editor for `opencode.jsonc` |
| **Skills** | `pages/skills.tsx` | Browse/install/edit skills (`.opencode/skills/`) |
| **Extensions** | `pages/extensions.tsx` | Extension/plugin registry |
| **Plugins** | `pages/plugins.tsx` | Plugin management |
| **MCP** | `pages/mcp.tsx` | MCP server browser and quick-connect |
| **Proto** | `pages/proto-*.tsx` | Dev/prototyping sandboxes |

### 4.4 Key UI Components

#### Composer (`components/session/composer.tsx`)

The rich-text prompt input:
- **`@mention` system** -- `@agent-name` or `@path/to/file` with fuzzy search dropdown (`fuzzysort`)
- **`/slash` commands** -- invokes `listCommands()` for skill/command/MCP completions
- **Attachments** -- images (PNG, JPEG, GIF, WebP) and PDF drops up to 8MB, inline compression (2048px max)
- **Paste handling** -- large pastes collapse to placeholder `[pasted text N]`; full text in `resolvedText`
- **File drop** -- dropped files become inbox markdown links or data URLs
- **Mode toggle** -- `prompt` vs `shell` mode
- Emits `ComposerDraft`: `{ mode, parts, attachments, text, resolvedText, command? }`

#### MessageList (`components/session/message-list.tsx`)

- **Virtualizer** via `@tanstack/solid-virtual` (threshold: 500, overscan: 4)
- Renders `MessageBlock` (user/assistant) and `StepClusterBlock` (tool step timeline)
- `groupMessageParts()` clusters parts into `{kind: "text"}` or `{kind: "steps"}`
- Search highlighting and nested message rendering for subtask sessions

#### SessionSidebar (`components/session/sidebar.tsx`)

- Workspaces as collapsible groups with **drag-and-drop reordering** (HTML5 drag API)
- Up to 8 sessions per workspace with "show all" toggle
- Workspace type badges: local / remote / AuroWork / sandbox

#### ContextPanel (`components/session/context-panel.tsx`)

Right-side panel: progress/todos, working files/artifacts, skills, MCP servers, plugins, authorized folders.

#### CodeEditorPanel (`components/code-editor-panel/`)

- Built on CodeMirror 6 with language auto-detection
- File tree sidebar, read-only diff/preview mode

### 4.5 State Management

SolidJS primitives exclusively -- no Redux, Zustand, or MobX.

| Layer | Mechanism | Use |
|-------|-----------|-----|
| 1 | `createSignal` | Fine-grained atoms: modal state, prompt text, busy flags |
| 2 | `createStore` + `produce`/`reconcile` | Nested objects: sessions, messages, parts, config |
| 3 | Contexts (Provider/Consumer) | Dependency injection: Platform, Server, SDK, Sync, Local |
| 4 | `createMemo` | Derived computations: selectedSession, messages, todos |

**Provider tree:**

```
PlatformProvider          -> platform abstraction (desktop/web)
  ServerProvider          -> active OpenCode server URL + health
    GlobalSDKProvider     -> SDK client instance + SSE event emitter
      GlobalSyncProvider  -> global data (config, providers, MCP, LSP, projects)
        LocalProvider     -> persisted local UI preferences
          App             -> all business logic
```

**Persistence:** `persisted()` wraps `makePersisted` from `@solid-primitives/storage`. Desktop uses Tauri file storage (`.dat` files); web uses `localStorage`. Supports legacy key migration.

### 4.6 Backend Communication

#### A) OpenCode Engine (REST + SSE)

All AI session operations via OpenCode HTTP server (default `http://127.0.0.1:4096`).

- **Client creation** (`lib/opencode.ts`): Wraps `@opencode-ai/sdk/v2/client`, adds `x-opencode-directory` header
- **Key operations** (`context/session.ts`): `session.list()`, `session.messages()`, `session.promptAsync()`, `session.todo()`, `permission.list()/reply()`, `question.list()/reply()`, `global.health()`
- **SSE events** (`context/global-sdk.tsx`): Event coalescing pipeline with keyed deduplication, 16ms batch flush, exponential backoff reconnect (1s -> max 30s)
- **Event types**: `session.{updated,created,deleted,status,idle,error}`, `message.{updated,removed}`, `message.part.{updated,delta,removed}`, `todo.updated`, `permission.{asked,replied}`, `question.{asked,replied}`

#### B) Tauri IPC (`lib/tauri.ts`)

40+ native commands via `invoke()`: engine lifecycle, workspace CRUD, config I/O, skills, commands, orchestrator management, AuroWork server, UI/shell, debug logging.

#### C) AuroWork Server REST (`lib/aurowork-server.ts`)

HTTP client for workspace sharing, teams, bundles. Auth via Bearer tokens.

### 4.7 Key Design Patterns

| Pattern | Description |
|---------|-------------|
| Props-down / Signals-up | `app.tsx` orchestrates, passes ~60 typed props to views |
| Store-per-concern | `createSessionStore()` for sessions, `GlobalSyncProvider` for config, `LocalProvider` for preferences |
| Event coalescing | Two-level SSE coalescing queue, keyed deduplication, `batch()` flush |
| Optimistic + reconciled | `reconcile()` for full list swaps; `produce()` for in-place mutations |
| Synthetic loop detection | Auto-aborts after >3 synthetic continues/minute |
| Platform abstraction | `PlatformContext` provides `{ platform, openLink, restart, notify, storage, fetch }` -- zero conditionals in UI |

---

## 5. apps/desktop -- Tauri 2 Desktop Shell

**Package:** `@aurowork/desktop` v0.11.193

Native desktop wrapper using Tauri 2 (Rust). Manages window lifecycle, native file access, deep linking, and sidecar process management.

### 5.1 Rust Source Structure

```
src-tauri/src/
├── main.rs                    # Entry point -> aurowork::run()
├── lib.rs                     # Module declarations + Tauri builder + app run loop
├── types.rs                   # All shared serializable types (Serde)
├── config.rs                  # opencode config file R/W
├── bun_env.rs                 # Bun/Node DNS flag sanitization
├── fs.rs                      # Recursive filesystem helpers
├── opkg.rs                    # Package installer (opkg)
├── paths.rs                   # PATH augmentation + XDG + sidecar discovery
├── platform/
│   ├── mod.rs                 # Platform gate: unix vs windows
│   ├── unix.rs                # Command::new(program)
│   └── windows.rs             # CREATE_NO_WINDOW flag, .cmd wrapper
├── updater.rs                 # Auto-update environment detection
├── utils.rs                   # truncate_output, now_ms
├── engine/
│   ├── manager.rs             # EngineState mutex + EngineManager
│   ├── spawn.rs               # spawn_engine() -- launches opencode serve
│   ├── doctor.rs              # opencode binary resolution + healthcheck
│   └── paths.rs               # opencode binary search (PATH + known dirs)
├── aurowork_server/
│   ├── mod.rs                 # start_aurowork_server(), token management
│   ├── manager.rs             # AuroworkServerState mutex + manager
│   └── spawn.rs               # spawn_aurowork_server(), port resolution
├── orchestrator/
│   ├── mod.rs                 # spawn_orchestrator_daemon(), state file I/O
│   └── manager.rs             # OrchestratorState mutex + graceful shutdown
├── workspace/
│   ├── state.rs               # Workspace JSON persistence (stable IDs)
│   ├── files.rs               # ensure_workspace_files (templates/presets)
│   └── watch.rs               # notify-based FS watcher -> reload events
└── commands/
    ├── engine.rs              # engine_start/stop/restart/doctor/install
    ├── aurowork_server.rs     # aurowork_server_info/restart
    ├── orchestrator.rs        # orchestrator_status/activate/dispose/start_detached
    ├── workspace.rs           # workspace CRUD + import/export
    ├── config.rs              # read/write opencode config
    ├── command_files.rs       # opencode command file CRUD
    ├── skills.rs              # list/read/write/uninstall SKILL.md
    ├── fs.rs                  # fs_read_dir/read_text_file/write_text_file
    ├── misc.rs                # app_build_info, nuke/reset, db_migrate, mcp_auth
    ├── opkg.rs                # opkg_install, import_skill
    ├── debug_log.rs           # debug_log_append/clear
    ├── updater.rs             # updater_environment (DMG guard)
    └── window.rs              # set_window_decorations
```

### 5.2 Sidecar Management -- Three Processes

The desktop shell manages **three independent sidecar processes**:

#### A. `opencode` (AI engine)

- Binary bundled at `src-tauri/sidecars/opencode[-<target-triple>]`
- CLI: `opencode serve --hostname 127.0.0.1 --port <free_port> --cors *`
- Environment: `OPENCODE_CLIENT=aurowork`, `AUROWORK=1`, random 512-char UUID-chain credentials (`OPENCODE_SERVER_USERNAME/PASSWORD`)
- **Binary resolution order:** `OPENCODE_BIN_PATH` env -> bundled sidecar -> PATH -> well-known locations (`~/.opencode/bin`, `/opt/homebrew/bin`, npm globals, scoop, chocolatey)

#### B. `aurowork-orchestrator` (process manager)

- Default runtime mode (preferred over direct engine spawning)
- CLI: `aurowork-orchestrator daemon run --data-dir ~/.aurowork/aurowork-orchestrator --daemon-host 127.0.0.1 --daemon-port <free> --opencode-bin <path> ...`
- State: `~/.aurowork/aurowork-orchestrator/aurowork-orchestrator-state.json`
- HTTP API: `/health`, `/workspaces`, `/workspaces/:id/activate`, `/instances/:id/dispose`, `/shutdown`
- Graceful shutdown via `POST /shutdown` (1.5s timeout, fallback SIGKILL)
- Startup timeout: 180s (configurable, allows SQLite migrations)

#### C. `aurowork-server` (local HTTP relay)

- Ports: random from **48000-51000** range, persisted per-workspace
- CLI: `aurowork-server --host 127.0.0.1 --port <port> --token <uuid> --host-token <uuid> --cors * --approval auto --workspace <paths...> --opencode-base-url <url>`
- Credentials: UUIDv4 tokens persisted per-workspace in `aurowork-server-tokens.json`; `owner_token` issued post-startup via `POST /tokens`

#### D. `chrome-devtools-mcp` (utility sidecar)

- Bun-compiled shim exposing Chrome DevTools protocol as an MCP server

### 5.3 Window Management

- **macOS behavior:** Close button hides instead of quitting (system-tray-like). Dock click restores window.
- **Linux tiling WMs:** `set_window_decorations` toggles native titlebar for Hyprland/i3/sway.
- **Single instance:** `tauri_plugin_single_instance` detects duplicate launches, restores existing window, forwards deep-link URLs.
- **macOS dev process name:** Uses `objc2` to set `NSProcessInfo.setProcessName("AuroWork - Dev")`.

### 5.4 Deep Linking (`aurowork://`)

Registration in `tauri.conf.json`:
```json
"plugins": { "deep-link": { "desktop": { "schemes": ["aurowork"] } } }
```

**Flow:**
1. macOS: `RunEvent::Opened { urls }` -> `emit_native_deep_links()` -> frontend event `aurowork:deep-link-native`
2. Windows/Linux: Second-instance CLI args -> `tauri_plugin_single_instance` callback -> `emit_forwarded_deep_links()`
3. Frontend: `deep-link-bridge.ts` receives and processes URLs

### 5.5 Build Configuration

- **Production:** App ID `com.differentai.aurowork`, sidecars: opencode, aurowork-server, aurowork-orchestrator, chrome-devtools-mcp
- **Auto-updater:** Minisign-signed, endpoint `https://github.com/different-ai/aurowork/releases/latest/download/latest.json`
- **Release profile:** `panic = "abort"`, `codegen-units = 1`, `lto = true`, `opt-level = "s"`, `strip = true`
- **Sidecar build pipeline** (`scripts/prepare-sidecar.mjs`): Downloads versioned OpenCode release, SHA-256 validates, builds server + orchestrator via `bun build --compile`

### 5.6 Frontend <-> Native Bridge

**Rust -> JS events:**

| Event | Source | Purpose |
|-------|--------|---------|
| `aurowork:deep-link-native` | `lib.rs` | Deep-link URLs to frontend |
| `aurowork://reload-required` | `workspace/watch.rs` | Workspace file changed |
| `aurowork://sandbox-create-progress` | `commands/orchestrator.rs` | Sandbox startup progress |

**FS Watcher** (`workspace/watch.rs`): `notify::recommended_watcher` watches workspace root (non-recursive) + `.opencode/` (recursive). Debounced to 750ms.

**PATH augmentation** (`paths.rs`): Since macOS GUI apps don't inherit shell PATH, prepends Homebrew, nvm, fnm, volta, pnpm, bun, cargo, pyenv to every spawned sidecar's environment.

**Security:** Random 512-char credentials generated per `engine_start`. Injected into both OpenCode and AuroWork server. Persisted to disk only for orchestrator reconnection.

---

## 6. apps/server -- AuroWork Server

**Package:** `aurowork-server` v0.11.193

Filesystem-backed API layer. Manages workspaces, skills, plugins, MCP, permissions. Runs on Bun, compiled to a standalone binary.

### 6.1 Directory Structure

```
apps/server/
├── bin/aurowork-server.mjs      # Compiled binary entry point
├── script/build.ts              # Cross-platform binary build
├── src/
│   ├── cli.ts                   # CLI entry (parses args, starts server)
│   ├── server.ts                # Core: all routes, dispatch, auth (~3700 lines)
│   ├── config.ts                # Config resolution (CLI -> env -> file -> defaults)
│   ├── types.ts                 # Shared types
│   ├── approvals.ts             # ApprovalService: in-memory approval gate
│   ├── tokens.ts                # TokenService: scoped token CRUD (file-backed)
│   ├── plugins.ts               # Plugin list/add/remove
│   ├── skills.ts                # Skill list/upsert/delete (SKILL.md files)
│   ├── mcp.ts                   # MCP list/add/remove
│   ├── commands.ts              # Command list/upsert/delete (.md files)
│   ├── events.ts                # ReloadEventStore: in-memory sequenced events
│   ├── reload-watcher.ts        # fs.watch-based file watcher
│   ├── file-sessions.ts         # FileSessionStore: in-memory TTL session registry
│   ├── workspace-files.ts       # Path helpers (.opencode/* paths)
│   ├── workspace-init.ts        # Workspace bootstrapping (skills, commands, config)
│   ├── workspaces.ts            # WorkspaceInfo builder + ID derivation
│   ├── opencode-connection.ts   # Resolves OpenCode baseUrl + auth header
│   ├── opencode-db.ts           # Direct SQLite access to OpenCode's database
│   ├── portable-opencode.ts     # Config sanitization (export-safe keys only)
│   ├── paths.ts                 # Safe path resolution (no traversal)
│   ├── utils.ts                 # exists, ensureDir, hashToken, shortId
│   ├── errors.ts                # ApiError class + formatError
│   ├── jsonc.ts                 # JSONC read/write/update (jsonc-parser)
│   ├── frontmatter.ts           # YAML frontmatter parse/build
│   ├── validators.ts            # Name/config validators
│   └── toy-ui.ts                # Embedded static HTML/CSS/JS for toy UI
├── package.json
└── tsconfig.json
```

### 6.2 Server Startup

```
parseCliArgs() -> resolveServerConfig() -> createServerLogger() -> startServer()
```

**Config resolution** merges three sources (precedence order):
```
CLI flags > environment variables > ~/.config/aurowork/server.json > defaults
```

Defaults: host `127.0.0.1`, port `8787`, approval mode `manual`, timeout `30s`.

Uses **`Bun.serve()`** directly -- no Express/Hono/Fastify. The router is a hand-rolled linear regex matcher with `addRoute(routes, METHOD, path, authMode, handler)`.

### 6.3 API Routes (Complete)

#### System / Metadata (no auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{ ok, version, uptimeMs }` |
| GET | `/w/:id/health` | Per-workspace health |
| GET | `/ui` | Toy UI HTML |

#### Status / Discovery (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Server status, active workspace, config |
| GET | `/capabilities` | Full capability advertisement |
| GET | `/whoami` | Returns `{ actor }` with scope info |
| GET | `/workspaces` | List all workspace infos |
| GET | `/runtime/versions` | Runtime version info |

#### Token Management (host/owner auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tokens` | List scoped tokens (hashes redacted) |
| POST | `/tokens` | Create token (`scope: owner|collaborator|viewer`) |
| DELETE | `/tokens/:id` | Revoke token |

#### Workspace Management (host auth for writes)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/workspaces/local` | Create & init local workspace |
| PATCH | `/workspaces/:id/display-name` | Rename workspace |
| POST | `/workspaces/:id/activate` | Move workspace to front |
| DELETE | `/workspaces/:id` | Remove workspace from config |
| POST | `/runtime/upgrade` | Trigger runtime upgrade |

#### Config Management (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspace/:id/config` | Read `opencode.json` + `aurowork.json` |
| PATCH | `/workspace/:id/config` | Patch config keys |
| GET/POST | `/workspace/:id/opencode-config` | Raw config file R/W |

#### Skills (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspace/:id/skills` | List skills (project + global dirs) |
| GET | `/workspace/:id/skills/:name` | Read skill content |
| POST | `/workspace/:id/skills` | Upsert skill (SKILL.md) |
| DELETE | `/workspace/:id/skills/:name` | Delete skill directory |

#### Plugins (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspace/:id/plugins` | List plugins |
| POST | `/workspace/:id/plugins` | Add plugin spec |
| DELETE | `/workspace/:id/plugins/:name` | Remove plugin spec |

#### MCP Servers (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspace/:id/mcp` | List MCP entries |
| POST | `/workspace/:id/mcp` | Add/update MCP entry |
| DELETE | `/workspace/:id/mcp/:name` | Remove MCP entry |
| DELETE | `/workspace/:id/mcp/:name/auth` | Logout MCP |

#### Commands (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspace/:id/commands` | List commands |
| POST | `/workspace/:id/commands` | Upsert command |
| DELETE | `/workspace/:id/commands/:name` | Delete command |

#### File Sessions (client auth)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/workspace/:id/files/sessions` | Create file session (with TTL) |
| POST | `/files/sessions/:id/renew` | Extend session TTL |
| DELETE | `/files/sessions/:id` | Close session |
| GET | `/files/sessions/:id/catalog/snapshot` | Full workspace file listing |
| GET | `/files/sessions/:id/catalog/events` | Changelog events since cursor |
| POST | `/files/sessions/:id/read-batch` | Batch file reads (base64) |
| POST | `/files/sessions/:id/write-batch` | Batch file writes (revision locking) |
| POST | `/files/sessions/:id/ops` | FS ops: mkdir, delete, rename |

#### Inbox / Artifacts (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/workspace/:id/inbox` | List/upload inbox files |
| GET | `/workspace/:id/inbox/:inboxId` | Download inbox file |
| GET | `/workspace/:id/artifacts` | List outbox artifacts |
| GET | `/workspace/:id/artifacts/:id` | Download artifact |

#### Agent Lab Automations (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspace/:id/agentlab/automations` | List automations |
| POST | `/workspace/:id/agentlab/automations` | Create/update automation |
| DELETE | `/workspace/:id/agentlab/automations/:id` | Delete automation |
| POST | `/workspace/:id/agentlab/automations/:id/run` | Trigger automation |
| GET | `/workspace/:id/agentlab/automations/logs[/:id]` | List/read logs |

#### OpenCode Router / Chat Integrations (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspace/:id/opencode-router/health` | Router health |
| GET/POST | `/workspace/:id/opencode-router/telegram*` | Telegram config + identity CRUD |
| GET/POST/DELETE | `/workspace/:id/opencode-router/identities/slack*` | Slack identity CRUD |
| GET/POST | `/workspace/:id/opencode-router/bindings` | Channel->directory bindings |
| POST | `/workspace/:id/opencode-router/send` | Send message via Telegram/Slack |

#### Export / Import (client auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workspace/:id/export` | Export full workspace config |
| POST | `/workspace/:id/import` | Import workspace config bundle |

#### Approvals (host auth)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/approvals` | List pending approvals |
| POST | `/approvals/:id` | Respond allow or deny |

#### Transparent Proxies (pre-route dispatch)

| Path Pattern | Target |
|---|---|
| `/opencode/*` or `/w/:id/opencode/*` | OpenCode HTTP server |
| `/opencode-router/*` or `/w/:id/opencode-router/*` | OpenCode Router |

### 6.4 Filesystem-Backed Storage Model

**No database for workspace data** -- everything lives in files:

| Data | Location | Format |
|------|----------|--------|
| Skills | `<ws>/.opencode/skills/<name>/SKILL.md` | Markdown + YAML frontmatter |
| Commands | `<ws>/.opencode/commands/<name>.md` | Markdown + YAML frontmatter |
| Plugins | `<ws>/opencode.json[c]` -> `"plugin"` | JSONC |
| MCP config | `<ws>/opencode.json[c]` -> `"mcp"` | JSONC |
| OpenCode config | `<ws>/opencode.json[c]` | JSONC |
| AuroWork workspace config | `<ws>/.opencode/aurowork.json` | JSON |
| Agent Lab automations | `<ws>/.opencode/aurowork/agentlab/automations.json` | JSON |
| Inbox files | `<ws>/.opencode/aurowork/inbox/<path>` | Binary |
| Outbox/artifacts | `<ws>/.opencode/aurowork/outbox/<path>` | Binary |
| Scoped tokens | `~/.config/aurowork/tokens.json` | JSON (hashes only) |
| Server config | `~/.config/aurowork/server.json` | JSON |
| Global OpenCode config | `~/.config/opencode/opencode.json[c]` | JSONC |

**JSONC-safe editing:** Uses `jsonc-parser`'s `modify()` + `applyEdits()` for surgical AST-level edits preserving comments and formatting.

**Atomic writes:** All file writes use `tmp-<uuid>` + `rename()` to prevent partial writes.

**Reload watchers:** `fs.watch()` on each workspace's `.opencode/` subtree and root config files. Changes emit `ReloadEvent`s, clients poll via `GET /workspace/:id/events?since=<seq>`. Debounced at 750ms.

### 6.5 Authentication Model

**Two-tier authentication with three token scopes:**

| Tier | Header | Scopes | Purpose |
|------|--------|--------|---------|
| Host | `X-AuroWork-Host-Token` | owner | Admin: workspace management, token CRUD, approval responses |
| Client | `Authorization: Bearer` | owner > collaborator > viewer | Workspace operations with scope gating |

- Token values are SHA-256 hashed before storage; plaintext returned only at creation
- `viewer` tokens: read-only (GET/HEAD only)
- `collaborator` tokens: read + write (but not token/approval management)
- `owner` tokens: full access

### 6.6 Approval Gate

Every mutating operation calls `requireApproval()`:
- **Manual mode (default):** Pending `ApprovalRequest` stored in-memory. Host polls `GET /approvals`, responds via `POST /approvals/:id`. Promise-based suspension.
- **Auto mode:** Returns `{ allowed: true }` immediately.
- **Timeout:** 30s default, yields `{ allowed: false, reason: "timeout" }`.

### 6.7 OpenCode Integration

The server is a **sidecar to OpenCode** -- augments, doesn't replace:

- **Proxy layer:** `/opencode/*` paths forwarded to OpenCode with stripped auth headers and injected `X-OpenCode-Directory`
- **Direct API calls:** Session deletion, automation prompts, MCP auth/disconnect, engine reload
- **Direct SQLite access:** `opencode-db.ts` opens OpenCode's SQLite database for seeding sessions with initial messages

### 6.8 Workspace Initialization

When creating a workspace, `ensureWorkspaceFiles()` seeds:
- Starter skills (`workspace-guide`, `get-started`)
- An `aurowork.md` agent definition
- Starter commands (`learn-files`, `learn-skills`, `learn-plugins`, `get-started`)
- An `opencode.jsonc` with `default_agent: "aurowork"`, `opencode-scheduler` plugin, `control-chrome` MCP

Preset system (`starter`, `automation`, `remote`) controls which items are included.

---

## 7. apps/orchestrator -- CLI Orchestrator

**Package:** `aurowork-orchestrator` v0.11.193

CLI host daemon that manages OpenCode + AuroWork server + OpenCode Router together. Features a TUI (terminal dashboard). Published to npm as the `aurowork` command.

### 7.1 Directory Structure

```
apps/orchestrator/
├── bin/aurowork              # Node.js wrapper shim (CJS), dispatches to platform binary
├── script/build.ts           # Bun compile script -- builds single-file binary
├── scripts/
│   ├── build-bin.ts          # Copies sidecars into dist/, writes versions.json
│   ├── build-sidecars.mjs   # Builds all sidecar binaries for all platforms
│   ├── postinstall.mjs       # npm postinstall: resolves platform binary
│   ├── publish-npm.mjs       # Publishes meta + 5 platform packages to npm
│   └── router.mjs            # Integration test for daemon router
├── src/
│   ├── cli.ts                # ~5554-line main entry -- the entire CLI
│   └── tui/
│       ├── app.tsx           # Terminal UI component (SolidJS + @opentui/solid)
│       └── opentui-jsx.d.ts  # JSX type declarations
├── bunfig.toml               # Bun config: preloads @opentui/solid/preload
├── package.json
└── tsconfig.json
```

### 7.2 CLI Commands

| Command | Handler | Description |
|---------|---------|-------------|
| `start` | `runStart()` | Start TUI + services |
| `serve` | `runStart()` | Start without TUI |
| `daemon run` | `runRouterDaemon()` | Multi-workspace daemon |
| `daemon start/stop/status` | `runDaemonCommand()` | Daemon lifecycle |
| `workspace add/list/switch/info/path/add-remote` | `runWorkspaceCommand()` | Workspace management |
| `instance dispose` | `runInstanceCommand()` | Dispose OpenCode instance |
| `approvals list/reply` | `runApprovals()` | Approval management |
| `files session/catalog/events/read/write/...` | `runFiles()` | File session operations |
| `status` | `runStatus()` | Current status |

### 7.3 Startup Sequence (`runStart()`)

```
1. Resolve workspace, data dir, opencode state layout
2. Resolve binary paths for opencode + aurowork-server
3. Allocate random free ports (opencode, aurowork-server, control)
4. Generate managed credentials (512-char random username/password)
5. Start control HTTP server on 127.0.0.1:{random}
6. Conditionally start TUI (if TTY + pretty format + not --detach/--check)
7. Spawn OpenCode: opencode serve --hostname 127.0.0.1 --port {port}
8. Wait for OpenCode health (polls /health via SDK)
9. Spawn aurowork-server with resolved OpenCode URL
10. Wait for aurowork-server health
11. Issue AuroWork owner token via POST /tokens
12. Optionally start worker activity heartbeat (Den integration)
13. Output startup summary (TUI, JSON, or plain text)
14. If --detach: unref children, print summary, exit
15. If --check: run checks, exit
16. Block forever + SIGINT/SIGTERM handlers
```

### 7.4 Sidecar Binary Resolution

**4-way source preference** (`auto | bundled | downloaded | external`):

For `auto` mode:
1. **Bundled** (in `versions.json` alongside binary) -- SHA-256 verified on Linux
2. **Downloaded** from GitHub via sidecar manifest JSON -- SHA-256 verified, cached at `~/.aurowork/aurowork-orchestrator/sidecars/{version}/{target}/`
3. **External** (from `$PATH` or `node_modules`, requires `--allow-external`)

### 7.5 TUI (Terminal UI)

**Framework:** `@opentui/solid` -- SolidJS-based terminal renderer (60 FPS, mouse support, Kitty keyboard protocol)

**Views (tab-switched):**

| View | Key | Description |
|------|-----|-------------|
| Overview | `O`/`B` | Service status, ports, connection info |
| Logs | `L` | Scrollable log stream with service/level filtering |
| Router | `W` | Messaging router health + Telegram/Slack config |
| Help | `H`/`?` | Keyboard shortcut reference |

**Key bindings:** `Q`/`Ctrl+C` quit, `D` detach, `C` copy attach command, `F` toggle follow, `S` cycle service filter, `R` refresh router, `T` enter Telegram token.

**State (SolidJS store):** `services[]`, `connect`, `routerHealth`, `logs[]` (ring buffer, 800 max), `scrollOffset`, `follow`, `levelFilter`.

**Fallback:** If `@opentui/solid` fails to initialize, `switchToPlainOutput()` falls back to plain stdout.

### 7.6 Daemon Mode (`runRouterDaemon()`)

Multi-workspace daemon:
- Starts a **single shared OpenCode** instance (the "active workspace")
- Lightweight HTTP server on `127.0.0.1:{daemonPort}` as workspace registry
- State persisted to `aurowork-orchestrator-state.json`
- Routes: `GET /health`, `GET/POST /workspaces`, `POST /workspaces/:id/activate`, `POST /instances/:id/dispose`, `POST /shutdown`

### 7.7 Control Server

Internal HTTP on `127.0.0.1:{controlPort}`, authenticated with per-run UUID bearer token:
- `GET /runtime/versions` -- snapshot of service versions and upgrade state
- `POST /runtime/upgrade` -- hot upgrade of opencode and/or aurowork-server (stop, re-resolve, re-spawn, wait for health)

### 7.8 CLI Flags

#### Core Flags

| Flag | Env | Default | Description |
|------|-----|---------|-------------|
| `--workspace <path>` | `AUROWORK_WORKSPACE` | cwd | Working directory |
| `--data-dir <path>` | `AUROWORK_DATA_DIR` | `~/.aurowork/aurowork-orchestrator` | State root |
| `--tui` / `--no-tui` | -- | auto (TTY) | TUI toggle |
| `--detach` | `AUROWORK_DETACH` | false | Detach after start |
| `--log-format` | `AUROWORK_LOG_FORMAT` | `pretty` | `pretty` or `json` (OTel) |
| `--verbose` | `AUROWORK_VERBOSE` | false | Extra diagnostics |

#### OpenCode Sidecar Flags

| Flag | Env | Default |
|------|-----|---------|
| `--opencode-bin <path>` | `AUROWORK_OPENCODE_BIN` | auto |
| `--opencode-host <host>` | `AUROWORK_OPENCODE_HOST` | `127.0.0.1` |
| `--opencode-port <port>` | `AUROWORK_OPENCODE_PORT` | random |
| `--opencode-source <mode>` | `AUROWORK_OPENCODE_SOURCE` | `auto` |

#### AuroWork Server Flags

| Flag | Env | Default |
|------|-----|---------|
| `--aurowork-host` | `AUROWORK_HOST` | `127.0.0.1` |
| `--aurowork-port` | `AUROWORK_PORT` | `8787` |
| `--aurowork-token` | `AUROWORK_TOKEN` | random UUID |
| `--aurowork-host-token` | `AUROWORK_HOST_TOKEN` | random UUID |
| `--remote-access` | `AUROWORK_REMOTE_ACCESS` | false |
| `--approval <mode>` | `AUROWORK_APPROVAL_MODE` | `manual` |
| `--read-only` | `AUROWORK_READONLY` | false |

### 7.9 npm Publishing

**Two-tier package layout:**

1. **Meta-package** `aurowork-orchestrator`: Contains `bin/aurowork` (Node.js wrapper shim), `postinstall.mjs`, `constants.json`. `optionalDependencies` point to 5 platform packages.

2. **Platform packages** (5 targets): `aurowork-orchestrator-{darwin-arm64,darwin-x64,linux-x64,linux-arm64,windows-x64}`. Each contains the actual Bun-compiled binary.

**Wrapper shim** (`bin/aurowork`): Detects platform + arch -> `require.resolve()` the platform package -> run its binary. Fallback: `dist/bin/aurowork`.

**Postinstall:** Tries `require()` for platform package. If not found, downloads binary from GitHub releases. Fatal with manual instructions if all paths fail.

### 7.10 Logger

Structured logger with two modes:
- **`pretty`:** Human-readable with ANSI colors per component
- **`json`:** OTel log format (`timeUnixNano`, `severityText`, `body`, `attributes`, `resource`)

In TUI mode, entries feed into `tui.pushLog()` instead of stdout.

---

## 8. Enterprise Edition (ee/)

The cloud infrastructure layer for hosted AuroWork workers. Contains the "Den" platform.

### 8.1 Den Controller (`ee/apps/den-controller/`)

**Package:** `@aurowork-ee/den-controller`

Cloud control plane API built with Express + better-auth + Drizzle ORM + MySQL.

#### 8.1.1 Authentication (`src/auth.ts`)

- **Library:** better-auth with Drizzle adapter (MySQL/PlanetScale)
- **Social providers:** GitHub OAuth, Google OAuth
- **Email:** Email + password with verification, email OTP (6-digit code, 600s expiry, 5 attempts)
- **Organization plugin:** Teams enabled, creator role = "owner", dynamic access control
- **Rate limiting (database-backed):** `/sign-in/email` 5/300s, `/sign-up/email` 3/3600s, default 20/60s
- **Post-verification hooks:** `ensureUserOrgAccess()` creates personal org; `syncDenSignupContact()` sends to Loops
- **TypeID generation:** All IDs use typed prefixes (`user_`, `session_`, `organization_`, `worker_`, etc.)

#### 8.1.2 API Routes

| Route | Description |
|-------|-------------|
| `ALL /api/auth/*` | better-auth handler |
| `GET /health` | Health check |
| `GET /v1/me` | Current user session |
| `GET /v1/me/orgs` | User organizations |
| `USE /v1/admin` | Admin router |
| `USE /v1/auth` | Desktop auth router |
| `USE /v1/orgs` | Organizations router |
| `USE /v1/workers` | Workers router |

#### 8.1.3 Workers API (`src/http/workers.ts`)

| Endpoint | Description |
|----------|-------------|
| `GET /` | List workers for active org |
| `POST /` | Create worker (local or cloud); cloud -> async 202 with billing gate |
| `GET /:id` | Get worker by ID |
| `PATCH /:id` | Update worker name |
| `DELETE /:id` | Deprovision + delete (cascading) |
| `POST /:id/tokens` | Get tokens + resolved connect URL (`/w/ws_*`) |
| `POST /:id/activity-heartbeat` | Worker heartbeat (activity token) |
| `GET /:id/runtime` | Proxy to worker runtime versions |
| `POST /:id/runtime/upgrade` | Proxy runtime upgrade |
| `GET /billing` | Billing status (checkout URL, portal URL, invoices) |
| `POST /billing/subscription` | Set cancel-at-period-end |

**Billing gate:** 1 free cloud worker. Additional requires active Polar subscription. Dev mode bypasses.

**Cloud provisioning:** Async -- worker inserted as `provisioning`, continues in background. On failure -> `failed`.

#### 8.1.4 Organizations API (`src/http/orgs.ts`)

| Endpoint | Description |
|----------|-------------|
| `POST /` | Create organization |
| `GET /invitations/accept` | Accept invitation |
| `GET /:orgSlug/context` | Full org context (members, invitations, roles) |
| `POST /:orgSlug/invitations` | Send invitation (7-day expiry) |
| `POST /:orgSlug/invitations/:id/cancel` | Cancel invitation |
| `POST /:orgSlug/members/:id/role` | Update member role |
| `DELETE /:orgSlug/members/:id` | Remove member |
| `POST /:orgSlug/roles` | Create custom role with permission map |
| `PATCH/DELETE /:orgSlug/roles/:id` | Update/delete role |
| `POST/GET /:orgSlug/templates` | Template sharing CRUD |

#### 8.1.5 Desktop Auth (`src/http/desktop-auth.ts`)

Desktop handoff flow bridges web auth -> desktop deep link:
1. `POST /v1/auth/desktop-handoff`: Creates one-time grant (24 bytes base64url, 5-min expiry). Returns `aurowork://den-auth?grant=...&denBaseUrl=...` deep link.
2. `POST /v1/auth/desktop-handoff/exchange`: Exchanges grant for session token + user info. One-time use.

#### 8.1.6 Provisioner (`src/workers/provisioner.ts`)

**3 modes** (via `PROVISIONER_MODE`):
- **`daytona`** (default): Daytona cloud sandboxes
- **`render`**: Render.com web services
- **`stub`**: Template URL substitution (testing)

**Daytona provisioning:**
1. Create two persistent volumes (workspace + data)
2. Create sandbox from snapshot (2 vCPU / 4GB RAM / 8GB disk)
3. Execute `aurowork serve` start script with retry loop
4. Get signed preview URL (24h expiry, auto-refresh with 5-min lead)
5. Poll `/health` until healthy
6. Return worker proxy URL

**Render provisioning:** Creates Render web service, builds with `npm install -g aurowork-orchestrator`, starts `aurowork serve`, polls until deploy is `live`.

#### 8.1.7 Billing (`src/billing/polar.ts`)

Polar.sh integration:
- Customer lookup by `external_id` (userId) or email
- Checks `granted_benefits` for configured benefit ID
- 14-day free trial on checkout
- Exposes: `requireCloudWorkerAccess()`, `getCloudWorkerBillingStatus()`, `setCloudWorkerSubscriptionCancellation()`

### 8.2 Den-DB (`ee/packages/den-db/`)

MySQL via Drizzle ORM. All IDs use TypeID typed prefixes.

#### Authentication Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `user` | Primary user record | id (TypeID), name, email (unique), email_verified |
| `session` | Auth sessions | id, user_id, active_organization_id, token (unique), expires_at |
| `account` | OAuth provider accounts | id, user_id, provider_id, access_token, refresh_token |
| `verification` | Email OTP codes | id, identifier, value, expires_at |
| `rate_limit` | Database-backed rate limiting | id, key (unique), count, last_request |

#### Organization Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `organization` | Organizations | id, name, slug (unique), logo |
| `member` | Org membership | id, organization_id, user_id, role; unique(org_id, user_id) |
| `invitation` | Invitations | id, organization_id, email, role, status, expires_at (7 days) |
| `team` | Teams within orgs | id, name, organization_id; unique(org_id, name) |
| `team_member` | Team membership | id, team_id, user_id; unique(team_id, user_id) |
| `organization_role` | Custom roles | id, organization_id, role, permission (JSON) |

#### Worker Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `worker` | Worker records | id, org_id, name, destination (local/cloud), status (provisioning/healthy/failed/stopped), last_heartbeat_at |
| `worker_instance` | Provisioned instances | id, worker_id, provider, url, status |
| `daytona_sandbox` | Daytona sandbox state | id, worker_id (unique), sandbox_id, volume IDs, signed_preview_url |
| `worker_token` | Access tokens | id, worker_id, scope (client/host/activity), token (unique) |
| `worker_bundle` | Bundle/snapshot refs | id, worker_id, storage_url, status |
| `audit_event` | Worker action audit | id, org_id, worker_id, actor_user_id, action, payload |
| `desktop_handoff_grant` | One-time desktop grants | id, user_id, session_token, expires_at, consumed_at |
| `temp_template_sharing` | Template sharing | id, organization_id, creator info, template_json |
| `admin_allowlist` | Admin email allowlist | id, email (unique) |

### 8.3 Den Web (`ee/apps/den-web/`)

**Framework:** Next.js 14 App Router, TypeScript, TailwindCSS.

**Pages:**

| Route | Screen | Description |
|-------|--------|-------------|
| `/` | `DashboardRedirectScreen` | Auth-based redirect logic |
| `/dashboard` | `DashboardScreen` | Main worker dashboard |
| `/checkout` | `CheckoutScreen` | Billing/plan selection |
| `/o/[orgSlug]/dashboard` | `OrgDashboardShell` | Org-scoped dashboard |
| `/o/.../manage-members` | `ManageMembersScreen` | Member management |
| `/admin` | Admin panel | Internal admin view |

**AuthScreen:** Social (GitHub/Google), email + password, OTP verification, desktop handoff (detects `?grant=` param -> deep link).

**DashboardScreen:**
- **Sidebar:** Worker list with status badges, billing summary
- **Main panel:** Overview, Connection details (URL + tokens with copy), Worker actions (refresh/status/redeploy/delete), Worker runtime (versions + upgrade), Recent activity, Billing snapshot

**CheckoutScreen:** Two-column cards: Den Cloud ($50/mo, 14-day trial) vs Desktop App (free). Polar checkout integration.

**State:** `DenFlowProvider` (React context) manages: auth state, workers, billing, runtime, events, all async operations.

**API proxying:** `/api/auth/*` and `/api/den/*` routes proxy to den-controller.

### 8.4 Den Worker Proxy (`ee/apps/den-worker-proxy/`)

**Framework:** Hono + Bun runtime. Reverse proxy that keeps Daytona API keys server-side.

- **Route:** `/{workerId}/{...path}` -> proxied to signed Daytona preview URL
- **Auth:** Validates `X-AuroWork-Host-Token` or `Authorization: Bearer` against `worker_token` table
- **Rate limiting:** Anonymous: 60 reads/min (no writes). Authenticated: 240 reads/min, 60 writes/min.
- **Signed URL management:** Caches URLs, deduplicates concurrent refresh requests, auto-refreshes 5 min before expiry
- **CORS:** Strips hop-by-hop headers, sets wildcard `Access-Control-Allow-Origin: *`

### 8.5 Den Worker Runtime (`ee/apps/den-worker-runtime/`)

Runtime packaging for Daytona cloud sandboxes.

**Docker image** (`Dockerfile.daytona-snapshot`):
- Build stage: `node:22-bookworm-slim`, installs bun, builds `aurowork-orchestrator` binary
- Runtime stage: Copies `aurowork` + `opencode` binaries, runs `sleep infinity`

**Daytona start script:**
```bash
mkdir -p {workspace,data,volumes}
ln -sfn {volumeMountPaths} volumes/
aurowork serve --workspace <path> --remote-access \
  --aurowork-port 8787 --opencode-port 4096 \
  --cors '*' --approval manual --allow-external \
  --opencode-source external --opencode-bin $(command -v opencode)
```

**Activity heartbeat:** Workers ping `POST /v1/workers/{id}/activity-heartbeat` with `isActiveRecently`, `lastActivityAt`, `openSessionCount` using activity-scoped token.

### 8.6 Landing Page (`ee/apps/landing/`)

**Framework:** Next.js 14, TailwindCSS, Framer Motion.

**Pages:** Home (`/`), Den (`/den`), Enterprise (`/enterprise`), Download (`/download`), Feedback (`/feedback`).

**Home page components:**
- Hero: "The open source Claude Cowork for your team" + Download/Contact CTAs
- App demo panel with animated flow selector
- 3-column cards (Desktop, Cloud, Enterprise)
- Provider section (Subscription, BYOK, Local tabs)
- Team showcase with animated 3-step use case switcher

**API routes:** `POST /api/app-feedback` (Slack webhook), `POST /api/enterprise-contact` (Slack webhook).

**Custom fonts:** FKRasterRomanCompact family (woff2).

---

## 9. Packages (packages/)

### 9.1 packages/docs/

**Platform:** Mintlify (`docs.json` schema). Theme: `mint`. Primary color: `#0F766E` (teal).

**Documentation pages:**

| Page | Description |
|------|-------------|
| `get-started` | CLI install (`npm install -g aurowork-orchestrator`), `aurowork start`, connect remote |
| `sharing-ow-setup` | Sharing AuroWork setup |
| `how-to-connect-a-custom-provider` | Custom LLM providers |
| `how-to-connect-mcps` | MCP server connection |
| `accessing-ow-from-slack` | Slack integration |
| `importing-a-skill` | Skill import workflow |
| `computer-use` | Computer use / browser automation |
| `how-to-connect-chat-gpt` | ChatGPT provider |
| `enable-advanced-search-with-exa` | Exa search integration |

### 9.2 packages/app/

Minimal shared utilities:
- `src/app/lib/deep-link-bridge.ts` -- bridge for desktop deep link handling
- `pr/` -- PR notes and screenshots (e.g., server token persistence)

---

## 10. CI/CD and Release Pipeline

### 10.1 Continuous Integration (`ci.yml`)

Triggers on push/PR to `dev`. Three parallel jobs:
1. **Build Web** (`@aurowork-ee/den-web`) -- Next.js build
2. **Build Den** (`@aurowork-ee/den-controller`) -- TypeScript compile
3. **Build Orchestrator** -- typecheck + `build:bin` + validate binary

Runner: `blacksmith-4vcpu-ubuntu-2404`.

### 10.2 Release Pipeline (`release-macos-aarch64.yml`)

Triggers on `v*` tag push or manual dispatch. Jobs in dependency order:

```
1. resolve-release     -- Validate semver, create GitHub Release (draft)
2. verify-release      -- Check tag matches package.json versions
3. publish-tauri       -- Build desktop app (5 platforms: macOS ARM/x64,
   (matrix: 5)            Linux x64/ARM, Windows x64). Apple notarization.
4. publish-updater-json -- Generate latest.json from release assets
5. release-orchestrator -- Build orchestrator for all platforms,
   -sidecars              create aurowork-orchestrator-v{version} release
6. publish-npm          -- Publish to npm: aurowork-server,
                           opencode-router, aurowork-orchestrator
7. publish-daytona      -- Build Docker image, push to Daytona snapshot,
   -snapshot               deploy to Render
8. aur-publish          -- Update PKGBUILD, publish to AUR
9. publish-release      -- Remove draft flag from GitHub Release
```

### 10.3 Other Workflows

| Workflow | Purpose |
|----------|---------|
| `deploy-den.yml` | Deploy Den control plane to Render |
| `release-daytona-snapshot.yml` | Build + push Daytona snapshot image |
| `aur-validate.yml` | AUR package validation |
| `download-stats.yml` | Download stats collection |
| `opencode-agents.yml` | OpenCode agent automation |

### 10.4 Release Scripts (`scripts/release/`)

| Script | Purpose |
|--------|---------|
| `prepare.mjs` | Pre-release preparation (version bumps) |
| `review.mjs` | Release validation checks (`--strict` for CI) |
| `ship.mjs` | Manual release shipping |
| `verify-tag.mjs` | Verify git tag matches all package.json versions |
| `generate-latest-json.mjs` | Aggregate Tauri update signatures into `latest.json` |

---

## 11. Design Assumptions and Principles

### 11.1 Architecture Principles

- **Predictable > Clever:** Explicit configuration over heuristics. Auto-detection must be explainable, overrideable, and safe.
- **Filesystem mutation policy:** All writes routed through AuroWork server (not Tauri directly) for parity between desktop and cloud.
- **Server-consumption first:** AuroWork app consumes AuroWork server surfaces instead of inventing parallel behavior.
- **Parity:** UI actions map to OpenCode server APIs.
- **Transparency:** Plans, steps, tool calls, permissions are visible.
- **Least privilege:** Only user-authorized folders + explicit approvals.
- **Prompt is the workflow:** Product logic lives in prompts, rules, and skills.
- **Local-first:** No secrets in git. OS keychain for credentials. Graceful degradation.

### 11.2 Infrastructure Principles

1. **CLI-first, always** -- every component runnable via single CLI command
2. **Unix-like interfaces** -- JSON over stdout, flags, env vars
3. **Sidecar-composable** -- any component runs as sidecar
4. **Clear boundaries** -- OpenCode is engine, AuroWork adds thin UX layer
5. **Local-first, graceful degradation** -- cloud is first-class option, not separate product
6. **Portable configuration** -- config files + env vars, no hidden state
7. **Observability by default** -- health endpoints + structured logs
8. **Security + scoping** -- filesystem access scoped to workspace roots

### 11.3 Design Language

- **No glassmorphism** (`backdrop-blur`, frosted glass) on core application surfaces
- **No extraneous chrome** -- no decorative counters/pills/badges unless functional
- **No aggressive gradients** -- no radial/linear background washes behind panels
- **Flat hierarchy** -- soft `1px` borders, semantic backgrounds (`bg-gray-1/2/3`)
- **Preserve anchor** -- never hide primary labels for hover actions
- **Palette:** Tight monochrome grayscale + intentional accents. Base: `bg-dls-sidebar` or `bg-gray-1`. Ink: `text-gray-12`.
- **Geometry:** Large panels `rounded-2xl`, lists `rounded-xl`, badges `rounded-full`.
- **Typography:** Inter sans, monospace for commands/paths. Eyebrows: `text-[11px]` uppercase `tracking-[0.18em]`.
- **Primary button:** `bg-[#011627]` dark fill, white text, `rounded-full`.
- **Landing page exception:** Only place where frosted blur (`landing-shell`) is appropriate.

### 11.4 OpenCode Primitives Hierarchy

How to pick the right extension abstraction:

| Primitive | When to Use |
|-----------|-------------|
| **MCP** | Authenticated third-party flows (OAuth), expose capability safely |
| **Plugins** | Real tools in code, scoped permissions, safer than raw CLI |
| **Skills** | Reliable plain-english patterns that shape behavior, repeatability |
| **Bash/CLI** | Advanced users, internal power workflows, prototyping |
| **Agents** | Tasks executed by different models with extra context |
| **Commands** | `/` commands that trigger tools |

### 11.5 Workspace Terminology

- **Selected workspace:** UI concept -- the workspace user is currently viewing
- **Runtime active workspace:** Backend concept -- the workspace the server/orchestrator currently reports as active
- **Watched workspace:** Desktop-host concept -- which workspace root file watching is attached to
- These states can diverge briefly while the UI is browsing another workspace

---

## 12. Data Flow Diagrams

### 12.1 Mode A -- Desktop Runtime Stack

```
/apps/app UI (SolidJS)
    |
    v
/apps/desktop (Tauri shell)
    |
    +--> /apps/orchestrator (daemon or start/serve host)
    |          |
    |          v
    |        OpenCode (AI engine, loopback)
    |
    +--> /apps/server (AuroWork API + proxy)
    |          |
    |          +--> OpenCode (proxied)
    |          +--> /apps/opencode-router (optional, Telegram/Slack)
    |
    +--> /apps/opencode-router (optional local child)
```

### 12.2 Mode B -- Cloud Runtime Stack

```
/ee/apps/den-web (Next.js, auth + dashboard)
    |
    v
/ee/apps/den-controller (Express, auth + worker CRUD)
    |
    +--> Daytona/Render provisioning
    |        |
    |        v
    |      /ee/apps/den-worker-runtime
    |        -> aurowork serve + OpenCode (in sandbox)
    |
    +--> /ee/apps/den-worker-proxy
           (signed preview URL proxy)

AuroWork app (any client)
    -> Connect remote (URL + token)
    -> worker AuroWork server surface
```

### 12.3 Cloud Worker Lifecycle

```
User opens den-web
  -> AuthScreen: email+OTP or GitHub/Google OAuth
     -> POST /api/auth/* -> den-controller better-auth
        -> ensureUserOrgAccess() -> personal org if new

User clicks "Create Worker"
  -> POST /v1/workers { name, destination: "cloud" }
     -> Billing gate check (Polar benefit)
     -> INSERT worker (status: provisioning)
     -> INSERT 3 tokens (host, client, activity)
     -> 202 response
     -> [background] provisionWorkerOnDaytona()
        -> Create volumes -> Create sandbox -> aurowork serve
        -> Poll /health -> UPDATE status -> "healthy"

User opens dashboard
  -> GET /v1/workers -> list workers
  -> POST /v1/workers/{id}/tokens -> tokens + workspace URL

User clicks "Open in Desktop"
  -> aurowork://open?url={url}&token={token} deep link
     -> Desktop app connects to worker AuroWork server
        -> Worker proxy validates -> refreshes signed URL
        -> Proxies to Daytona sandbox

Worker runtime heartbeats
  -> POST /v1/workers/{id}/activity-heartbeat (activity token)
```

### 12.4 SSE Event Pipeline

```
OpenCode Engine
  -> SSE event stream
     -> GlobalSDKProvider (context/global-sdk.tsx)
        -> Event coalescing queue (keyed deduplication)
           -> 16ms batch flush via SolidJS batch()
              -> createSessionStore (context/session.ts)
                 -> Per-workspace SSE subscription
                    -> Store updates (sessions, messages, parts, todos)
                       -> Reactive UI re-renders (fine-grained)
```

---

## 13. Configuration Reference

### 13.1 Key Configuration Files

| File | Location | Purpose |
|------|----------|---------|
| `opencode.json` / `opencode.jsonc` | Workspace root | OpenCode configuration (model, MCP, plugins) |
| `.opencode/aurowork.json` | Workspace `.opencode/` | AuroWork workspace config |
| `~/.config/aurowork/server.json` | User home | AuroWork server configuration |
| `~/.config/aurowork/tokens.json` | User home | Scoped token hashes |
| `~/.config/opencode/opencode.json` | User home | Global OpenCode configuration |
| `constants.json` | Repo root | OpenCode version pin (`v1.2.27`) |
| `tauri.conf.json` | `apps/desktop/src-tauri/` | Tauri build + runtime configuration |

### 13.2 Environment Variables

| Variable | Component | Description |
|----------|-----------|-------------|
| `OPENCODE_BIN_PATH` | Desktop/Orchestrator | Override opencode binary path |
| `OPENCODE_CLIENT` | Engine | Set to `aurowork` |
| `AUROWORK_WORKSPACE` | Orchestrator | Working directory override |
| `AUROWORK_DATA_DIR` | Orchestrator | State directory |
| `AUROWORK_HOST` / `AUROWORK_PORT` | Server | Bind host/port |
| `AUROWORK_TOKEN` / `AUROWORK_HOST_TOKEN` | Server | Auth tokens |
| `AUROWORK_REMOTE_ACCESS` | Server | Bind to `0.0.0.0` |
| `AUROWORK_APPROVAL_MODE` | Server | `manual` or `auto` |
| `AUROWORK_OPENCODE_SOURCE` | Orchestrator | Binary source: `auto\|bundled\|downloaded\|external` |
| `PROVISIONER_MODE` | Den Controller | `daytona\|render\|stub` |
| `DEN_WORKER_ID` | Worker Runtime | Worker identification |
| `DEN_ACTIVITY_HEARTBEAT_URL` | Worker Runtime | Heartbeat endpoint |

### 13.3 Port Ranges

| Component | Port Range | Notes |
|-----------|-----------|-------|
| OpenCode Engine | `4096` (default) | Loopback only, randomized by orchestrator |
| AuroWork Server | `8787` (default) | Desktop: `48000-51000` per-workspace |
| Orchestrator daemon | Random | Loopback only |
| Control server | Random | Internal, per-run |
| Den Controller | `8788` (default) | Cloud control plane |

### 13.4 OpenCode Skills Storage

Skills are stored as `SKILL.md` files with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does
trigger: When to use this skill
---

# Skill content here
```

**Discovery paths:**
- Project: `<workspace>/.opencode/skills/<name>/SKILL.md`
- Global: `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`
- Multi-root: Walks up git roots to find all `.opencode/skills/` directories

### 13.5 OpenCode Commands Storage

Commands stored as `.md` files in `<workspace>/.opencode/commands/<name>.md` with YAML frontmatter:

```markdown
---
name: my-command
description: What this command does
---

Command prompt content here
```

---

## Appendix: Related Documentation

| Document | Purpose |
|----------|---------|
| `docs/architecture/overview.md` | Runtime architecture, design principles, Mode A/B |
| `docs/product/principles.md` | Decision framework for features and bugs |
| `docs/design/design-language.md` | Visual design system rules |
| `docs/architecture/infrastructure.md` | Infrastructure principles |
| `docs/product/product.md` | Product requirements, target users, UI/UX spec |
| `docs/product/vision.md` | Mission statement |
| `docs/architecture/agents.md` | Agent development guide |
| `docs/architecture/backend.md` | Rust/TypeScript API reference |
| `docs/ops/release.md` | Release procedures |
| `project-plan.md` | Current development roadmap |
| `apps/orchestrator/README.md` | Orchestrator CLI docs |
| `apps/server/README.md` | AuroWork Server docs |
| `ee/apps/den-controller/README.md` | Den controller API docs |
| `packaging/docker/README.md` | Docker dev setup |
