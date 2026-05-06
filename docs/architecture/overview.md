# AuroWork Architecture

## Design principle: Predictable > Clever

AuroWork optimizes for **predictability** over "clever" auto-detection. Users should be able to form a correct mental model of what will happen.

Guidelines:

- Prefer **explicit configuration** (a single setting or env var) over heuristics.
- Auto-detection is acceptable as a convenience, but must be:
  - explainable (we can tell the user what we tried)
  - overrideable (one obvious escape hatch)
  - safe (no surprising side effects)
- When a prerequisite is missing, surface the **exact failing check** and a concrete next step.

### Example: Docker-backed sandboxes (desktop)

When enabling Docker-backed sandbox mode, prefer an explicit, single-path override for the Docker client binary:

- `AUROWORK_DOCKER_BIN` (absolute path to `docker`)

This keeps behavior predictable across environments where GUI apps do not inherit shell PATH (common on macOS).

Auto-detection can exist as a convenience, but should be tiered and explainable:

1. Honor `AUROWORK_DOCKER_BIN` if set.
2. Try the process PATH.
3. On macOS, try the login PATH from `/usr/libexec/path_helper`.
4. Last-resort: try well-known locations (Homebrew, Docker Desktop bundle) and validate the binary exists.

The readiness check should be a clear, single command (e.g. `docker info`) and the UI should show the exact error output when it fails.

## Minimal use of Tauri
We move most of the functionality to the aurowork server which interfaces mostly with FS and proxies to opencode.



## Filesystem mutation policy

AuroWork should route filesystem mutations through the AuroWork server whenever possible.

Why:

- the server is the one place that can apply the same behavior for both local and remote workspaces
- server-routed writes keep permission checks, approvals, audit trails, and reload events consistent
- Tauri-only filesystem mutations only work in desktop host mode and break parity with remote execution

Guidelines:

- Any UI feature that changes workspace files or config should call an AuroWork server endpoint first.
- Local Tauri filesystem commands are a host-mode fallback, not the primary product surface.
- If a feature cannot yet write through the AuroWork server, treat that as an architecture gap and close it before depending on direct local writes.
- Reads can fall back locally when necessary, but writes should be designed around the AuroWork server path.

## Agent authority map

When AuroWork is edited from `aurowork-enterprise`, architecture and runtime behavior should be sourced from this document.

| Entry point | Role | Architecture authority |
| --- | --- | --- |
| `aurowork-enterprise/AGENTS.md` | AuroWork Factory multi-repo orchestration | Defers AuroWork runtime flow, server-vs-shell ownership, and filesystem mutation behavior to `_repos/aurowork/ARCHITECTURE.md`. |
| `aurowork-enterprise/.opencode/agents/aurowork-surgeon.md` | Surgical fix agent for `_repos/aurowork` | Uses `_repos/aurowork/ARCHITECTURE.md` as the runtime and architecture source of truth before changing product behavior. |
| `_repos/aurowork/AGENTS.md` | Product vocabulary, audience, and repo-local development guidance | Refers to `docs/architecture/overview.md` for runtime flow, server ownership, and architectural boundaries. |
| Skills / commands / agents that mutate workspace state | Capability layer on top of the product runtime | Should assume the AuroWork server path is canonical for workspace creation, config writes, `.opencode/` mutation, and reload signaling. |

### Agent access to server-owned behavior

Agents, skills, and commands should model the following as AuroWork server behavior first:

- workspace creation and initialization
- writes to `.opencode/`, `opencode.json`, and `opencode.jsonc`
- AuroWork workspace config writes (`.opencode/aurowork.json`)
- workspace template export/import, including shareable `.opencode/**` files and `opencode.json` state
- workspace template starter-session materialization from portable blueprint config (not copied runtime session history)
- share-bundle publish/fetch flows used by AuroWork template links
- reload event generation after config or capability changes
- other filesystem-backed capability changes that must work across desktop host mode and remote clients

Tauri or other native shell behavior remains the fallback or shell boundary for:

- file and folder picking
- reveal/open-in-OS affordances
- updater and window management
- host-side process supervision and native runtime bootstrapping

If an agent needs one of the server-owned behaviors above and only a Tauri path exists, treat that as an architecture gap to close rather than a parallel capability surface to preserve.

## opencode primitives
how to pick the right extension abstraction for 
@opencode

opencode has a lot of extensibility options:
mcp / plugins / skills / bash / agents / commands

- mcp
use when you need authenticated third-party flows (oauth) and want to expose that safely to end users
good fit when "auth + capability surface" is the product boundary
downside: you're limited to whatever surface area the server exposes

- bash / raw cli
use only for the most advanced users or internal power workflows
highest risk, easiest to get out of hand (context creep + permission creep + footguns)
great for power users and prototyping, terrifying as a default for non-tech users

- plugins
use when you need real tools in code and want to scope permissions around them
good middle ground: safer than raw cli, more flexible than mcp, reusable and testable
basically "guardrails + capability packaging"

- skills
use when you want reliable plain-english patterns that shape behavior
best for repeatability and making workflows legible
pro tip: pair skills with plugins or cli (i literally embed skills inside plugins right now and expose commands like get_skills / retrieve)

- agents
use when you need to create tasks that are executed by different models than the main one and might have some extra context to find skills or interact with mcps.

- commands 
`/` commands that trigger tools

These are all opencode primitives you can read the docs to find out exactly how to set them up.

## Core Concepts of AuroWork

- uses all these primitives
- uses native OpenCode commands for reusable flows (markdown files in `.opencode/commands`)
- adds a new abstraction "workspace" is a project folder and a simple .json file that includes a list of opencode primitives that map perfectly to an opencode workdir (not fully implemented)
  - aurowork can open a workpace.json and decide where to populate a folder with thse settings (not implemented today

## Repository/component map

- `/apps/app/`: AuroWork app UI (desktop/mobile/web client experience layer).
- `/apps/desktop/`: Tauri desktop shell that hosts the app UI and manages native process lifecycles.
- `/apps/server/`: AuroWork server (API/control layer consumed by the app).
- `/apps/orchestrator/`: AuroWork orchestrator CLI/daemon. In `start`/`serve` host mode it manages AuroWork server + OpenCode; in daemon mode it manages workspace activation and OpenCode lifecycle for desktop runtime.
- `/apps/share/`: share-link publisher service for AuroWork bundle imports.
- `/ee/apps/landing/`: AuroWork landing page surfaces.
- `/ee/apps/den-web/`: Den web UI for sign-in, worker creation, and future user-management flows.
- `/ee/apps/den-controller/`: Den controller API that provisions/spins up worker runtimes.
- `/ee/apps/den-worker-proxy/`: proxy layer that keeps Daytona API keys server-side, refreshes signed worker preview URLs, and forwards worker traffic so users do not manage provider keys directly.
- `/ee/apps/den-worker-runtime/`: worker runtime packaging (including Docker/runtime artifacts) deployed to Daytona sandboxes.

## Core Architecture

AuroWork is a client experience that consumes AuroWork server surfaces.

AuroWork supports two product runtime modes for users:

- desktop
- web/cloud (also usable from mobile clients)

AuroWork therefore has two runtime connection modes:

### Mode A - Desktop

- AuroWork runs on a desktop/laptop and can host AuroWork server surfaces locally.
- The OpenCode server runs on loopback (default `127.0.0.1:4096`).
- The AuroWork server also defaults to loopback-only access. Remote sharing is an explicit opt-in that rebinds the AuroWork server to `0.0.0.0` while keeping OpenCode on loopback.
- AuroWork UI connects via the official SDK and listens to events.
- `aurowork-orchestrator` is the CLI host path for this mode.

### Mode B - Web/Cloud (can be mobile)

- User signs in to hosted AuroWork web/app surfaces (including mobile browser/client access).
- User launches a cloud worker from hosted control plane.
- AuroWork returns remote connect credentials (`/w/ws_*` URL + access token).
- User connects from AuroWork app using `Add a worker` -> `Connect remote`.

This model keeps the user experience consistent across self-hosted and hosted paths while preserving OpenCode parity.

### Mode A composition (Tauri shell + local services)

- `/apps/app/` runs as the product UI; on desktop it is hosted inside `/apps/desktop/` (Tauri webview).
- `/apps/desktop/` exposes native commands (`engine_*`, `orchestrator_*`, `aurowork_server_*`) to start/stop local services and report status to the UI.
- Runtime selection in desktop:
  - `aurowork-orchestrator` (default): Tauri launches `aurowork daemon run` and uses it for workspace activation plus OpenCode lifecycle.
  - `direct`: Tauri starts OpenCode directly.
- In both desktop runtimes, AuroWork server (`/apps/server/`) is the API surface consumed by the UI; it is started with the resolved OpenCode base URL and proxies OpenCode routes.
- Desktop-launched OpenCode credentials are always random, per-launch values generated by AuroWork. OpenCode stays on loopback and is intended to be reached through AuroWork server rather than exposed directly.

```text
/apps/app UI
    |
    v
/apps/desktop (Tauri shell)
    |
    +--> /apps/orchestrator (daemon or start/serve host)
    |          |
    |          v
    |        OpenCode
    |
    +--> /apps/server (AuroWork API + proxy surface)
               |
               +--> OpenCode
```

### Mode B composition (Web/Cloud services)

- `/ee/apps/den-web/` is the hosted web control surface (sign-in, worker create, upcoming user management).
- `/ee/apps/den-controller/` is the cloud control plane API (auth/session + worker CRUD + provisioning orchestration).
- `/ee/apps/den-worker-runtime/` defines the runtime packaging and boot path used inside cloud workers (including Docker/snapshot artifacts and `aurowork serve` startup assumptions).
- `/ee/apps/den-worker-proxy/` fronts Daytona worker preview URLs, refreshes signed links with provider credentials, and proxies traffic to the worker runtime.
- The AuroWork app (desktop or mobile client) connects to worker AuroWork server surfaces via URL + token (`/w/ws_*` when available).

```text
/ee/apps/den-web
    |
    v
/ee/apps/den-controller
    |
    +--> Daytona/Render provisioning
    |        |
    |        v
    |      /ee/apps/den-worker-runtime -> aurowork serve + OpenCode
    |
    +--> /ee/apps/den-worker-proxy (signed preview + proxy)

AuroWork app/mobile client
    -> Connect remote (URL + token)
    -> worker AuroWork server surface
```

## Cloud Worker Connect Flow (Canonical)

1. Authenticate in AuroWork Cloud control surface.
2. Launch worker (with checkout/paywall when needed).
3. Wait for provisioning and health.
4. Generate/retrieve connect credentials.
5. Connect in AuroWork app via deep link or manual URL + token.

Technical note:

- Default connect URL should be workspace-scoped (`/w/ws_*`) when available.
- Technical diagnostics (host URL, worker ID, raw logs) should be progressive disclosure, not default UI.

## Web Parity + Filesystem Actions

The browser runtime cannot read or write arbitrary local files. Any feature that:

- reads skills/commands/plugins from `.opencode/`
- edits `SKILL.md` / command templates / `opencode.json`
- opens folders / reveals paths

must be routed through a host-side service.

In AuroWork, the long-term direction is:

- Use the AuroWork server (`/apps/server/`) as the single API surface for filesystem-backed operations.
- Treat Tauri-only file operations as an implementation detail / convenience fallback, not a separate feature set.

This ensures the same UI flows work on desktop, mobile, and web clients, with approvals and auditing handled centrally.

## OpenCode Integration (Exact SDK + APIs)

AuroWork uses the official JavaScript/TypeScript SDK:

- Package: `@opencode-ai/sdk/v2` (UI should import `@opencode-ai/sdk/v2/client` to avoid Node-only server code)
- Purpose: type-safe client generated from OpenAPI spec

### Engine Lifecycle

#### Start server + client (Host mode)

Use `createOpencode()` to launch the OpenCode server and create a client.

```ts
import { createOpencode } from "@opencode-ai/sdk/v2";

const opencode = await createOpencode({
  hostname: "127.0.0.1",
  port: 4096,
  timeout: 5000,
  config: {
    model: "anthropic/claude-3-5-sonnet-20241022",
  },
});

const { client } = opencode;
// opencode.server.url is available
```

#### Connect to an existing server (Client mode)

```ts
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  directory: "/path/to/project",
});
```

### Health + Version

- `client.global.health()`
  - Used for startup checks, compatibility warnings, and diagnostics.

### Event Streaming (Real-time UI)

AuroWork must be real-time. It subscribes to SSE events:

- `client.event.subscribe()`

The UI uses these events to drive:

- streaming assistant responses
- step-level tool execution timeline
- permission prompts
- session lifecycle changes

### Sessions (Primary Primitive)

AuroWork maps a "Task Run" to an OpenCode **Session**.

Core methods:

- `client.session.create()`
- `client.session.list()`
- `client.session.get()`
- `client.session.messages()`
- `client.session.prompt()`
- `client.session.abort()`
- `client.session.summarize()`

### Files + Search

AuroWork's file browser and "what changed" UI are powered by:

- `client.find.text()`
- `client.find.files()`
- `client.find.symbols()`
- `client.file.read()`
- `client.file.status()`

### Permissions

AuroWork must surface permission requests clearly and respond explicitly.

- Permission response API:
  - `client.permission.reply({ requestID, reply })` (where `reply` is `once` | `always` | `reject`)

AuroWork UI should:

1. Show what is being requested (scope + reason).
2. Provide choices (allow once / allow for session / deny).
3. Post the response to the server.
4. Record the decision in the run's audit log.

### Config + Providers

AuroWork's settings pages use:

- `client.config.get()`
- `client.config.providers()`
- `client.auth.set()` (optional flow to store keys)

### Extensibility - Skills + Plugins

AuroWork exposes two extension surfaces:

1. **Skills (OpenPackage)**
   - Installed into `.opencode/skills/*`.
   - AuroWork can run `opkg install` to pull packages from the registry or GitHub.

2. **Plugins (OpenCode)**
   - Plugins are configured via `opencode.json` in the workspace.
   - The format is the same as OpenCode CLI uses today.
   - AuroWork should show plugin status and instructions; a native plugin manager is planned.

### Engine reload (config refresh)

- AuroWork server exposes `POST /workspace/:id/engine/reload`.
- It calls OpenCode `POST /instance/dispose` with the workspace directory to force a config re-read.
- Use after skills/plugins/MCP/config edits; reloads can interrupt active sessions.
- Reload requests follow AuroWork server approval rules.

### OpenPackage Registry (Current + Future)

- Today, AuroWork only supports **curated lists + manual sources**.
- Publishing to the official registry currently requires authentication (`opkg push` + `opkg configure`).
- Future goals:
  - in-app registry search
  - curated list sync (e.g. Awesome Claude Skills)
  - frictionless publishing without signup (pending registry changes)

## Projects + Path

- `client.project.list()` / `client.project.current()`
- `client.path.get()`

AuroWork conceptually treats "workspace" as the current project/path.

## Optional TUI Control (Advanced)

The SDK exposes `client.tui.*` methods. AuroWork can optionally provide a "Developer Mode" screen to:

- append/submit prompt
- open help/sessions/themes/models
- show toast

This is optional and not required for non-technical MVP.

## Folder Authorization Model

AuroWork enforces folder access through **two layers**:

1. **AuroWork UI authorization**
   - user explicitly selects allowed folders via native picker
   - AuroWork remembers allowed roots per profile

2. **OpenCode server permissions**
   - OpenCode requests permissions as needed
   - AuroWork intercepts requests via events and displays them

Rules:

- Default deny for anything outside allowed roots.
- "Allow once" never expands persistent scope.
- "Allow for session" applies only to the session ID.
- "Always allow" (if offered) must be explicit and reversible.

## Open Questions

- Best packaging strategy for Host mode engine (bundled vs user-installed Node/runtime).
- Best remote transport for mobile client (LAN only vs optional tunnel).
- Scheduling API surface (native in OpenCode server vs AuroWork-managed scheduler).
