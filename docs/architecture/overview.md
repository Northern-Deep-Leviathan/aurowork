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

This document (`docs/architecture/overview.md`) is the canonical architectural reference for AuroWork. Agents, skills, and commands that mutate workspace state should assume the AuroWork server path is canonical for workspace creation, config writes, `.opencode/` mutation, and reload signaling.

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

## Core Architecture

AuroWork is a local desktop experience that consumes local AuroWork server surfaces.

The current product runtime mode is desktop:

- AuroWork runs on a desktop/laptop and can host AuroWork server surfaces locally.
- The OpenCode server runs on loopback (`127.0.0.1`) on a dynamically allocated port; the port is recorded in the orchestrator state file. Defaults are not hardcoded.
- The AuroWork server also defaults to loopback-only access on a port within the range `48000-51000`.
- AuroWork UI connects via the official SDK and listens to events.
- `aurowork-orchestrator` is treated as local desktop infrastructure unless explicitly re-scoped later.

### Desktop composition (Tauri shell + local services)

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

## Local Filesystem Actions

Any feature that:

- reads skills/commands/plugins from `.opencode/`
- edits `SKILL.md` / command templates / `opencode.json`
- opens folders / reveals paths

must be routed through a host-side service.

In AuroWork, the current direction is:

- Use the AuroWork server (`/apps/server/`) as the single API surface for filesystem-backed operations.
- Treat Tauri-only file operations as an implementation detail / convenience fallback, not a separate product surface.

This keeps local desktop file behavior explicit and testable while approvals and diagnostics remain centralized.

## OpenCode Integration (Exact SDK + APIs)

AuroWork uses the official JavaScript/TypeScript SDK:

- Package: `@opencode-ai/sdk` (currently pinned to `^1.1.31`)
- UI imports the v2 client subpath (`@opencode-ai/sdk/v2/client`) to avoid Node-only server code
- Purpose: type-safe client generated from OpenAPI spec

### Engine Lifecycle

#### Connect to an existing OpenCode server (Client mode)

AuroWork itself does **not** spawn the OpenCode server from JS. The OpenCode process is launched by `aurowork-orchestrator` (Rust/CLI) and AuroWork connects to it as a client via `createOpencodeClient`:

```ts
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

const client = createOpencodeClient({
  baseUrl: "http://127.0.0.1:<dynamic-port>",
  directory: "/path/to/project",
});
```

> Note: The SDK also exports `createOpencode()` for in-process server creation. AuroWork does not use it — process lifecycle is owned by the orchestrator.

### Health + Version

- `client.global.health()` — used for startup checks, compatibility warnings, and diagnostics. **In active use.**

### SDK surface used today vs planned

Today AuroWork primarily talks to OpenCode through the **AuroWork server proxy** (`/apps/server/`), which forwards to OpenCode HTTP routes. Direct SDK calls from the UI are limited to lightweight checks (e.g. `client.global.health()`).

The methods listed below are part of the OpenCode SDK surface that AuroWork plans to consume directly or proxy through. They are documented here as the integration target — **not all are wired up yet**. Confirm against `apps/app/` and `apps/server/` before relying on them.

#### Event Streaming (Real-time UI) — *via server proxy / planned for direct subscription*

AuroWork must be real-time. The relevant SDK surface:

- `client.event.subscribe()` (SSE)

Drives streaming assistant responses, step-level tool execution timeline, permission prompts, session lifecycle changes.

#### Sessions (Primary Primitive) — *proxied through AuroWork server*

AuroWork maps a "Task Run" to an OpenCode **Session**. Relevant SDK methods:

- `client.session.create()`, `client.session.list()`, `client.session.get()`
- `client.session.messages()`, `client.session.prompt()`
- `client.session.abort()`, `client.session.summarize()`

#### Files + Search — *planned*

- `client.find.text()`, `client.find.files()`, `client.find.symbols()`
- `client.file.read()`, `client.file.status()`

#### Permissions — *planned*

- `client.permission.reply({ requestID, reply })` where `reply` is `once` | `always` | `reject`

UI should: show what is requested (scope + reason); provide allow-once / allow-session / deny choices; post the response; record the decision in the run audit log.

#### Config + Providers — *planned*

- `client.config.get()`, `client.config.providers()`, `client.auth.set()`

### Extensibility - Skills + Plugins

AuroWork exposes two extension surfaces:

1. **Skills**
   - Installed into `.opencode/skills/*`.
   - AuroWork should preserve user-created skill folders and only update versioned built-in presets.

2. **Plugins (OpenCode)**
   - Plugins are configured via `opencode.json` in the workspace.
   - The format is the same as OpenCode CLI uses today.
   - AuroWork should show plugin status and instructions; a native plugin manager is planned.

### Engine reload (config refresh)

- AuroWork server exposes `POST /workspace/:id/engine/reload`.
- It calls OpenCode `POST /instance/dispose` with the workspace directory to force a config re-read.
- Use after skills/plugins/MCP/config edits; reloads can interrupt active sessions.
- Reload requests follow AuroWork server approval rules.

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
