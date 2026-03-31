# AuroWork

> Open-source desktop AI agent — powered by [OpenCode](https://opencode.ai).

AuroWork puts a native desktop GUI on top of OpenCode, turning agentic coding workflows into something anyone on your team can use — not just developers fluent in CLI.

## Highlights

- **Local-first** — runs entirely on your machine. One click to start, zero cloud dependency.
- **Powered by OpenCode** — full feature parity with the OpenCode CLI: sessions, skills, plugins, MCP, commands.
- **Extensible** — install skills from the OpenPackage registry, add plugins via `opencode.json`, or connect MCP servers (Notion, Linear, Sentry, Stripe, etc.) with OAuth.
- **Multi-workspace** — manage multiple project folders from a single app instance.
- **Developer tools** — built-in Developer Mode with file-based debug logging (`/tmp/aurowork-debug.log`) for runtime diagnostics.

## Architecture

```
apps/app/          SolidJS UI (desktop / web)
apps/desktop/      Tauri 2 shell (Rust) — window management, native commands, process lifecycle
apps/server/       AuroWork Server — filesystem-backed API layer
apps/orchestrator/ CLI host orchestrator (opencode + server + router)
```

### How it works

1. **Tauri shell** spawns an OpenCode server on `127.0.0.1`.
2. **AuroWork Server** sits between the UI and OpenCode, handling workspace management, skills, plugins, permissions, and file operations.
3. **SolidJS frontend** connects via the `@opencode-ai/sdk` — SSE streaming for real-time updates, session lifecycle, tool execution timeline, and permission prompts.

OpenCode handles context compaction, model routing, and all LLM interactions natively. AuroWork is the experience layer.

## Quick Start

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | LTS |
| pnpm | 10.27+ |
| Rust toolchain | stable (`rustup`) |
| Bun | 1.3.9+ |
| Xcode CLI Tools | macOS only |
| WebKitGTK 4.1 | Linux only |

### Install & Run

```bash
# Clone
git clone https://github.com/Northern-Deep-Leviathan/aurowork.git
cd aurowork

# Install dependencies
pnpm install

# Run desktop app (dev mode)
pnpm dev

# Run web UI only
pnpm dev:ui
```

`pnpm dev` sets `AUROWORK_DEV_MODE=1` automatically — local development uses an isolated OpenCode state, separate from your personal config.

### CLI Host (no desktop UI)

```bash
npm install -g aurowork-orchestrator
aurowork start --workspace /path/to/workspace --approval auto
```

See [apps/orchestrator/README.md](./apps/orchestrator/README.md) for full CLI documentation.

## What's Included

| Feature | Description |
|---------|-------------|
| **Sessions** | Create, switch, and manage AI chat sessions per workspace |
| **Live streaming** | SSE event subscription for real-time assistant responses |
| **Execution plan** | OpenCode todos rendered as a visual timeline |
| **Permissions** | Surface permission requests — allow once / always / deny |
| **Skills manager** | Browse, install, and manage `.opencode/skills` |
| **Plugin manager** | Configure plugins via `opencode.json` (project or global scope) |
| **MCP servers** | Quick-connect to Notion, Linear, Sentry, Stripe, Context7, Chrome DevTools |
| **Templates** | Save and re-run common workflows |
| **File explorer** | Search files, view diffs, read workspace content |
| **Developer Mode** | Toggle via Settings → Advanced. Enables debug file logging and console diagnostics |

## Project Structure

```
.
├── apps/
│   ├── app/             # SolidJS frontend (UI components, context stores, i18n)
│   ├── desktop/         # Tauri 2 desktop shell (Rust commands, window management)
│   ├── server/          # AuroWork Server (workspace API, token management, file sessions)
│   └── orchestrator/    # CLI orchestrator (multi-service host mode)
├── ARCHITECTURE.md      # Runtime architecture, design principles
├── PRODUCT.md           # Product vision, target users, UX requirements
├── project-plan.md      # Development roadmap and feature tracking
└── constants.json       # OpenCode version pin
```

## Useful Commands

```bash
pnpm dev              # Desktop app (dev mode)
pnpm dev:ui           # Web UI only
pnpm typecheck        # TypeScript type check
pnpm build            # Production build
pnpm build:ui         # Build web UI
pnpm test:e2e         # End-to-end tests
```

## Troubleshooting

### Linux / Wayland (Hyprland)

If AuroWork crashes on launch with WebKitGTK errors:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 aurowork
# or
WEBKIT_DISABLE_COMPOSITING_MODE=1 aurowork
```

### Arch Linux

```bash
sudo pacman -S --needed webkit2gtk-4.1
```

## Security

- Model reasoning and sensitive tool metadata are hidden by default.
- Host mode binds to `127.0.0.1` — local only.
- Permission system surfaces all tool calls for user approval.

## Contributing

1. Read `AGENTS.md`, `ARCHITECTURE.md`, and `PRODUCT.md` before making changes.
2. Run `pnpm install` once, then verify with `pnpm typecheck` and `pnpm test:e2e`.
3. Use `.github/pull_request_template.md` for PRs — include commands run, outcomes, and evidence.

## License

MIT — see [LICENSE](./LICENSE).

---

> Forked from [different-ai/aurowork](https://github.com/different-ai/aurowork). This fork focuses on a streamlined local-first experience.
