# Launch-log Internal Phases — Design

**Date:** 2026-05-24
**Branch:** `feat/launch-log-internal-phases`
**Trigger:** PR #38 (round 1+2) made Rust-side boundaries observable but left orchestrator daemon, opencode engine, and aurowork-server internals as black boxes. The 25 s orchestrator-ready gap and 30 s server gap on Windows are still unattributed.

## Problem

After PR #38 we can see *which* subsystem is slow, but not *why*. Three black boxes remain:

| # | Black box | Length on Windows cold start | What's hidden |
|---|---|---|---|
| 1 | `aurowork-orchestrator` daemon (Bun) startup, from `runRouterDaemon()` entry → `Bun.serve` listening → opencode child healthy | ~25 s | manifest fetch, binary download, XDG setup, spawn, health-poll inside daemon |
| 2 | opencode child (vendored binary) internal init after spawn | embedded in #1 | model-list fetch (suspected models.dev / provider HTTP), plugin / MCP load, sqlite migration |
| 3 | `aurowork-server` (Bun) startup, from process entry → `Bun.serve` | ~30 s | Bun runtime cold start, config resolution, `fs.watch` setup. **Research confirmed: NO blocking startup HTTP fetches** — kills the "chain wait on opencode" hypothesis. The 30 s must be local. |

### Research findings (verified from code)

**Orchestrator (`apps/orchestrator/src/cli.ts:3534` `runRouterDaemon`):**
- `resolveCliVersion` (line 3550) and 5 more I/O calls run **before** the first `logger.info("Daemon starting")` at line 3646 — meaning the first 100–2000 ms is silent even with current logging.
- `readVersionManifest` (line 3659) and `resolveOpencodeBin` (line 3671, which may call `downloadSidecarBinary`) are the network-touching steps. Manifest source can be local or remote.
- `ensureOpencode` (line 3765) is the longest single phase — spawns opencode child and polls its `/health`. This is where the 25 s lives if the binary download is cached.
- Existing logger already prefixes output with component name (e.g. `[aurowork-orchestrator]`, `[opencode]`), which the Tauri forwarder's `classify_sidecar_tag` already routes to the correct `launch:*` tag.

**Server (`apps/server/src/cli.ts`):**
- Three awaited calls before `Bun.serve`: `resolveServerConfig` (synchronous file reads), `createServerLogger`, `startServer` → `startReloadWatchers` (sync `fs.watch`) → `Bun.serve` (sync bind).
- **Zero blocking HTTP startup.** `auroBaseUrl` is just resolved (line 227 in config.ts) and stored, never pinged.
- Logger uses `process.stdout.write` with **no `[aurowork-server]` prefix** — current Rust forwarder routes everything to the default `launch:server` tag because there's no recognized prefix to strip.

**opencode (`vendored binary`):**
- Source not modifiable in this repo, but its stdout is verbose and already forwarded by the Rust engine forwarder at `apps/desktop/src-tauri/src/commands/engine.rs:804-834`.
- Known recognizable lines from upstream behavior: `opencode server listening on http://...`, `fetching models`, references to `models.dev` / provider URLs, `plugin loaded`, `mcp server`, `migrating database`.
- The forwarder currently treats all of these as undifferentiated DEBUG lines under `launch:engine`.

## Scope

**This is one feature** (launch-log internal observability) split into three independent patches that share the same branch and ship in one PR:

- **Patch 1 — Orchestrator phase logs (Bun TS).** Add structured `[orchestr-phase]` stdout lines at every awaited step in `runRouterDaemon`, with elapsed-ms relative to daemon entry. Mark any URL hitting GitHub / models.dev / non-localhost as `[overseas]`.
- **Patch 2 — opencode pattern detector (Rust).** In the engine forwarder, recognize ~6 well-known opencode stdout patterns and emit a secondary INFO `launch:engine` line normalizing them as `[engine-phase] <event>` plus an `[overseas]` marker where applicable. The original DEBUG line still flows through unchanged.
- **Patch 3 — Server phase logs (Bun TS).** Add `[aurowork-server]` prefix to all stdout logger output (so the existing `classify_sidecar_tag` recognizes it), plus structured `[server-phase]` lines at: bun-started, config-resolved, watchers-installed, listening.

**Out of scope:**
- Performance fixes themselves. We're still in observability-only mode for this round.
- Changing opencode behavior. We only pattern-match its existing output.
- Backporting any of this to aurowork-server's HTTP request handlers (only startup path).
- Anything that requires the frontend to know about phases.

## Design

### Patch 1 — Orchestrator phase logs

**File:** `apps/orchestrator/src/cli.ts`

**Approach:** Use the **existing `logger`** for any phase that occurs *after* `createLogger()` at line 3551. For the earliest two phases (between line 3534 entry and line 3551) that run before the logger exists, use raw `console.log` with the `[aurowork-orchestrator]` prefix manually — this matches what the Rust forwarder's `classify_sidecar_tag` already strips and routes to `launch:orchestr`.

**Phase line format (single line, no newlines in payload):**

```
[orchestr-phase] <event> elapsed=<ms>ms [<key=value> ...]
```

Examples:
- `[orchestr-phase] entry elapsed=0ms pid=1234`
- `[orchestr-phase] cli-version-resolved elapsed=42ms version=0.1.0`
- `[orchestr-phase] version-manifest-loaded elapsed=120ms source=local`
- `[orchestr-phase] version-manifest-loaded elapsed=8420ms source=remote url=https://github.com/... [overseas]`
- `[orchestr-phase] opencode-bin-resolved elapsed=80ms cached=true path=/.../opencode`
- `[orchestr-phase] downloading-sidecar elapsed=130ms url=https://github.com/... bytes_expected=14823456 [overseas]`
- `[orchestr-phase] download-progress elapsed=2130ms pct=18`  (emitted every 2 s during downloadSidecarBinary)
- `[orchestr-phase] sidecar-downloaded elapsed=22510ms sha256_ok=true bytes=14823456`
- `[orchestr-phase] xdg-layout-ready elapsed=22580ms`
- `[orchestr-phase] http-listening elapsed=22640ms port=55782`
- `[orchestr-phase] spawning-opencode elapsed=22650ms port=55779`
- `[orchestr-phase] opencode-spawned elapsed=22700ms pid=5678`
- `[orchestr-phase] opencode-health-ok elapsed=27450ms polls=24`

**Elapsed timer:** captured by `const startedAt = Date.now()` as the very first statement of `runRouterDaemon`. Helper:

```ts
function phaseLog(event: string, extras: Record<string, string | number | boolean> = {}) {
  const elapsed = Date.now() - startedAt;
  const kv = Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(' ');
  // Use raw console.log to bypass the structured logger: the Rust forwarder will
  // re-tag this based on the [aurowork-orchestrator] prefix, and the [orchestr-phase]
  // sub-tag inside the message keeps phase entries grep-able.
  console.log(`[aurowork-orchestrator] [orchestr-phase] ${event} elapsed=${elapsed}ms${kv ? ' ' + kv : ''}`);
}
```

**Overseas marker:** a URL is "overseas" if its hostname matches any of:
- `*.github.com`, `*.githubusercontent.com`, `objects.githubusercontent.com`
- `models.dev`, `*.models.dev`
- `api.openai.com`, `api.anthropic.com`, `openrouter.ai`, `*.openrouter.ai`
- `registry.npmjs.org`, `npm.pkg.github.com`
- Any non-loopback (not `127.0.0.1` / `localhost` / `::1`) — fallback for unknown CDNs

Helper:

```ts
function isOverseasUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    const overseasHosts = ['github.com', 'githubusercontent.com', 'models.dev',
      'api.openai.com', 'api.anthropic.com', 'openrouter.ai',
      'registry.npmjs.org', 'npm.pkg.github.com'];
    return overseasHosts.some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}
```

**Download progress:** `downloadSidecarBinary` (`cli.ts:1458`) currently downloads but probably doesn't emit progress. Add a 2-second-interval progress emit inside its byte-counting loop. If the function uses `fetch()` + `.body.getReader()`, instrument the loop. If it uses some other strategy, emit a single before/after pair as fallback (acceptable degradation).

**Phases instrumented (in order they appear in `runRouterDaemon`):**

| # | Event | Location | Source |
|---|---|---|---|
| 1 | `entry` | cli.ts:3534 (first statement) | `console.log` (pre-logger) |
| 2 | `cli-version-resolved` | after line 3550 | `console.log` (pre-logger) |
| 3 | `router-state-loaded` | after line 3580 | `logger` if available else `console.log` |
| 4 | `port-resolved` | after line 3609 | logger |
| 5 | `workspace-ensured` | after line 3636 | logger |
| 6 | `xdg-layout-ready` | after line 3645 | logger |
| 7 | `version-manifest-loaded` | after line 3659 | logger (with source=local/remote, url if remote) |
| 8 | `opencode-bin-resolved` | after line 3671 | logger (with cached=, path=) |
| 9 | `downloading-sidecar` (only if download occurs) | inside `downloadSidecarBinary` | logger |
| 10 | `download-progress` (every 2s) | inside loop | logger |
| 11 | `sidecar-downloaded` | end of `downloadSidecarBinary` | logger |
| 12 | `spawning-opencode` | before line 3765's spawn | logger |
| 13 | `opencode-spawned` (with pid) | after spawn | logger |
| 14 | `opencode-health-ok` (with polls=) | after `ensureOpencode` returns | logger |
| 15 | `http-listening` | inside `server.listen` callback at line 4062 | logger |

Whether a phase uses `logger.info()` or `console.log` is irrelevant *to the Rust forwarder*, because both end up on the orchestrator's stdout and both will have the `[aurowork-orchestrator]` prefix (added by raw `console.log` in case 1–2, added by the logger's component metadata in case 3+). The `[orchestr-phase]` sub-tag inside the message is what makes them filterable.

### Patch 2 — opencode pattern detector

**Files:** `apps/desktop/src-tauri/src/launch_log/sidecar.rs`, `apps/desktop/src-tauri/src/commands/engine.rs`

**Approach:** Add a free function `classify_opencode_phase` next to `classify_sidecar_tag`. It takes the **already-stripped** message (i.e. after `[opencode] ` prefix is removed by `classify_sidecar_tag`) and returns `Option<OpencodePhase>` where:

```rust
pub struct OpencodePhase {
    pub event: &'static str,       // e.g. "server-listening", "model-list-fetch"
    pub overseas: bool,            // true if the line contains a known overseas URL/host
    pub level: Level,              // typically Info; Warn for slow indicators
    pub extras: Option<String>,    // e.g. "url=https://models.dev/...", "host=models.dev"
}
```

**Patterns recognized** (case-insensitive substring or simple regex):

| Pattern in line | event | overseas | level |
|---|---|---|---|
| `server listening on` | `server-listening` | false | Info |
| `fetching model` OR `models.dev` OR `fetching models` | `model-list-fetch` | true (if URL matches overseas list) | Info |
| `plugin loaded` | `plugin-loaded` | false (unless URL present) | Info |
| `mcp server` AND (`spawn` OR `starting` OR `connect`) | `mcp-spawn` | false | Info |
| `migration` AND (`sqlite` OR `database` OR `migrating`) | `db-migration` | false | Info |
| `fetching` AND (`api.anthropic.com` OR `api.openai.com` OR `openrouter`) | `provider-fetch` | true | Info |

**Forwarder integration:** in the stdout match arm (engine.rs:818-823), after the existing `classify_sidecar_tag` + `agg.append`, add:

```rust
if tag == "launch:engine" {
    if let Some(phase) = crate::launch_log::sidecar::classify_opencode_phase(msg) {
        let prefix = if phase.overseas { "[engine-phase][overseas] " } else { "[engine-phase] " };
        let body = match phase.extras {
            Some(extras) => format!("{prefix}{} {}", phase.event, extras),
            None => format!("{prefix}{}", phase.event),
        };
        agg.append(phase.level, "launch:engine", None, &body, None);
    }
}
```

(Apply to stderr arm and termination flush as well — same code, refactored into a small inline helper.)

**Tests (unit, in sidecar.rs `#[cfg(test)] mod tests`):**
- Each of the 6 patterns above → one positive test verifying event name + overseas flag.
- A negative case (random line) returns `None`.
- A line with `models.dev` URL → overseas=true and `extras` contains `host=models.dev`.

### Patch 3 — Server phase logs

**Files:** `apps/server/src/cli.ts`, `apps/server/src/server.ts`

**Step 3.1 — Prefix all stdout output with `[aurowork-server]`:**

In `server.ts:87` (pretty mode) and `server.ts:84` (json mode), prepend `[aurowork-server] ` to the written bytes. JSON mode: prepend before the JSON envelope so the prefix is the first thing the Rust forwarder sees (the forwarder will then route to `launch:server` via `classify_sidecar_tag`, and the JSON body becomes the message). For pretty mode: just prepend the bracketed prefix.

**Step 3.2 — Add `[server-phase]` entries in `cli.ts`:**

Identical helper pattern to orchestrator:

```ts
const startedAt = Date.now();
function phaseLog(event: string, extras: Record<string, string | number | boolean> = {}) {
  const elapsed = Date.now() - startedAt;
  const kv = Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(' ');
  console.log(`[aurowork-server] [server-phase] ${event} elapsed=${elapsed}ms${kv ? ' ' + kv : ''}`);
}
```

Place at the very top of `cli.ts` (before line 7), then instrument:

| # | Event | Location | Extras |
|---|---|---|---|
| 1 | `bun-started` | first statement of cli.ts | `pid=<process.pid>` |
| 2 | `args-parsed` | after line 7 | `workspace_count=<N>` |
| 3 | `config-resolved` | after line 19 (await `resolveServerConfig`) | `workspaces=<N>` `auro_base_url=<set\|unset>` |
| 4 | `logger-ready` | after line 20 | (none) |
| 5 | `watchers-installed` | inside `startServer` after `startReloadWatchers` (server.ts:244) | `count=<N>` |
| 6 | `listening` | inside `startServer` after `Bun.serve` (server.ts:437) | `port=<N>` `host=<...>` |

For step 5 and 6 (which are inside `server.ts`), add the same `phaseLog` helper at the top of that file (with a fresh `startedAt = Date.now()` capturing import-time — close enough to bun-started for ms-resolution).

**No changes to behavior. Every added call is a pure-stdout side effect.**

## Files Touched

| File | Why |
|---|---|
| `apps/orchestrator/src/cli.ts` | Patch 1 — phaseLog helper, 14 phase emits, isOverseasUrl helper, download progress emit |
| `apps/desktop/src-tauri/src/launch_log/sidecar.rs` | Patch 2 — `classify_opencode_phase` + tests |
| `apps/desktop/src-tauri/src/commands/engine.rs` | Patch 2 — call phase classifier in 3 forwarder sites (stdout, stderr, termination) |
| `apps/server/src/cli.ts` | Patch 3 — phaseLog helper + 4 emit sites |
| `apps/server/src/server.ts` | Patch 3 — `[aurowork-server]` prefix + 2 emit sites |

## Build / Verification

Two binaries must be rebuilt because their TypeScript source changed:

```bash
pnpm --filter aurowork-orchestrator build:bin:bundled
pnpm --filter aurowork-server build:bin
```

The `:bundled` variant for orchestrator also refreshes the desktop sidecar at `apps/desktop/src-tauri/sidecars/`.

**Test commands:**
- `pnpm --filter aurowork-orchestrator test` (if tests exist) — phase log helper is pure
- `pnpm --filter aurowork-server test` (if tests exist)
- `cargo test -p aurowork --lib launch_log` from `apps/desktop/src-tauri/` — covers new pattern detector
- `cargo check -p aurowork` clean

**Manual (Windows + macOS):**
1. Rebuild sidecars (both).
2. Trigger Settings → Debug → Run launch diagnostic.
3. Open the resulting `launch-*.log`.
4. Verify `[launch:orchestr]` contains a contiguous run of `[orchestr-phase]` lines with monotonically increasing elapsed ms.
5. Verify `[launch:engine]` contains zero-to-many `[engine-phase]` events, with `[overseas]` marker on model-list-fetch and provider-fetch when applicable.
6. Verify `[launch:server]` contains 6 `[server-phase]` events.
7. On a fast macOS launch with all binaries cached, total orchestrator phase span < 5 s and `download-progress` lines absent.
8. On a fresh Windows launch with no caches, `download-progress` lines appear and an `[overseas]` marker is visible on the download URL.

## Testing Strategy

**Unit (Rust, Patch 2):**
- Table-driven test for `classify_opencode_phase` covering all 6 patterns + 1 negative.
- Test that lines with `models.dev` produce `overseas=true`.
- Test that the engine forwarder integration doesn't break existing classifier behavior (existing tests still pass).

**Unit (TS, Patches 1+3):**
- Helper `isOverseasUrl` is testable in isolation if there's a test runner configured for `apps/orchestrator`. If not (likely, given current repo state), inline-verify by running the orchestrator binary locally and grepping stdout.
- `phaseLog` is deterministic on its inputs; not worth a test.

**Integration (manual):** as described in Verification.

## Risk & Rollback

| Patch | Risk | Rollback |
|---|---|---|
| 1 | New stdout lines on the orchestrator. The Rust forwarder already routes lines through `classify_sidecar_tag`, so a malformed prefix would simply land as DEBUG `launch:orchestr` — visible but harmless. Download-progress hook is the only place where new control flow lives. | Single commit; revert. |
| 2 | New launch-log entries; no behavior change. If pattern matcher accidentally matches a normal line, we get one extra INFO log — annoying, not harmful. | Single commit; revert. |
| 3 | Prefix prepend in `server.ts:84/87` changes the literal stdout output. Anything that parses aurowork-server stdout would break — investigate if anything does. Quick scan: no test or runtime parses server stdout (Rust forwarder treats it as opaque text). | Revert the prefix change only; phase emits are independent. |

## Open Questions

None.
