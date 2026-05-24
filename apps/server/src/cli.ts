#!/usr/bin/env bun

import { parseCliArgs, printHelp, resolveServerConfig } from "./config.js";
import { createServerLogger, startServer } from "./server.js";
import pkg from "../package.json" with { type: "json" };

const startedAt = Date.now();
const phaseLog = (event: string, extras: Record<string, string | number | boolean> = {}) => {
  const elapsed = Date.now() - startedAt;
  const kv = Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`[aurowork-server] [server-phase] ${event} elapsed=${elapsed}ms${kv ? " " + kv : ""}`);
};
phaseLog("bun-started", { pid: process.pid });

const args = parseCliArgs(process.argv.slice(2));
phaseLog("args-parsed");

if (args.help) {
  printHelp();
  process.exit(0);
}

if (args.version) {
  console.log(pkg.version);
  process.exit(0);
}

const config = await resolveServerConfig(args);
phaseLog("config-resolved", {
  workspaces: config.workspaces?.length ?? 0,
  auro_base_url: config.auroBaseUrl ? "set" : "unset",
});
const logger = createServerLogger(config);
phaseLog("logger-ready");
const server = startServer(config);

const url = `http://${config.host}:${server.port}`;
logger.log("info", `AuroWork server listening on ${url}`);

if (config.tokenSource === "generated") {
  logger.log("info", `Client token: ${config.token}`);
}

if (config.hostTokenSource === "generated") {
  logger.log("info", `Host token: ${config.hostToken}`);
}

if (config.workspaces.length === 0) {
  logger.log("info", "No workspaces configured. Add --workspace or update server.json.");
} else {
  logger.log("info", `Workspaces: ${config.workspaces.length}`);
}

if (args.verbose) {
  logger.log("info", `Config path: ${config.configPath ?? "unknown"}`);
  logger.log("info", `Read-only: ${config.readOnly ? "true" : "false"}`);
  logger.log("info", `Approval: ${config.approval.mode} (${config.approval.timeoutMs}ms)`);
  logger.log("info", `CORS origins: ${config.corsOrigins.join(", ")}`);
  logger.log("info", `Authorized roots: ${config.authorizedRoots.join(", ")}`);
  logger.log("info", `Token source: ${config.tokenSource}`);
  logger.log("info", `Host token source: ${config.hostTokenSource}`);
}
