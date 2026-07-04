import { runStep } from "./lib.mjs";

runStep("common PR helper tests", "bash", ["scripts/common/test-open-merge-pr-common.sh"]);
runStep("publish script tests", "bash", ["scripts/publish/test-all.sh"]);
runStep("release PR helper tests", "bash", ["scripts/release/test-open-merge-release-pr.sh"]);
runStep("stats unit tests", "node", ["--test", "scripts/stats.test.mjs"]);
runStep("debug report tests", "node", ["--test", "scripts/debug/report.test.mjs"]);

console.log("\ntest:scripts passed");
