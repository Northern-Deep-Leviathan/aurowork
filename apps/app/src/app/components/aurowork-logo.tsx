import type { JSX } from "solid-js";

type Props = {
  size?: number;
  class?: string;
};

export default function AuroWorkLogo(props: Props): JSX.Element {
  const size = props.size ?? 24;
  return (
    <img
      src="/aurowork-logo.svg"
      alt="AuroWork"
      width={size}
      height={size}
      class={`inline-block ${props.class ?? ""}`}
    />
  );
}
