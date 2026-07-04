# Local Desktop Subtraction Pipeline — Implementation Plan

Date: 2026-07-02
Status: Draft
Spec: `docs/specs/2026-07-02-local-desktop-subtraction-pipeline-design.md`

## Goal

Build the automation guardrails required before removing fork/remote/cloud/share influence from AuroWork. The first deliverable is a reliable local-desktop pipeline for release, setup, tests, debug, eval, and docs.

## Guiding Constraints

- The product target is local desktop first.
- Do not complete remote/cloud/share features while creating the pipeline.
- Prefer small scripts with explicit root `package.json` commands.
- Every release gate must be runnable locally.
- CI should call the same commands contributors run locally.
- Historical docs stay available but must not be treated as current product truth.

## Phase 0 — Stabilize Current Evidence

- [x] Keep `docs/audit/2026-07-02-feature-audit.md` as the feature subtraction evidence base.
- [x] Keep `docs/superpowers/todo/2026-07-02-feature-subtraction-todo.md` as the high-priority subtraction backlog.
- [x] Add this pipeline spec/plan to `docs/INDEX.md`.
- [ ] Decide whether `apps/orchestrator` is current product surface or internal local desktop infrastructure.
- [ ] Decide whether `aurowork-server` remains independently published or becomes desktop-sidecar-only.

## Phase 1 — Setup Pipeline

- [x] Create `scripts/setup/doctor.mjs`.
- [x] Add root scripts:
  - `setup:doctor`
  - `setup:doctor:json`
- [x] Check Node, pnpm, Bun, Rust, Cargo, Tauri CLI.
- [x] Check `pnpm install --frozen-lockfile` readiness without mutating by default.
- [x] Check local desktop sidecar prerequisites.
- [x] Check that default setup does not require remote/cloud/headless env vars.
- [x] Fail if default build points to missing packages such as `apps/share`.
- [x] Fail if root scripts expose legacy `dev:headless-web`.
- [x] Emit a stable JSON schema for reuse by debug reports and CI.

## Phase 2 — Verification Pipeline

- [x] Create `scripts/verify/fast.mjs`.
- [x] Create `scripts/verify/full.mjs`.
- [x] Create `scripts/verify/release.mjs`.
- [x] Add root scripts:
  - `verify:fast`
  - `verify:full`
  - `verify:release`
  - `test:server`
  - `test:desktop`
  - `test:scripts`
- [x] Update root `typecheck` so it either checks all TypeScript packages or is renamed to `typecheck:app`.
- [x] Include `pnpm --filter aurowork-server typecheck` in fast verification.
- [x] Include `pnpm --filter aurowork-server test` in full verification.
- [x] Include `pnpm --filter aurowork-orchestrator typecheck` in fast verification while orchestrator remains in the architecture.
- [x] Include `cargo check` and `cargo test` for `apps/desktop/src-tauri`.
- [x] Include script tests:
  - `scripts/common/test-open-merge-pr-common.sh`
  - `scripts/publish/test-all.sh`
  - `scripts/release/test-open-merge-release-pr.sh`
  - `node --test scripts/stats.test.mjs`
- [ ] Mark remote/cloud/share tests as legacy/quarantine if they remain.

## Phase 3 — CI And Release Pipeline

- [x] Add an active CI workflow for `verify:fast` on PR/push.
- [x] Update `.github/workflows/build-desktop.yml` so packaging depends on a `quality` job.
- [x] Make the `quality` job run `pnpm verify:release`.
- [x] Expand `scripts/release/review.mjs --strict` beyond version checks:
  - verify root scripts exist
  - verify sidecar manifest expectations
  - verify no Vercel `apps/share` path remains in default build
  - verify release workflow includes the quality gate
- [ ] Decide whether to keep Windows-only desktop releases temporarily or restore macOS/Linux matrices before the first subtraction release.
- [x] Treat Azure sync as installer distribution only, not cloud product scope.
- [ ] Archive or remove disabled workflows that no longer serve local desktop development.

## Phase 4 — Debug Pipeline

- [x] Audit current Debug tab and launch diagnostic implementation.
- [ ] Remove or hide router, remote worker, Cloud/Den, and sandbox-pruned debug residue.
- [x] Create `scripts/debug/report.mjs`.
- [x] Add root script `debug:report`.
- [x] Ensure debug report includes `setup:doctor --json`.
- [x] Ensure debug report redacts tokens, auth headers, absolute secrets, and cloud credentials.
- [ ] Keep local launch diagnostics available in production builds.
- [x] Add a debug-report fixture test that proves required fields exist and secrets are absent.
- [ ] Expose the unified debug report from the Debug tab after product-surface cleanup.

## Phase 5 — Eval Pipeline

- [x] Create `scripts/eval/local-desktop.mjs`.
- [x] Add root script `eval:local-desktop`.
- [x] Start with temporary-workspace script evals:
  - first launch/setup state can initialize
  - local workspace can be created/selected
  - local config/skills/commands/plugins/MCP can be listed
  - local file read/write respects workspace boundary
  - debug report can be generated
- [ ] Add UI evals only after startup is deterministic enough for automation.
- [x] Keep default eval free of cloud accounts, Den login, public share links, or remote workers.

## Phase 6 — Documentation Pipeline

- [x] Create `scripts/docs/index-check.mjs`.
- [x] Create `scripts/docs/claims-check.mjs`.
- [x] Add root scripts:
  - `docs:check`
  - `docs:index:check`
  - `docs:claims:check`
- [x] Make `docs:index:check` fail when any `docs/` file is missing from `docs/INDEX.md`.
- [x] Make `docs:claims:check` fail on unsupported current-product claims in README and current docs.
- [x] Add banned or quarantined claim patterns:
  - fork-origin positioning
  - Openwrk/headless as current product
  - cloud-ready workers
  - WhatsApp/Telegram ready
  - public sharing
  - Den/team templates
  - OpenPackage registry install
  - full OpenCode CLI parity
- [x] Reword README only after deciding the exact surviving local desktop surface.

## Current Verification Snapshot

- `pnpm setup:doctor`: passes with no warnings after removing root `dev:headless-web` and adding a non-mutating frozen-lockfile readiness check.
- `pnpm setup:doctor:json`: passes and emits stable JSON.
- `pnpm docs:check`: passes after rewriting README/current architecture claims for local desktop scope.
- `docs/ops/release.md`: rewritten as the current local desktop release runbook.
- `pnpm verify:fast`: passes after removing stale `opencodeRouter` from server capabilities.
- `pnpm test:server`: passes after preserving user-created preset skill folders without `.meta.json`.
- `pnpm test:scripts`: passes and includes `scripts/debug/report.test.mjs`.
- `pnpm debug:report`: passes and emits a redacted local desktop report with embedded `setupDoctor`.
- `pnpm eval:local-desktop`: passes and checks debug report generation plus injected token redaction.
- `node scripts/release/review.mjs --strict`: passes and now checks version alignment, required root scripts, default desktop build target, local desktop CI workflow commands, and desktop release quality gate wiring.
- `.github/workflows/verify-local-desktop.yml`: active PR/push workflow added, runs setup/docs/debug/fast/eval gates, and YAML parses.
- `.github/workflows/build-desktop.yml`: release `quality` job added before release creation/build packaging and YAML parses.
- `pnpm verify:full`: currently blocked in this execution environment by local port binding restrictions during app e2e (`listen EPERM 127.0.0.1`).
- `pnpm test:desktop`: currently blocked in this execution environment by Rust tests that bind local listeners (`Operation not permitted`).

## Phase 7 — Begin Product Subtraction

Start product subtraction only after Phases 1-6 have a working minimal implementation.

Initial subtraction order:

1. Fix gates and current failing server validation.
2. Remove or quarantine hard stubs.
3. Remove public share/bundle surfaces.
4. Remove Cloud/Den/team-template surfaces.
5. Remove remote workspace/client surfaces.
6. Remove scheduler/automation/proto/onboarding residue.
7. Rewrite README and current product docs.

Progress:

- 2026-07-03: app-side hard stub calls were cut off. `apps/app` no longer calls `fetchBundle`, `publishBundle`, `listAudit`, `listScheduledJobs`, or `materializeBlueprintSessions`; Skills public share/link-install UI and workspace public template sharing UI were removed; shared-bundle URL/deep-link parsing was disabled.
- 2026-07-03: Toy UI Share/Automations navigation and Deploy Beta hard stub were removed; `/proto` route rendering and proto mock pages were deleted; stale Automations/Messaging sidebar buttons were removed.
- 2026-07-03: missing desktop `install_skill_template` command was implemented and registered for local `skill-creator` installation.
- 2026-07-03: unused throwing AuroWork server client methods for bundle/audit/scheduler/blueprint were deleted from app code.
- 2026-07-03: Cloud/Den/team-template surfaces were removed from the app: the Den settings panel and client were deleted, `den-auth` deep-link handling was removed, team-template share actions were deleted from Dashboard/Session, and Cloud/team-template translation keys were removed.
- 2026-07-03 verification: `pnpm --filter @aurowork/app typecheck`, `pnpm docs:check`, and `pnpm verify:fast` passed.

## Acceptance Criteria For The Pipeline Milestone

- `pnpm setup:doctor` gives an actionable local desktop setup report.
- `pnpm verify:fast` runs app/server/orchestrator TypeScript checks and desktop Rust check.
- `pnpm verify:full` runs unit/integration tests that are relevant to the local desktop product.
- `pnpm verify:release` blocks packaging when server typecheck/test failures exist.
- Active CI runs the same verification commands.
- `pnpm docs:check` proves docs index coverage and blocks unsupported current-product claims.
- `pnpm eval:local-desktop` exists and covers at least one deterministic local workspace journey.
- Debug report includes setup diagnostics and excludes remote/cloud secrets.
- The repo has a clear list of legacy remote/cloud/share tests and docs that are not part of the local desktop product.
