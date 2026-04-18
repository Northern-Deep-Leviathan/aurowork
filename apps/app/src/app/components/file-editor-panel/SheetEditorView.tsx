import { onMount, onCleanup } from "solid-js";
import type {
  FsEntry,
  WorkbookData,
  SheetCapabilities,
  CellDelta,
  CellRef,
} from "../../lib/tauri-fs";

export interface SheetEditorViewProps {
  entry: FsEntry;
  content: WorkbookData;
  capabilities: SheetCapabilities;
  deltas: CellDelta[];
  onDeltasChange: (next: CellDelta[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaveRequested: () => void;
}

/**
 * Convert our sparse WorkbookData into Fortune-sheet's expected format.
 * Fortune-sheet expects an array of sheet objects with celldata arrays.
 */
function toFortuneCellData(
  cells: CellRef[],
): Array<{ r: number; c: number; v: { v: string | number | boolean; m: string } }> {
  return cells.map((cell) => {
    let v: string | number | boolean = cell.value;
    if (cell.cell_type === "number") {
      const n = Number(cell.value);
      if (!isNaN(n)) v = n;
    } else if (cell.cell_type === "boolean") {
      v = cell.value === "true";
    }
    return {
      r: cell.row - 1, // Fortune-sheet is 0-indexed
      c: cell.col - 1,
      v: { v, m: String(v) },
    };
  });
}

function toFortuneSheets(content: WorkbookData) {
  return content.sheets.map((sheet, idx) => ({
    name: sheet.name,
    order: idx,
    row: sheet.max_row,
    column: sheet.max_col,
    celldata: toFortuneCellData(sheet.cells),
    status: idx === 0 ? 1 : 0,
  }));
}

export default function SheetEditorView(props: SheetEditorViewProps) {
  let containerRef: HTMLDivElement | undefined;
  let reactRoot: any = null;
  let mounted = false;

  onMount(async () => {
    if (!containerRef) return;

    try {
      const React = await import("react");
      const ReactDOM = await import("react-dom/client");
      const { Workbook } = await import("@fortune-sheet/react");

      // Import Fortune-sheet CSS
      await import("@fortune-sheet/react/dist/index.css");

      const sheets = toFortuneSheets(props.content);
      const readOnly = !props.capabilities.can_edit_cells;

      // Error boundary wrapper
      class ErrorBoundary extends React.Component<
        { children: React.ReactNode },
        { hasError: boolean }
      > {
        constructor(p: any) {
          super(p);
          this.state = { hasError: false };
        }
        static getDerivedStateFromError() {
          return { hasError: true };
        }
        render() {
          if (this.state.hasError) {
            return React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  color: "#888",
                  fontSize: "13px",
                },
              },
              "Spreadsheet viewer failed to load",
            );
          }
          return this.props.children;
        }
      }

      let activeSheetName = sheets[0]?.name ?? "Sheet1";

      const App = () => {
        return React.createElement(
          ErrorBoundary,
          null,
          React.createElement(Workbook, {
            data: sheets,
            onChange: (_data: any[]) => {
              // onChange gives full sheet data; we use onOp for granular tracking
            },
            onOp: (op: any[]) => {
              if (readOnly) return;

              const newDeltas: CellDelta[] = [...props.deltas];

              for (const o of op) {
                if (o.op === "replace" && o.value && typeof o.value === "object") {
                  const row = (o.value.r ?? 0) + 1;
                  const col = (o.value.c ?? 0) + 1;
                  const value = o.value.v?.v ?? o.value.v?.m ?? "";
                  newDeltas.push({
                    sheet: activeSheetName,
                    cell: {
                      row,
                      col,
                      value: String(value),
                    },
                  });
                }
              }

              if (newDeltas.length !== props.deltas.length) {
                props.onDeltasChange(newDeltas);
                props.onDirtyChange(true);
              }
            },
            onActivate: (sheetName: string) => {
              activeSheetName = sheetName;
            },
            allowEdit: !readOnly,
            showToolbar: !readOnly,
            showFormulaBar: false,
            showSheetTabs: true,
          }),
        );
      };

      reactRoot = ReactDOM.createRoot(containerRef);
      reactRoot.render(React.createElement(App));
      mounted = true;
    } catch (err) {
      console.error("Failed to mount Fortune-sheet:", err);
      if (containerRef) {
        containerRef.innerHTML =
          '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#888;font-size:13px;">Spreadsheet viewer failed to load</div>';
      }
    }
  });

  // Handle Cmd+S for save
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (props.capabilities.can_save && props.deltas.length > 0) {
        props.onSaveRequested();
      }
    }
  };

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
    if (reactRoot && mounted) {
      try {
        reactRoot.unmount();
      } catch {
        // ignore unmount errors
      }
      reactRoot = null;
      mounted = false;
    }
  });

  return (
    <div
      ref={(el) => (containerRef = el)}
      class="h-full w-full overflow-hidden"
    />
  );
}
