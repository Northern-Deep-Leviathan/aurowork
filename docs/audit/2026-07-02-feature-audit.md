# AuroWork Feature Audit

Date: 2026-07-02

Purpose: record the current feature audit before doing product subtraction. This is not a roadmap for adding features. The recommended default is to remove, hide, or reword incomplete surfaces unless a feature is explicitly chosen for completion.

## Verification Snapshot

- `pnpm --filter @aurowork/app typecheck`: passed.
- `pnpm --filter @aurowork/app build`: passed earlier in this audit, with chunk-size warnings.
- `pnpm --filter aurowork-orchestrator typecheck`: passed earlier in this audit.
- `cargo check` in `apps/desktop/src-tauri`: passed earlier in this audit, with one dead-code warning.
- `pnpm --filter aurowork-server typecheck`: now passes after removing stale `opencodeRouter` from server capabilities.
- `pnpm --filter aurowork-server test`: now passes after preserving user-created skill folders that do not have `.meta.json`.
- Root `pnpm typecheck`: now checks app, server, and orchestrator TypeScript packages.

## Subtraction Categories

- **Remove**: delete code/UI/docs for a feature that should not ship.
- **Hide**: keep implementation but remove visible navigation until complete.
- **Complete**: finish the missing backend/frontend contract and add tests.
- **Reword**: update product text so it matches what exists.
- **Fix gate**: make CI/typecheck/test coverage catch the issue.

## Findings

| Area | Status | Evidence | Recommended subtraction |
| --- | --- | --- | --- |
| Server capabilities | Fixed gate bug | `apps/server/src/server.ts:730`, `apps/server/src/types.ts:109` | Stale `opencodeRouter` capability was removed from the server capability payload. Continue broader router cleanup later. |
| Starter workspace files | Fixed data-loss bug | `apps/server/src/workspace-init.ts:158`, `apps/server/src/workspace-init.test.ts:82` | User-created skill directories without `.meta.json` are now preserved. Continue starter preset copy cleanup later. |
| AuroWork server client stubs | Hard runtime stubs | `apps/app/src/app/lib/aurowork-server.ts:1111` | Remove UI paths that call these methods, or implement `fetchBundle`, `publishBundle`, `listAudit`, `listScheduledJobs`, and `materializeBlueprintSessions`. |
| Missing Tauri command | Frontend calls command not registered | `apps/app/src/app/lib/tauri.ts:616`, `apps/desktop/src-tauri/src/lib.rs:288` | Remove/disable the install path or register `install_skill_template`. |
| Skill Hub | Hidden/incomplete | `apps/app/src/app/pages/skills.tsx:753`, `apps/app/src/app/lib/aurowork-server.ts:1368` | Keep hidden or remove hub client methods/routes until server capability exists. |
| Skill publishing | Removed but UI still exposes sharing | `apps/app/src/app/pages/skills.tsx:9`, `apps/app/src/app/pages/skills.tsx:290` | Remove public share UI or replace with local export only. |
| Public bundle sharing | Stub-backed | `apps/app/src/app/lib/aurowork-server.ts:1111`, `apps/app/src/app/app.tsx:546` | Remove public-link import/export surfaces unless bundle hosting is implemented. |
| Cloud/Den Settings | Removed from app surface | `apps/app/src/app/pages/settings.tsx`, `apps/app/src/app/app.tsx` | Den settings UI, `den-auth` deep-link handling, and the app-side Den client were deleted on 2026-07-03. |
| Team templates | Removed from app surface | `apps/app/src/app/components/share-workspace-modal.tsx`, `apps/app/src/app/pages/dashboard.tsx`, `apps/app/src/app/pages/session.tsx` | Team-template share entry points and Cloud template save actions were deleted on 2026-07-03. |
| Workspace profile export/import | Extra files not round-tripped | `apps/app/src/app/pages/dashboard.tsx:931`, `apps/server/src/server.ts:4675`, `apps/server/src/server.ts:4705` | Reword as config/skills/commands export only, or implement `workspace.files` import/export. |
| Workspace blueprint/templates | Stubbed | `apps/app/src/app/app.tsx:86`, `apps/app/src/app/pages/session.tsx:111`, `apps/app/src/app/lib/aurowork-server.ts:1134` | Remove blueprint/session materialization UI until implemented. |
| Scheduler | Broken local and remote paths | `apps/app/src/app/app.tsx:5609`, `apps/app/src/app/app.tsx:5698`, `apps/app/src/app/lib/aurowork-server.ts:1127` | Remove scheduled tasks UI, preset suggestions, and plugin recommendation unless scheduler is rebuilt. |
| AgentLab automations | Backend exists, main UI absent | `apps/server/src/server.ts:3336`, `apps/server/src/server.ts:3423`, `apps/app/src/app/pages/proto-v1-ux.tsx:529` | Hide/remove automation claims unless a real management UI is added. |
| Proto routes | Mock/redirected | `apps/app/src/app/app.tsx:8497`, `apps/app/src/app/pages/proto-v1-ux.tsx` | Delete proto pages or move to archive/dev-only route. |
| Onboarding route | Redirected away | `apps/app/src/app/app.tsx:8517` | Remove route/page if no longer used, or restore a real onboarding flow. |
| Dashboard tab types | Stale tabs remain in types | `apps/app/src/app/types.ts:153`, `apps/app/src/app/app.tsx:8418` | Remove `scheduled` and `identities` from public tab types unless navigation is restored. |
| Settings tab types | Stale tabs remain in types | `apps/app/src/app/types.ts:162`, `apps/app/src/app/pages/settings.tsx:894` | Remove `den`, `model`, `automations`, `messaging` from active UI types or expose them deliberately. |
| Right sidebar | Points at missing surfaces | `apps/app/src/app/components/workspace-right-sidebar.tsx:104`, `apps/app/src/app/pages/dashboard.tsx:1715` | Remove Automations/Messaging buttons or point them to real pages. |
| OpenCode Router | Feature removed but residue remains | `apps/app/src/app/app.tsx:1422`, `apps/server/src/types.ts:236`, `apps/app/src/app/pages/settings.tsx:2554` | Finish string/type cleanup. Do not show router version in debug if router is gone. |
| Messaging/Identities | Server residue, no main dashboard | `apps/server/src/server.ts:2315`, `apps/app/src/app/types.ts:159` | Remove from visible product unless identity/messaging UX is restored. |
| Approval queues | Two permission systems | `apps/server/src/server.ts:3522`, `apps/app/src/app/context/session.ts:851`, `apps/app/src/app/context/session.ts:1080` | Either add owner approval queue UI or remove server approval queue from the product surface. |
| Provider connection display | Stale status risk | Provider refresh preserves old connected ids on list failure | Prefer explicit error/stale state over showing old connected state. |
| Debug/sandbox settings | Pruned features still referenced | `apps/app/src/app/pages/settings.tsx:2023`, `apps/app/src/app/pages/settings.tsx:2482`, `apps/app/src/app/pages/settings.tsx:2566` | Remove hidden panels and related translations/docs unless actively planned. |
| Session event stream | No reconnect for global SDK stream | Session SSE path is real, global SDK events are weaker | Add reconnect handling or avoid claiming robust live sync beyond active session paths. |
| Slash command listing | Errors swallowed | `apps/app/src/app/lib/auro-session.ts:128` | Surface command-list errors in dev/status UI instead of returning empty list. |
| Commands management | Backend exists, UI absent | `apps/server/src/server.ts:3274`, `apps/app/src/app/lib/aurowork-server.ts:1482`, `apps/app/src/app/components/session/composer.tsx:1648` | Remove command-management claims or add create/edit/delete UI. |
| Agents management | Selection only | `apps/app/src/app/app.tsx:2542`, `apps/app/src/app/components/session/composer.tsx:1501` | Reword as "select/use agents"; do not claim agent authoring/management unless implemented. |
| Plugins | Config editor, not installer | `apps/server/src/plugins.ts:75`, `apps/app/src/app/pages/plugins.tsx:218` | Reword "Add plugin" as "Add plugin spec to config"; do not imply package install/validation. |
| MCP Quick Connect | Connected badge can mean configured only | `apps/app/src/app/pages/mcp.tsx:253`, `apps/app/src/app/pages/mcp.tsx:419` | Change badge to "Configured" unless `mcpStatuses[name].status === "connected"`. |
| MCP OAuth/reauth | Partial flow | `apps/app/src/app/app.tsx:6711`, `apps/app/src/app/pages/mcp.tsx:278` | Keep as advanced/config feature or complete reauth/status UX. |
| Local Work Files | Desktop-only and broad Tauri command boundary | `apps/app/src/app/components/file-editor-panel/FileEditorPanel.tsx:258`, `apps/desktop/src-tauri/src/commands/fs.rs:383`, `apps/desktop/src-tauri/src/commands/fs.rs:450` | Add workspace-root guard to Tauri commands or keep panel scoped by capability and documentation. |
| Work Files search/diff | README overclaim risk | `apps/app/src/app/app.tsx:8223`, `apps/app/src/app/components/session/composer.tsx:1522`, `apps/app/src/app/components/part-view.tsx:775` | Reword: file search is composer mention search; diff display is tool-output diff, not file explorer diff. |
| Remote file sessions | Backend more complete than UI | `apps/server/src/server.ts:2611`, `apps/server/src/server.ts:2650`, `apps/server/src/server.ts:2739`, `apps/app/src/app/pages/session.tsx:1482` | Either expose remote file browser/editor or document this as internal artifact sync only. |
| Obsidian mirror | Removed module stubs still used | `apps/app/src/app/pages/session.tsx:40`, `apps/app/src/app/pages/session.tsx:1319`, `apps/app/src/app/pages/session.tsx:1482` | Remove Obsidian wording/path or restore mirror module properly. |
| Deep link bundle import | Bridge exists, fetch stubbed | `apps/desktop/src-tauri/tauri.conf.json:46`, `apps/desktop/src-tauri/src/lib.rs:338`, `apps/app/src/app/index.tsx:70`, `apps/app/src/app/app.tsx:546` | Keep connect deep links, remove bundle deep links until fetch is implemented. |
| Release/test gates | Basic gates added | `package.json:16`, `.github/workflows/verify-local-desktop.yml`, `.github/workflows/build-desktop.yml` | `verify:fast` is active for PR/push and release packaging now depends on `verify:release`; still expand `release:review` and solve environment-sensitive full tests. |
| Vercel build entry | Points at removed app | `scripts/build.mjs:3`, `scripts/build.mjs:5`; current `apps/` only has `app`, `desktop`, `orchestrator`, `server` | Delete Vercel share build path or restore the missing `apps/share` package if public sharing is kept. |
| Desktop release scope | Windows-only active build | `.github/workflows/build-desktop.yml:205`, `.github/workflows/build-desktop.yml:223` | Reword release expectations or restore macOS/Linux build matrices. |
| README product claims | Reworded to local desktop scope | `README.md`, `README_ZH.md`, `README_ZH_hk.md` | README files now describe local desktop scope and current pipeline commands; keep `docs:claims:check` active to prevent regression. |
| Current architecture claims | Reworded to local desktop scope | `docs/architecture/overview.md`, `docs/architecture/infrastructure.md` | Current architecture entry points no longer present hosted worker/OpenPackage as active product scope. Historical docs remain archived/indexed as context. |

## Current Prioritized Subtraction Backlog

1. **Finish gates first**: setup/verify/docs/eval gates and active CI/release quality jobs now exist, but `release:review`, debug-report integration, and environment-sensitive full tests still need work.
2. **Remove stale router residue**: server capabilities are fixed, but remaining `opencodeRouter` debug/routes/text should not exist if router is removed.
3. **Hide or remove scheduled/automation surfaces**: scheduler is not functional and AgentLab UI is not productized.
4. **Cloud/Den removed from app surface**: Den settings, Den auth deep links, and team-template share actions were deleted on 2026-07-03; keep claims checks active so this product story does not return accidentally.
5. **Reword Plugins and MCP**: distinguish "configured" from "installed/connected".
6. **Choose one file story**: local desktop Work Files, remote file sessions, and Obsidian mirror currently overlap without a single coherent UI.
7. **Remove public bundle/share paths or implement them**: stub-backed share flows are high-risk.
8. **Reduce tab/type drift**: remove stale tab union members and sidebar buttons for hidden pages.
9. **Keep docs gates active**: README/current architecture now match local desktop scope; use `docs:claims:check` to prevent remote/cloud/fork language from returning.

## Notes For Future Cleanup

- Treat a visible entry point as a product promise. If a feature is not ready, remove the visible entry point first.
- Prefer deleting stale route/page/type surfaces over leaving redirects that hide broken functionality.
- When keeping backend-only functionality, label it internal in docs and avoid presenting it in user-facing navigation.
- Any "connected" label should be backed by runtime health/status, not by config presence.
- Any write path should have an explicit workspace-root boundary and test coverage for traversal/out-of-root attempts.
