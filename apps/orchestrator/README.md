# AuroWork Orchestrator

Host orchestrator for opencode + AuroWork server + opencode-router. This is a CLI-first way to run host mode without the desktop UI.

Published on npm as `aurowork-orchestrator` and installs the `aurowork` command.

## Quick start

```bash
npm install -g aurowork-orchestrator
aurowork start --workspace /path/to/workspace --approval auto
```

When run in a TTY, `aurowork` shows an interactive status dashboard with service health, ports, and
connection details. Use `aurowork serve` or `--no-tui` for log-only mode.

```bash
aurowork serve --workspace /path/to/workspace
```

`aurowork` ships as a compiled binary, so Bun is not required at runtime.

If npm skips the optional platform package, `postinstall` falls back to downloading the matching
binary from the `aurowork-orchestrator-v<version>` GitHub release. Override the download host with
`AUROWORK_ORCHESTRATOR_DOWNLOAD_BASE_URL` when you need to use a mirror.

`aurowork` downloads and caches the `aurowork-server`, `opencode-router`, and `opencode` sidecars on
first run using a SHA-256 manifest. Use `--sidecar-dir` or `AUROWORK_SIDECAR_DIR` to control the
cache location, and `--sidecar-base-url` / `--sidecar-manifest` to point at a custom host.

Use `--sidecar-source` to control where `aurowork-server` and `opencode-router` are resolved
(`auto` | `bundled` | `downloaded` | `external`), and `--opencode-source` to control
`opencode` resolution. Set `AUROWORK_SIDECAR_SOURCE` / `AUROWORK_OPENCODE_SOURCE` to
apply the same policies via env vars.

By default the manifest is fetched from
`https://github.com/different-ai/aurowork/releases/download/aurowork-orchestrator-v<version>/aurowork-orchestrator-sidecars.json`.

OpenCode Router is optional. If it exits, `aurowork` continues running unless you pass
`--opencode-router-required` or set `AUROWORK_OPENCODE_ROUTER_REQUIRED=1`.

For development overrides only, set `AUROWORK_ALLOW_EXTERNAL=1` or pass `--allow-external` to use
locally installed `aurowork-server` or `opencode-router` binaries.

Add `--verbose` (or `AUROWORK_VERBOSE=1`) to print extra diagnostics about resolved binaries.

OpenCode hot reload is enabled by default when launched via `aurowork`.
Tune it with:

- `--opencode-hot-reload` / `--no-opencode-hot-reload`
- `--opencode-hot-reload-debounce-ms <ms>`
- `--opencode-hot-reload-cooldown-ms <ms>`

Equivalent env vars:

- `AUROWORK_OPENCODE_HOT_RELOAD` (router mode)
- `AUROWORK_OPENCODE_HOT_RELOAD_DEBOUNCE_MS`
- `AUROWORK_OPENCODE_HOT_RELOAD_COOLDOWN_MS`
- `AUROWORK_OPENCODE_HOT_RELOAD` (start/serve mode)
- `AUROWORK_OPENCODE_HOT_RELOAD_DEBOUNCE_MS`
- `AUROWORK_OPENCODE_HOT_RELOAD_COOLDOWN_MS`

Or from source:

```bash
pnpm --filter aurowork-orchestrator dev -- \
  start --workspace /path/to/workspace --approval auto --allow-external
```

When `AUROWORK_DEV_MODE=1` is set, orchestrator uses an isolated OpenCode dev state for config, auth, data, cache, and state. AuroWork's repo-level `pnpm dev` commands enable this automatically so local development does not reuse your personal OpenCode environment.

The command prints pairing details (AuroWork server URL + token, OpenCode URL + auth) so remote AuroWork clients can connect.

Use `--detach` to keep services running and exit the dashboard. The detach summary includes the
AuroWork URL, tokens, and the `opencode attach` command.

## Sandbox mode (Docker / Apple container)

`aurowork` can run the sidecars inside a Linux container boundary while still mounting your workspace
from the host.

```bash
# Auto-pick sandbox backend (prefers Apple container on supported Macs)
aurowork start --sandbox auto --workspace /path/to/workspace --approval auto

# Explicit backends
aurowork start --sandbox docker --workspace /path/to/workspace --approval auto
aurowork start --sandbox container --workspace /path/to/workspace --approval auto
```

Notes:

- `--sandbox auto` prefers Apple `container` on supported Macs (arm64), otherwise Docker.
- Docker backend requires `docker` on your PATH.
- Apple container backend requires the `container` CLI (https://github.com/apple/container).
- In sandbox mode, sidecars are resolved for a Linux target (and `--sidecar-source` / `--opencode-source`
  are effectively `downloaded`).
- Custom `--*-bin` overrides are not supported in sandbox mode yet.
- Use `--sandbox-image` to pick an image with the toolchain you want available to OpenCode.
- Use `--sandbox-persist-dir` to control the host directory mounted at `/persist` inside the container.

### Extra mounts (allowlisted)

You can add explicit, validated mounts into `/workspace/extra/*`:

```bash
aurowork start --sandbox auto --sandbox-mount "/path/on/host:datasets:ro" --workspace /path/to/workspace
```

Additional mounts are blocked unless you create an allowlist at:

- `~/.config/aurowork/sandbox-mount-allowlist.json`

Override with `AUROWORK_SANDBOX_MOUNT_ALLOWLIST`.

## Logging

`aurowork` emits a unified log stream from OpenCode, AuroWork server, and opencode-router. Use JSON format for
structured, OpenTelemetry-friendly logs and a stable run id for correlation.

```bash
AUROWORK_LOG_FORMAT=json aurowork start --workspace /path/to/workspace
```

Use `--run-id` or `AUROWORK_RUN_ID` to supply your own correlation id.

AuroWork server logs every request with method, path, status, and duration. Disable this when running
`aurowork-server` directly by setting `AUROWORK_LOG_REQUESTS=0` or passing `--no-log-requests`.

## Router daemon (multi-workspace)

The router keeps a single OpenCode process alive and switches workspaces JIT using the `directory` parameter.

```bash
aurowork daemon start
aurowork workspace add /path/to/workspace-a
aurowork workspace add /path/to/workspace-b
aurowork workspace list --json
aurowork workspace path <id>
aurowork instance dispose <id>
```

Use `AUROWORK_DATA_DIR` or `--data-dir` to isolate router state in tests.

## Pairing notes

- Use the **AuroWork connect URL** and **client token** to connect a remote AuroWork client.
- The AuroWork server advertises the **OpenCode connect URL** plus optional basic auth credentials to the client.

## Approvals (manual mode)

```bash
aurowork approvals list \
  --aurowork-url http://<host>:8787 \
  --host-token <token>

aurowork approvals reply <id> --allow \
  --aurowork-url http://<host>:8787 \
  --host-token <token>
```

## Health checks

```bash
aurowork status \
  --aurowork-url http://<host>:8787 \
  --opencode-url http://<host>:4096
```

## File sessions (JIT catalog + batch read/write)

Create a short-lived workspace file session and sync files in batches:

```bash
# Create writable session
aurowork files session create \
  --aurowork-url http://<host>:8787 \
  --token <client-token> \
  --workspace-id <workspace-id> \
  --write \
  --json

# Fetch catalog snapshot
aurowork files catalog <session-id> \
  --aurowork-url http://<host>:8787 \
  --token <client-token> \
  --limit 200 \
  --json

# Read one or more files
aurowork files read <session-id> \
  --aurowork-url http://<host>:8787 \
  --token <client-token> \
  --paths "README.md,notes/todo.md" \
  --json

# Write a file (inline content or --file)
aurowork files write <session-id> \
  --aurowork-url http://<host>:8787 \
  --token <client-token> \
  --path notes/todo.md \
  --content "hello from aurowork" \
  --json

# Watch change events and close session
aurowork files events <session-id> --aurowork-url http://<host>:8787 --token <client-token> --since 0 --json
aurowork files session close <session-id> --aurowork-url http://<host>:8787 --token <client-token> --json
```

## Smoke checks

```bash
aurowork start --workspace /path/to/workspace --check --check-events
```

This starts the services, verifies health + SSE events, then exits cleanly.

## Local development

Point to source CLIs for fast iteration:

```bash
aurowork start \
  --workspace /path/to/workspace \
  --allow-external \
  --aurowork-server-bin apps/server/src/cli.ts \
  --opencode-router-bin apps/opencode-router/dist/cli.js
```
