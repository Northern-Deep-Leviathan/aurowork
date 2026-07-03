import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const docsDir = resolve(root, "docs");
const indexPath = resolve(docsDir, "INDEX.md");
const index = readFileSync(indexPath, "utf8");

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...walk(path));
    } else if (stat.isFile()) {
      files.push(path);
    }
  }
  return files;
}

const missing = [];
for (const file of walk(docsDir).sort()) {
  const rel = relative(docsDir, file).replaceAll("\\", "/");
  if (rel === "INDEX.md") continue;
  if (!index.includes(rel)) {
    missing.push(`docs/${rel}`);
  }
}

if (missing.length) {
  console.error("docs:index:check failed. Missing files in docs/INDEX.md:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

console.log("docs:index:check passed");
