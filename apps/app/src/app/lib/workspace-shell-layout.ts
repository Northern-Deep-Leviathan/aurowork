import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

const LEFT_SIDEBAR_WIDTH_KEY = "aurowork.workspace-shell.left-width.v1";
const LEFT_SIDEBAR_COLLAPSED_KEY = "aurowork.workspace-shell.left-collapsed.v1";
const RIGHT_SIDEBAR_EXPANDED_KEY = "aurowork.workspace-shell.right-expanded.v3";
const RIGHT_PANEL_WIDTH_KEY = "aurowork.workspace-shell.right-width.v1";

export const DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH = 260;
export const MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH = 220;
export const MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH = 420;
export const LEFT_SIDEBAR_COLLAPSED_WIDTH = 56;
export const DEFAULT_WORKSPACE_RIGHT_SIDEBAR_COLLAPSED_WIDTH = 72;
export const DEFAULT_RIGHT_PANEL_WIDTH = 420;
export const MIN_RIGHT_PANEL_WIDTH = 280;
export const MAX_RIGHT_PANEL_WIDTH = 1200;

type WorkspaceShellLayoutOptions = {
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  collapsedRightWidth?: number;
  expandedRightWidth: number;
};

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore persistence failures
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function createWorkspaceShellLayout(options: WorkspaceShellLayoutOptions) {
  const minLeftWidth = Math.max(180, options.minLeftWidth ?? MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH);
  const maxLeftWidth = Math.max(minLeftWidth, options.maxLeftWidth ?? MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH);
  const defaultLeftWidth = clampNumber(
    options.defaultLeftWidth ?? DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
    minLeftWidth,
    maxLeftWidth,
  );
  const collapsedRightWidth = Math.max(
    56,
    options.collapsedRightWidth ?? DEFAULT_WORKSPACE_RIGHT_SIDEBAR_COLLAPSED_WIDTH,
  );
  const expandedRightWidth = Math.max(collapsedRightWidth, options.expandedRightWidth);

  const readLeftSidebarWidth = () => {
    const raw = readStorage(LEFT_SIDEBAR_WIDTH_KEY);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return defaultLeftWidth;
    return clampNumber(parsed, minLeftWidth, maxLeftWidth);
  };

  const readRightSidebarExpanded = () => {
    const raw = readStorage(RIGHT_SIDEBAR_EXPANDED_KEY);
    if (raw == null) return false;
    return raw === "1";
  };

  const readRightPanelWidth = () => {
    const raw = readStorage(RIGHT_PANEL_WIDTH_KEY);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_RIGHT_PANEL_WIDTH;
    return clampNumber(parsed, MIN_RIGHT_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH);
  };

  const readLeftSidebarCollapsed = () => {
    const raw = readStorage(LEFT_SIDEBAR_COLLAPSED_KEY);
    return raw === "1";
  };

  const [leftSidebarWidth, setLeftSidebarWidth] = createSignal(readLeftSidebarWidth());
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = createSignal(readLeftSidebarCollapsed());
  const [rightSidebarExpanded, setRightSidebarExpanded] = createSignal(readRightSidebarExpanded());
  const [rightPanelWidth, setRightPanelWidth] = createSignal(readRightPanelWidth());

  createEffect(() => {
    writeStorage(LEFT_SIDEBAR_WIDTH_KEY, String(clampNumber(leftSidebarWidth(), minLeftWidth, maxLeftWidth)));
  });

  createEffect(() => {
    writeStorage(LEFT_SIDEBAR_COLLAPSED_KEY, leftSidebarCollapsed() ? "1" : "0");
  });

  createEffect(() => {
    writeStorage(RIGHT_SIDEBAR_EXPANDED_KEY, rightSidebarExpanded() ? "1" : "0");
  });

  createEffect(() => {
    writeStorage(RIGHT_PANEL_WIDTH_KEY, String(clampNumber(rightPanelWidth(), MIN_RIGHT_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH)));
  });

  const rightSidebarWidth = createMemo(() =>
    rightSidebarExpanded() ? expandedRightWidth : collapsedRightWidth,
  );

  const effectiveLeftSidebarWidth = createMemo(() =>
    leftSidebarCollapsed() ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftSidebarWidth(),
  );

  const toggleLeftSidebarCollapsed = () => setLeftSidebarCollapsed((c) => !c);

  let dragCleanup: (() => void) | null = null;

  const stopLeftSidebarResize = () => {
    dragCleanup?.();
    dragCleanup = null;
    if (typeof document === "undefined") return;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  const startLeftSidebarResize = (event: PointerEvent) => {
    if (event.button !== 0 || typeof window === "undefined") return;
    if (leftSidebarCollapsed()) return;

    stopLeftSidebarResize();
    const initialX = event.clientX;
    const initialWidth = leftSidebarWidth();

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - initialX;
      setLeftSidebarWidth(clampNumber(initialWidth + delta, minLeftWidth, maxLeftWidth));
    };

    const handleStop = () => {
      stopLeftSidebarResize();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleStop);
    window.addEventListener("pointercancel", handleStop);
    dragCleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleStop);
      window.removeEventListener("pointercancel", handleStop);
    };

    if (typeof document !== "undefined") {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    event.preventDefault();
  };

  const toggleRightSidebar = () => {
    setRightSidebarExpanded((current) => !current);
  };

  let rightDragCleanup: (() => void) | null = null;

  const stopRightPanelResize = () => {
    rightDragCleanup?.();
    rightDragCleanup = null;
    if (typeof document === "undefined") return;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
  };

  const startRightPanelResize = (event: PointerEvent) => {
    if (event.button !== 0 || typeof window === "undefined") return;

    stopRightPanelResize();
    const initialX = event.clientX;
    const initialWidth = rightPanelWidth();

    const handleMove = (moveEvent: PointerEvent) => {
      // Dragging left increases right panel width, dragging right decreases it
      const delta = initialX - moveEvent.clientX;
      setRightPanelWidth(clampNumber(initialWidth + delta, MIN_RIGHT_PANEL_WIDTH, MAX_RIGHT_PANEL_WIDTH));
    };

    const handleStop = () => {
      stopRightPanelResize();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleStop);
    window.addEventListener("pointercancel", handleStop);
    rightDragCleanup = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleStop);
      window.removeEventListener("pointercancel", handleStop);
    };

    if (typeof document !== "undefined") {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    event.preventDefault();
  };

  onCleanup(() => {
    stopLeftSidebarResize();
    stopRightPanelResize();
  });

  return {
    leftSidebarWidth,
    leftSidebarCollapsed,
    effectiveLeftSidebarWidth,
    toggleLeftSidebarCollapsed,
    rightSidebarExpanded,
    rightSidebarWidth,
    rightPanelWidth,
    setRightSidebarExpanded,
    startLeftSidebarResize,
    startRightPanelResize,
    toggleRightSidebar,
  };
}
