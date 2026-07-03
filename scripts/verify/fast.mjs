import { resolve } from "node:path";
import { root, runStep } from "./lib.mjs";

runStep("app typecheck", "pnpm", ["--filter", "@aurowork/app", "typecheck"]);
runStep("server typecheck", "pnpm", ["--filter", "aurowork-server", "typecheck"]);
runStep("orchestrator typecheck", "pnpm", ["--filter", "aurowork-orchestrator", "typecheck"]);
runStep("desktop cargo check", "cargo", ["check"], {
  cwd: resolve(root, "apps/desktop/src-tauri"),
});

console.log("\nverify:fast passed");
