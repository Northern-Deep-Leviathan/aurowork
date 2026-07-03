# Local Desktop Subtraction Pipeline — Design

Date: 2026-07-02
Status: Draft for implementation planning

## Context

AuroWork started from a forked/openwork-style direction, but the current product goal is different: **ship a focused local desktop app**. Remote access, cloud workers, public sharing, Den/team templates, headless web flows, and fork-origin product language are no longer primary goals.

The current codebase still contains many mixed signals:

- Root README still says the project is forked from another AuroWork source and claims OpenCode CLI parity, OpenPackage installs, templates, and file explorer search/diff.
- Chinese READMEs still mention Openwrk/headless, WhatsApp, cloud readiness, and OpenPackage install flows.
- `scripts/dev/dev-headless-web.ts` remains as a legacy helper file, but `package.json` no longer exposes a root `dev:headless-web` entry. Keep it quarantined until the remote/headless subtraction pass deletes or archives it.
- `apps/server/package.json` describes the server as an API for remote clients.
- App code still contains remote worker, Den/Cloud, shared bundle, public publishing, scheduler, router, and team-template paths.
- Active release CI does not run the checks that already fail in `aurowork-server`.

Use `docs/audit/2026-07-02-feature-audit.md` as the feature-level evidence base. This document defines the engineering pipeline that must exist before large-scale subtraction begins.

## Target Product Boundary

The target product is:

- A local Tauri desktop app.
- A local SolidJS UI.
- A local sidecar runtime that talks to the bundled Auro/OpenCode engine.
- Local workspace selection, local sessions, local `.opencode` configuration, local skills/commands/plugins/MCP configuration, local file access, local debug reports, and local installer/update flow.

The target product is not:

- A remote workspace client.
- A cloud worker client.
- A public bundle/share platform.
- A Den/team-template product.
- A headless web product.
- A router/daemon management product for external clients.
- A continuation of fork-origin README/product positioning.

## Subtraction Rule

Before deleting a feature, classify every surface as one of:

| Class | Meaning | Default action |
|-------|---------|----------------|
| Core local desktop | Needed for the local desktop app | Keep and test |
| Local support infrastructure | Needed to run the local app, but not user-facing | Keep internal, hide product claims |
| Legacy remote/cloud/share | Not part of the current product | Remove from UI/docs first, then code |
| Experimental/dev-only | Useful for maintainers only | Gate behind debug/dev tooling or archive |
| Broken stub | Visible but not implemented | Remove immediately or quarantine behind tests |

Visible UI and README text are product promises. If a feature is not in the target boundary, remove the promise before preserving implementation code.

## Required Pipelines

### 1. Setup Pipeline

Goal: one command tells a contributor whether their machine can develop the local desktop app.

Proposed commands:

- `pnpm setup:doctor`
- `pnpm setup:doctor --json`
- `pnpm setup:fix` only for safe local fixes such as `pnpm install` and skill symlink refresh.

Checks:

- Node, pnpm, Bun, Rust, Cargo, Tauri CLI availability.
- `pnpm-lock.yaml` is usable with `pnpm install --frozen-lockfile`.
- Desktop sidecar prerequisites are present or can be built.
- `apps/share` is not referenced by default build paths.
- Local dev command starts only local loopback services by default.
- Remote/headless/cloud environment variables are not required for normal setup.
- `pnpm dev` is the product development entry point. `pnpm dev:ui` is only a browser UI preview for layout/routing/copy checks and must not be treated as a local desktop smoke test because it cannot validate Tauri folder access, sidecars, engine startup, or workspace file IO.

Output artifact:

- Human summary in terminal.
- JSON report under a stable schema for CI/debug report reuse.

### 2. Test And Verification Pipeline

Goal: root validation must cover all packages that can break the desktop app.

Proposed commands:

- `pnpm verify:fast`
- `pnpm verify:full`
- `pnpm verify:release`
- `pnpm test:server`
- `pnpm test:desktop`
- `pnpm test:scripts`

Minimum `verify:fast`:

- `pnpm --filter @aurowork/app typecheck`
- `pnpm --filter aurowork-server typecheck`
- `pnpm --filter aurowork-orchestrator typecheck`
- `cargo check` in `apps/desktop/src-tauri`
- Script unit tests that do not require network or release credentials.

Minimum `verify:full`:

- Everything in `verify:fast`.
- `pnpm --filter aurowork-server test`
- `pnpm --filter @aurowork/app test:e2e`
- `pnpm --filter aurowork-orchestrator test:router`
- `pnpm --filter aurowork-orchestrator test:files`
- `cargo test` in `apps/desktop/src-tauri`

Minimum `verify:release`:

- Everything in `verify:full`.
- `pnpm --filter @aurowork/app build`
- `pnpm --filter @aurowork/desktop prepare:sidecar`
- `pnpm release:review --strict`
- A release-manifest check that proves updater asset naming and sidecar manifest expectations match current workflows.

Quarantine rule:

- Tests that assert remote/cloud/share behavior must not be part of local desktop release gates unless the behavior is intentionally kept.
- If a test remains for legacy behavior, rename it under a clearly marked legacy/quarantine suite.

### 3. Release Pipeline

Goal: release cannot package a broken local desktop app.

Current gaps:

- `scripts/release/review.mjs` checks versions and sidecar manifest metadata, not product health.
- Active `build-desktop.yml` installs dependencies and builds the Tauri package without a prior full verification gate.
- Active desktop release matrix is Windows-only.
- `scripts/build.mjs` points Vercel builds to missing `apps/share`.

Required shape:

1. A `quality` job runs `pnpm verify:release`.
2. Release bump/tag happens only after `quality` is green.
3. Desktop packaging consumes the verified commit.
4. Updater manifest generation is checked before upload.
5. Azure mirroring is treated as installer distribution, not cloud product functionality.
6. Any remote/cloud/headless release workflows are disabled, archived, or renamed before they can be mistaken for current product paths.

Release review must expand from "versions match" to "release is safe to ship".

### 4. Debug Pipeline

Goal: subtraction work must not make local failures harder to diagnose.

Keep and harden:

- Launch diagnostic flow.
- Local debug report export.
- Local sidecar/orchestrator/engine version reporting while those components remain.
- Startup preference reset and app-data reset for recovery.

Remove or reword from debug:

- OpenCode Router version/status if router is not a supported product path.
- Remote worker hints.
- Cloud/Den auth debug affordances.
- Sandbox panels for pruned sandbox features.

Debug report should include:

- App version, commit, platform, locale.
- Local workspace id/path metadata without secrets.
- Local sidecar status and ports.
- Engine resolution source.
- Recent local errors/events.
- Output of `setup:doctor --json`.
- Redacted config summary.

### 5. Eval Pipeline

Goal: create product-level confidence that the local desktop app still works after removing large feature areas.

This is different from unit tests. Evals should represent the expected local desktop user journey.

Browser-only UI previews are not sufficient for product evals. They can catch visual and routing regressions, but local desktop acceptance must exercise desktop-side capabilities or script-level sidecar/workspace flows.

Initial eval scenarios:

- First launch: app opens, no remote/cloud prompt blocks the user.
- Select local folder: workspace becomes active.
- Create or open a session.
- Send a basic prompt through the local engine path or a deterministic mocked engine.
- See streaming/event progress without crashing.
- Permission request can be approved/denied.
- Local `.opencode` skills/commands/plugins/MCP config can be listed.
- Local file read/write is constrained to the authorized workspace boundary.
- Debug report can be exported.
- README/setup instructions match the actual commands.

Proposed command:

- `pnpm eval:local-desktop`

Implementation options:

- Start with deterministic script-level evals using temporary workspaces.
- Add Playwright/UI evals only after the local dev server startup is deterministic.
- Avoid network, cloud accounts, Den login, public share links, or remote workers in the default eval.

### 6. Documentation Pipeline

Goal: docs must stop reintroducing fork/remote/cloud promises while code subtraction is in progress.

Required checks:

- `docs/INDEX.md` covers every file under `docs/`.
- Root READMEs do not mention unsupported product claims:
  - fork-origin positioning
  - Openwrk/headless as current product
  - cloud-ready workers
  - WhatsApp/Telegram ready
  - public sharing
  - Den/team templates
  - OpenPackage registry install
  - full OpenCode CLI parity
  - file explorer search/diff unless implemented in that surface
- Any document marked Historical is not linked as a current source of truth from README.
- New plans/specs include status, date, scope, and verification commands.

Proposed commands:

- `pnpm docs:check`
- `pnpm docs:index:check`
- `pnpm docs:claims:check`

## Automation Layout

Recommended new script groups:

```text
scripts/setup/
  doctor.mjs

scripts/verify/
  fast.mjs
  full.mjs
  release.mjs

scripts/eval/
  local-desktop.mjs

scripts/docs/
  index-check.mjs
  claims-check.mjs
```

Root package scripts should expose these groups directly. Avoid hiding full-product validation behind app-only commands.

## First Implementation Milestone

The first milestone is not feature subtraction. It is a guardrail milestone:

1. Add `setup:doctor`.
2. Add root `verify:fast`, `verify:full`, and `verify:release`.
3. Update active CI to run `verify:fast` on PR/push and `verify:release` before desktop packaging.
4. Add `docs:check` with index and banned-claim checks.
5. Add a minimal `eval:local-desktop` smoke path, even if it starts as a script-level temporary-workspace eval.
6. Update release review to fail when verification is missing or stale.
7. Mark remote/cloud/share/headless tests and docs as legacy until intentionally removed.

Only after this milestone should large deletion passes begin.

## Non-Goals For This Pipeline

- Do not complete remote access.
- Do not complete Cloud/Den.
- Do not complete public sharing.
- Do not rebuild scheduler/automation.
- Do not preserve fork-origin product positioning.
- Do not make CI depend on external accounts or network-only services for local desktop validation.

## Open Decisions

1. Whether `apps/orchestrator` remains a user-facing CLI or becomes internal desktop infrastructure only.
2. Whether `aurowork-server` remains independently publishable or becomes a desktop sidecar package only.
3. Whether Azure release mirror remains active as a distribution mirror for installers.
4. Whether cross-platform release should be restored before or after the first subtraction pass.
5. Whether local evals should use the real Auro/OpenCode engine or a deterministic local mock for the default gate.
