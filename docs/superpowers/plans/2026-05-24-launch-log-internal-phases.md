# Launch-log Internal Phases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make orchestrator daemon, opencode engine, and aurowork-server startup phases visible in the launch log so the still-unexplained 25 s / 30 s gaps on Windows become attributable.

**Architecture:** Three independent patches sharing a branch and PR. Patch 1 + 3 add `[<service>-phase]` stdout lines from Bun TypeScript (re-tagged by existing Rust forwarder). Patch 2 adds a Rust-side pattern detector that recognizes opencode's existing stdout and emits secondary INFO entries with `[overseas]` markers where applicable.

**Tech Stack:** Bun 1.x + TypeScript (orchestrator, server); Rust + Tauri 2 (forwarder).

**Spec:** `docs/superpowers/specs/2026-05-24-launch-log-internal-phases-design.md`.

---

## Task 1: Patch 1 — Orchestrator phase logs (`apps/orchestrator/src/cli.ts`)

**Files:**
- Modify: `apps/orchestrator/src/cli.ts` (function `runRouterDaemon` at line 3534; helper `downloadSidecarBinary` at line 1458)

- [ ] **Step 1: Add helper block at module top of `apps/orchestrator/src/cli.ts`**

Find an existing top-of-file utility region (look near the imports / first non-import statement). Add **once**:

```ts
function isOverseasUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    const overseasHosts = [
      "github.com", "githubusercontent.com", "models.dev",
      "api.openai.com", "api.anthropic.com", "openrouter.ai",
      "registry.npmjs.org", "npm.pkg.github.com",
    ];
    return overseasHosts.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}
```

(No `phaseLog` at module scope — it needs the per-invocation `startedAt`. Define it inside `runRouterDaemon`.)

- [ ] **Step 2: Add `startedAt` + `phaseLog` at top of `runRouterDaemon` (line 3534)**

As the very first statements:

```ts
const startedAt = Date.now();
const phaseLog = (event: string, extras: Record<string, string | number | boolean> = {}) => {
  const elapsed = Date.now() - startedAt;
  const kv = Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`[aurowork-orchestrator] [orchestr-phase] ${event} elapsed=${elapsed}ms${kv ? " " + kv : ""}`);
};
phaseLog("entry", { pid: process.pid });
```

- [ ] **Step 3: Insert phase emits after each existing awaited startup call**

Anchor each emit by the **line ranges given in the spec**. Find each line, insert a `phaseLog(...)` IMMEDIATELY AFTER the await returns. Use the table from the spec. Concretely:

```ts
// after line 3550 await resolveCliVersion(...)
phaseLog("cli-version-resolved", { version: cliVersion });

// after line 3580 await loadRouterState(...)
phaseLog("router-state-loaded");

// after the two resolvePort awaits around lines 3583-3609
phaseLog("port-resolved", { daemonPort, opencodePort });

// after line 3636 await ensureWorkspace(...)
phaseLog("workspace-ensured");

// after line 3645 await ensureOpencodeStateLayout(...)
phaseLog("xdg-layout-ready");

// after line 3659 await readVersionManifest(...) — include source if discoverable
phaseLog("version-manifest-loaded", { source: manifest.source ?? "unknown" });

// after line 3671 await resolveOpencodeBin(...)
phaseLog("opencode-bin-resolved", { cached: bin.cached ?? "unknown", path: bin.path });

// before line 3765 (the await ensureOpencode call)
phaseLog("spawning-opencode", { port: opencodePort });

// after ensureOpencode resolves
phaseLog("opencode-health-ok");

// inside the server.listen callback (around line 4062)
phaseLog("http-listening", { port: daemonPort });
```

Variable names (`cliVersion`, `daemonPort`, `opencodePort`, `manifest.source`, `bin.cached`, `bin.path`) must be checked against the actual code at those lines. If a destructured variable doesn't exist, use what does — read the file at each anchor before inserting.

- [ ] **Step 4: Instrument `downloadSidecarBinary` (line 1458)**

Read the function body. If it uses `fetch()` + `.body.getReader()` byte-counting:

```ts
// before the loop (after fetch returns headers)
const dlStartedAt = Date.now();
const expectedBytes = Number(response.headers.get("content-length") ?? 0);
console.log(`[aurowork-orchestrator] [orchestr-phase] downloading-sidecar elapsed=${Date.now() - dlStartedAt}ms url=${url} bytes_expected=${expectedBytes}${isOverseasUrl(url) ? " [overseas]" : ""}`);

let lastProgressEmit = Date.now();
let received = 0;
// inside the read loop, after each chunk:
received += chunk.byteLength;
const now = Date.now();
if (now - lastProgressEmit >= 2000) {
  const pct = expectedBytes ? Math.floor((received / expectedBytes) * 100) : 0;
  console.log(`[aurowork-orchestrator] [orchestr-phase] download-progress elapsed=${now - dlStartedAt}ms pct=${pct}`);
  lastProgressEmit = now;
}

// after loop completes
console.log(`[aurowork-orchestrator] [orchestr-phase] sidecar-downloaded elapsed=${Date.now() - dlStartedAt}ms bytes=${received}`);
```

If the function uses a different download primitive (Bun.write, fs.createWriteStream piped, etc.), use the matching equivalent:
- Emit a `downloading-sidecar` line once before the network call starts.
- Emit a `sidecar-downloaded` line once after success with `bytes=<final size>`.
- Skip `download-progress` lines (acceptable degradation noted in spec).

Read the function first, choose the right path, then write.

- [ ] **Step 5: Build the binary**

```bash
pnpm --filter aurowork-orchestrator build:bin:bundled
```

Expected: builds and refreshes `apps/desktop/src-tauri/sidecars/aurowork-orchestrator*`. Resolve any TS errors before continuing.

- [ ] **Step 6: Commit**

```bash
git add apps/orchestrator/src/cli.ts apps/desktop/src-tauri/sidecars/
git commit -m "feat(launch-log): orchestrator-phase logs in runRouterDaemon

Adds 11 phaseLog emits across runRouterDaemon covering entry, version
resolution, manifest load, opencode bin resolution, optional sidecar
download (with 2s progress), spawn, health-ok, and http listening.
Lines prefixed with [aurowork-orchestrator] [orchestr-phase] so the
Tauri forwarder routes them to launch:orchestr. Overseas URLs (GitHub,
models.dev, npm, providers) are flagged with an [overseas] marker."
```

---

## Task 2: Patch 2 — opencode pattern detector (Rust)

**Files:**
- Modify: `apps/desktop/src-tauri/src/launch_log/sidecar.rs`
- Modify: `apps/desktop/src-tauri/src/commands/engine.rs` (3 forwarder sites: stdout line ~820, stderr line ~851, termination ~872)

- [ ] **Step 1: Write the failing test in `sidecar.rs` `#[cfg(test)] mod tests`**

```rust
#[test]
fn classify_opencode_phase_recognizes_known_events() {
    use super::classify_opencode_phase;
    let p = classify_opencode_phase("opencode server listening on http://127.0.0.1:55779").expect("phase");
    assert_eq!(p.event, "server-listening");
    assert!(!p.overseas);

    let p = classify_opencode_phase("fetching models from https://models.dev/v1/models").expect("phase");
    assert_eq!(p.event, "model-list-fetch");
    assert!(p.overseas);
    assert!(p.extras.as_deref().unwrap_or("").contains("models.dev"));

    let p = classify_opencode_phase("plugin loaded: web-search").expect("phase");
    assert_eq!(p.event, "plugin-loaded");

    let p = classify_opencode_phase("mcp server starting: filesystem").expect("phase");
    assert_eq!(p.event, "mcp-spawn");

    let p = classify_opencode_phase("running migration on opencode.db sqlite").expect("phase");
    assert_eq!(p.event, "db-migration");

    let p = classify_opencode_phase("fetching from api.anthropic.com/v1/messages").expect("phase");
    assert_eq!(p.event, "provider-fetch");
    assert!(p.overseas);

    assert!(classify_opencode_phase("just some random output").is_none());
}
```

- [ ] **Step 2: Run test to verify failure**

```
cd apps/desktop/src-tauri && cargo test -p aurowork --lib launch_log::sidecar::tests::classify_opencode_phase_recognizes_known_events
```
Expected: FAIL — `classify_opencode_phase` not found.

- [ ] **Step 3: Implement `classify_opencode_phase` in `sidecar.rs`**

Add below the existing `classify_sidecar_tag`:

```rust
/// A recognized opencode startup/runtime phase event extracted from a
/// stdout line. The original line is unchanged; this is a *secondary*
/// signal used by the engine forwarder to emit normalized INFO entries
/// (e.g. `[engine-phase] model-list-fetch [overseas]`).
pub struct OpencodePhase {
    pub event: &'static str,
    pub overseas: bool,
    pub level: Level,
    pub extras: Option<String>,
}

/// Pattern-detect a stripped opencode stdout line. Input MUST already
/// have the `[opencode] ` prefix removed (i.e. the second tuple element
/// from `classify_sidecar_tag`).
pub fn classify_opencode_phase(line: &str) -> Option<OpencodePhase> {
    let lower = line.to_lowercase();

    // 1. Server listening.
    if lower.contains("server listening on") {
        return Some(OpencodePhase {
            event: "server-listening",
            overseas: false,
            level: Level::Info,
            extras: None,
        });
    }

    // 2. Model list fetch.
    if lower.contains("models.dev")
        || lower.contains("fetching models")
        || lower.contains("fetching model list")
    {
        let host = extract_host(line);
        let overseas = host.as_deref().map(is_overseas_host).unwrap_or(false)
            || lower.contains("models.dev");
        return Some(OpencodePhase {
            event: "model-list-fetch",
            overseas,
            level: Level::Info,
            extras: host.map(|h| format!("host={h}")),
        });
    }

    // 3. Plugin loaded.
    if lower.contains("plugin loaded") {
        return Some(OpencodePhase {
            event: "plugin-loaded",
            overseas: false,
            level: Level::Info,
            extras: None,
        });
    }

    // 4. MCP server spawn/start.
    if lower.contains("mcp server")
        && (lower.contains("spawn") || lower.contains("starting") || lower.contains("connect"))
    {
        return Some(OpencodePhase {
            event: "mcp-spawn",
            overseas: false,
            level: Level::Info,
            extras: None,
        });
    }

    // 5. DB migration.
    if lower.contains("migration")
        && (lower.contains("sqlite") || lower.contains("database") || lower.contains("migrating"))
    {
        return Some(OpencodePhase {
            event: "db-migration",
            overseas: false,
            level: Level::Info,
            extras: None,
        });
    }

    // 6. Provider fetch.
    if lower.contains("fetching")
        && (lower.contains("api.anthropic.com")
            || lower.contains("api.openai.com")
            || lower.contains("openrouter"))
    {
        let host = extract_host(line);
        return Some(OpencodePhase {
            event: "provider-fetch",
            overseas: true,
            level: Level::Info,
            extras: host.map(|h| format!("host={h}")),
        });
    }

    None
}

fn extract_host(line: &str) -> Option<String> {
    // Find the first http(s):// substring and parse its host.
    let idx = line.find("http://").or_else(|| line.find("https://"))?;
    let rest = &line[idx..];
    let end = rest.find(|c: char| c.is_whitespace() || c == ')' || c == ',').unwrap_or(rest.len());
    let url = &rest[..end];
    url::Url::parse(url).ok().and_then(|u| u.host_str().map(|s| s.to_string()))
}

fn is_overseas_host(host: &str) -> bool {
    let h = host.to_lowercase();
    if h == "localhost" || h == "127.0.0.1" || h == "::1" {
        return false;
    }
    let overseas = [
        "github.com", "githubusercontent.com", "models.dev",
        "api.openai.com", "api.anthropic.com", "openrouter.ai",
        "registry.npmjs.org", "npm.pkg.github.com",
    ];
    overseas.iter().any(|o| h == *o || h.ends_with(&format!(".{o}")))
}
```

`url::Url` requires the `url` crate. Check `apps/desktop/src-tauri/Cargo.toml` — if `url` is not a direct dep, add `url = "2"` (it's almost certainly already transitive).

- [ ] **Step 4: Run test to verify pass**

```
cd apps/desktop/src-tauri && cargo test -p aurowork --lib launch_log
```
Expected: all launch_log tests pass.

- [ ] **Step 5: Wire into the engine forwarder (`commands/engine.rs`)**

Find each of the 3 `agg.append(level, tag, None, msg, stack.as_deref());` calls in the engine spawn block (stdout ~line 821, stderr ~line 852, termination ~line 873). After EACH one, add:

```rust
if tag == "launch:engine" {
    if let Some(phase) = crate::launch_log::sidecar::classify_opencode_phase(msg) {
        let marker = if phase.overseas { "[engine-phase][overseas] " } else { "[engine-phase] " };
        let body = match phase.extras.as_deref() {
            Some(extras) => format!("{marker}{} {}", phase.event, extras),
            None => format!("{marker}{}", phase.event),
        };
        agg.append(phase.level, "launch:engine", None, &body, None);
    }
}
```

Do not extract into a helper unless the call site already wraps things in a closure; inline is fine and keeps the diff readable.

- [ ] **Step 6: Build**

```
cd apps/desktop/src-tauri && cargo check -p aurowork
```
Expected: clean (one pre-existing dead-code warning OK).

- [ ] **Step 7: Run full Rust test suite**

```
cd apps/desktop/src-tauri && cargo test -p aurowork --lib
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src-tauri/src/launch_log/sidecar.rs apps/desktop/src-tauri/src/commands/engine.rs apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock
git commit -m "feat(launch-log): opencode-phase pattern detector

The engine forwarder now recognizes 6 well-known opencode stdout
patterns (server-listening, model-list-fetch, plugin-loaded, mcp-spawn,
db-migration, provider-fetch) and emits a normalized [engine-phase]
INFO entry per match. Lines hitting models.dev / anthropic.com / openai
/ openrouter / github / npm get an [overseas] marker — fast triage for
PRC cold-start debugging."
```

---

## Task 3: Patch 3 — Server phase logs

**Files:**
- Modify: `apps/server/src/cli.ts` (top of file; after each existing await)
- Modify: `apps/server/src/server.ts` (line 84/87 prefix; line 244 watchers; line 437 listening)

- [ ] **Step 1: Add `phaseLog` helper at top of `apps/server/src/cli.ts` (before line 7)**

```ts
const startedAt = Date.now();
const phaseLog = (event: string, extras: Record<string, string | number | boolean> = {}) => {
  const elapsed = Date.now() - startedAt;
  const kv = Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`[aurowork-server] [server-phase] ${event} elapsed=${elapsed}ms${kv ? " " + kv : ""}`);
};
phaseLog("bun-started", { pid: process.pid });
```

- [ ] **Step 2: Add `args-parsed`, `config-resolved`, `logger-ready` emits in cli.ts**

```ts
// after line 7 (parseCliArgs)
phaseLog("args-parsed");

// after line 19 (await resolveServerConfig)
phaseLog("config-resolved", {
  workspaces: config.workspaces?.length ?? 0,
  auro_base_url: config.auroBaseUrl ? "set" : "unset",
});

// after line 20 (createServerLogger)
phaseLog("logger-ready");
```

- [ ] **Step 3: Add `phaseLog` helper at top of `apps/server/src/server.ts` and emit watchers + listening**

Reuse the SAME helper structure (separate `startedAt` captured at module load is fine):

```ts
const _serverStartedAt = Date.now();
const _serverPhaseLog = (event: string, extras: Record<string, string | number | boolean> = {}) => {
  const elapsed = Date.now() - _serverStartedAt;
  const kv = Object.entries(extras).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`[aurowork-server] [server-phase] ${event} elapsed=${elapsed}ms${kv ? " " + kv : ""}`);
};
```

Then:

```ts
// inside startServer, after startReloadWatchers (around line 244)
_serverPhaseLog("watchers-installed", { count: config.workspaces?.length ?? 0 });

// after Bun.serve (around line 437)
_serverPhaseLog("listening", { port: server.port, host: config.host });
```

- [ ] **Step 4: Prepend `[aurowork-server]` prefix to existing logger output**

Read `server.ts` lines 75-91. For JSON mode (line ~84), change:

```ts
process.stdout.write(`${JSON.stringify(envelope)}\n`);
```

to

```ts
process.stdout.write(`[aurowork-server] ${JSON.stringify(envelope)}\n`);
```

For pretty mode (line ~87), change:

```ts
process.stdout.write(`${message}\n`);
```

to

```ts
process.stdout.write(`[aurowork-server] ${message}\n`);
```

Read the actual code first — if the strings differ, use the actual literals.

- [ ] **Step 5: Build the binary**

```bash
pnpm --filter aurowork-server build:bin
```

Expected: builds and refreshes `apps/desktop/src-tauri/sidecars/aurowork-server*` (verify with `git status`).

If the build command does NOT refresh the desktop sidecar automatically, check `apps/server/package.json` for a `build:bin:bundled` or equivalent — use that instead.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/cli.ts apps/server/src/server.ts apps/desktop/src-tauri/sidecars/
git commit -m "feat(launch-log): server-phase logs + [aurowork-server] prefix

Adds 6 phaseLog emits (bun-started, args-parsed, config-resolved,
logger-ready, watchers-installed, listening) so the Tauri forwarder
can attribute the 30s server gap on Windows to bun bootstrap vs
config resolution vs fs.watch setup. Also prepends [aurowork-server]
to all server stdout so classify_sidecar_tag routes to launch:server
instead of falling through to the default tag."
```

---

## Task 4: Final verification + PR

- [ ] **Step 1: Full test suite**

```
cd apps/desktop/src-tauri && cargo test -p aurowork --lib
pnpm typecheck
```
Expected: all green.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin feat/launch-log-internal-phases
gh pr create --title "Launch-log internal phases (orchestrator / opencode / server)" \
  --body "Implements docs/superpowers/specs/2026-05-24-launch-log-internal-phases-design.md. Three independent additive patches: orchestrator-phase logs in runRouterDaemon, opencode-phase pattern detector in the Rust forwarder, and server-phase logs + [aurowork-server] stdout prefix. Manual verification pending: run a Windows diagnostic launch and confirm the three new tags-within-tags appear with monotonic elapsed ms."
```
