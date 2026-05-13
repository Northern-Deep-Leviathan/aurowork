---
name: launch-windows-dev
description: Use when need to compile and launch the AuroWork desktop dev build on Windows, or when `pnpm dev:windows` fails with corepack/sidecar/MSVC errors on a fresh checkout
---

# Launch AuroWork Desktop Dev (Windows)

## Overview

The standard `pnpm dev:windows` flow assumes corepack + VS BuildTools + working `prepare-sidecar.mjs`. On a fresh Windows machine these assumptions often break silently. This skill is the deterministic fallback: build every sidecar by hand, then launch via raw cargo + the compiled exe.

Core principle: **bypass tauri-cli's sidecar resource validation** — it has Windows-specific bugs around the `versions.json` "binary" and silently failing prepare scripts. Once `cargo build` succeeds, run the exe directly.

## When to Use

- Fresh clone on Windows, `pnpm dev:windows` fails
- Errors like:
  - `'corepack' is not recognized`
  - `'AUROWORK_DEV_MODE' is not recognized as an internal or external command`
  - `The "beforeDevCommand" terminated with a non-zero status code`
  - `resource path sidecars\versions.json-x86_64-pc-windows-msvc.exe doesn't exist`
  - `prepare-sidecar.mjs` exits 1 with no output (Node 25 + Windows ESM bug)
- VS 2022 Enterprise installed (not BuildTools — the path hardcoded in `dev-windows.mjs` is wrong)

When NOT to use: macOS/Linux (use `pnpm dev`), or when standard `pnpm dev:windows` works.

## Prerequisites

| Tool | Min Version | Note |
|------|-------------|------|
| Node | 20+ | Node 25 has the silent-exit bug; works for cargo build but `prepare-sidecar.mjs` may fail |
| pnpm | 10.27+ | global install, no corepack needed |
| Bun | 1.3+ | for sidecar compilation |
| Rust | stable + `x86_64-pc-windows-msvc` target | |
| VS 2022 | Enterprise OR BuildTools | need MSVC + Windows SDK |

## Quick Reference (5 Steps)

```
1. pnpm install
2. Download Auro sidecar (auro.exe) from GitHub release
3. bun build the 3 local sidecars (server, orchestrator, chrome-devtools-mcp shim)
4. Stage all sidecars under apps/desktop/src-tauri/sidecars/ with CI naming
5. cargo build (with MSVC env injected) → run AuroWork-Dev.exe directly
```

## Step-by-Step

### 1. Install deps

```bash
pnpm install
```

### 2. Download Auro sidecar

Pinned version comes from `constants.json` → `auroVersion`. Asset name for Windows is `auro-windows-x64-baseline.zip`.

```bash
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('constants.json')).auroVersion.replace(/^v/,''))")
curl -fL "https://github.com/Northern-Deep-Leviathan/auro/releases/download/v${VERSION}/auro-windows-x64-baseline.zip" -o /tmp/auro.zip
mkdir -p /tmp/auro && unzip -q /tmp/auro.zip -d /tmp/auro
mkdir -p apps/desktop/src-tauri/sidecars
cp /tmp/auro/auro.exe apps/desktop/src-tauri/sidecars/auro.exe
cp /tmp/auro/auro.exe apps/desktop/src-tauri/sidecars/auro-x86_64-pc-windows-msvc.exe
```

### 3. Build the 3 local Bun sidecars

```bash
pnpm --filter aurowork-server build:bin
pnpm --filter aurowork-orchestrator build:bin
(cd apps/desktop && bun build --compile scripts/chrome-devtools-mcp-shim.ts \
  --outfile src-tauri/sidecars/chrome-devtools-mcp.exe)
```

### 4. Stage sidecars with CI naming

Tauri's `externalBin` requires `<name>-<target-triple>.exe` files alongside the canonical name.

```bash
SC=apps/desktop/src-tauri/sidecars
cp apps/server/dist/bin/aurowork-server.exe       "$SC/aurowork-server.exe"
cp apps/server/dist/bin/aurowork-server.exe       "$SC/aurowork-server-x86_64-pc-windows-msvc.exe"
cp apps/orchestrator/dist/bin/aurowork.exe        "$SC/aurowork-orchestrator.exe"
cp apps/orchestrator/dist/bin/aurowork.exe        "$SC/aurowork-orchestrator-x86_64-pc-windows-msvc.exe"
cp "$SC/chrome-devtools-mcp.exe"                  "$SC/chrome-devtools-mcp-x86_64-pc-windows-msvc.exe"

# versions.json is also declared as externalBin — needs both forms
printf '{}\n' > "$SC/versions.json"
printf '{}\n' > "$SC/versions.json-x86_64-pc-windows-msvc"
printf '{}\n' > "$SC/versions.json-x86_64-pc-windows-msvc.exe"
```

### 5. Compile + launch (skip `tauri dev`)

`tauri dev` will fail at the sidecar resource check even when files exist. Use raw `cargo build` + run the exe.

Create `.claude/dev-launch.cmd`:

```cmd
@echo off
setlocal
rem Adjust path if you have BuildTools instead of Enterprise
set "VSDEVCMD=C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" (
  set "VSDEVCMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
)
call "%VSDEVCMD%" -arch=x64 -host_arch=x64 >nul
set AUROWORK_DEV_MODE=1
set PORT=5173
set AUROWORK_DATA_DIR=%USERPROFILE%\.aurowork\aurowork-orchestrator-dev
cd /d %~dp0..\apps\desktop\src-tauri
cargo build
start "" "target\debug\AuroWork-Dev.exe"
```

Start vite separately (the dev script uses unix env-var syntax so call vite directly):

```cmd
@echo off
cd /d %~dp0..
set AUROWORK_DEV_MODE=1
set PORT=5173
call pnpm --filter @aurowork/app exec vite
```

Run order:
1. Start vite cmd (waits for `Local: http://localhost:5173/`)
2. Run `dev-launch.cmd` (cargo build ~40s incremental, ~10min cold)
3. AuroWork-Dev window opens, talks to vite at 5173

## Sidecar Naming Reference

Tauri's `externalBin` declarations in `apps/desktop/src-tauri/tauri.conf.json`:

```json
"externalBin": [
  "sidecars/auro",
  "sidecars/aurowork-server",
  "sidecars/aurowork-orchestrator",
  "sidecars/chrome-devtools-mcp",
  "sidecars/versions.json"
]
```

For each entry `sidecars/<name>`, you must place BOTH:
- `sidecars/<name>.exe` (canonical)
- `sidecars/<name>-x86_64-pc-windows-msvc.exe` (target-suffixed)

Yes, even `versions.json` becomes `versions.json-x86_64-pc-windows-msvc.exe` — that's the bug, but it must exist.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Running `pnpm dev:windows` directly | Calls `corepack.cmd pnpm` which 404s. Use this skill's flow instead. |
| Hardcoded BuildTools path in `dev-windows.mjs` | Override via `VSDEVCMD_PATH` env var or use the cmd above with auto-fallback. |
| Skipping `versions.json-...exe` file | `tauri dev` validates this and errors silently in a watch loop. |
| Using `pnpm --filter @aurowork/app dev` on Windows | Script is `AUROWORK_DEV_MODE=1 vite` (unix syntax). Set env via cmd, call `pnpm exec vite`. |
| Trusting `prepare-sidecar.mjs --force` output | On Node 25 + Windows it can exit 1 with zero output. Build sidecars manually as in step 3. |
| Running cargo without VsDevCmd | Linker errors on `webview2-com`, `tauri`, etc. Always inject MSVC env first. |
| Using `tauri dev` after sidecars are staged | Still hits the `versions.json-...exe` resource bug. Use `cargo build` + run exe. |

## Red Flags - STOP and Use This Flow

- `'corepack' is not recognized` → don't install corepack, use this flow
- `prepare-sidecar.mjs` exits 1 silently → manual sidecar build
- `resource path sidecars\versions.json-...exe doesn't exist` → write the empty file
- `'AUROWORK_DEV_MODE' is not recognized as an internal or external command` → wrap pnpm call in a `.cmd` that does `set` first

## What Success Looks Like

```
$ tasklist | findstr AuroWork
AuroWork-Dev.exe              4944  ...
$ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/
200
```

App window opens with title "AuroWork - Dev", connects to vite, sidecars (auro/server/orchestrator) are spawned by the Rust process and visible in tasklist.
