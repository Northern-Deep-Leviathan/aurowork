import type { JSX } from "solid-js";

type Props = {
  size?: number;
  class?: string;
};

/**
 * AuroWork Logo — sourced from the canonical mark at
 * `apps/desktop/src-tauri/icons/logo-2.svg` (the single source of truth used
 * by the Tauri icon generator). The generator copies it to
 * `apps/app/public/aurowork-logo.svg` so this component can serve it.
 *
 * Renders as an <img> so we don't have to inline the (large, base64-embedded)
 * bitmap data into the JS bundle.
 */
export default function AuroWorkLogo(props: Props): JSX.Element {
  const size = () => props.size ?? 24;
  return (
    <img
      src="/aurowork-logo.svg"
      width={size()}
      height={size()}
      alt="AuroWork"
      class={`inline-block shrink-0 ${props.class ?? ""}`}
    />
  );
}
