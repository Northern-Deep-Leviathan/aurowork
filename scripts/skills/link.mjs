#!/usr/bin/env node
// Link `.claude/skills` -> `.skills` so Claude Code / Copilot CLI can discover
// project-scoped skills. Run once after fresh clone:
//   node scripts/skills/link.mjs
//
// Idempotent. Works on Windows (junction), macOS, and Linux (symlink).

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const target = resolve(repoRoot, ".skills");
const linkPath = resolve(repoRoot, ".claude", "skills");

if (!existsSync(target)) {
  console.error(`✗ source missing: ${target}`);
  process.exit(1);
}

mkdirSync(dirname(linkPath), { recursive: true });

if (existsSync(linkPath) || lstatSyncSafe(linkPath)) {
  const stat = lstatSync(linkPath);
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    rmSync(linkPath, { recursive: true, force: true });
  }
}

// On Windows, prefer "junction" — it doesn't require admin / dev mode.
const type = process.platform === "win32" ? "junction" : "dir";
symlinkSync(target, linkPath, type);
console.log(`✓ linked .claude/skills -> .skills (${type})`);

function lstatSyncSafe(p) {
  try {
    return lstatSync(p);
  } catch {
    return null;
  }
}
