import { Show, createEffect, createSignal } from "solid-js";
import { X, Save, FolderOpen } from "lucide-solid";
import CodeEditorView from "./CodeEditorView";
import FileTree from "./FileTree";
import { fsReadTextFile, fsWriteTextFile } from "../../lib/tauri-fs";
import { isTauriRuntime } from "../../utils";
import { pickDirectory } from "../../lib/tauri";

type CodeEditorPanelProps = {
  expanded: boolean;
  onClose: () => void;
  rootPath: string | null;
  width?: number;
};

export function CodeEditorPanel(props: CodeEditorPanelProps) {
  const [selectedFilePath, setSelectedFilePath] = createSignal<string | null>(
    null,
  );
  const [fileContent, setFileContent] = createSignal("");
  const [isDirty, setIsDirty] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [splitPosition, setSplitPosition] = createSignal(280);
  const [effectiveRoot, setEffectiveRoot] = createSignal<string | null>(null);

  // Sync rootPath from props
  createEffect(() => {
    const root = props.rootPath;
    if (root) setEffectiveRoot(root);
  });

  // ---------- file operations ----------

  const loadFile = async (path: string) => {
    if (isDirty()) {
      const ok = window.confirm(
        "You have unsaved changes. Discard and open new file?",
      );
      if (!ok) return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const content = await fsReadTextFile(path);
      setFileContent(content);
      setSelectedFilePath(path);
      setIsDirty(false);
    } catch (err) {
      setLoadError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const saveFile = async () => {
    const path = selectedFilePath();
    if (!path) return;
    try {
      await fsWriteTextFile(path, fileContent());
      setIsDirty(false);
    } catch (err) {
      window.alert(`Failed to save: ${err}`);
    }
  };

  const handleContentChange = (value: string) => {
    setFileContent(value);
    setIsDirty(true);
  };

  const handlePickFolder = async () => {
    try {
      const result = await pickDirectory({ title: "Open Folder" });
      if (typeof result === "string" && result) {
        setEffectiveRoot(result);
      }
    } catch {
      // user cancelled
    }
  };

  // ---------- splitter drag ----------

  const [dragging, setDragging] = createSignal(false);
  let panelRef: HTMLElement | undefined;

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging() || !panelRef) return;
    const rect = panelRef.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setSplitPosition(Math.max(160, Math.min(x, rect.width - 200)));
  };

  const onPointerUp = () => setDragging(false);

  // ---------- file name from path ----------

  const fileName = () => {
    const path = selectedFilePath();
    if (!path) return null;
    const parts = path.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] ?? path;
  };

  const breadcrumb = () => {
    const path = selectedFilePath();
    const root = effectiveRoot();
    if (!path) return "";
    if (root && path.startsWith(root)) {
      return path.slice(root.length).replace(/^[\\/]+/, "");
    }
    return path;
  };

  // ---------- non-Tauri guard ----------

  if (!isTauriRuntime()) {
    return (
      <aside class="relative hidden lg:flex h-full w-[400px] shrink-0 flex-col items-center justify-center overflow-hidden rounded-[24px] border border-dls-border bg-dls-sidebar p-8 text-center">
        <div>
          <div class="text-sm font-medium text-gray-11">Desktop Only</div>
          <p class="mt-2 text-xs text-gray-9">
            Work Files requires the AuroWork desktop app.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={(el) => (panelRef = el)}
      class="relative hidden lg:flex h-full shrink-0 flex-col overflow-hidden rounded-[24px] border border-dls-border bg-dls-sidebar"
      style={{ width: `${props.width ?? 420}px`, "min-width": "280px" }}
    >
      {/* Header */}
      <div class="flex h-12 items-center gap-2 border-b border-dls-border px-4 shrink-0">
        <span class="text-[13px] font-semibold text-dls-text shrink-0">Work Files</span>
        <div class="min-w-0 flex-1 truncate text-xs text-gray-9">
          <Show when={selectedFilePath()}>
            <span class="text-gray-10">{breadcrumb()}</span>
          </Show>
        </div>
        <Show when={isDirty()}>
          <span
            class="h-2 w-2 shrink-0 rounded-full bg-amber-9"
            title="Unsaved changes"
          />
        </Show>
        <Show when={selectedFilePath()}>
          <button
            type="button"
            class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-10 transition-colors hover:bg-gray-2 hover:text-gray-12 disabled:opacity-50"
            onClick={saveFile}
            disabled={!isDirty()}
            title="Save (Cmd+S)"
          >
            <Save size={12} />
            <span>Save</span>
          </button>
        </Show>
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-md text-gray-9 transition-colors hover:bg-gray-2 hover:text-gray-12"
          onClick={props.onClose}
          title="Close panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div class="relative flex min-h-0 flex-1 overflow-hidden">
        {/* File tree */}
        <div
          class="shrink-0 overflow-hidden border-r border-dls-border"
          style={{ width: `${splitPosition()}px` }}
        >
          <Show
            when={effectiveRoot()}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                <p class="text-xs text-gray-9">No workspace folder</p>
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-md bg-gray-3 px-3 py-1.5 text-[12px] font-medium text-gray-11 transition-colors hover:bg-gray-4"
                  onClick={handlePickFolder}
                >
                  <FolderOpen size={14} />
                  Open Folder
                </button>
              </div>
            }
          >
            <FileTree
              rootPath={effectiveRoot()}
              onFileSelect={(path) => void loadFile(path)}
              selectedPath={selectedFilePath()}
            />
          </Show>
        </div>

        {/* Splitter */}
        <div
          class={`w-[3px] shrink-0 cursor-col-resize transition-colors ${
            dragging() ? "bg-blue-8" : "bg-transparent hover:bg-gray-5"
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {/* Editor area */}
        <div class="min-w-0 flex-1 overflow-hidden">
          <Show when={isLoading()}>
            <div class="flex h-full items-center justify-center text-xs text-gray-9">
              Loading file...
            </div>
          </Show>
          <Show when={loadError()}>
            <div class="flex h-full items-center justify-center p-4 text-xs text-red-11">
              {loadError()}
            </div>
          </Show>
          <Show
            when={selectedFilePath() && !isLoading() && !loadError()}
            fallback={
              <Show when={!isLoading() && !loadError()}>
                <div class="flex h-full items-center justify-center text-xs text-gray-9">
                  Select a file to edit
                </div>
              </Show>
            }
          >
            <CodeEditorView
              content={fileContent()}
              filePath={selectedFilePath()}
              onContentChange={handleContentChange}
              onSave={saveFile}
            />
          </Show>
        </div>
      </div>
    </aside>
  );
}
