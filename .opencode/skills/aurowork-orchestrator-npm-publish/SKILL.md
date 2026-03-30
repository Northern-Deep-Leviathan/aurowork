---
name: aurowork-orchestrator-npm-publish
description: |
  Publish the aurowork-orchestrator npm package with clean git hygiene.

  Triggers when user mentions:
  - "aurowork-orchestrator npm publish"
  - "publish aurowork-orchestrator"
  - "bump aurowork-orchestrator"
---

## Quick usage (already configured)

1. Ensure you are on the default branch and the tree is clean.
2. Bump versions via the shared release bump (this keeps `aurowork-orchestrator` aligned with the app/desktop release).

```bash
pnpm bump:patch
# or: pnpm bump:minor
# or: pnpm bump:major
# or: pnpm bump:set -- X.Y.Z
```

3. Commit the bump.
4. Preferred: publish via the "Release App" GitHub Actions workflow by tagging `vX.Y.Z`.

Manual recovery path (sidecars + npm) below.

```bash
pnpm --filter aurowork-orchestrator build:sidecars
gh release create aurowork-orchestrator-vX.Y.Z packages/orchestrator/dist/sidecars/* \
  --repo different-ai/aurowork \
  --title "aurowork-orchestrator vX.Y.Z sidecars" \
  --notes "Sidecar binaries and manifest for aurowork-orchestrator vX.Y.Z"
```

5. Build aurowork-orchestrator binaries for all supported platforms.

```bash
pnpm --filter aurowork-orchestrator build:bin:all
```

6. Publish `aurowork-orchestrator` as a meta package + platform packages (optionalDependencies).

```bash
node packages/orchestrator/scripts/publish-npm.mjs
```

7. Verify the published version.

```bash
npm view aurowork-orchestrator version
```

---

## Scripted publish

```bash
./.opencode/skills/aurowork-orchestrator-npm-publish/scripts/publish-aurowork-orchestrator.sh
```

---

## First-time setup (if not configured)

Authenticate with npm before publishing.

```bash
npm login
```

Alternatively, export an npm token in your environment (see `.env.example`).

---

## Notes

- `aurowork-orchestrator` is published as:
  - `aurowork-orchestrator` (wrapper + optionalDependencies)
  - `aurowork-orchestrator-darwin-arm64`, `aurowork-orchestrator-darwin-x64`, `aurowork-orchestrator-linux-arm64`, `aurowork-orchestrator-linux-x64`, `aurowork-orchestrator-windows-x64` (platform binaries)
- `aurowork-orchestrator` is versioned in lockstep with AuroWork app/desktop releases.
- aurowork-orchestrator downloads sidecars from `aurowork-orchestrator-vX.Y.Z` release assets by default.
