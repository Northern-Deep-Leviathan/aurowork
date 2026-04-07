import { createEffect, on, onCleanup, onMount } from "solid-js";

import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { detectLanguage } from "./language-detection";

type Props = {
  content: string;
  filePath: string | null;
  onContentChange: (value: string) => void;
  onSave: () => void;
  class?: string;
};

const codeEditorTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    height: "100%",
  },
  ".cm-scroller": {
    fontFamily:
      "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "8px 0",
    caretColor: "var(--dls-text-primary)",
  },
  ".cm-line": {
    padding: "0 12px",
  },
  ".cm-focused": {
    outline: "none",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(var(--dls-accent-rgb) / 0.18)",
  },
  ".cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(var(--dls-accent-rgb) / 0.22)",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--dls-text-primary)",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--gray-4)",
    color: "var(--gray-8)",
    fontSize: "11px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--gray-11)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--gray-2)",
  },
});

export default function CodeEditorView(props: Props) {
  let hostEl: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  const saveKeymap = keymap.of([
    {
      key: "Mod-s",
      run: () => {
        props.onSave();
        return true;
      },
    },
  ]);

  const buildExtensions = async (): Promise<Extension[]> => {
    const exts: Extension[] = [
      history(),
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      codeEditorTheme,
      saveKeymap,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        props.onContentChange(update.state.doc.toString());
      }),
    ];

    if (props.filePath) {
      const lang = await detectLanguage(props.filePath);
      if (lang) exts.push(lang);
    }

    return exts;
  };

  const createEditorState = async (doc: string): Promise<EditorState> => {
    const extensions = await buildExtensions();
    return EditorState.create({ doc, extensions });
  };

  onMount(async () => {
    if (!hostEl) return;
    const state = await createEditorState(props.content ?? "");
    view = new EditorView({ state, parent: hostEl });
  });

  // When filePath changes, rebuild the entire state (new language, fresh undo).
  createEffect(
    on(
      () => props.filePath,
      async () => {
        if (!view || !hostEl) return;
        const state = await createEditorState(props.content ?? "");
        view.setState(state);
      },
      { defer: true },
    ),
  );

  // When content is set externally (but NOT from user typing), sync it.
  createEffect(
    on(
      () => props.content,
      () => {
        if (!view) return;
        const next = props.content ?? "";
        const current = view.state.doc.toString();
        if (next === current) return;
        view.dispatch({
          changes: { from: 0, to: current.length, insert: next },
        });
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    view?.destroy();
    view = undefined;
  });

  return (
    <div
      class={`h-full overflow-hidden ${props.class ?? ""}`}
      ref={(el) => (hostEl = el)}
    />
  );
}
