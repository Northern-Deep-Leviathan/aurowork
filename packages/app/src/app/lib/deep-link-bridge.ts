export const deepLinkBridgeEvent = "aurowork:deep-link";
export const nativeDeepLinkEvent = "aurowork:deep-link-native";

export type DeepLinkBridgeDetail = {
  urls: string[];
};

declare global {
  interface Window {
    __AUROWORK__?: {
      deepLinks?: string[];
    };
  }
}

function normalizeDeepLinks(urls: readonly string[]): string[] {
  return urls.map((url) => url.trim()).filter(Boolean);
}

export function pushPendingDeepLinks(target: Window, urls: readonly string[]): string[] {
  const normalized = normalizeDeepLinks(urls);
  if (normalized.length === 0) {
    return [];
  }

  target.__AUROWORK__ ??= {};
  const pending = target.__AUROWORK__.deepLinks ?? [];
  target.__AUROWORK__.deepLinks = [...pending, ...normalized];
  target.dispatchEvent(
    new CustomEvent<DeepLinkBridgeDetail>(deepLinkBridgeEvent, {
      detail: { urls: normalized },
    }),
  );
  return normalized;
}

export function drainPendingDeepLinks(target: Window): string[] {
  const pending = target.__AUROWORK__?.deepLinks ?? [];
  if (target.__AUROWORK__) {
    target.__AUROWORK__.deepLinks = [];
  }
  return [...pending];
}
