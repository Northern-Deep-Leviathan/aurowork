# Preset Skills Externalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move hardcoded skill string constants out of `workspace-init.ts` into external `.md` files with build-time embedding, version-gated upsert via sidecar `.meta.json`, and preset-based gating.

**Architecture:** Preset skill `.md` files live in `apps/server/src/preset-skills/<name>/SKILL.md` with extended frontmatter (`aurowork_builtin_version`, `presets`). A barrel `index.ts` imports them via Bun's text loader. `ensureStarterSkills()` loops over the registry, checks version via `.meta.json` sidecar, strips internal metadata, and writes clean content to workspace.

**Tech Stack:** Bun (text import, test runner), TypeScript, YAML frontmatter

**Spec:** `docs/superpowers/specs/2026-04-22-preset-skills-externalization-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `apps/server/src/preset-skills/workspace-guide/SKILL.md` | Create | Workspace guide skill content, migrated from `WORKSPACE_GUIDE` constant |
| `apps/server/src/preset-skills/get-started/SKILL.md` | Create | Get-started skill content, migrated from `GET_STARTED_SKILL` constant |
| `apps/server/src/preset-skills/index.ts` | Create | Barrel: imports `.md` files, exports `presetSkills: string[]` |
| `apps/server/src/preset-skills/md.d.ts` | Create | TypeScript declaration for `.md` module imports |
| `apps/server/src/workspace-init.ts` | Modify | Remove constants, add `upsertPresetSkill()`, rewrite `ensureStarterSkills()` |
| `apps/server/src/workspace-init.test.ts` | Create | Tests for version-gated upsert and preset gating |

---

### Task 1: Create Preset Skill `.md` Files

**Files:**
- Create: `apps/server/src/preset-skills/workspace-guide/SKILL.md`
- Create: `apps/server/src/preset-skills/get-started/SKILL.md`

- [ ] **Step 1: Create the `workspace-guide` skill file**

Create `apps/server/src/preset-skills/workspace-guide/SKILL.md` with the content from the `WORKSPACE_GUIDE` constant (workspace-init.ts L11-58), adding `aurowork_builtin_version` and `presets` to frontmatter:

```markdown
---
name: workspace-guide
description: Workspace guide to introduce AuroWork and onboard new users.
aurowork_builtin_version: 1
presets:
  - all
---

# Welcome to AuroWork

Hi, I'm Ben and this is AuroWork. It's an open-source alternative to Claude's cowork. It helps you work on your files with AI and automate the mundane tasks so you don't have to.

Before we start, use the question tool to ask:
"Are you more technical or non-technical? I'll tailor the explanation."

## If the person is non-technical
AuroWork feels like a chat app, but it can safely work with the files you allow. Put files in this workspace and I can summarize them, create new ones, or help organize them.

Try:
- "Summarize the files in this workspace."
- "Create a checklist for my week."
- "Draft a short summary from this document."

## Skills and plugins (simple)
Skills add new capabilities. Plugins add advanced features like scheduling or browser automation. We can add them later when you're ready.

## If the person is technical
AuroWork is a GUI for OpenCode. Everything that works in OpenCode works here.

Most reliable setup today:
1) Install OpenCode from opencode.ai
2) Configure providers there (models and API keys)
3) Come back to AuroWork and start a session

Skills:
- Install from the Skills tab, or add them to this workspace.
- Docs: https://opencode.ai/docs/skills

Plugins:
- Configure in opencode.json or use the Plugins tab.
- Docs: https://opencode.ai/docs/plugins/

MCP servers:
- Add external tools via opencode.json.
- Docs: https://opencode.ai/docs/mcp-servers/

Config reference:
- Docs: https://opencode.ai/docs/config/

End with two friendly next actions to try in AuroWork.
```

- [ ] **Step 2: Create the `get-started` skill file**

Create `apps/server/src/preset-skills/get-started/SKILL.md` with the content from the `GET_STARTED_SKILL` constant (workspace-init.ts L60-78), adding `aurowork_builtin_version` and `presets` to frontmatter:

```markdown
---
name: get-started
description: Guide users through the get started setup and Chrome DevTools demo.
aurowork_builtin_version: 1
presets:
  - starter
---

## When to use
- Always load this skill when the user says "get started".

## What to do
- Reply with these four lines, exactly and in order:
  1) hey there welcome this is aurowork
  2) we've pre-configured you with a couple tools
  3) Get Started
  4) write "hey go on google.com"

## Then
- If the user writes "go on google.com" (or "hey go on google.com"), use the chrome-devtools MCP to open the site.
- After the navigation completes, reply: "I'm on <site>" where <site> is the final URL or page title they asked for.
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/preset-skills/workspace-guide/SKILL.md apps/server/src/preset-skills/get-started/SKILL.md
git commit -m "feat(server): add preset skill .md files for workspace-guide and get-started"
```

---

### Task 2: Create Barrel File and TypeScript Declaration

**Files:**
- Create: `apps/server/src/preset-skills/index.ts`
- Create: `apps/server/src/preset-skills/md.d.ts`

- [ ] **Step 1: Create the TypeScript declaration for `.md` imports**

Bun handles `.md` text imports natively at runtime and compile, but `tsc` (used by `pnpm typecheck`) does not understand them. Create a type declaration file:

Create `apps/server/src/preset-skills/md.d.ts`:

```ts
declare module "*.md" {
  const content: string;
  export default content;
}
```

- [ ] **Step 2: Create the barrel file**

Create `apps/server/src/preset-skills/index.ts`:

```ts
import workspaceGuide from "./workspace-guide/SKILL.md" with { type: "text" };
import getStarted from "./get-started/SKILL.md" with { type: "text" };

export const presetSkills: string[] = [workspaceGuide, getStarted];
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /workspace/aurowork && pnpm --filter aurowork-server typecheck`

Expected: No errors. If `tsc` does not support `with { type: "text" }` syntax with `module: "NodeNext"`, fall back to a plain import (Bun resolves `.md` as text by default):

```ts
// Fallback if import attributes are unsupported by tsc:
// @ts-expect-error -- Bun text loader, tsc cannot resolve .md
import workspaceGuide from "./workspace-guide/SKILL.md";
// @ts-expect-error -- Bun text loader, tsc cannot resolve .md
import getStarted from "./get-started/SKILL.md";

export const presetSkills: string[] = [workspaceGuide, getStarted];
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/preset-skills/index.ts apps/server/src/preset-skills/md.d.ts
git commit -m "feat(server): add preset-skills barrel and .md type declaration"
```

---

### Task 3: Add `upsertPresetSkill()` to `workspace-init.ts`

**Files:**
- Modify: `apps/server/src/workspace-init.ts`

- [ ] **Step 1: Add imports**

Add to the top of `workspace-init.ts` (after existing imports):

```ts
import { readFile } from "node:fs/promises";  // already imported — verify
import { parseFrontmatter, buildFrontmatter } from "./frontmatter.js";
import { presetSkills } from "./preset-skills/index.js";
```

Note: `readFile` and `writeFile` are already imported at L2. `parseFrontmatter` and `buildFrontmatter` are new imports for this file. `exists` and `ensureDir` are already imported.

- [ ] **Step 2: Add `upsertPresetSkill()` function**

Add this function after the existing `mergePlugins()` function (after L213), before `ensureAuroworkAgent()`:

```ts
async function upsertPresetSkill(workspaceRoot: string, rawContent: string): Promise<void> {
  const { data, body } = parseFrontmatter(rawContent);
  const name = data.name as string;
  const newVersion = typeof data.aurowork_builtin_version === "number" ? data.aurowork_builtin_version : 0;

  const skillDir = join(projectSkillsDir(workspaceRoot), name);
  const existingSkillPath = join(skillDir, "SKILL.md");
  const metaPath = join(skillDir, ".meta.json");

  if (await exists(existingSkillPath)) {
    if (await exists(metaPath)) {
      // Built-in skill — check version
      try {
        const metaRaw = await readFile(metaPath, "utf8");
        const meta = JSON.parse(metaRaw) as { aurowork_builtin_version?: number };
        const installedVersion = typeof meta.aurowork_builtin_version === "number" ? meta.aurowork_builtin_version : 0;
        if (newVersion <= installedVersion) return; // already current or newer
      } catch {
        // Corrupted meta — overwrite
      }
    } else {
      // SKILL.md exists but no .meta.json — user-created skill, don't touch
      return;
    }
  }

  // Strip internal metadata from frontmatter before writing
  const cleanData = { ...data };
  delete cleanData.aurowork_builtin_version;
  delete cleanData.presets;
  const cleanContent = buildFrontmatter(cleanData) + body.replace(/^\n/, "");

  await upsertSkill(workspaceRoot, {
    name,
    content: cleanContent,
    description: (data.description as string) ?? "",
  });

  // Write sidecar meta
  await writeFile(metaPath, JSON.stringify({ aurowork_builtin_version: newVersion }, null, 2) + "\n", "utf8");
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/workspace-init.ts
git commit -m "feat(server): add upsertPresetSkill with version-gated sidecar logic"
```

---

### Task 4: Rewrite `ensureStarterSkills()` and Remove Constants

**Files:**
- Modify: `apps/server/src/workspace-init.ts`

- [ ] **Step 1: Rewrite `ensureStarterSkills()`**

Replace the existing `ensureStarterSkills()` function (L223-237) with:

```ts
async function ensureStarterSkills(workspaceRoot: string, preset: string): Promise<void> {
  await ensureDir(projectSkillsDir(workspaceRoot));
  for (const raw of presetSkills) {
    const { data } = parseFrontmatter(raw);
    const presets = Array.isArray(data.presets) ? (data.presets as string[]) : [];
    if (presets.includes("all") || presets.includes(preset)) {
      await upsertPresetSkill(workspaceRoot, raw);
    }
  }
}
```

- [ ] **Step 2: Remove `WORKSPACE_GUIDE` and `GET_STARTED_SKILL` constants**

Delete lines 11-78 (the `WORKSPACE_GUIDE` constant from L11-58 and the `GET_STARTED_SKILL` constant from L60-78). These are now in the external `.md` files.

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /workspace/aurowork && pnpm --filter aurowork-server typecheck`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/workspace-init.ts
git commit -m "refactor(server): replace hardcoded skill constants with preset-skills loop"
```

---

### Task 5: Write Tests

**Files:**
- Create: `apps/server/src/workspace-init.test.ts`

Tests use `bun:test` with temp directories, matching the project's existing test pattern (see `commands.test.ts`).

- [ ] **Step 1: Write test — first install writes skill and .meta.json**

Create `apps/server/src/workspace-init.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureWorkspaceFiles } from "./workspace-init.js";
import { parseFrontmatter } from "./frontmatter.js";
import { exists } from "./utils.js";

describe("ensureStarterSkills (preset-skills)", () => {
  test("first install writes skill and .meta.json", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "aurowork-preset-skills-"));

    await ensureWorkspaceFiles(workspace, "starter");

    // workspace-guide should exist (presets: [all])
    const guidePath = join(workspace, ".opencode", "skills", "workspace-guide", "SKILL.md");
    expect(await exists(guidePath)).toBe(true);

    const guideContent = await readFile(guidePath, "utf8");
    const { data: guideData } = parseFrontmatter(guideContent);
    // Internal metadata should be stripped
    expect(guideData.aurowork_builtin_version).toBeUndefined();
    expect(guideData.presets).toBeUndefined();
    // Standard metadata should remain
    expect(guideData.name).toBe("workspace-guide");
    expect(guideData.description).toBeTruthy();

    // .meta.json should exist with version
    const guideMetaPath = join(workspace, ".opencode", "skills", "workspace-guide", ".meta.json");
    expect(await exists(guideMetaPath)).toBe(true);
    const guideMeta = JSON.parse(await readFile(guideMetaPath, "utf8"));
    expect(guideMeta.aurowork_builtin_version).toBe(1);

    // get-started should exist (presets: [starter], preset is "starter")
    const getStartedPath = join(workspace, ".opencode", "skills", "get-started", "SKILL.md");
    expect(await exists(getStartedPath)).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd /workspace/aurowork && pnpm --filter aurowork-server test -- --filter "first install"`

Expected: PASS

- [ ] **Step 3: Write test — preset gating excludes get-started from minimal**

```ts
  test("preset gating: get-started excluded from minimal", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "aurowork-preset-skills-"));

    await ensureWorkspaceFiles(workspace, "minimal");

    // workspace-guide should exist (presets: [all])
    const guidePath = join(workspace, ".opencode", "skills", "workspace-guide", "SKILL.md");
    expect(await exists(guidePath)).toBe(true);

    // get-started should NOT exist (presets: [starter], preset is "minimal")
    const getStartedPath = join(workspace, ".opencode", "skills", "get-started", "SKILL.md");
    expect(await exists(getStartedPath)).toBe(false);
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /workspace/aurowork && pnpm --filter aurowork-server test -- --filter "preset gating"`

Expected: PASS

- [ ] **Step 5: Write test — skips overwrite when version is current**

```ts
  test("skips overwrite when .meta.json version >= shipped version", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "aurowork-preset-skills-"));

    await ensureWorkspaceFiles(workspace, "starter");

    // Modify the skill content to detect if it gets overwritten
    const guidePath = join(workspace, ".opencode", "skills", "workspace-guide", "SKILL.md");
    const original = await readFile(guidePath, "utf8");
    const marker = original + "\n<!-- user edit -->\n";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(guidePath, marker, "utf8");

    // Run again — should NOT overwrite since .meta.json version matches
    await ensureWorkspaceFiles(workspace, "starter");

    const afterSecondRun = await readFile(guidePath, "utf8");
    expect(afterSecondRun).toContain("<!-- user edit -->");
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /workspace/aurowork && pnpm --filter aurowork-server test -- --filter "skips overwrite"`

Expected: PASS

- [ ] **Step 7: Write test — respects user-created skill without .meta.json**

```ts
  test("respects user-created skill (no .meta.json)", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "aurowork-preset-skills-"));
    const { mkdir, writeFile } = await import("node:fs/promises");

    // Pre-create a skill with the same name but no .meta.json (user-created)
    const skillDir = join(workspace, ".opencode", "skills", "workspace-guide");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: workspace-guide\ndescription: My custom guide\n---\nCustom content\n", "utf8");

    await ensureWorkspaceFiles(workspace, "starter");

    // Should NOT overwrite — no .meta.json means user-created
    const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
    expect(content).toContain("Custom content");
    expect(await exists(join(skillDir, ".meta.json"))).toBe(false);
  });
```

- [ ] **Step 8: Close the describe block**

```ts
});
```

- [ ] **Step 9: Run all tests**

Run: `cd /workspace/aurowork && pnpm --filter aurowork-server test -- --filter "preset-skills"`

Expected: All 4 tests PASS

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/workspace-init.test.ts
git commit -m "test(server): add tests for preset-skills version-gated upsert and preset gating"
```

---

### Task 6: Verify Build

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `cd /workspace/aurowork && pnpm --filter aurowork-server typecheck`

Expected: No errors.

- [ ] **Step 2: Run full test suite**

Run: `cd /workspace/aurowork && pnpm --filter aurowork-server test`

Expected: All tests pass, including the new ones and all existing tests.

- [ ] **Step 3: Run compile build**

Run: `cd /workspace/aurowork && pnpm --filter aurowork-server build:bin`

Expected: Binary compiles successfully. The `.md` files are embedded via Bun's text import — no runtime file dependencies.

- [ ] **Step 4: Commit (if any fixups needed)**

If any fixes were needed during verification, commit them:

```bash
git add -A
git commit -m "fix(server): address build/test issues from preset-skills migration"
```
