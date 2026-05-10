# Frontend Type Errors Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive `pnpm --filter @aurowork/app typecheck` from 53 errors to 0 by repairing type drift between `apps/app` and `apps/server`, without changing runtime behavior.

**Architecture:** This is a type-cleanup branch, not a feature branch. The strategy is *minimum-blast-radius*: every fix preserves current runtime behavior. Where the spec recommends deleting dead UI (Group A: 150 LOC of unreachable handlers), this plan instead adds typed stub methods on the client that `throw new Error("not implemented")`. Rationale: (1) the call sites already throw at runtime today (calling `undefined` throws `TypeError`), so behavior is unchanged; (2) removing UI affordances is a product decision, not a type decision; (3) one commit per group keeps each change reviewable; (4) a follow-up ticket can rip out the dead UI once product confirms the features are abandoned.

**Tech Stack:** TypeScript strict mode, SolidJS, Bun, pnpm monorepo. Verification command: `pnpm --filter @aurowork/app typecheck`.

**Validated against codebase (2026-05-06):**
- Group B: server `WorkspaceAuroworkConfig` (in `apps/server/src/workspace-init.ts:57-69`) has `blueprint?: Record<string, unknown> | null`. Two client copies exist (`apps/app/src/app/types.ts:184`, `apps/app/src/app/lib/tauri.ts:343`); both must be synced.
- Group C: `SandboxDoctorResult` is already a *local stub* in `apps/app/src/app/context/workspace.ts:107-114` (Docker sandbox was pruned). The fields `debug`/`serverVersion` are read by old creation-flow code that never executes today (`isTauriRuntime()` short-circuits before that block). Cheapest fix: extend the stub with optional fields.
- Group E: confirmed root cause is `opencodeRouterInfo: null` (literal `null` type, not `Foo | null`) in `SettingsViewProps` (`pages/settings.tsx:120`), `SessionViewProps` (`pages/session.tsx:170`), and the source signal `createSignal<null>(null)` (`app.tsx:1044`). One synchronized type fix clears 13 settings.tsx errors + 1 session.tsx error.
- Group F audit-related errors (`AuroworkAuditEntry` undefined; `entry: unknown` ×5) come from a typed audit signal `createSignal<Array<{...}>>([])` at `app.tsx:1046` but a `SettingsViewProps.auroworkAuditEntries: unknown[]` at `settings.tsx:114`. Fix: extract a named type and use it on both sides.

---

## File Structure

| File | Role | Touched by |
|---|---|---|
| `apps/app/src/app/lib/aurowork-server.ts` | AuroWork server client; needs stub methods + audit-entry type | Group A |
| `apps/app/src/app/types.ts` | Shared client types (`WorkspaceAuroworkConfig`, `DashboardTab`, `SettingsTab`) | Groups B, D |
| `apps/app/src/app/lib/tauri.ts` | Tauri-side duplicate of `WorkspaceAuroworkConfig` | Group B |
| `apps/app/src/app/context/workspace.ts` | Hosts the local `SandboxDoctorResult` stub + writes blueprint | Groups B, C |
| `apps/app/src/app/pages/settings.tsx` | `SettingsViewProps` interface + audit rendering | Groups E, F |
| `apps/app/src/app/pages/session.tsx` | `SessionViewProps` (mirrors opencodeRouterInfo) | Group E |
| `apps/app/src/app/app.tsx` | Source signals (`opencodeRouterInfoState`, audit), JSON parse boundary | Groups E, F |
| `apps/app/src/app/components/workspace-right-sidebar.tsx` | Compares against tab unions | Group D |
| `apps/app/src/app/context/local.tsx` | Defaults a tab literal | Group D |
| `apps/app/src/app/pages/dashboard.tsx` | Passes props to `<SettingsView/>` | Group F |

**Verification command (used everywhere):** `pnpm --filter @aurowork/app typecheck`

---

## Task 1 — Group A: Stub the missing client methods

**Goal:** Eliminate 10 `Property 'X' does not exist` errors against the AuroWork server client by adding typed stub methods that throw at runtime (matching today's behavior). Also publish a typed `AuroworkAuditEntry` to unblock Task 6.

**Files:**
- Modify: `apps/app/src/app/lib/aurowork-server.ts` (factory that builds the client object the errors target)

- [ ] **Step 1.1: Locate the client factory**

Run: `grep -n "publishBundle\|fetchBundle\|listAudit\|listScheduledJobs\|materializeBlueprintSessions\|return {" apps/app/src/app/lib/aurowork-server.ts | head -40`

Find the `return { baseUrl, token, health, ... }` literal that constructs the client object. The 10 errors all target this object literal.

- [ ] **Step 1.2: Add a shared `AuroworkAuditEntry` type near the top of the file**

Insert next to the other exported types (search for `export type` to find a good neighborhood):

```typescript
export type AuroworkAuditEntry = {
  id: string;
  workspaceId: string;
  action: string;
  target: string;
  summary: string;
  timestamp: number;
  actor?:
    | { type: "host" }
    | { type: "remote"; clientId?: string }
    | null;
};
```

The `actor` shape comes from `formatActor` in `apps/app/src/app/pages/settings.tsx:909` (`entry.actor.type === "host" | "remote"`, `actor.clientId`).

- [ ] **Step 1.3: Add five stub methods to the returned client object**

Inside the returned object literal, add:

```typescript
    fetchBundle: async (_url: string): Promise<unknown> => {
      throw new Error("AuroWork server fetchBundle is not implemented");
    },
    publishBundle: async (
      _payload: unknown,
      _kind: string,
      _opts?: { workspaceId?: string },
    ): Promise<{ url: string }> => {
      throw new Error("AuroWork server publishBundle is not implemented");
    },
    listAudit: async (
      _workspaceId: string,
      _limit: number,
    ): Promise<{ entries: AuroworkAuditEntry[] }> => {
      throw new Error("AuroWork server listAudit is not implemented");
    },
    listScheduledJobs: async (
      _workspaceId: string,
    ): Promise<{ jobs: Array<{ id: string; cron: string; nextRunAt: number | null }> }> => {
      throw new Error("AuroWork server listScheduledJobs is not implemented");
    },
    materializeBlueprintSessions: async (
      _workspaceId: string,
    ): Promise<{ created: number }> => {
      throw new Error("AuroWork server materializeBlueprintSessions is not implemented");
    },
```

The shapes are inferred from caller usage:
- `app.tsx:537` — `parseSharedBundle(await serverClient.fetchBundle(...))` → returns `unknown`, parser handles narrowing.
- `dashboard.tsx:926/1043`, `session.tsx:3378/3507` — callers expect a `url` string back.
- `app.tsx:4352` — caller iterates `result.entries` (Group F audit cluster).
- `app.tsx:5500` — caller reads `response.jobs`.
- `app.tsx:5784` — caller reads `result.created`.

Pick `unknown`/minimal shapes where caller usage isn't visible — these are stubs, the real shape will be authored when the feature is actually built.

- [ ] **Step 1.4: Verify Group A errors clear**

Run: `pnpm --filter @aurowork/app typecheck 2>&1 | grep -E "fetchBundle|publishBundle|listAudit|listScheduledJobs|materializeBlueprintSessions"`
Expected: empty output.

Then: `pnpm --filter @aurowork/app typecheck 2>&1 | tail -5`
Expected: error count drops by ~10 (from 53 → ~43). Some Group F errors (`AuroworkAuditEntry`, `entry: unknown` cluster) may also resolve once Task 6 imports the type.

- [ ] **Step 1.5: Commit**

```bash
git add apps/app/src/app/lib/aurowork-server.ts
git commit -m "fix(types): stub unimplemented AuroWork server client methods (Group A)

Adds typed throw-at-runtime stubs for fetchBundle, publishBundle,
listAudit, listScheduledJobs, materializeBlueprintSessions. Behavior is
unchanged - calling these already threw a TypeError today since the
methods didn't exist on the client. Also publishes AuroworkAuditEntry
type for shared use across pages."
```

---

## Task 2 — Group B: Add `blueprint` to client `WorkspaceAuroworkConfig`

**Goal:** Sync the client `WorkspaceAuroworkConfig` type with the server-side source of truth so 5 errors (in `app.tsx`, `context/workspace.ts`, `session.tsx`) clear.

**Files:**
- Modify: `apps/app/src/app/types.ts:184-196`
- Modify: `apps/app/src/app/lib/tauri.ts:343-355`

**Server source of truth:** `apps/server/src/workspace-init.ts:57-69` declares `blueprint?: Record<string, unknown> | null;`

- [ ] **Step 2.1: Add `blueprint` to `apps/app/src/app/types.ts`**

Edit the type at line 184 to insert one new field next to `reload`:

```typescript
export type WorkspaceAuroworkConfig = {
  version: number;
  workspace?: {
    name?: string | null;
    createdAt?: number | null;
    preset?: string | null;
  } | null;
  authorizedRoots: string[];
  blueprint?: Record<string, unknown> | null;
  reload?: {
    auto?: boolean;
    resume?: boolean;
  } | null;
};
```

- [ ] **Step 2.2: Add the same field to `apps/app/src/app/lib/tauri.ts:343`**

Same edit (the file declares its own copy of the type — both must drift together).

- [ ] **Step 2.3: Verify Group B errors clear**

Run: `pnpm --filter @aurowork/app typecheck 2>&1 | grep -E "blueprint" | grep -v "node_modules"`
Expected: empty output.

- [ ] **Step 2.4: Commit**

```bash
git add apps/app/src/app/types.ts apps/app/src/app/lib/tauri.ts
git commit -m "fix(types): sync WorkspaceAuroworkConfig.blueprint with server (Group B)

Server has emitted blueprint?: Record<string, unknown> | null since
workspace-init.ts shipped; the client type was never updated. Frontend
already reads it correctly at runtime - this only fixes the type
declaration drift."
```

---

## Task 3 — Group C: Extend `SandboxDoctorResult` stub with `debug` and `serverVersion`

**Goal:** Eliminate 7 errors at `apps/app/src/app/context/workspace.ts:1885-1916`. The Docker sandbox feature was pruned, leaving only a local stub type; the call sites that read `debug`/`serverVersion` are dead under `isTauriRuntime()` short-circuit but TypeScript still checks them.

**Files:**
- Modify: `apps/app/src/app/context/workspace.ts:107-115`

- [ ] **Step 3.1: Extend the local `SandboxDoctorResult` stub**

Edit the type literal at line 107:

```typescript
type SandboxDoctorCommandDebug = {
  status: number;
  stderr?: string;
};

type SandboxDoctorResult = {
  installed: boolean;
  daemonRunning: boolean;
  permissionOk: boolean;
  ready: boolean;
  error?: string;
  serverVersion?: string | null;
  debug?: {
    selectedBin?: string;
    candidates?: string[];
    versionCommand?: SandboxDoctorCommandDebug;
    infoCommand?: SandboxDoctorCommandDebug;
  };
};
```

The optional-field shapes are derived from the read sites at lines 1885-1916:
- `doctor.debug.selectedBin?.trim()` → `string | undefined`
- `doctor.debug.candidates ?? []` iterated with `.filter((item) => item?.trim())` → `string[]`
- `doctor.debug.versionCommand` / `infoCommand` → `{ status, stderr? }` (read `.status` and `.stderr?.trim()`)
- `doctor.serverVersion ?? null` → `string | null | undefined`

- [ ] **Step 3.2: Verify Group C errors and the implicit-any at 1890 clear**

Run: `pnpm --filter @aurowork/app typecheck 2>&1 | grep "context/workspace.ts" | grep -E "debug|serverVersion|item"`
Expected: empty output. (The `Parameter 'item' implicitly has an 'any' type` at line 1890 also resolves because `candidates` is now typed as `string[]`.)

- [ ] **Step 3.3: Commit**

```bash
git add apps/app/src/app/context/workspace.ts
git commit -m "fix(types): extend SandboxDoctorResult stub with debug+serverVersion (Group C)

Docker sandbox feature was pruned; the local stub type was missing
fields that legacy creation-flow code still reads under a dead
isTauriRuntime() branch. Adding optional fields keeps the call sites
type-safe without resurrecting the feature."
```

---

## Task 4 — Group E: Replace `opencodeRouterInfo: null` with proper stub type

**Goal:** Eliminate 13 errors in `settings.tsx` and 1 in `session.tsx` by introducing an `OpencodeRouterInfo` stub type. Currently the prop is typed as the literal `null`, narrowing every field access to `never`.

**Files:**
- Modify: `apps/app/src/app/types.ts` (add new exported type near other interface declarations)
- Modify: `apps/app/src/app/pages/settings.tsx:120`
- Modify: `apps/app/src/app/pages/session.tsx:170`
- Modify: `apps/app/src/app/app.tsx:1044`

- [ ] **Step 4.1: Add `OpencodeRouterInfo` to `apps/app/src/app/types.ts`**

Insert near the other UI-facing types (e.g. just after `WorkspaceAuroworkConfig`):

```typescript
/**
 * Stub shape for the (currently pruned) OpenCode router runtime info.
 * Kept so UI code that reads these fields type-checks; today the value
 * is always `null` at runtime. Re-author when the router lands.
 */
export type OpencodeRouterInfo = {
  running?: boolean;
  version?: string | null;
  healthPort?: number | null;
  pid?: number | null;
  opencodeUrl?: string | null;
  workspacePath?: string | null;
  lastStdout?: string | null;
  lastStderr?: string | null;
};
```

Field set is exhaustive — derived from every `props.opencodeRouterInfo?.X` access in `settings.tsx` (lines 748, 753, 961, 968, 1010, 1147, 1148, 3313, 3317, 3322, 3325, 3344) and `session.tsx:494`.

- [ ] **Step 4.2: Update `SettingsViewProps`**

In `apps/app/src/app/pages/settings.tsx`:

1. Add to imports (find the existing `from "../types"` import block):
   ```typescript
   import type { OpencodeRouterInfo } from "../types";
   ```
   (If `../types` is already imported, just add `OpencodeRouterInfo` to the existing list.)

2. Change line 120 from:
   ```typescript
     opencodeRouterInfo: null;
   ```
   to:
   ```typescript
     opencodeRouterInfo: OpencodeRouterInfo | null;
   ```

- [ ] **Step 4.3: Update `SessionViewProps`**

In `apps/app/src/app/pages/session.tsx`:

1. Ensure `OpencodeRouterInfo` is imported from `../types`.
2. Change line 170 from `opencodeRouterInfo: null;` to `opencodeRouterInfo: OpencodeRouterInfo | null;`.

- [ ] **Step 4.4: Update the source signal in `app.tsx`**

At `apps/app/src/app/app.tsx:1044`, change:

```typescript
const [opencodeRouterInfoState, setOpenCodeRouterInfoState] = createSignal<null>(null);
```

to:

```typescript
const [opencodeRouterInfoState, setOpenCodeRouterInfoState] =
  createSignal<OpencodeRouterInfo | null>(null);
```

Add `OpencodeRouterInfo` to the existing `from "./types"` import in `app.tsx`.

- [ ] **Step 4.5: Verify Group E errors clear**

Run: `pnpm --filter @aurowork/app typecheck 2>&1 | grep -E "type 'never'|opencodeRouterInfo"`
Expected: empty output (was 14 errors).

Then: `pnpm --filter @aurowork/app typecheck 2>&1 | tail -3`
Expected: total error count down to ~22 or fewer.

- [ ] **Step 4.6: Commit**

```bash
git add apps/app/src/app/types.ts apps/app/src/app/pages/settings.tsx apps/app/src/app/pages/session.tsx apps/app/src/app/app.tsx
git commit -m "fix(types): replace opencodeRouterInfo: null with stub type (Group E)

Prop was typed as the literal null, narrowing every field access to
never (13 errors in settings.tsx + 1 in session.tsx). Introduces
OpencodeRouterInfo stub with all read fields optional so UI code
type-checks. Runtime value remains null until the router feature is
re-introduced."
```

---

## Task 5 — Group D: Reconcile `DashboardTab` / `SettingsTab` literals

**Goal:** 8 errors from string literals not in the union types. Per spec §D, decide per-literal: live feature → add to union; dead caller → remove.

**Investigation outcome (validated 2026-05-06):**
- `"scheduled"` (DashboardTab) — Sole live writer is `context/local.tsx:33` (a default value) and a comparison in `workspace-right-sidebar.tsx:108`. The handler this routes to lives behind `client.listScheduledJobs` (Group A stub). Treat as **live but dormant**: add to union — removing the default would force a different default and ripple through stored persisted state.
- `"identities"` (DashboardTab) — Used in `session.tsx:3781` (a navigation call) and a sidebar comparison. Identity management is referenced in DESIGN docs as live. **Add to union.**
- `"automations"` (SettingsTab) — Sidebar comparison only. Automations tab exists in product copy. **Add to union.**
- `"messaging"` (SettingsTab) — Sidebar comparison only. **Add to union.**

All four are `add-to-union` decisions — least risky and matches the spec's "per literal" guidance.

**Files:**
- Modify: `apps/app/src/app/types.ts:153-170`

- [ ] **Step 5.1: Extend both unions**

Edit `apps/app/src/app/types.ts`:

```typescript
export type DashboardTab =
  | "skills"
  | "plugins"
  | "mcp"
  | "config"
  | "settings"
  | "scheduled"
  | "identities";

export type SettingsTab =
  | "general"
  | "den"
  | "model"
  | "skills"
  | "extensions"
  | "advanced"
  | "appearance"
  | "updates"
  | "recovery"
  | "debug"
  | "automations"
  | "messaging";
```

- [ ] **Step 5.2: Verify Group D errors clear**

Run: `pnpm --filter @aurowork/app typecheck 2>&1 | grep -E "DashboardTab|SettingsTab"`
Expected: empty output.

- [ ] **Step 5.3: Commit**

```bash
git add apps/app/src/app/types.ts
git commit -m "fix(types): add scheduled/identities/automations/messaging tabs (Group D)

Each literal is referenced by live UI code (sidebar comparisons,
navigation calls, default value in local context). Adding to the
unions matches the runtime reality; removing callers would require
product input."
```

---

## Task 6 — Group F: JSON parse boundary + audit-entry typing

**Goal:** Clear the 10 remaining miscellaneous errors (some auto-resolved by Task 1).

**Files:**
- Modify: `apps/app/src/app/app.tsx:2184, 2261, 5786, 5791, 5794`
- Modify: `apps/app/src/app/pages/settings.tsx:114, 909, 3561-3570`
- Modify: `apps/app/src/app/pages/dashboard.tsx:1414` (likely auto-resolves; verify only)

- [ ] **Step 6.1: Replay typecheck to see what's left**

Run: `pnpm --filter @aurowork/app typecheck 2>&1 | grep -v "tsc -p\|>" | head -40`

Expected remaining errors (approximate):
- `app.tsx:2184` — `Property 'text' does not exist on type '{}'`
- `app.tsx:2261` — `Type 'unknown[]' not assignable to {role,text}[]`
- `app.tsx:5786` — `Property 'text' does not exist on type '{}'`
- `app.tsx:5791` — `Parameter 'entry' implicitly has an 'any' type`
- `app.tsx:5794` — `Type 'unknown[]' not assignable to {role,text}[]`
- `settings.tsx:909` — `Cannot find name 'AuroworkAuditEntry'`
- `settings.tsx:3561-3570` — `'entry' is of type 'unknown'` (×5)
- `settings.tsx:114` — `auroworkAuditEntries: unknown[]` (props mismatch with dashboard.tsx pass)
- `dashboard.tsx:1414` — SettingsViewProps mismatch

- [ ] **Step 6.2: Type the audit entries on `SettingsViewProps`**

In `apps/app/src/app/pages/settings.tsx`:

1. Import the type:
   ```typescript
   import type { AuroworkAuditEntry } from "../lib/aurowork-server";
   ```
2. Change line 114 from:
   ```typescript
     auroworkAuditEntries: unknown[];
   ```
   to:
   ```typescript
     auroworkAuditEntries: AuroworkAuditEntry[];
   ```

This makes the `entry: unknown` narrowing at lines 3561-3570 unnecessary — `entry` becomes `AuroworkAuditEntry`. The reference to `AuroworkAuditEntry` at line 909 (`formatActor(entry: AuroworkAuditEntry)`) also resolves once the import is added.

- [ ] **Step 6.3: Type the source signal in `app.tsx`**

At `apps/app/src/app/app.tsx:1046`, change:

```typescript
const [auroworkAuditEntries, setAuroworkAuditEntries] = createSignal<Array<{ id: string; workspaceId: string; action: string; target: string; summary: string; timestamp: number }>>([]);
```

to:

```typescript
const [auroworkAuditEntries, setAuroworkAuditEntries] = createSignal<AuroworkAuditEntry[]>([]);
```

Add `AuroworkAuditEntry` to the existing `from "./lib/aurowork-server"` import (or add the import).

- [ ] **Step 6.4: Inspect the `text`/`unknown[]` cluster sites**

Run: `sed -n '2175,2270p' apps/app/src/app/app.tsx`
Run: `sed -n '5780,5800p' apps/app/src/app/app.tsx`

Both sites parse JSON-ish data and pass it to a function expecting `Array<{ role?: "assistant" | "user" | null; text?: string | null }>`. The variable is typed `{}` after `JSON.parse(...)` or similar `unknown`-emitting boundary.

- [ ] **Step 6.5: Add a typed parse helper at the top of `app.tsx` (near other helpers)**

```typescript
type ChatTranscriptEntry = {
  role?: "assistant" | "user" | null;
  text?: string | null;
};

function asTranscriptEntries(value: unknown): ChatTranscriptEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object") return {};
    const obj = item as Record<string, unknown>;
    const role = obj.role;
    const text = obj.text;
    return {
      role: role === "assistant" || role === "user" ? role : null,
      text: typeof text === "string" ? text : null,
    };
  });
}
```

- [ ] **Step 6.6: Use the helper at the two parse boundaries**

At `app.tsx:2184` and `app.tsx:2261` (the same flow), replace the direct `unknown[]`/`{}` propagation with `asTranscriptEntries(rawValue)`. Concretely:

1. Read lines 2175-2270; locate the assignment that produces `{}` or `unknown[]` (e.g. `const parsed = JSON.parse(s)` or a destructure thereof).
2. Wrap: `const entries = asTranscriptEntries(parsed)` and pass `entries` to the consumer.
3. Remove the `.text` accesses on the original `{}`-typed variable; instead read from `entries[i].text`.

Apply the same transform at `app.tsx:5786, 5791, 5794`. The `entry` lambda parameter at 5791 should now be inferred as `ChatTranscriptEntry`.

If the surrounding code shape makes `asTranscriptEntries` awkward, the alternative is a single cast at the boundary: `const parsed = JSON.parse(s) as ChatTranscriptEntry[]` — acceptable per spec ("cast-at-boundary is fine if it validates the shape"). Prefer the helper because it actually validates.

- [ ] **Step 6.7: Verify all `app.tsx` errors clear**

Run: `pnpm --filter @aurowork/app typecheck 2>&1 | grep "app.tsx"`
Expected: empty output.

- [ ] **Step 6.8: Verify `dashboard.tsx:1414` SettingsViewProps mismatch**

Run: `pnpm --filter @aurowork/app typecheck 2>&1 | grep "dashboard.tsx"`

If the error persists, read the error message — it lists which 9 properties are missing. The likely cause is that `SettingsView` props are spread from a parent that doesn't include the audit/router fields. Either:
- (a) Pass the missing props through (preferred — matches the rest of the prop drilling pattern).
- (b) Mark them optional in `SettingsViewProps`.

Pick (a) by default. Read `dashboard.tsx:1380-1420` to find the `<SettingsView/>` callsite and add the missing keys, sourcing them from the props the parent already receives.

- [ ] **Step 6.9: Final verification**

Run: `pnpm --filter @aurowork/app typecheck`
Expected: exit 0, no errors.

Run: `git diff --stat`
Confirm changes are scoped to the files listed above.

Smoke check (manual, optional but per spec acceptance criteria): `pnpm dev:ui` → open workspace → list sessions → open settings → run sandbox doctor → start/stop engine. No new console errors.

- [ ] **Step 6.10: Commit**

```bash
git add apps/app/src/app/app.tsx apps/app/src/app/pages/settings.tsx apps/app/src/app/pages/dashboard.tsx
git commit -m "fix(types): type JSON parse boundary and audit entries (Group F)

- Adds asTranscriptEntries() validator for the two JSON parse sites in
  app.tsx that were leaking {} and unknown[].
- Types auroworkAuditEntries as AuroworkAuditEntry[] (introduced in
  Group A), eliminating 5 'entry is unknown' errors and the unresolved
  AuroworkAuditEntry name in settings.tsx.
- Reconciles SettingsView props passthrough in dashboard.tsx.

Closes the 53-error backlog: typecheck now exits 0."
```

---

## Acceptance Criteria

- [ ] `pnpm --filter @aurowork/app typecheck` exits 0
- [ ] `bun run typecheck` (repo root) exits 0
- [ ] No new `// @ts-ignore` or `as any` introduced (one cast-at-boundary in Task 6 acceptable if helper rejected)
- [ ] 6 commits total, each scoped to one Group, each with `fix(types): <group> ...` prefix
- [ ] No runtime regression in the smoke flow (open workspace → list sessions → open settings → run sandbox doctor → start/stop engine)

## Out of Scope (explicitly deferred)

- Implementing the 5 stubbed server APIs (`fetchBundle`, `publishBundle`, `listAudit`, `listScheduledJobs`, `materializeBlueprintSessions`) — separate product ticket.
- Removing dead UI affordances tied to those stubs — separate product/UX ticket.
- Re-introducing the OpenCode router or Docker sandbox features.
- Splitting `settings.tsx` (3500+ LOC monolith).
- Server-side type drift errors (separate ticket).
