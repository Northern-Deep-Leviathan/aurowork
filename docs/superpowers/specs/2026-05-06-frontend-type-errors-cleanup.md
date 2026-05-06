# Frontend Type Errors Cleanup — Triage & Plan

**Date:** 2026-05-06
**Scope:** `apps/app/` — 53 pre-existing TypeScript errors that surfaced once the opencode→auro rename made the codebase quieter. Errors predate the rename branch (reproducible on `main`-equivalent baseline) and were tolerated as a known cliff during the rename PR.
**Reproduce:** `bun run typecheck` from repo root → `pnpm --filter @aurowork/app typecheck`

## Summary by file

| File | Errors |
|---|---|
| `pages/settings.tsx` | 18 |
| `context/workspace.ts` | 11 |
| `app.tsx` | 11 |
| `pages/session.tsx` | 5 |
| `components/workspace-right-sidebar.tsx` | 4 |
| `pages/dashboard.tsx` | 3 |
| `context/local.tsx` | 1 |
| **Total** | **53** |

## Root-cause groups

The 53 errors fall into **6 distinct groups**. Each group has a common fix; treat each group as one task.

### Group A — Calls to AuroWork-server methods that don't exist (10 errors)

Frontend invokes client methods that have never been implemented on either side. Server has no matching route handler; client has no method definition.

| Symbol | Call site(s) | Server route exists? |
|---|---|---|
| `client.fetchBundle(url)` | `app.tsx:537` | ❌ |
| `client.publishBundle(payload, kind, opts)` | `dashboard.tsx:926,1043`, `session.tsx:3378,3507` | ❌ |
| `client.listAudit(wsId, limit)` | `app.tsx:4352` | ❌ |
| `client.listScheduledJobs(wsId)` | `app.tsx:5500` | ❌ |
| `client.materializeBlueprintSessions(wsId)` | `app.tsx:5784` | ❌ |

**History check:** `git log -S "publishBundle"` traces all of these to the **initial commit** (`9c057eb`). They are abandoned scaffolding — UI was wired but the server contract was never landed.

**Recommendation: REMOVE the dead callers.** None of these features ship today; the callers are unreachable in any working flow (any code path that hits them throws at runtime). For each call site:

1. Trace the surrounding handler/effect.
2. Delete the handler if it's the only purpose; remove the wiring (button, menu item, effect).
3. If the surrounding component still has reason to exist, replace the call with a clear `throw new Error("...not implemented")` *and* remove the UI affordance that triggers it.

If product wants any of these features back, they re-design from scratch — the existing UI bones are a year old and pre-rename.

### Group B — `WorkspaceAuroworkConfig.blueprint` (5 errors)

| Site | Reads or writes? |
|---|---|
| `app.tsx:5652,5721` | reads `config.blueprint` |
| `context/workspace.ts:3507,3529` | writes `{ blueprint }` into config |
| `pages/session.tsx:3910` | reads `config.blueprint` |

`blueprint` is described in `.claude/CLAUDE.md` ("空状态 UI、预设 session、starters") and referenced in `apps/server/src/workspace-init.ts` as a preset concept. The TS type `WorkspaceAuroworkConfig` (in `apps/app/src/app/lib/aurowork-server.ts` or `apps/app/src/app/types.ts`) is missing the field — server emits it but the client type was never updated.

**Recommendation: ADD the missing field to the TS type.** This is "missing-type-only-cosmetic" — server already produces it, frontend reads it correctly at runtime, only the type declaration drifted. Fix:

1. Read the actual server-side schema in `apps/server/src/types.ts` (or wherever `WorkspaceAuroworkConfig` ships from).
2. Sync the client interface to match (likely `blueprint?: { emptyState?: …; sessions?: …[]; starters?: …[]; reload?: … }`).
3. Re-typecheck.

### Group C — `SandboxDoctorResult.{debug,serverVersion}` (7 errors, all in `context/workspace.ts:1885-1916`)

Code reads `result.debug` (an array, iterated with `.forEach((item) => …)`) and `result.serverVersion`. The TS type lacks both fields.

**Recommendation:** Same as Group B — sync the client `SandboxDoctorResult` type with whatever the sandbox doctor server route actually returns. Read `apps/server/src/sandbox-doctor.ts` (or equivalent) to find the real shape.

### Group D — `DashboardTab` / `SettingsTab` union mismatches (8 errors)

Code uses string literals not in the union types defined in `apps/app/src/app/types.ts:153-170`:

| Literal | Used in | Current union |
|---|---|---|
| `"scheduled"` (DashboardTab) | `workspace-right-sidebar.tsx:108`, `local.tsx:33` | DashboardTab missing it |
| `"identities"` (DashboardTab) | `workspace-right-sidebar.tsx:126`, `session.tsx:3781` | missing |
| `"automations"` (SettingsTab) | `workspace-right-sidebar.tsx:108` | missing |
| `"messaging"` (SettingsTab) | `workspace-right-sidebar.tsx:126` | missing |

**Two interpretations:**

- **(D1) The features exist, types drifted.** Add the literals to both unions. Verify each tab handler exists and renders something coherent.
- **(D2) The features were dropped, callers are dead.** Remove the comparisons / assignments at those call sites.

**Recommendation: investigate per literal.** Likely mixed: `"scheduled"` and `"identities"` map to features in `app.tsx` (Groups A/F call sites for scheduled jobs / audit) which are themselves dead → remove. `"automations"` and `"messaging"` may be live tabs not yet typed → add. Decide per literal during execution.

### Group E — `settings.tsx` "of type 'never'" cluster (13 errors at lines 748–3344)

13 errors all match the pattern `Property 'X' does not exist on type 'never'`. This means a state variable is being narrowed to `never` because its declared type is `never` or its inferred type is empty. Fields accessed: `running`, `lastStdout`, `lastStderr`, `version`, `healthPort`, `pid`, `opencodeUrl`, `workspacePath`.

**Likely root cause:** A signal/store accessor like `engineInfo()` returns `EngineInfo | null` but somewhere a `null` check or default value is typed `never` (e.g., `useState<never>()` or `const [x, setX] = createSignal()` without a generic). One bad initialization cascades into 13 access errors.

**Recommendation: investigate at the declaration.** Find where each affected variable is declared/typed at the top of `settings.tsx`. Add the proper `EngineInfo | null` (or correct interface) generic. Likely one or two signal declarations fix all 13.

### Group F — Misc narrow-fix (10 errors)

The remaining grab-bag:

| Error | File:Line | Fix |
|---|---|---|
| `Property 'text' does not exist on type '{}'` | `app.tsx:2184,5786` | The variable is typed `{}`. Find its declaration and tighten to `{ role?: …; text?: … }` or cast at the boundary. |
| `Type 'unknown[]' not assignable to {role,text}[]` | `app.tsx:2261,5794` | Same — JSON parse boundary leaks `unknown`. Add a type assertion/parse-validator. |
| `Parameter 'entry' implicitly has an 'any' type` | `app.tsx:5791` | Annotate the lambda param. |
| `Cannot find name 'AuroworkAuditEntry'` | `settings.tsx:909` | Group A territory: delete the audit code or import a real type if listAudit is kept. |
| `dashboard.tsx:1414` SettingsViewProps missing 9 properties | `dashboard.tsx:1414` | The `<SettingsView/>` props interface diverged from its callers. Reconcile the prop list. Likely shaved by Group A removals. |
| `entry: unknown` accesses (5×) | `settings.tsx:3561-3570` | Same Group A audit list iteration — should disappear when the listAudit caller is removed. |
| `'config' \| 'identities'` not assignable to DashboardTab | `session.tsx:3781` | Resolved by Group D decision on `"identities"`. |
| `Property 'version' does not exist on type 'never'` | `session.tsx:494` | Same root cause as Group E. |

## Execution plan

### Order of attack

1. **Group A first.** Removing the 5 dead-API callers shrinks Groups F and E (the audit/scheduled wiring leaves 5+ errors orphaned). Estimate: ~150 LOC deletions, mostly in `app.tsx` + `dashboard.tsx` + `session.tsx`. After this pass, re-run typecheck — expect ~15 fewer errors.
2. **Group E next.** Find the `settings.tsx` declaration that infers `never` and fix the generic. One declaration fix likely clears 13 errors. Estimate: ~5 LOC.
3. **Group B & C in parallel.** Sync `WorkspaceAuroworkConfig.blueprint` and `SandboxDoctorResult.{debug,serverVersion}` against the server-side source of truth. Estimate: ~30 LOC across `apps/server/src/types.ts` + `apps/app/src/app/lib/aurowork-server.ts`.
4. **Group D after Group A.** With dead-tab call sites already removed, re-decide each remaining literal (`"automations"`, `"messaging"`) — add to union if live, remove caller if dead.
5. **Group F last.** Mostly mop-up after steps 1-4. The 5 `entry: unknown` errors and 1 `AuroworkAuditEntry` should auto-resolve from Group A; the `text` / `unknown[]` cluster needs a small parse-boundary type assertion.

### Acceptance criteria

- `bun run typecheck` exits 0
- No new `// @ts-ignore` / `as any` introduced (cast-at-boundary is fine if it validates the shape)
- No runtime regressions in the smoke flow: open workspace → list sessions → open settings → run sandbox doctor → start/stop engine
- One commit per group (5 commits total, plus a final cleanup commit if needed). Each commit: `fix(types): <group> ...`

### Out of scope

- Implementing the 5 missing server APIs (`fetchBundle`, `publishBundle`, `listAudit`, `listScheduledJobs`, `materializeBlueprintSessions`). Those are product features, not type fixes; they need their own design.
- Resolving the 7 server-side server.ts API drift errors (separate ticket — those are server-internal).
- Refactoring `settings.tsx` (3500+ LOC monolith). Just fix the type declarations. Splitting the file is a different ticket.

## Risks

- **Group A removal cascades.** Deleting a handler may leave an orphaned button. Audit each removed call site for upstream UI affordances.
- **Group B / C type drift.** If the server-side type isn't authoritative either, a "fix" may just hide a different bug. Cross-check by reading the actual server route response, not the existing TS interface.
- **Group E declaration-level fix.** Could be a generic that one bad declaration fans out to 13 sites. If the fix is genuinely "type the signal correctly," low risk. If it's "this variable is supposed to be `never`," then those access sites are themselves dead code — investigate before patching.

## Next step

Run the `superpowers:writing-plans` skill against this design doc to produce a step-by-step implementation plan with verification gates per group.
