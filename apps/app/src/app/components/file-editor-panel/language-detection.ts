import type { Extension } from "@codemirror/state";

type LanguageLoader = () => Promise<Extension>;

const languageMap: Record<string, LanguageLoader> = {
  // JavaScript / TypeScript
  js: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  jsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true }),
    ),
  ts: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ typescript: true }),
    ),
  tsx: () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true, typescript: true }),
    ),
  mjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  cjs: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),

  // JSON
  json: () => import("@codemirror/lang-json").then((m) => m.json()),
  jsonc: () => import("@codemirror/lang-json").then((m) => m.json()),

  // CSS
  css: () => import("@codemirror/lang-css").then((m) => m.css()),
  scss: () => import("@codemirror/lang-css").then((m) => m.css()),
  less: () => import("@codemirror/lang-css").then((m) => m.css()),

  // HTML
  html: () => import("@codemirror/lang-html").then((m) => m.html()),
  htm: () => import("@codemirror/lang-html").then((m) => m.html()),
  svg: () => import("@codemirror/lang-html").then((m) => m.html()),
  xml: () => import("@codemirror/lang-html").then((m) => m.html()),

  // Python
  py: () => import("@codemirror/lang-python").then((m) => m.python()),

  // Markdown (sync — already in bundle)
  md: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
  mdx: () => import("@codemirror/lang-markdown").then((m) => m.markdown()),
};

/**
 * Return a CodeMirror language extension for the given file path.
 * Returns `null` when no matching language is found.
 */
export async function detectLanguage(
  filePath: string,
): Promise<Extension | null> {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  const loader = languageMap[ext];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}

/** Quick sync check whether a path maps to a known language. */
export function hasLanguageSupport(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase();
  return Boolean(ext && languageMap[ext]);
}
