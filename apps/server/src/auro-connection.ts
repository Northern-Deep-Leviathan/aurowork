import type { ServerConfig, WorkspaceInfo } from "./types.js";

type AuroConnection = {
  baseUrl?: string;
  authHeader?: string;
};

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function resolveWorkspaceAuroConnection(
  config: Pick<ServerConfig, "auroBaseUrl" | "auroUsername" | "auroPassword">,
  workspace: WorkspaceInfo,
): AuroConnection {
  const baseUrl = trim(workspace.baseUrl) || trim(config.auroBaseUrl) || undefined;
  const username = trim(workspace.auroUsername) || trim(config.auroUsername);
  const password = trim(workspace.auroPassword) || trim(config.auroPassword);

  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(username && password
      ? {
          authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
        }
      : {}),
  };
}

export function inheritWorkspaceAuroConnection(
  config: Pick<ServerConfig, "auroBaseUrl" | "auroUsername" | "auroPassword">,
): Pick<WorkspaceInfo, "baseUrl" | "auroUsername" | "auroPassword"> {
  const baseUrl = trim(config.auroBaseUrl);
  const username = trim(config.auroUsername);
  const password = trim(config.auroPassword);

  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(username ? { auroUsername: username } : {}),
    ...(password ? { auroPassword: password } : {}),
  };
}
