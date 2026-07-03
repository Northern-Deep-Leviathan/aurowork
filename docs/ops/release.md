# Local Desktop Release Runbook

Date: 2026-07-02
Status: Current

This runbook describes the current AuroWork release path while the product is being reduced to a local desktop application. Treat remote/cloud/share publishing as legacy unless a current plan explicitly reintroduces it.

## Release Principles

- Release gates must be runnable locally before GitHub Actions packages installers.
- The default build target is the Tauri desktop app.
- CI should call the same root commands contributors run locally.
- Azure Blob sync is installer distribution only, not a cloud product surface.
- Sidecar/npm publishing remains a packaging concern while `apps/orchestrator` and `aurowork-server` are still part of the desktop runtime.

## Local Preflight

Run these from the repo root before preparing a release:

```bash
pnpm setup:doctor
pnpm docs:check
pnpm verify:fast
pnpm eval:local-desktop
node scripts/release/review.mjs --strict
```

`release:review` checks version alignment, required root automation scripts, the default desktop build target, active local desktop CI commands, and desktop release quality gate wiring.

## Full Release Gate

Run the release gate before tagging:

```bash
pnpm verify:release
```

This runs the full verification pipeline, builds the app, prepares sidecars, and runs the release review.

Current environment caveat: some local desktop tests bind loopback ports. In restricted sandboxes, `pnpm verify:full` or Rust desktop tests can fail with `Operation not permitted` / `listen EPERM 127.0.0.1`. Treat that as an environment limitation only after the same tests pass in a normal local or CI environment.

## Prepare And Ship

Use the release scripts instead of hand-editing versions:

```bash
pnpm release:prepare --patch
pnpm release:ship
```

`release:prepare` bumps versions, runs verification, commits the release change, and creates the tag locally. `release:ship` pushes the tag and branch so GitHub Actions can package installers.

## Active GitHub Actions

- `.github/workflows/verify-local-desktop.yml` runs setup, docs, fast verification, and local desktop eval on PR/push.
- `.github/workflows/build-desktop.yml` packages installers only after its `quality` job runs `pnpm verify:release`.
- `.github/workflows/sync-release-to-azure.yml` mirrors release artifacts for installer delivery.

Disabled workflows are historical until reviewed and either restored for local desktop needs or archived.

## Post-Release Checks

```bash
gh run list --workflow build-desktop.yml --limit 5
gh release view vX.Y.Z
pnpm release:review --json
```

Confirm the release contains only expected desktop installer artifacts and updater metadata. Do not add public share, cloud worker, Den, or chat connector artifacts to the release unless a current local desktop plan explicitly requires them.
