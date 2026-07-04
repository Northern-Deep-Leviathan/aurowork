import { resolve } from "node:path";
import { root, runNodeScript, runStep } from "./lib.mjs";

runNodeScript("verify fast gate", "scripts/verify/fast.mjs");
runStep("server tests", "pnpm", ["--filter", "aurowork-server", "test"]);
runStep("app e2e tests", "pnpm", ["--filter", "@aurowork/app", "test:e2e"]);
runStep("orchestrator router test", "pnpm", ["--filter", "aurowork-orchestrator", "test:router"]);
runStep("orchestrator file-session test", "pnpm", ["--filter", "aurowork-orchestrator", "test:files"]);
runStep("desktop cargo test", "cargo", ["test"], {
  cwd: resolve(root, "apps/desktop/src-tauri"),
});
runNodeScript("script tests", "scripts/verify/script-tests.mjs");

console.log("\nverify:full passed");
