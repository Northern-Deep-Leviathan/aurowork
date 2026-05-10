# Preset Skills Externalization

**Date:** 2026-04-22
**Status:** Approved
**Scope:** `apps/server/` — workspace-init skill preset system

## Problem

Preset skills (`WORKSPACE_GUIDE`, `GET_STARTED_SKILL`) are hardcoded as multi-line string constants in `apps/server/src/workspace-init.ts`. This makes the file hard to read, and there is no version control mechanism to allow upgrade-safe overwriting of built-in skills without clobbering user edits.

## Goals

1. Move preset skills from inline string constants to external `.md` files in a dedicated folder.
2. Add version control to preset skills so upgrades can overwrite built-in skills safely.
3. Zero changes to build scripts or CI/CD pipeline.

## Design

### Folder Structure

```
apps/server/src/preset-skills/
  workspace-guide/SKILL.md
  get-started/SKILL.md
  index.ts
```

Mirrors the workspace `.opencode/skills/<name>/SKILL.md` layout.

### Skill File Format

Each `.md` file is self-contained with extended frontmatter:

```yaml
---
name: workspace-guide
description: Workspace guide to introduce AuroWork and onboard new users.
aurowork_builtin_version: 1
presets:
  - all
---

# Welcome to AuroWork
...
```

- `aurowork_builtin_version` — integer, bumped when we ship a content update.
- `presets` — which workspace presets include this skill. Values: `all` (every preset), or specific names like `starter`, `automation`, `minimal`.

These two fields are **internal metadata only** — they are stripped before writing to the workspace (see Version-Gated Upsert below).

### Barrel File (`index.ts`)

```ts
import workspaceGuide from "./workspace-guide/SKILL.md" with { type: "text" };
import getStarted from "./get-started/SKILL.md" with { type: "text" };

export const presetSkills: string[] = [workspaceGuide, getStarted];
```

Uses Bun's text loader to embed `.md` content at compile time. No runtime file I/O. No build script changes — `bun build --compile` handles this natively.

### Version-Gated Upsert

A new `upsertPresetSkill()` function in `workspace-init.ts` wraps the version check and clean-write logic.

**On-disk layout per installed skill:**

```
.opencode/skills/workspace-guide/
  SKILL.md       <- clean frontmatter (name + description only), LLM reads this
  .meta.json     <- { "aurowork_builtin_version": 1 }, LLM never sees this
```

The `.meta.json` sidecar stores the version marker separately from the skill content to avoid LLM hallucination or misinterpretation of version metadata in the context window.

**`upsertPresetSkill()` logic:**

1. Parse source `.md` -> extract `aurowork_builtin_version` and `presets` from frontmatter.
2. Read `.meta.json` from workspace skill directory if it exists -> get installed version.
3. Compare versions and decide action (see table below).
4. Strip `aurowork_builtin_version` and `presets` from frontmatter.
5. Call `upsertSkill()` with clean content.
6. Write `.meta.json` with the new version.

**Decision table:**

| On-disk state | Action |
|---|---|
| No `SKILL.md` | Write skill + `.meta.json` (first install) |
| `.meta.json` exists, version < shipped | Overwrite both (upgrade) |
| `.meta.json` exists, version >= shipped | Skip (already current) |
| `SKILL.md` exists, no `.meta.json` | Skip (user-created, respect it) |

### Revised `ensureStarterSkills()`

```ts
import { presetSkills } from "./preset-skills/index.js";

async function ensureStarterSkills(workspaceRoot: string, preset: string): Promise<void> {
  await ensureDir(projectSkillsDir(workspaceRoot));
  for (const raw of presetSkills) {
    const { data } = parseFrontmatter(raw);
    const presets = (data.presets as string[]) ?? [];
    if (presets.includes("all") || presets.includes(preset)) {
      await upsertPresetSkill(workspaceRoot, raw);
    }
  }
}
```

No per-skill `if` branching. Preset gating is driven by the `presets` field in each `.md` file. Adding a new preset skill = drop a `.md` file + one import line in `index.ts`.

## File Change Summary

**New files:**

| File | Purpose |
|---|---|
| `apps/server/src/preset-skills/workspace-guide/SKILL.md` | Migrated from `WORKSPACE_GUIDE` constant. `aurowork_builtin_version: 1`, `presets: [all]` |
| `apps/server/src/preset-skills/get-started/SKILL.md` | Migrated from `GET_STARTED_SKILL` constant. `aurowork_builtin_version: 1`, `presets: [starter]` |
| `apps/server/src/preset-skills/index.ts` | Barrel: imports `.md` files, exports `presetSkills: string[]` |

**Modified files:**

| File | Change |
|---|---|
| `apps/server/src/workspace-init.ts` | Remove `WORKSPACE_GUIDE` + `GET_STARTED_SKILL` constants (~100 lines). Import `presetSkills`. Add `upsertPresetSkill()`. Rewrite `ensureStarterSkills()` to loop with preset gating. |

**No changes to:**

- Build scripts / CI/CD pipeline
- `package.json`
- `apps/server/src/skills.ts`
- Any other files

## Adding a New Preset Skill (Future)

1. Create `apps/server/src/preset-skills/<skill-name>/SKILL.md` with frontmatter including `aurowork_builtin_version: 1` and `presets`.
2. Add one import line + array entry in `apps/server/src/preset-skills/index.ts`.
3. Done. No changes to `ensureStarterSkills()` or any other file.
