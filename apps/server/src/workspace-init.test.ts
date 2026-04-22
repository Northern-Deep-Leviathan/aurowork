import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

  test("skips overwrite when .meta.json version >= shipped version", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "aurowork-preset-skills-"));

    await ensureWorkspaceFiles(workspace, "starter");

    // Modify the skill content to detect if it gets overwritten
    const guidePath = join(workspace, ".opencode", "skills", "workspace-guide", "SKILL.md");
    const original = await readFile(guidePath, "utf8");
    const marker = original + "\n<!-- user edit -->\n";
    await writeFile(guidePath, marker, "utf8");

    // Run again — should NOT overwrite since .meta.json version matches
    await ensureWorkspaceFiles(workspace, "starter");

    const afterSecondRun = await readFile(guidePath, "utf8");
    expect(afterSecondRun).toContain("<!-- user edit -->");
  });

  test("respects user-created skill (no .meta.json)", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "aurowork-preset-skills-"));

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
});
