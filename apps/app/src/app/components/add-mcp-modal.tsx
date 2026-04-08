import { Show, createSignal } from "solid-js";
import { Loader2, Plus, X } from "lucide-solid";
import Button from "./button";
import TextInput from "./text-input";
import type { McpDirectoryInfo } from "../constants";
import { t, type Language } from "../../i18n";

export type AddMcpModalProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (entry: McpDirectoryInfo) => void;
  busy: boolean;
  isRemoteWorkspace: boolean;
  language: Language;
};

export default function AddMcpModal(props: AddMcpModalProps) {
  const tr = (key: string) => t(key, props.language);

  const [name, setName] = createSignal("");
  const [serverType, setServerType] = createSignal<"remote" | "local">("remote");
  const [url, setUrl] = createSignal("");
  const [command, setCommand] = createSignal("");
  const [oauthRequired, setOauthRequired] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const reset = () => {
    setName("");
    setServerType("remote");
    setUrl("");
    setCommand("");
    setOauthRequired(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    props.onClose();
  };

  const handleSubmit = () => {
    setError(null);

    const trimmedName = name().trim();
    if (!trimmedName) {
      setError(tr("mcp.name_required"));
      return;
    }

    if (serverType() === "remote") {
      const trimmedUrl = url().trim();
      if (!trimmedUrl) {
        setError(tr("mcp.url_or_command_required"));
        return;
      }

      props.onAdd({
        name: trimmedName,
        description: "",
        type: "remote",
        url: trimmedUrl,
        oauth: oauthRequired(),
      });
    } else {
      const trimmedCommand = command().trim();
      if (!trimmedCommand) {
        setError(tr("mcp.url_or_command_required"));
        return;
      }

      props.onAdd({
        name: trimmedName,
        description: "",
        type: "local",
        command: trimmedCommand.split(/\s+/),
        oauth: false,
      });
    }

    handleClose();
  };

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          class="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={handleClose}
        />

        <div class="relative w-full max-w-lg bg-dls-surface border border-dls-border rounded-3xl shadow-[var(--dls-shell-shadow)] overflow-hidden">
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-dls-border">
            <div>
              <h2 class="text-lg font-semibold text-dls-text">
                {tr("mcp.add_modal_title")}
              </h2>
              <p class="text-sm text-dls-secondary">{tr("mcp.add_modal_subtitle")}</p>
            </div>
            <button
              type="button"
              class="p-2 text-dls-secondary hover:text-dls-text hover:bg-dls-active rounded-lg transition-colors"
              onClick={handleClose}
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div class="px-6 py-5 space-y-4">
            <TextInput
              label={tr("mcp.server_name")}
              placeholder={tr("mcp.server_name_placeholder")}
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              autofocus
            />

            <div>
              <div class="mb-1 text-xs font-medium text-dls-secondary">{tr("mcp.server_type")}</div>
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  class={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    serverType() === "remote"
                      ? "bg-dls-active text-dls-text"
                      : "text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                  }`}
                  onClick={() => setServerType("remote")}
                >
                  {tr("mcp.type_remote")}
                </button>
                <button
                  type="button"
                  disabled={props.isRemoteWorkspace}
                  class={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    serverType() === "local"
                      ? "bg-dls-active text-dls-text"
                      : "text-dls-secondary hover:text-dls-text hover:bg-dls-hover"
                  } ${props.isRemoteWorkspace ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => {
                    if (props.isRemoteWorkspace) return;
                    setServerType("local");
                  }}
                >
                  {tr("mcp.type_local_cmd")}
                </button>
              </div>
              <Show when={props.isRemoteWorkspace}>
                <div class="mt-2 text-[11px] text-dls-secondary">{tr("mcp.remote_workspace_url_hint")}</div>
              </Show>
            </div>

            <Show when={serverType() === "remote"}>
              <div class="space-y-3">
                <TextInput
                  label={tr("mcp.server_url")}
                  placeholder={tr("mcp.server_url_placeholder")}
                  value={url()}
                  onInput={(e) => setUrl(e.currentTarget.value)}
                />
                <div class="rounded-xl border border-dls-border bg-dls-hover/40 px-3 py-3">
                  <div class="mb-2 text-xs font-medium text-dls-text">{tr("mcp.sign_in_section_label")}</div>
                  <label class="flex items-start gap-2 text-xs text-dls-secondary">
                    <input
                      type="checkbox"
                      class="mt-0.5 h-4 w-4 rounded border border-dls-border"
                      checked={oauthRequired()}
                      onChange={(event) => setOauthRequired(event.currentTarget.checked)}
                    />
                    <span>
                      <span class="block text-dls-text">{tr("mcp.oauth_optional_label")}</span>
                      <span class="mt-0.5 block text-dls-secondary">{tr("mcp.oauth_optional_hint")}</span>
                    </span>
                  </label>
                </div>
              </div>
            </Show>

            <Show when={serverType() === "local"}>
              <TextInput
                label={tr("mcp.server_command")}
                placeholder={tr("mcp.server_command_placeholder")}
                hint={tr("mcp.server_command_hint")}
                value={command()}
                onInput={(e) => setCommand(e.currentTarget.value)}
              />
            </Show>

            <Show when={error()}>
              <div class="rounded-lg bg-red-2 border border-red-6 px-3 py-2 text-xs text-red-11">
                {error()}
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-dls-border bg-dls-surface/50">
            <Button variant="ghost" onClick={handleClose}>
              {tr("mcp.auth.cancel")}
            </Button>
            <Button variant="secondary" onClick={handleSubmit} disabled={props.busy}>
              <Show when={props.busy} fallback={<Plus size={16} />}>
                <Loader2 size={16} class="animate-spin" />
              </Show>
              {tr("mcp.add_server_button")}
            </Button>
          </div>
        </div>
      </div>
    </Show>
  );
}
