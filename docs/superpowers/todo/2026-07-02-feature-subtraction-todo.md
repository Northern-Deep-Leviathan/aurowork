# Feature Subtraction Todo

Date: 2026-07-02

Source: `docs/audit/2026-07-02-feature-audit.md`

These are the seven high-priority subtraction/fix tracks to work through before presenting AuroWork as a clean product surface.

- [ ] Fix release and validation gates.
  - Root `pnpm typecheck` must include server/orchestrator checks or be renamed so it does not imply full-repo coverage.
  - Active release CI must run server typecheck/tests before packaging.

- [ ] Remove or complete hard stub entry points.
  - Public bundle sharing, scheduler, workspace blueprint materialization, audit list, and scheduled jobs must not remain visible while backed by `throw not implemented`.
  - 2026-07-03 progress: removed the Skills page public share/link-install UI, removed the public template branch from the workspace share modal, disabled shared-bundle URL/deep-link parsing, and stopped app-side calls to `fetchBundle`, `publishBundle`, `listAudit`, `listScheduledJobs`, and `materializeBlueprintSessions`.
  - 2026-07-03 progress: removed Toy UI Share/Automations tabs from visible navigation, deleted the Toy UI Deploy Beta hard stub, removed `/proto` route rendering, deleted proto mock pages, and removed stale Automations/Messaging sidebar buttons.
  - 2026-07-03 progress: implemented and registered the missing desktop `install_skill_template` command, so installing the local `skill-creator` template no longer targets an unregistered Tauri command.
  - 2026-07-03 progress: removed the unused `fetchBundle`, `publishBundle`, `listAudit`, `listScheduledJobs`, and `materializeBlueprintSessions` throwing methods from the app-side AuroWork server client.
  - 2026-07-03 progress: removed the visible Cloud/team-template share branch and deleted the Den auth/template client path from the app.

- [x] Hide or make coherent Cloud/Den/team-template surfaces.
  - 2026-07-03 completed: removed the Den settings panel and `apps/app/src/app/lib/den.ts`, removed `den-auth` deep-link processing, removed team-template share state/actions from Dashboard and Session, removed Cloud/team-template translation keys, and changed the remote-worker overlay copy away from Cloud positioning.

- [ ] Align workspace export/import semantics.
  - Pick one contract for local zip export, server JSON export/import, and public/team templates.
  - Do not claim "full workspace template" until extra `.opencode` files round-trip correctly.

- [ ] Delete stale navigation, route, type, and debug residue.
  - Scheduled, identities, automations, messaging, proto/onboarding, and OpenCode Router leftovers need a removal pass unless intentionally restored.

- [ ] Reword README and product documentation to match shipped behavior.
  - Remove or qualify claims around CLI parity, OpenPackage registry install, workflow templates, file explorer diff/search, chat integrations, and cloud readiness.

- [ ] Tighten local file write/read boundaries.
  - Tauri filesystem commands should enforce a workspace-root boundary or the product should clearly scope and gate the feature.
