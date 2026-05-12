# Project Skills

This directory is the **canonical source** for project-scoped agent skills.

Each skill is a folder containing a `SKILL.md` file (Anthropic skill format: YAML frontmatter + markdown body). The format is also consumed by Copilot CLI and is becoming a de-facto standard across coding agents.

## Layout

```
.skills/
  <skill-name>/
    SKILL.md           # required
    references/        # optional supporting docs
```

## Why `.skills/` (not `.claude/skills/`)

To keep skills agent-neutral and version-controlled. Different agents look in different locations:

| Agent          | Expected path           | How we satisfy it           |
|----------------|-------------------------|-----------------------------|
| Claude Code    | `.claude/skills/`       | junction → `.skills/`       |
| Copilot CLI    | `.claude/skills/`       | same junction               |
| Cursor         | `.cursor/rules/*.mdc`   | (TODO: conversion script)   |
| Continue.dev   | `.continue/`            | (TODO: conversion script)   |

`.skills/` itself is the source of truth — committed to git, reviewable, shareable.

## Setup on a fresh clone

The `.claude/skills` link is **not** in git (junctions / symlinks don't round-trip across platforms safely). Each developer recreates it once:

### Windows (PowerShell or cmd)

```cmd
cd .claude
mklink /J skills ..\.skills
```

### macOS / Linux

```sh
ln -s ../.skills .claude/skills
```

## Adding a new skill

1. Create `.skills/<your-skill>/SKILL.md` with YAML frontmatter:
   ```markdown
   ---
   name: your-skill
   description: Use when <trigger condition>
   ---

   # Body in markdown
   ```
2. Commit it. The junction in `.claude/skills/` will surface it automatically.

## Format reference

- Anthropic: https://docs.claude.com/en/docs/claude-code/skills
- Frontmatter `name` must match the directory name
- `description` should start with "Use when…" so the model knows when to trigger
