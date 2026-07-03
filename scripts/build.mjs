import { execSync } from "node:child_process";

const command = "pnpm --filter @aurowork/desktop build";

execSync(command, { stdio: "inherit" });
