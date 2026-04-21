import { createMemo, onCleanup, createSignal, onMount } from "solid-js";
import { marked } from "marked";

type MarkdownPreviewProps = {
  content: string;
  class?: string;
};

// ---------- HTML escaping ----------

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------- renderer (matches part-view.tsx style) ----------

function createPreviewRenderer(tone: "light" | "dark") {
  const renderer = new marked.Renderer();

  const codeBlockClass =
    tone === "dark"
      ? "bg-dls-text/10 border-dls-secondary/20 text-dls-text"
      : "bg-dls-surface/80 border-dls-border/70 text-dls-text";
  const inlineCodeClass =
    tone === "dark"
      ? "bg-dls-text/15 text-dls-text"
      : "bg-dls-hover/70 text-dls-text";

  const isSafeUrl = (url: string) => {
    const normalized = (url || "").trim().toLowerCase();
    if (normalized.startsWith("javascript:")) return false;
    if (normalized.startsWith("data:"))
      return normalized.startsWith("data:image/");
    return true;
  };

  renderer.html = ({ text }) => escapeHtml(text);

  renderer.code = ({ text, lang }) => {
    const language = lang || "";
    return `
      <div class="rounded-2xl border px-4 py-3 my-4 ${codeBlockClass}">
        ${
          language
            ? `<div class="text-[10px] uppercase tracking-[0.2em] text-dls-secondary mb-2">${escapeHtml(language)}</div>`
            : ""
        }
        <pre class="overflow-x-auto whitespace-pre text-[13px] leading-relaxed font-mono"><code>${escapeHtml(text)}</code></pre>
      </div>
    `;
  };

  renderer.codespan = ({ text }) => {
    return `<code class="rounded-md px-1.5 py-0.5 text-[13px] font-mono ${inlineCodeClass}">${escapeHtml(text)}</code>`;
  };

  renderer.link = ({ href, title, text }) => {
    const safeHref = isSafeUrl(href) ? escapeHtml(href ?? "#") : "#";
    const safeTitle = title ? escapeHtml(title) : "";
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2 text-dls-accent hover:text-[var(--dls-accent-hover)]" ${safeTitle ? `title="${safeTitle}"` : ""}>${text}</a>`;
  };

  renderer.image = ({ href, title, text }) => {
    const safeHref = isSafeUrl(href) ? escapeHtml(href ?? "") : "";
    const safeTitle = title ? escapeHtml(title) : "";
    return `<img src="${safeHref}" alt="${escapeHtml(text || "")}" ${safeTitle ? `title="${safeTitle}"` : ""} loading="lazy" decoding="async" class="max-w-full h-auto rounded-lg my-4" />`;
  };

  return renderer;
}

const rendererCache = new Map<
  "light" | "dark",
  ReturnType<typeof createPreviewRenderer>
>();

function getRenderer(tone: "light" | "dark") {
  const cached = rendererCache.get(tone);
  if (cached) return cached;
  const r = createPreviewRenderer(tone);
  rendererCache.set(tone, r);
  return r;
}

// ---------- dark mode detection ----------

function useTone(): () => "light" | "dark" {
  const detect = (): "light" | "dark" => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  };

  const [tone, setTone] = createSignal<"light" | "dark">(detect());

  onMount(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setTone(detect());
    mq.addEventListener("change", handler);
    onCleanup(() => mq.removeEventListener("change", handler));
  });

  return tone;
}

// ---------- component ----------

export default function MarkdownPreview(props: MarkdownPreviewProps) {
  const tone = useTone();

  const renderedHtml = createMemo(() => {
    const text = props.content;
    if (!text.trim()) return "";

    try {
      const renderer = getRenderer(tone());
      const result = marked.parse(text, {
        breaks: true,
        gfm: true,
        renderer,
        async: false,
      });
      return typeof result === "string" ? result : "";
    } catch (err) {
      console.error("Markdown preview parse error:", err);
      return `<pre class="text-red-11 text-xs whitespace-pre-wrap">${escapeHtml(String(err))}</pre>`;
    }
  });

  return (
    <div
      class={`h-full overflow-y-auto px-6 py-4 text-sm leading-relaxed text-dls-text ${props.class ?? ""}`}
      innerHTML={renderedHtml()}
    />
  );
}
