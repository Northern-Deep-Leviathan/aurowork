import { runNodeScript, runStep } from "./lib.mjs";

runNodeScript("verify full gate", "scripts/verify/full.mjs");
runStep("app production build", "pnpm", ["--filter", "@aurowork/app", "build"]);
runStep("desktop sidecar preparation", "pnpm", ["--filter", "@aurowork/desktop", "prepare:sidecar"]);
runStep("release review", "node", ["scripts/release/review.mjs", "--strict"]);

console.log("\nverify:release passed");
