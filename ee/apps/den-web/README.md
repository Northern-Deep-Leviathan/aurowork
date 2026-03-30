# AuroWork Cloud App (`ee/apps/den-web`)

Frontend for `app.auroworklabs.com`.

## What it does

- Signs up / signs in users against Den service auth.
- Launches cloud workers via `POST /v1/workers`.
- Handles paywall responses (`402 payment_required`) and shows Polar checkout links.
- Uses a Next.js proxy route (`/api/den/*`) to reach `api.auroworklabs.com` without browser CORS issues.
- Uses a same-origin auth proxy (`/api/auth/*`) so GitHub OAuth callbacks can land on `app.auroworklabs.com`.

## Local development

1. Install workspace deps from repo root:
   `pnpm install`
2. Run the app:
   `pnpm --filter @aurowork-ee/den-web dev`
3. Open:
   `http://localhost:3005`

### Optional env vars

- `DEN_API_BASE` (server-only): upstream API base used by proxy route.
  - default: `https://api.auroworklabs.com`
- `DEN_AUTH_ORIGIN` (server-only): Origin header sent to Better Auth endpoints when the browser request does not include one.
  - default: `https://app.auroworklabs.com`
- `DEN_AUTH_FALLBACK_BASE` (server-only): fallback Den origin used if `DEN_API_BASE` serves an HTML/5xx error.
  - default: `https://den-control-plane-aurowork.onrender.com`
- `NEXT_PUBLIC_AUROWORK_APP_CONNECT_URL` (client): Base URL for "Open in App" links.
  - Example: `https://auroworklabs.com/app`
  - The web panel appends `/connect-remote` and injects worker URL/token params automatically.
- `NEXT_PUBLIC_AUROWORK_AUTH_CALLBACK_URL` (client): Canonical URL used for GitHub auth callback redirects.
  - default: `https://app.auroworklabs.com`
  - this host must serve `/api/auth/*`; the included proxy route does that
- `NEXT_PUBLIC_POSTHOG_KEY` (client): PostHog project key used for Den analytics.
  - optional override; defaults to the same project key used by `ee/apps/landing`
- `NEXT_PUBLIC_POSTHOG_HOST` (client): PostHog ingest host or same-origin proxy path.
  - default: `/ow`
  - set it to `https://us.i.posthog.com` to bypass the local proxy

## Deploy on Vercel

Recommended project settings:

- Root directory: `ee/apps/den-web`
- Framework preset: Next.js
- Build command: `next build`
- Output directory: `.next`
- Install command: `pnpm install --frozen-lockfile`

Then assign custom domain:

- `app.auroworklabs.com`
