import type { JSX } from "solid-js";

type CardProps = {
  title?: string;
  children: JSX.Element;
  actions?: JSX.Element;
};

export default function Card(props: CardProps) {
  return (
    <div class="rounded-2xl bg-dls-surface border border-dls-border shadow-[var(--dls-card-shadow)]">
      {props.title || props.actions ? (
        <div class="flex items-center justify-between gap-3 border-b border-dls-border px-6 py-5">
          <div class="text-sm font-semibold text-dls-text">{props.title}</div>
          <div>{props.actions}</div>
        </div>
      ) : null}
      <div class="px-6 py-5">{props.children}</div>
    </div>
  );
}
