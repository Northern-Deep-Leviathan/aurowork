# AuroWork Project Plan

> Owner: yangxiao
> Last updated: 2026-03-29
> Status: Draft

---

## 1. Feature Isolation — Prepare for Cloud-Native Auth

The following features currently work in a local/manual mode. They will be **isolated from the active UI** (hidden, not deleted) and later re-implemented as cloud-managed features integrated with a unified auth system.

### 1.A Connect Remote Workspace

**What it does now**: User manually enters an AuroWork Server URL + bearer token to connect to a remote workspace hosted on another machine.

**Why isolate**: The manual token copy-paste flow will be replaced by cloud-authenticated workspace discovery (login → see your workspaces → one-click connect).

#### Current Implementation Reference

**Frontend — UI**:
| File | What | Lines |
|------|------|-------|
| `apps/app/src/app/components/create-remote-workspace-modal.tsx` | Modal form: Host URL, Token, Directory, Display Name fields | full (219 lines) |
| `apps/app/src/app/components/sidebar.tsx` | "Connect remote" menu option in Add Workspace dropdown | 575-585 |

**Frontend — Logic**:
| File | Function | Lines | What it does |
|------|----------|-------|--------------|
| `apps/app/src/app/context/workspace.ts` | `createRemoteWorkspaceFlow()` | 2092-2191 | Validates URL → calls `resolveAuroworkHost()` → connects to remote OpenCode → registers workspace locally |
| `apps/app/src/app/context/workspace.ts` | `resolveAuroworkHost()` | 626-727 | Probes the remote server: health check → list workspaces → resolve OpenCode URL + auth. Returns `{ kind: "aurowork", hostUrl, workspace, opencodeBaseUrl, directory, auth }` or `{ kind: "fallback" }` |
| `apps/app/src/app/lib/aurowork-server.ts` | `AuroworkServerClient` class | ~972+ | HTTP client SDK for AuroWork Server. Methods: `health()`, `listWorkspaces()`, `getWorkspace()`, `getConfig()`. Uses bearer token auth. |
| `apps/app/src/app/context/workspace.ts` | `activateWorkspace()` remote path | 989-1211 | Handles remote workspace activation: resolves AuroWork host, connects to OpenCode, updates workspace entry |

**Backend — Tauri (Rust)**:
| File | Command | Lines | What it does |
|------|---------|-------|--------------|
| `apps/desktop/src-tauri/src/commands/workspace.rs` | `workspace_create_remote` | 288-406 | Creates a new remote workspace entry. Generates stable ID from `aurowork://{hostUrl}::{workspaceId}`. Saves to `aurowork-workspaces.json`. |
| `apps/desktop/src-tauri/src/commands/workspace.rs` | `workspace_update_remote` | 409-542 | Updates an existing remote workspace entry (URL, token, directory, display name, etc.) |

**Data structures**:
```typescript
// Remote workspace entry in aurowork-workspaces.json
{
  id: "ws_<sha256_12chars>",       // stable hash of "aurowork::{hostUrl}::{workspaceId}"
  name: string,
  path: "",                         // empty for remote
  workspaceType: "remote",
  remoteType: "aurowork" | "opencode",  // "opencode" is legacy
  baseUrl: string,                  // resolved OpenCode URL
  directory: string | null,
  auroworkHostUrl: string,          // the server URL user entered
  auroworkToken: string | null,     // bearer token
  auroworkWorkspaceId: string | null,
  auroworkWorkspaceName: string | null,
}
```

**Auth flow**: Bearer token in `Authorization` header → server validates via SHA-256 hash comparison → returns scope (`owner` / `collaborator` / `viewer`).

---

### 1.B Import / Export Config

**What it does now**: Export a workspace's AI configuration (agents, skills, commands, opencode.json) as a `.aurowork-workspace` ZIP file. Import it into another machine/folder to replicate the setup.

**Why isolate**: Will become cloud-managed — workspace configs stored/shared through cloud, tied to user accounts. Import/export becomes "sync from cloud" / "publish config template".

#### Current Implementation Reference

**Frontend — UI**:
| File | What | Lines |
|------|------|-------|
| `apps/app/src/app/components/sidebar.tsx` | "Import config" menu option in Add Workspace dropdown | 586-597 |
| `apps/app/src/app/components/share-workspace-modal.tsx` | Export button (inside share modal's menu) | within modal |

**Frontend — Logic**:
| File | Function | Lines | What it does |
|------|----------|-------|--------------|
| `apps/app/src/app/context/workspace.ts` | `exportWorkspaceConfig()` | 2804-2860 | Calls Tauri `workspace_export_config` → gets back `{ outputPath, included, excluded }`. Only works for local workspaces. |
| `apps/app/src/app/context/workspace.ts` | `importWorkspaceConfig()` | 2862-2916 | Opens file picker (`.aurowork-workspace` / `.zip`) → opens folder picker (destination) → calls Tauri `workspace_import_config` → registers + activates new workspace. |

**Backend — Tauri (Rust)**:
| File | Command | Lines | What it does |
|------|---------|-------|--------------|
| `apps/desktop/src-tauri/src/commands/workspace.rs` | `workspace_export_config` | 746-837 | Collects `opencode.json` / `opencode.jsonc` + `.opencode/` dir → creates ZIP. **Excludes**: `.env`, `credentials.json`, `*.key`, `*.pem`, `*.p12`, `*.pfx`. Output filename: `aurowork-{name}-{YYYY-MM-DD}.aurowork-workspace`. |
| `apps/desktop/src-tauri/src/commands/workspace.rs` | `workspace_import_config` | 840-1000 | Validates ZIP → security checks (path traversal, requires empty target `.opencode/`) → extracts to target dir → registers as new workspace. |

**What gets packaged**:
```
.aurowork-workspace (ZIP)
├── opencode.json / opencode.jsonc     ← main config
└── .opencode/
    ├── agents/                        ← custom agent definitions
    ├── skills/                        ← custom skill scripts
    ├── commands/                      ← custom commands
    └── aurowork.json                  ← workspace behavior config
```

**Security filters in export**: `.env`, `credentials.json`, private keys (`*.key`, `*.pem`, `*.p12`, `*.pfx`) are automatically excluded. Import validates against directory traversal attacks and requires the target `.opencode/` to not already exist.

---

### 1.C Share Workspace (Remote Access)

**What it does now**: Enables remote access on a local workspace by binding the AuroWork Server to `0.0.0.0` (instead of `127.0.0.1`), generating tokens, and displaying connection credentials (URL + token) for remote clients to copy.

**Why isolate**: Will be replaced by cloud-mediated sharing — user shares workspace through cloud dashboard, invitees connect via authenticated cloud flow (not raw URL + token).

#### Current Implementation Reference

**Frontend — UI**:
| File | What | Lines |
|------|------|-------|
| `apps/app/src/app/components/share-workspace-modal.tsx` | Full share modal: remote access toggle, credential display, messaging integration | full (634 lines) |

The modal contains:
- **Remote access toggle** (off by default) with Save button
- After enabling: displays Host URL, Access Token (client_token), optional Owner Token
- **Connection fields** shown as copyable cards with show/hide for secrets
- **Messaging integration** section (Slack/Telegram setup)

**Frontend — Logic**:
| File | Function | What it does |
|------|----------|--------------|
| `apps/app/src/app/lib/aurowork-server.ts` | `AuroworkServerClient` | Client SDK used to communicate with local AuroWork Server |
| `apps/app/src/app/lib/aurowork-server.ts` | Settings persistence | localStorage keys: `aurowork.server.urlOverride`, `aurowork.server.token`, `aurowork.server.remoteAccessEnabled` |
| `apps/app/src/app/context/workspace.ts` | `startHost()` | Passes `auroworkRemoteAccess` flag to `engineStart()` |

**Backend — Tauri (Rust)**:
| File | Function/Area | Lines | What it does |
|------|---------------|-------|--------------|
| `apps/desktop/src-tauri/src/aurowork_server/mod.rs` | `start_aurowork_server()` | 304-429 | Full startup: resolve tokens → find port (48000-51000) → spawn binary → wait for health → issue owner token via POST `/tokens` |
| `apps/desktop/src-tauri/src/aurowork_server/mod.rs` | Token generation | 195-287 | Per-workspace token storage in `aurowork-server-tokens.json`. Generates UUID `client_token` and `host_token`. |
| `apps/desktop/src-tauri/src/aurowork_server/mod.rs` | `issue_owner_token()` | 270-287 | POST to `/tokens` endpoint to create `owt_<random>` owner token |
| `apps/desktop/src-tauri/src/aurowork_server/manager.rs` | `AuroworkServerManager` | full (77 lines) | State: `child`, `child_exited`, `last_stdout/stderr`, `host`, `port`, `remote_access`, tokens. Snapshot method for `aurowork_server_info` command. |
| `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` | `resolve_aurowork_server_port()` | full | Port resolution: tries persisted port → scans 48000-51000 → falls back to ephemeral |
| `apps/desktop/src-tauri/src/commands/aurowork_server.rs` | `aurowork_server_info` | 9-16 | Returns `AuroworkServerInfo` snapshot to frontend |
| `apps/desktop/src-tauri/src/commands/aurowork_server.rs` | `aurowork_server_restart` | 19-78 | Restarts server with workspace paths, remote access setting, and OpenCode connection |

**Backend — AuroWork Server (TypeScript)**:
| File | What | Key details |
|------|------|-------------|
| `apps/server/src/tokens.ts` | `TokenService` class | CRUD for tokens. Scopes: `owner`, `collaborator`, `viewer`. Storage: JSON file per workspace. SHA-256 hash-based validation. |
| `apps/server/src/server.ts` | `requireClient()` middleware | Extracts `Bearer` token from `Authorization` header → hash → lookup in token store → attaches scope to request |
| `apps/server/src/server.ts` | `requireHost()` middleware | Two paths: custom `X-Host-Token` header (internal) OR standard `Bearer` token with owner scope |

**Token hierarchy**:
```
owner_token (owt_<random>)      → full control (manage workspace, tokens, settings)
  ↳ client_token (UUID)         → tool access (run tasks, read files — "collaborator" scope)
    ↳ host_token (UUID)         → internal use only (desktop ↔ local server)
```

**Remote access toggle effect**:
- OFF: Server binds to `127.0.0.1` → only local access
- ON: Server binds to `0.0.0.0` → exposes `lanUrl`, `mdnsUrl`, `connectUrl` for remote clients

**Persistent storage**:
- `{app_data_dir}/aurowork-server-tokens.json` — per-workspace tokens with version field
- `{app_data_dir}/aurowork-server-state.json` — persisted port per workspace

---

## 2. Future: Unified Cloud Auth

### Vision

All three isolated features converge into a single cloud-authenticated system:

```
┌─────────────────────────────────────────────────────┐
│                  AuroWork Cloud                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ User Auth │  │  Workspace   │  │ Config Store  │ │
│  │ (account) │  │  Registry    │  │ (templates)   │ │
│  └─────┬─────┘  └──────┬───────┘  └──────┬────────┘ │
└────────┼───────────────┼────────────────┼───────────┘
         │               │                │
    ┌────▼────┐    ┌─────▼─────┐    ┌────▼─────┐
    │  Login  │    │  Connect  │    │  Sync    │
    │  once   │    │  remote   │    │  config  │
    └─────────┘    └───────────┘    └──────────┘
    (replaces       (replaces        (replaces
     manual token)   connect remote)  import/export)
```

| Current Feature | Cloud Replacement |
|----------------|-------------------|
| Connect Remote (manual URL + token) | Login → workspace list → one-click connect |
| Import/Export Config (ZIP file) | Cloud config store → sync / publish templates |
| Share Workspace (raw token display) | Cloud-mediated sharing → invite by email / link |

### Tasks

#### Phase 1: Auth Foundation

- [ ] **1.1** Define auth provider strategy
  - Decision: self-hosted auth (e.g. Supabase/Auth.js) vs cloud-only vs hybrid
  - Consider: local-first desktop app needs offline-capable auth
  - Deliverable: ADR in `ARCHITECTURE.md`

- [ ] **1.2** Design unified token model
  - Merge the three separate token layers into a coherent hierarchy
  - Define token scopes: `owner`, `collaborator`, `viewer` (already partially exists)
  - Add token TTL, rotation, and revocation
  - Deliverable: Token schema design doc

- [ ] **1.3** Add user identity to AuroWork Server
  - Currently workspace-centric (no user concept)
  - Add user registration/login endpoints to `apps/server/`
  - Store user ↔ workspace mappings
  - Deliverable: Server API changes

#### Phase 2: Cloud Workspace Management

- [ ] **2.1** Cloud workspace registry
  - Register/discover workspaces through cloud account
  - Replace manual URL + token entry

- [ ] **2.2** Cloud config store
  - Upload/download workspace configs (replaces ZIP import/export)
  - Version control for configs
  - Shareable config templates

- [ ] **2.3** Cloud-mediated sharing
  - Invite collaborators by email/link
  - Manage access through cloud dashboard
  - Replace raw token display

#### Phase 3: Re-enable Features

- [ ] **3.1** Re-implement Connect Remote with cloud auth
- [ ] **3.2** Re-implement config sharing as cloud sync
- [ ] **3.3** Re-implement workspace sharing with cloud access control

---

## 3. Dead Feature Cleanup

Features that are non-functional or vestigial — clean removal:

- [ ] **3.A** Sandbox/Docker features
  - `sandboxDoctor` returns stub: `"Sandbox feature has been removed."`
  - Clean up sandbox-related UI, types, and backend code

- [ ] **3.B** Legacy remote type `"opencode"`
  - `remoteType: "opencode"` (direct OpenCode connection without AuroWork Server) — assess if still used anywhere

- [ ] **3.C** Review onboarding paths
  - "Host vs Client" initial choice — still relevant or should default to local?
  - `startupPreference` persistence — behavior after clearing app data

---

## 4. Open Questions

1. **Is there an AuroWork cloud service already?** PRODUCT.md references "AuroWork cloud control surface" — is this implemented or planned?
2. **What auth provider to use?** Self-hosted (Supabase, Clerk, Auth.js) vs custom vs cloud-only?
3. **Should local-only users need an account?** Or is auth only required for remote/cloud features?
4. **Token backward compatibility** — existing users with manually-configured tokens: migration path?
5. **Mobile app** — PRODUCT.md mentions mobile-first. Does the auth system need to support mobile clients?

---

## 5. Feedback System Redesign

> **Status**: UI hidden (2026-03-29) — pending redesign

### Current State

Feedback UI has been **temporarily hidden** from the interface. The existing code is preserved in place (wrapped in comments), ready to be restored or replaced.

#### What was hidden

| Location | Element | Description |
|----------|---------|-------------|
| `apps/app/src/app/components/status-bar.tsx` | Feedback button | Bottom status bar "Feedback" button with MessageCircle icon (dashboard + session pages) |
| `apps/app/src/app/pages/settings.tsx` | Feedback card | Settings → General tab: "Help shape AuroWork" card with Send feedback / Join Discord / Report issue buttons |

#### Code still present but unused

| File | What |
|------|------|
| `apps/app/src/app/lib/feedback.ts` | `buildFeedbackUrl()` utility — constructs feedback URLs with OS context, app version, entrypoints |
| `apps/app/src/app/pages/dashboard.tsx` (lines 429-444) | `openFeedback()` function with entrypoint `"dashboard-status-bar"` |
| `apps/app/src/app/pages/session.tsx` (lines 474-489) | `openFeedback()` function with entrypoint `"session-status-bar"` |
| `apps/app/src/i18n/locales/en.ts` | Feedback i18n keys: `settings.feedback_badge`, `settings.feedback_title`, `settings.feedback_description`, `settings.feedback_send`, `settings.feedback_discord`, `settings.feedback_bug` |
| `apps/app/src/i18n/locales/zh.ts` | Chinese feedback translations |
| StatusBar props | `onSendFeedback` prop still in interface (not breaking — just unused) |

### Redesign Tasks

- [ ] **5.1** Define new feedback strategy
  - In-app feedback form vs external link vs integrated support widget?
  - Should feedback be tied to cloud user accounts (Phase 2)?
  - Consider: contextual feedback (per-session, per-feature) vs general feedback

- [ ] **5.2** Design new feedback UI
  - Where should feedback entry points live? (status bar, settings, help menu, command palette)
  - Should feedback include automatic diagnostics (versions, OS, session context)?
  - UX for feedback submission confirmation / follow-up

- [ ] **5.3** Implement new feedback system
  - Build new UI components
  - Integrate with feedback backend (cloud service / GitHub / custom)
  - Re-enable feedback entry points

- [ ] **5.4** Clean up legacy feedback code
  - Remove or refactor `buildFeedbackUrl()` if no longer needed
  - Clean up unused `openFeedback()` functions and i18n keys
  - Remove `onSendFeedback` prop from StatusBar if not used

---

## Appendix: Complete File Index

### Files affected by feature isolation

**Frontend Components**:
| File | Feature | Action |
|------|---------|--------|
| `apps/app/src/app/components/create-remote-workspace-modal.tsx` | Connect Remote | Hide |
| `apps/app/src/app/components/share-workspace-modal.tsx` | Share Workspace | Hide |
| `apps/app/src/app/components/sidebar.tsx` (lines 575-597) | "Connect remote" + "Import config" menu items | Hide |

**Frontend Logic**:
| File | Functions | Feature |
|------|-----------|---------|
| `apps/app/src/app/context/workspace.ts` | `createRemoteWorkspaceFlow()` (2092-2191), `resolveAuroworkHost()` (626-727), `importWorkspaceConfig()` (2862-2916), `exportWorkspaceConfig()` (2804-2860) | All three |
| `apps/app/src/app/lib/aurowork-server.ts` | `AuroworkServerClient` class, settings persistence | Connect Remote + Share |

**Backend — Tauri (Rust)**:
| File | Commands | Feature |
|------|----------|---------|
| `apps/desktop/src-tauri/src/commands/workspace.rs` | `workspace_create_remote` (288-406), `workspace_update_remote` (409-542), `workspace_export_config` (746-837), `workspace_import_config` (840-1000) | All three |
| `apps/desktop/src-tauri/src/aurowork_server/mod.rs` | `start_aurowork_server()` (304-429), token gen (195-287) | Share |
| `apps/desktop/src-tauri/src/aurowork_server/manager.rs` | `AuroworkServerManager` | Share |
| `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` | Port resolution | Share |
| `apps/desktop/src-tauri/src/commands/aurowork_server.rs` | `aurowork_server_info`, `aurowork_server_restart` | Share |

**Backend — AuroWork Server (TypeScript)**:
| File | What | Feature |
|------|------|---------|
| `apps/server/src/tokens.ts` | `TokenService` — token CRUD, scopes, hashing | Share + Connect Remote |
| `apps/server/src/server.ts` | `requireClient()`, `requireHost()` auth middleware | Share + Connect Remote |
