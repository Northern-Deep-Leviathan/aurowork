---
name: local-tag-checklist
description: Use when manually creating a release tag locally for AuroWork (bypassing the CI auto-bump flow). Required for hotfixes, rollbacks, or any situation where you push a vX.Y.Z tag from your machine instead of letting build-desktop.yml do it.
---

# Local Tag Checklist (AuroWork)

## Overview

The standard release path is **CI auto-bump**: dispatch `build-desktop.yml` with `bump=patch|minor|major`, CI bumps + commits + tags + pushes. This skill is for the rare case when you must do it locally.

Core principle: **a tag, once pushed, is a permanent contract**. Updater clients, GitHub Releases, and downstream tooling all key off it. Get it wrong and you cannot cleanly take it back.

## When to Use

- Hotfix that can't wait for CI dispatch
- Rolling back a botched release (tag the previous good commit as a new patch)
- Cutting a tag from a non-main branch (rare, e.g. emergency security fix on a release branch)
- CI itself is broken and you need to ship

When NOT to use: normal feature/patch release. Use CI dispatch instead.

## The 7-Step Pre-Push Checklist

Run **all 7 checks** before `git push --tags`. Skipping any one of them risks a permanently bad release.

### 1. Confirm branch

```bash
git rev-parse --abbrev-ref HEAD
```

Expect: `main` (or a documented release branch). Reject if you're on a feature branch.

### 2. Confirm clean working tree

```bash
git status --porcelain
```

Expect: empty output. Any uncommitted change means the tag would point at a commit that doesn't represent shipped code.

### 3. Sync with remote

```bash
git fetch origin
git rev-list HEAD..origin/main --count
```

Expect: `0`. If non-zero, pull-rebase first. Tagging behind remote means others' commits aren't in your release.

### 4. Pick the version number (no guessing)

```bash
# What's the highest existing tag?
git tag --list 'v*' --sort=-v:refname | head -5

# What does the repo currently claim?
node -p "require('./apps/app/package.json').version"
```

Decide: `patch` (`X.Y.Z+1`), `minor` (`X.Y+1.0`), `major` (`X+1.0.0`).
**Your new version MUST be strictly greater** than every existing `v*` tag (`sort -V` ordering).

### 5. Bump all 7 files atomically

```bash
pnpm bump:set X.Y.Z   # NOT bump:patch — be explicit
```

This writes:
- `apps/app/package.json`
- `apps/desktop/package.json`
- `apps/server/package.json`
- `apps/orchestrator/package.json`
- `apps/desktop/src-tauri/Cargo.toml`
- `apps/desktop/src-tauri/tauri.conf.json`
- regenerates `Cargo.lock`

Verify all 7 changed:
```bash
git diff --name-only | sort
# Should include all of the above
```

### 6. Confirm tag doesn't exist anywhere

```bash
# Local
git tag -l "vX.Y.Z"

# Remote
git ls-remote --tags origin "vX.Y.Z"
```

Both must be empty. If either prints a line, **STOP** — the tag has been used. Pick the next number.

### 7. Commit + tag + push (in this order)

```bash
git add -A
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main           # push branch first
git push origin vX.Y.Z         # then push tag
```

Why two pushes: if branch push fails (rejected by branch protection), you haven't yet polluted the remote with a tag pointing at an unreachable commit.

## Quick Reference

| Step | Command | Pass condition |
|------|---------|----------------|
| 1 | `git rev-parse --abbrev-ref HEAD` | `main` |
| 2 | `git status --porcelain` | empty |
| 3 | `git rev-list HEAD..origin/main --count` | `0` |
| 4 | `git tag -l 'v*' --sort=-v:refname \| head -1` vs target | target > existing |
| 5 | `pnpm bump:set X.Y.Z` | 7 files modified |
| 6 | `git ls-remote --tags origin vX.Y.Z` | empty |
| 7 | `git push origin main && git push origin vX.Y.Z` | both succeed |

## Common Mistakes

| Mistake | Consequence | Recovery |
|---------|-------------|----------|
| Tagging without bumping the 6 files | MSI inside the release reports old version → updater loops | Delete tag + release, re-tag at a new bumped commit |
| Pushing tag before branch | Tag points at commit not on remote main | `git push origin :refs/tags/vX.Y.Z`, push branch, re-tag |
| Reusing a deleted tag number | Some clients cache old `latest.json` content/hash | Pick next unused number, never reuse |
| Bumping with `bump:patch` instead of `bump:set` | Hard to predict number; collisions if remote has tags you don't | Always use `bump:set X.Y.Z` for manual flows |
| Tagging a non-main commit "for now" | Branch later force-pushed → tag dangles | Only tag commits that are reachable from `origin/main` |

## Red Flags - STOP

- Working tree is dirty
- `origin/main` is ahead of local
- Target tag exists on remote (any state — even deleted, see "reusing")
- 6 files weren't all modified by `bump:set`
- You're about to push tag before pushing branch
- You're tagging on a feature branch "just to test the CI"

**All of these mean: do NOT run `git push --tags`. Resolve the flag first.**

## Recovery: Un-pushing a Bad Tag

If you already pushed and need to undo (only safe if no client has fetched the release yet):

```bash
# Delete remote tag
git push origin :refs/tags/vX.Y.Z

# Delete GitHub Release (if create-release ran)
gh release delete vX.Y.Z --yes

# Delete local tag
git tag -d vX.Y.Z

# Revert the bump commit
git revert <bump-commit-sha>
git push origin main
```

After this, the version number `X.Y.Z` is **burned** — pick `X.Y.Z+1` next time, never reuse `X.Y.Z`.

## What Success Looks Like

```
$ git tag --list 'v*' --sort=-v:refname | head -3
v0.12.0          ← just pushed
v0.11.193
v0.11.192

$ gh release view v0.12.0
title:       AuroWork v0.12.0
state:       published
asset:       aurowork-desktop-windows-x64.msi (version 0.12.0 in MSI metadata)
```

Tag, MSI internal version, and Release name all match. CI's downstream `build-desktop.yml` (if triggered by tag push) picks up cleanly.
