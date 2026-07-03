import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

export function runStep(label, command, args = [], options = {}) {
  console.log(`\n==> ${label}`);
  console.log(`$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...(options.env || {}) },
  });
  if (result.status !== 0) {
    const code = result.status ?? 1;
    console.error(`\nFAILED: ${label} (exit ${code})`);
    process.exit(code);
  }
}

export function runNodeScript(label, path, args = []) {
  runStep(label, "node", [path, ...args]);
}
