import type { JSX } from "solid-js";

type Props = {
  size?: number;
  class?: string;
};

/**
 * AuroWork Logo — "Aurora Flame"
 *
 * An abstract rising flame/aurora form. 3 layered petals create depth.
 * Uses currentColor for automatic theme adaptation.
 */
export default function AuroWorkLogo(props: Props): JSX.Element {
  const size = () => props.size ?? 24;
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={`inline-block shrink-0 ${props.class ?? ""}`}
      aria-label="AuroWork"
      role="img"
    >
      {/* Back petal — largest, lightest */}
      <path
        d="M16 3C12.5 8 7 14 7 20a9 9 0 0 0 18 0c0-6-5.5-12-9-17Z"
        fill="currentColor"
        opacity="0.18"
      />
      {/* Middle petal — medium */}
      <path
        d="M16 7C13.5 11 10 15.5 10 20a6 6 0 0 0 12 0c0-4.5-3.5-9-6-13Z"
        fill="currentColor"
        opacity="0.45"
      />
      {/* Front petal — smallest, full color */}
      <path
        d="M16 12C14.5 14.5 13 17 13 20a3 3 0 0 0 6 0c0-3-1.5-5.5-3-8Z"
        fill="currentColor"
      />
    </svg>
  );
}
