import { Show, createEffect, createSignal, on } from "solid-js";
import { X, Save, FolderOpen } from "lucide-solid";
import CodeEditorView from "./CodeEditorView";
import MarkdownPreview from "./MarkdownPreview";
import FileTree from "./FileTree";
import { fsReadTextFile, fsWriteTextFile } from "../../lib/tauri-fs";
import { isTauriRuntime } from "../../utils";
import { pickDirectory } from "../../lib/tauri";

type FileEditorPanelProps = {
  expanded: boolean;
  onClose: () => void;
  rootPath: string | null;
  width?: number;
};

export function FileEditorPanel(props: FileEditorPanelProps) {
  const [selectedFilePath, setSelectedFilePath] = createSignal<string | null>(
    null,
  );
  const [fileContent, setFileContent] = createSignal("");
  const [isDirty, setIsDirty] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [splitPosition, setSplitPosition] = createSignal(280);
  const [effectiveRoot, setEffectiveRoot] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<"edit" | "preview">("edit");

  const isMarkdown = () => {
    const p = selectedFilePath();
    if (!p) return false;
    return /\.mdx?$/i.test(p);
  };

  // Sync rootPath from props
  createEffect(() => {
    const root = props.rootPath;
    if (root) setEffectiveRoot(root);
  });

  // Reset view mode when switching files
  createEffect(
    on(() => selectedFilePath(), () => setViewMode("edit"), { defer: true }),
  );

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
    // File tree is on the right, so width = distance from right edge
    const fileTreeWidth = rect.right - e.clientX;
    setSplitPosition(Math.max(160, Math.min(fileTreeWidth, rect.width - 200)));
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
          <div class="text-sm font-medium text-dls-secondary">Desktop Only</div>
          <p class="mt-2 text-xs text-dls-secondary">
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
        <div class="min-w-0 flex-1 truncate text-xs text-dls-secondary">
          <Show when={selectedFilePath()}>
            <span class="text-dls-secondary">{breadcrumb()}</span>
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
            class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:opacity-50"
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
          class="flex h-6 w-6 items-center justify-center rounded-md text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
          onClick={props.onClose}
          title="Close panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Body */}
      <div class="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Editor area (left) */}
        <div class="min-w-0 flex-1 flex flex-col overflow-hidden">
          {/* Edit / Preview tabs — only shown for markdown files */}
          <Show when={isMarkdown() && selectedFilePath() && !isLoading() && !loadError()}>
            <div class="flex items-center gap-0.5 border-b border-dls-border px-3 shrink-0">
              <button
                type="button"
                class={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  viewMode() === "edit"
                    ? "text-dls-text border-b-2 border-dls-text"
                    : "text-dls-secondary hover:text-dls-text"
                }`}
                onClick={() => setViewMode("edit")}
              >
                Edit
              </button>
              <button
                type="button"
                class={`px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                  viewMode() === "preview"
                    ? "text-dls-text border-b-2 border-dls-text"
                    : "text-dls-secondary hover:text-dls-text"
                }`}
                onClick={() => setViewMode("preview")}
              >
                Preview
              </button>
            </div>
          </Show>

          {/* Content area */}
          <div class="min-h-0 flex-1 overflow-hidden">
            <Show when={isLoading()}>
              <div class="flex h-full items-center justify-center text-xs text-dls-secondary">
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
                  <div class="flex h-full items-center justify-center text-xs text-dls-secondary">
                    Select a file to edit
                  </div>
                </Show>
              }
            >
              <Show
                when={isMarkdown() && viewMode() === "preview"}
                fallback={
                  <CodeEditorView
                    content={fileContent()}
                    filePath={selectedFilePath()}
                    onContentChange={handleContentChange}
                    onSave={saveFile}
                  />
                }
              >
                <MarkdownPreview content={fileContent()} />
              </Show>
            </Show>
          </div>
        </div>

        {/* Splitter */}
        <div
          class={`w-[3px] shrink-0 cursor-col-resize transition-colors ${
            dragging() ? "bg-blue-8" : "bg-transparent hover:bg-dls-border"
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {/* File tree (right) */}
        <div
          class="shrink-0 overflow-hidden border-l border-dls-border"
          style={{ width: `${splitPosition()}px` }}
        >
          <Show
            when={effectiveRoot()}
            fallback={
              <div class="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                <p class="text-xs text-dls-secondary">No workspace folder</p>
                <button
                  type="button"
                  class="flex items-center gap-1.5 rounded-md bg-dls-hover px-3 py-1.5 text-[12px] font-medium text-dls-secondary transition-colors hover:bg-dls-active"
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
      </div>
    </aside>
  );
}
