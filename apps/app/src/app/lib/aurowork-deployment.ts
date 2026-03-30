export const AUROWORK_DEPLOYMENT_ENV_VAR = "VITE_AUROWORK_DEPLOYMENT";

export type AuroWorkDeployment = "desktop" | "web";

function normalizeDeployment(value: string | undefined): AuroWorkDeployment {
  const normalized = value?.trim().toLowerCase();
  return normalized === "web" ? "web" : "desktop";
}

export function getAuroWorkDeployment(): AuroWorkDeployment {
  const envValue =
    typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_AUROWORK_DEPLOYMENT === "string"
      ? import.meta.env.VITE_AUROWORK_DEPLOYMENT
      : undefined;

  return normalizeDeployment(envValue);
}

export function isWebDeployment(): boolean {
  return getAuroWorkDeployment() === "web";
}

export function isDesktopDeployment(): boolean {
  return getAuroWorkDeployment() === "desktop";
}
