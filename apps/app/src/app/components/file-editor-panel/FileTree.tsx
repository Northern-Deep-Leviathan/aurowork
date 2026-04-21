import { For, Show, createEffect, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  ChevronDown,
  ChevronRight,
  File,
  FolderOpen,
  Folder,
} from "lucide-solid";
import { fsReadDir, type FsEntry } from "../../lib/tauri-fs";

/** Directories we never want to show. */
const HIDDEN_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".DS_Store",
  "Thumbs.db",
]);

type TreeNode = {
  entry: FsEntry;
  children: TreeNode[];
  loaded: boolean;
  expanded: boolean;
  loading: boolean;
};

type FileTreeProps = {
  rootPath: string | null;
  onFileSelect: (entry: FsEntry) => void;
  selectedPath: string | null;
};

function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export default function FileTree(props: FileTreeProps) {
  const [nodes, setNodes] = createStore<TreeNode[]>([]);
  const [rootLoading, setRootLoading] = createSignal(false);
  const [rootError, setRootError] = createSignal<string | null>(null);

  /** Load children for a directory and return TreeNodes. */
  const loadChildren = async (dirPath: string): Promise<TreeNode[]> => {
    const raw = await fsReadDir(dirPath);
    const filtered = raw.filter((e) => !HIDDEN_NAMES.has(e.name));
    return sortEntries(filtered).map((entry) => ({
      entry,
      children: [],
      loaded: false,
      expanded: false,
      loading: false,
    }));
  };

  /** Load root when rootPath changes. */
  const loadRoot = async (rootPath: string) => {
    setRootLoading(true);
    setRootError(null);
    try {
      const children = await loadChildren(rootPath);
      setNodes(children);
    } catch (err) {
      setRootError(String(err));
      setNodes([]);
    } finally {
      setRootLoading(false);
    }
  };

  // React to rootPath changes.
  let prevRoot: string | null = null;
  createEffect(() => {
    const root = props.rootPath;
    if (root && root !== prevRoot) {
      prevRoot = root;
      void loadRoot(root);
    } else if (!root) {
      prevRoot = null;
      setNodes([]);
    }
  });

  /** Navigate to a nested node via an index path within a mutable draft. */
  const getNode = (draft: TreeNode[], indexPath: number[]): TreeNode => {
    let node = draft[indexPath[0]!]!;
    for (let i = 1; i < indexPath.length; i++) {
      node = node.children[indexPath[i]!]!;
    }
    return node;
  };

  /** Toggle expand/collapse of a directory node by path index chain. */
  const toggleDir = async (indexPath: number[]) => {
    // Read current state of the target node.
    let target: TreeNode = nodes[indexPath[0]!]!;
    for (let i = 1; i < indexPath.length; i++) {
      target = target.children[indexPath[i]!]!;
    }

    if (target.expanded) {
      // Collapse
      setNodes(
        produce((draft: TreeNode[]) => {
          getNode(draft, indexPath).expanded = false;
        }),
      );
      return;
    }

    // Expand — lazy-load if needed
    if (!target.loaded) {
      setNodes(
        produce((draft: TreeNode[]) => {
          getNode(draft, indexPath).loading = true;
        }),
      );
      try {
        const children = await loadChildren(target.entry.path);
        setNodes(
          produce((draft: TreeNode[]) => {
            const node = getNode(draft, indexPath);
            node.children = children;
            node.loaded = true;
            node.loading = false;
            node.expanded = true;
          }),
        );
      } catch {
        setNodes(
          produce((draft: TreeNode[]) => {
            getNode(draft, indexPath).loading = false;
          }),
        );
      }
    } else {
      setNodes(
        produce((draft: TreeNode[]) => {
          getNode(draft, indexPath).expanded = true;
        }),
      );
    }
  };

  return (
    <div class="h-full overflow-y-auto overflow-x-hidden text-[13px]">
      <Show when={rootLoading()}>
        <div class="px-3 py-4 text-xs text-dls-secondary">Loading...</div>
      </Show>
      <Show when={rootError()}>
        <div class="px-3 py-4 text-xs text-red-11">
          {rootError()}
        </div>
      </Show>
      <Show when={!rootLoading() && !rootError() && nodes.length === 0 && props.rootPath}>
        <div class="px-3 py-4 text-xs text-dls-secondary">Empty directory</div>
      </Show>
      <div class="py-1">
        <For each={nodes}>
          {(node, idx) => (
            <FileTreeNode
              node={node}
              depth={0}
              indexPath={[idx()]}
              onToggle={toggleDir}
              onFileSelect={props.onFileSelect}
              selectedPath={props.selectedPath}
            />
          )}
        </For>
      </div>
    </div>
  );
}

type FileTreeNodeProps = {
  node: TreeNode;
  depth: number;
  indexPath: number[];
  onToggle: (indexPath: number[]) => void;
  onFileSelect: (entry: FsEntry) => void;
  selectedPath: string | null;
};

function FileTreeNode(props: FileTreeNodeProps) {
  const paddingLeft = () => props.depth * 16 + 8;
  const isSelected = () => props.selectedPath === props.node.entry.path;

  const handleClick = () => {
    if (props.node.entry.is_dir) {
      props.onToggle(props.indexPath);
    } else {
      props.onFileSelect(props.node.entry);
    }
  };

  return (
    <>
      <button
        type="button"
        class={`flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left transition-colors ${
          isSelected()
            ? "bg-dls-hover text-dls-text"
            : "text-dls-secondary hover:bg-dls-hover"
        }`}
        style={{ "padding-left": `${paddingLeft()}px` }}
        onClick={handleClick}
        title={props.node.entry.path}
      >
        <Show when={props.node.entry.is_dir}>
          <span class="flex h-4 w-4 shrink-0 items-center justify-center text-dls-secondary">
            <Show
              when={props.node.loading}
              fallback={
                <Show
                  when={props.node.expanded}
                  fallback={<ChevronRight size={14} />}
                >
                  <ChevronDown size={14} />
                </Show>
              }
            >
              <span class="h-3 w-3 animate-spin rounded-full border-2 border-dls-border border-t-dls-secondary" />
            </Show>
          </span>
          <span class="shrink-0 text-dls-secondary">
            <Show when={props.node.expanded} fallback={<Folder size={14} />}>
              <FolderOpen size={14} />
            </Show>
          </span>
        </Show>
        <Show when={!props.node.entry.is_dir}>
          <span class="h-4 w-4 shrink-0" />
          <span class="shrink-0 text-dls-secondary">
            <File size={14} />
          </span>
        </Show>
        <span class="truncate">{props.node.entry.name}</span>
      </button>
      <Show when={props.node.expanded && props.node.children.length > 0}>
        <For each={props.node.children}>
          {(child, childIdx) => (
            <FileTreeNode
              node={child}
              depth={props.depth + 1}
              indexPath={[...props.indexPath, childIdx()]}
              onToggle={props.onToggle}
              onFileSelect={props.onFileSelect}
              selectedPath={props.selectedPath}
            />
          )}
        </For>
      </Show>
    </>
  );
}
