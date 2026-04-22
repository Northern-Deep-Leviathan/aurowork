import { basename, join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { upsertSkill } from "./skills.js";
import { upsertCommand } from "./commands.js";
import { readJsoncFile, writeJsoncFile } from "./jsonc.js";
import { ensureDir, exists } from "./utils.js";
import { parseFrontmatter, buildFrontmatter } from "./frontmatter.js";
import { presetSkills } from "./preset-skills/index.js";
import { ApiError } from "./errors.js";
import { auroworkConfigPath, opencodeConfigPath, projectCommandsDir, projectSkillsDir } from "./workspace-files.js";

const AUROWORK_AGENT = `---
description: AuroWork default agent (safe, mobile-first, self-referential)
mode: primary
temperature: 0.2
---

You are AuroWork.

When the user refers to "you", they mean the AuroWork app and the current workspace.

Your job:
- Help the user work on files safely.
- Automate repeatable work.
- Keep behavior portable and reproducible.

Memory (two kinds)
1) Behavior memory (shareable, in git)
- ".opencode/skills/**"
- ".opencode/agents/**"
- repo docs

2) Private memory (never commit)
- Tokens, IDs, credentials
- Local DBs/logs/config files (gitignored)
- Notion pages/databases (if configured via MCP)

Hard rule: never copy private memory into repo files verbatim. Store only redacted summaries, schemas/templates, and stable pointers.

Reconstruction-first
- Do not assume env vars or prior setup.
- If required state is missing, ask one targeted question.
- After the user provides it, store it in private memory and continue.

Verification-first
- If you change code, run the smallest meaningful test or smoke check.
- If you touch UI or remote behavior, validate end-to-end and capture logs on failure.

Incremental adoption loop
- Do the task once end-to-end.
- If steps repeat, factor them into a skill.
- If the work becomes ongoing, create/refine an agent role.
- If it should run regularly, schedule it and store outputs in private memory.
`;

type WorkspaceAuroworkConfig = {
  version: number;
  workspace?: {
    name?: string | null;
    createdAt?: number | null;
    preset?: string | null;
  } | null;
  authorizedRoots: string[];
  blueprint?: Record<string, unknown> | null;
  reload?: {
    auto?: boolean;
    resume?: boolean;
  } | null;
};

function buildDefaultWorkspaceBlueprint(_preset: string): Record<string, unknown> {
  return {
    emptyState: {
      title: "What do you want to do?",
      body: "Pick a starting point or just type below.",
      starters: [
        {
          id: "csv-help",
          kind: "prompt",
          title: "Work on a CSV",
          description: "Clean up or generate spreadsheet data.",
          prompt: "Help me create or edit CSV files on this computer.",
        },
        {
          id: "starter-connect-openai",
          kind: "action",
          title: "Connect ChatGPT",
          description: "Add your OpenAi provider so ChatGPT models are ready in new sessions.",
          action: "connect-openai",
        },
        {
          id: "browser-automation",
          kind: "session",
          title: "Automate Chrome",
          description: "Start a browser automation conversation right away.",
          prompt: "Help me connect to Chrome and automate a repetitive task.",
        },
      ],
    },
    sessions: [
      {
        id: "welcome-to-aurowork",
        title: "Welcome to AuroWork",
        openOnFirstLoad: true,
        messages: [
          {
            role: "assistant",
            text:
              "Hi welcome to AuroWork!\n\nPeople use us to write .csv files on their computer, connect to Chrome and automate repetitive tasks, and sync contacts to Notion.\n\nBut the only limit is your imagination.\n\nWhat would you want to do?",
          },
        ],
      },
      {
        id: "csv-playbook",
        title: "CSV workflow ideas",
        messages: [
          {
            role: "assistant",
            text: "I can help you generate, clean, merge, and summarize CSV files. What kind of CSV work do you want to automate?",
          },
          {
            role: "user",
            text: "I want to combine exports from multiple tools into one clean CSV.",
          },
        ],
      },
    ],
  };
}

function normalizePreset(preset: string | null | undefined): string {
  const trimmed = preset?.trim() ?? "";
  if (!trimmed) return "starter";
  return trimmed;
}

function mergePlugins(existing: string[], required: string[]): string[] {
  const next = existing.slice();
  for (const plugin of required) {
    if (!next.includes(plugin)) {
      next.push(plugin);
    }
  }
  return next;
}

async function upsertPresetSkill(workspaceRoot: string, rawContent: string): Promise<void> {
  const { data, body } = parseFrontmatter(rawContent);
  const name = typeof data.name === "string" ? data.name : "";
  if (!name) throw new Error("Preset skill missing 'name' in frontmatter");
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

async function ensureAuroworkAgent(workspaceRoot: string): Promise<void> {
  const agentsDir = join(workspaceRoot, ".opencode", "agents");
  const agentPath = join(agentsDir, "aurowork.md");
  if (await exists(agentPath)) return;
  await ensureDir(agentsDir);
  await writeFile(agentPath, AUROWORK_AGENT.endsWith("\n") ? AUROWORK_AGENT : `${AUROWORK_AGENT}\n`, "utf8");
}

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

async function ensureStarterCommands(workspaceRoot: string, preset: string): Promise<void> {
  await ensureDir(projectCommandsDir(workspaceRoot));
  await upsertCommand(workspaceRoot, {
    name: "learn-files",
    description: "Safe, practical file workflows",
    template: "Show me how to interact with files in this workspace. Include safe examples for reading, summarizing, and editing.",
  });
  await upsertCommand(workspaceRoot, {
    name: "learn-skills",
    description: "How skills work and how to create your own",
    template: "Explain what skills are, how to use them, and how to create a new skill for this workspace.",
  });
  await upsertCommand(workspaceRoot, {
    name: "learn-plugins",
    description: "What plugins are and how to install them",
    template: "Explain what plugins are and how to install them in this workspace.",
  });
  if (preset === "starter") {
    await upsertCommand(workspaceRoot, {
      name: "get-started",
      description: "Get started",
      template: "get started",
    });
  }
}

async function ensureOpencodeConfig(workspaceRoot: string, preset: string): Promise<void> {
  const path = opencodeConfigPath(workspaceRoot);
  const { data } = await readJsoncFile<Record<string, unknown>>(path, {
    $schema: "https://opencode.ai/config.json",
  });
  const next: Record<string, unknown> = data && typeof data === "object" && !Array.isArray(data)
    ? { ...data }
    : { $schema: "https://opencode.ai/config.json" };

  if (typeof next.default_agent !== "string" || !next.default_agent.trim()) {
    next.default_agent = "aurowork";
  }

  const requiredPlugins = preset === "starter" || preset === "automation"
    ? ["opencode-scheduler"]
    : [];
  if (requiredPlugins.length > 0) {
    const currentPlugins = Array.isArray(next.plugin)
      ? next.plugin.filter((value: unknown): value is string => typeof value === "string")
      : typeof next.plugin === "string"
        ? [next.plugin]
        : [];
    next.plugin = mergePlugins(currentPlugins, requiredPlugins);
  }

  if (preset === "starter") {
    const currentMcp = next.mcp && typeof next.mcp === "object" && !Array.isArray(next.mcp)
      ? { ...(next.mcp as Record<string, unknown>) }
      : {};
    if (!("control-chrome" in currentMcp)) {
      currentMcp["control-chrome"] = {
        type: "local",
        command: ["chrome-devtools-mcp"],
      };
    }
    next.mcp = currentMcp;
  }

  await writeJsoncFile(path, next);
}

async function ensureWorkspaceAuroworkConfig(workspaceRoot: string, preset: string): Promise<void> {
  const path = auroworkConfigPath(workspaceRoot);
  if (await exists(path)) return;
  const now = Date.now();
  const config: WorkspaceAuroworkConfig = {
    version: 1,
    workspace: {
      name: basename(workspaceRoot) || "Workspace",
      createdAt: now,
      preset,
    },
    authorizedRoots: [workspaceRoot],
    blueprint: buildDefaultWorkspaceBlueprint(preset),
    reload: null,
  };
  await ensureDir(join(workspaceRoot, ".opencode"));
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export async function ensureWorkspaceFiles(workspaceRoot: string, presetInput: string): Promise<void> {
  const preset = normalizePreset(presetInput);
  if (!workspaceRoot.trim()) {
    throw new ApiError(400, "invalid_workspace_path", "workspace path is required");
  }
  await ensureDir(workspaceRoot);
  await ensureStarterSkills(workspaceRoot, preset);
  await ensureAuroworkAgent(workspaceRoot);
  await ensureStarterCommands(workspaceRoot, preset);
  await ensureOpencodeConfig(workspaceRoot, preset);
  await ensureWorkspaceAuroworkConfig(workspaceRoot, preset);
}

export async function readRawOpencodeConfig(path: string): Promise<{ exists: boolean; content: string | null }> {
  const hasFile = await exists(path);
  if (!hasFile) {
    return { exists: false, content: null };
  }
  const content = await readFile(path, "utf8");
  return { exists: true, content };
}
