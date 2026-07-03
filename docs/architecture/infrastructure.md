# AuroWork Infrastructure Principles

AuroWork is an experience layer. `opencode` is the engine. This document defines how infrastructure is built so every component is usable on its own, composable as a sidecar, and easy to automate.

## Core Principles

1.  CLI-first, always

* Every infrastructure component must be runnable via a single CLI command.
* The AuroWork UI may wrap these, but never replace or lock them out.

2.  Unix-like interfaces

* Prefer simple, composable boundaries: JSON over stdout, flags, and env vars.
* Favor readable logs and predictable exit codes.

3.  Sidecar-composable

* Any component must run as a sidecar without special casing.
* The UI should connect to the same surface area the CLI exposes.

4.  Clear boundaries

* OpenCode remains the engine; AuroWork adds a thin config + UX layer.
* When OpenCode exposes a stable API, use it instead of re-implementing.

5.  Local-first, graceful degradation

* Default to local execution.
* Hosted cloud is a first-class option, not a separate product.
* If a sidecar is missing or offline, the UI falls back to read-only or explicit user guidance.

6.  Portable configuration

* Use config files + env vars; avoid hidden state.
* Keep credentials outside git and outside the repo.

7.  Observability by default

* Provide health endpoints and structured logs.
* Record audit events for every config mutation.

8.  Security + scoping

* All filesystem access is scoped to explicit workspace roots.
* Writes require explicit host approval when requested remotely.

9.  Debuggable by agents

Agents (like you) make tool calls — they can drive Chrome, run `curl`, invoke CLIs, run Bun scripts, and so on. Components must be designed so an agent can exercise them end-to-end without going through the desktop UI (which offers little programmatic control).

Concretely, an agent should be able to:

* run the underlying CLIs directly (since each component is implemented as a sidecar)
* talk to the real OpenCode HTTP surface (loopback, dynamic port — read it from the orchestrator state file)
* use bash + `curl` against AuroWork Server / OpenCode endpoints
* collect setup, launch, and debug diagnostics without UI mediation

The goal: an agent can exercise ~99% of any flow without UI mediation.

## Applied to Current Components

### opencode Engine

* Always usable via `opencode` CLI.
* AuroWork never replaces the CLI; it only connects to the engine.

### AuroWork Server

* Runs standalone via `aurowork-server` CLI.
* Provides filesystem-backed config surfaces (skills, plugins, MCP, commands).
* Sidecar lifecycle is described in `docs/architecture/backend.md`.
* Current product usage is local desktop sidecar infrastructure.

## Non-goals

* Replacing OpenCode primitives with custom abstractions.
* Replacing local desktop workflows with hosted-only infrastructure.

## References

* `docs/product/vision.md`
* `docs/product/principles.md`
* `docs/architecture/overview.md`
* `docs/architecture/backend.md`
