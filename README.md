# AuroWork

> Local desktop AI workspace powered by OpenCode.

AuroWork is a native desktop app for running OpenCode-backed agent workflows on your own machine. The current product focus is deliberately narrow: local folders, local sessions, local `.opencode` configuration, local file access, and a reliable desktop release pipeline.

## Current Scope

- **Local desktop first**: the default app runs through Tauri and binds local services to loopback.
- **Workspace based**: pick a folder and work inside that authorized local workspace.
- **Sessions**: create and switch OpenCode-backed chat sessions for the selected workspace.
- **Local configuration**: manage workspace skills, commands, plugins, MCP config, and providers through files OpenCode already understands.
- **Local file tools**: read and edit workspace files from the desktop app.
- **Diagnostics**: use setup checks, launch diagnostics, debug reports, and local evals to keep changes observable.

Network-hosted workspaces and team distribution surfaces are not part of the current product target.

## Architecture

```text
apps/app/          SolidJS UI used inside the desktop shell
apps/desktop/      Tauri 2 shell: native commands, process lifecycle, updater
apps/server/       Local filesystem-backed API sidecar
apps/orchestrator/ Local process orchestration for OpenCode + AuroWork server
```

At runtime the desktop app starts local services, connects to OpenCode on loopback, and keeps workspace file access scoped to user-selected folders.

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | LTS |
| pnpm | 10.27+ |
| Bun | 1.3+ |
| Rust toolchain | stable |
| Tauri prerequisites | platform-specific desktop requirements |

### Install And Run

```bash
pnpm install
pnpm setup:doctor
pnpm dev
```

`pnpm dev` starts the desktop app in development mode with isolated local development state.

`pnpm dev:ui` is only a browser-based UI preview for layout, routing, and copy checks. It does not exercise Tauri commands, local folder selection, sidecars, the engine, or workspace file access, so do not use it as a product smoke test.

## Verification

Use these commands before and during subtraction work:

```bash
pnpm setup:doctor        # local machine and repo setup checks
pnpm docs:check          # docs index and current product claim checks
pnpm verify:fast         # app/server/orchestrator TS checks + desktop cargo check
pnpm test:server         # server tests
pnpm test:scripts        # release/publish/stats script tests
pnpm eval:local-desktop  # deterministic local desktop smoke eval
```

`pnpm verify:full` and `pnpm test:desktop` include tests that bind local ports. They may require an environment that allows loopback listeners.

## Documentation

Start with:

- [`docs/INDEX.md`](docs/INDEX.md) for the current documentation map.
- [`docs/audit/2026-07-02-feature-audit.md`](docs/audit/2026-07-02-feature-audit.md) for current feature audit findings.
- [`docs/specs/2026-07-02-local-desktop-subtraction-pipeline-design.md`](docs/specs/2026-07-02-local-desktop-subtraction-pipeline-design.md) for the subtraction pipeline design.
- [`docs/plans/2026-07-02-local-desktop-subtraction-pipeline.md`](docs/plans/2026-07-02-local-desktop-subtraction-pipeline.md) for the implementation plan.

Historical specs and plans are preserved for context, but code and current audit documents are the source of truth.

## Project Structure

```text
.
├── apps/
│   ├── app/             # SolidJS frontend
│   ├── desktop/         # Tauri desktop shell
│   ├── server/          # Local AuroWork API sidecar
│   └── orchestrator/    # Local process orchestration
├── docs/                # Current docs, audits, specs, plans, and archive
├── scripts/             # Setup, verify, docs, eval, release, and dev scripts
└── constants.json       # Auro/OpenCode engine version pin
```

## Security Model

- Local services bind to loopback by default.
- Workspace file access should stay inside explicitly selected local roots.
- Credentials and tokens must not be committed to the repo.
- Debug reports and setup diagnostics must redact secrets.

## License

MIT — see [LICENSE](./LICENSE).
