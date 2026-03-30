import App from "./app";
import { GlobalSDKProvider } from "./context/global-sdk";
import { GlobalSyncProvider } from "./context/global-sync";
import { LocalProvider } from "./context/local";
import { ServerProvider } from "./context/server";
import { isWebDeployment } from "./lib/aurowork-deployment";
import { isTauriRuntime } from "./utils";

export default function AppEntry() {
  const defaultUrl = (() => {
    // Desktop app connects to the local OpenCode engine.
    if (isTauriRuntime()) return "http://127.0.0.1:4096";

    // When running the web UI against an AuroWork server (e.g. Docker dev stack),
    // use the server's `/opencode` proxy instead of loopback.
    const auroworkUrl =
      typeof import.meta.env?.VITE_AUROWORK_URL === "string"
        ? import.meta.env.VITE_AUROWORK_URL.trim()
        : "";
    if (auroworkUrl) {
      return `${auroworkUrl.replace(/\/+$/, "")}/opencode`;
    }

    // When the hosted web deployment is served by the AuroWork server,
    // OpenCode is proxied at same-origin `/opencode`.
    if (isWebDeployment() && import.meta.env.PROD && typeof window !== "undefined") {
      return `${window.location.origin}/opencode`;
    }

    // Dev fallback (Vite) - allow overriding for remote debugging.
    const envUrl =
      typeof import.meta.env?.VITE_OPENCODE_URL === "string"
        ? import.meta.env.VITE_OPENCODE_URL.trim()
        : "";
    return envUrl || "http://127.0.0.1:4096";
  })();

  return (
    <ServerProvider defaultUrl={defaultUrl}>
      <GlobalSDKProvider>
        <GlobalSyncProvider>
          <LocalProvider>
            <App />
          </LocalProvider>
        </GlobalSyncProvider>
      </GlobalSDKProvider>
    </ServerProvider>
  );
}
