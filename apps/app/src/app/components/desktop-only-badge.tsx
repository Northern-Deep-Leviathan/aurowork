type DesktopOnlyBadgeProps = {
  class?: string;
};

const BASE_CLASS = "rounded-full bg-dls-hover px-2 py-0.5 text-[8px] tracking-[0.18em] text-dls-secondary";

export default function DesktopOnlyBadge(props: DesktopOnlyBadgeProps) {
  return <span class={props.class ? `${BASE_CLASS} ${props.class}` : BASE_CLASS}>Desktop Only</span>;
}
