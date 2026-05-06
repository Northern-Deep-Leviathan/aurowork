---
title: Release flow
description: Step through versioning, tagging, and verification
name: release
---

## Prepare
Confirm the repo is on `dev` and clean. Keep changes aligned with OpenCode primitives like `.opencode`, `opencode.json`, skills, and plugins when relevant.

---

## Bump
Update versions in `apps/app/package.json`, `apps/desktop/package.json`, `apps/orchestrator/package.json` (publishes as `aurowork-orchestrator`), `apps/desktop/src-tauri/tauri.conf.json`, and `apps/desktop/src-tauri/Cargo.toml`. Use one of these commands.

```bash
pnpm bump:patch
pnpm bump:minor
pnpm bump:major
pnpm bump:set -- 0.1.21
```

---

## Merge
Merge the version bump into `dev`. Make sure no secrets or credentials are committed.

---

## Tag
Create and push the tag to trigger the Release App workflow.

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

---

## Rerun
If a tag needs a rerun, dispatch the workflow.

```bash
gh workflow run "Release App" --repo Northern-Deep-Leviathan/aurowork -f tag=vX.Y.Z
```

---

## Verify
Confirm the run and the published release.

```bash
gh run list --repo Northern-Deep-Leviathan/aurowork --workflow "Release App" --limit 5
gh release view vX.Y.Z --repo Northern-Deep-Leviathan/aurowork
```
