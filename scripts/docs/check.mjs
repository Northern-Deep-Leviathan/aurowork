import { runStep } from "../verify/lib.mjs";

runStep("docs index coverage", "node", ["scripts/docs/index-check.mjs"]);
runStep("docs current-product claim guard", "node", ["scripts/docs/claims-check.mjs"]);

console.log("\ndocs:check passed");
