# AuroWork Backend Implementation Details for Feature Isolation

## Project Root
`/Users/yangxiao/Documents/github repos/Agent/aurowork`

---

## 1. WORKSPACE COMMANDS (Tauri)
**File:** `/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri/src/commands/workspace.rs`

### workspace_create_remote (Lines 288-406)
```rust
#[tauri::command]
pub fn workspace_create_remote(
    app: tauri::AppHandle,
    base_url: String,
    directory: Option<String>,
    display_name: Option<String>,
    remote_type: Option<RemoteType>,
    aurowork_host_url: Option<String>,
    aurowork_token: Option<String>,
    aurowork_client_token: Option<String>,
    aurowork_host_token: Option<String>,
    aurowork_workspace_id: Option<String>,
    aurowork_workspace_name: Option<String>,
    sandbox_backend: Option<String>,
    sandbox_run_id: Option<String>,
    sandbox_container_name: Option<String>,
    watch_state: State<WorkspaceWatchState>,
) -> Result<WorkspaceList, String>
```
**Purpose:** Creates a new remote workspace configuration
**Key Logic:**
- Validates baseUrl (must start with http:// or https://)
- For Aurowork remote type: validates auroworkHostUrl is required
- Uses `stable_workspace_id_for_aurowork()` or `stable_workspace_id_for_remote()` to generate ID
- Creates WorkspaceInfo struct with all remote connection details
- Persists to workspace state via `save_workspace_state()`
- Returns updated `WorkspaceList`

**Remote Type Fields Stored:**
- `base_url` (required)
- `remote_type` (default: RemoteType::Aurowork or other)
- `aurowork_host_url` (validated for Aurowork)
- `aurowork_token`, `aurowork_client_token`, `aurowork_host_token`
- `aurowork_workspace_id`, `aurowork_workspace_name`
- `sandbox_backend`, `sandbox_run_id`, `sandbox_container_name`

---

### workspace_update_remote (Lines 409-542)
```rust
#[tauri::command]
pub fn workspace_update_remote(
    app: tauri::AppHandle,
    workspace_id: String,
    base_url: Option<String>,
    directory: Option<String>,
    display_name: Option<String>,
    remote_type: Option<RemoteType>,
    aurowork_host_url: Option<String>,
    aurowork_token: Option<String>,
    aurowork_client_token: Option<String>,
    aurowork_host_token: Option<String>,
    aurowork_workspace_id: Option<String>,
    aurowork_workspace_name: Option<String>,
    sandbox_backend: Option<String>,
    sandbox_run_id: Option<String>,
    sandbox_container_name: Option<String>,
) -> Result<WorkspaceList, String>
```
**Purpose:** Updates existing remote workspace configuration
**Key Logic:**
- Validates workspace_id exists and is Remote type
- Validates baseUrl format if provided (http:// or https://)
- Validates auroworkHostUrl format if provided
- Updates individual fields conditionally (only if provided)
- Updates both workspace name and display_name appropriately
- Persists changes to workspace state
- Returns updated `WorkspaceList`

**Field Update Strategy:**
- Optional parameters only update if provided
- Empty strings after trimming are treated as "no update"
- Maintains existing values for unprovided fields

---

### workspace_export_config (Lines 746-837)
```rust
#[tauri::command]
pub fn workspace_export_config(
    app: tauri::AppHandle,
    workspace_id: String,
    output_path: String,
) -> Result<WorkspaceExportSummary, String>
```
**Purpose:** Exports workspace config as ZIP archive
**Key Logic:**
- Validates workspace_id exists
- Only works for Local workspaces (not Remote)
- Collects workspace entries from:
  - `opencode.json` (root level)
  - `.opencode/` directory (recursively)
- Excludes secret files via `should_exclude()` and `is_secret_name()`
- Creates ZIP with manifest.json containing:
  - version: 1
  - createdAtMs (timestamp)
  - workspace metadata (id, name, path)
  - included: list of included files
  - excluded: list of excluded files

**Excluded Files:**
- `.env*`
- `credentials.json`, `credentials.yml`, `credentials.yaml`
- Files ending with `.key`, `.pem`, `.p12`, `.pfx`

---

### workspace_import_config (Lines 840-1000)
```rust
#[tauri::command]
pub fn workspace_import_config(
    app: tauri::AppHandle,
    archive_path: String,
    target_dir: String,
    name: Option<String>,
    watch_state: State<WorkspaceWatchState>,
) -> Result<WorkspaceList, String>
```
**Purpose:** Imports workspace config from ZIP archive
**Key Logic:**
- Validates archive_path and target_dir are provided
- Validates target_dir is empty before import
- Creates target directory
- Extracts ZIP (skips manifest.json)
- Security checks:
  - Prevents directory traversal (ParentDir, RootDir, Prefix components)
  - Only extracts `opencode.json` and `.opencode/` paths
  - Skips secret files
- Reads and updates `.opencode/aurowork.json` with:
  - authorized_roots: set to [target_dir]
  - Preserves workspace config and preset info
- Creates aurowork.json if missing
- Creates WorkspaceInfo as Local type
- Persists new workspace to state
- Returns updated `WorkspaceList`

---

## 2. AUROWORK SERVER MODULE (Rust)
**Files:** 
- `/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri/src/aurowork_server/mod.rs`
- `/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri/src/aurowork_server/manager.rs`
- `/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri/src/aurowork_server/spawn.rs`

### Module Structure (mod.rs, Lines 1-476)

**Constants:**
```rust
const AUROWORK_SERVER_TOKEN_STORE_VERSION: u32 = 1;
const AUROWORK_SERVER_STATE_VERSION: u32 = 3;
const LEGACY_FIXED_AUROWORK_PORT: u16 = 8787;
```

**Persisted Data Structures:**
```rust
struct PersistedAuroworkServerTokens {
    client_token: String,
    host_token: String,
    owner_token: Option<String>,
    updated_at: u64,
}

struct PersistedAuroworkServerTokenStore {
    version: u32,
    workspaces: HashMap<String, PersistedAuroworkServerTokens>,
}

struct PersistedAuroworkServerState {
    version: u32,
    workspace_ports: HashMap<String, u16>,
    preferred_port: Option<u16>,
}
```

**Token Generation (Line 25):**
```rust
fn generate_token() -> String {
    Uuid::new_v4().to_string()
}
```
Generates UUIDs for `client_token` and `host_token`

**Token Storage Paths:**
```rust
fn aurowork_server_token_store_path(app: &AppHandle) -> Result<PathBuf, String>
  → {app_data_dir}/aurowork-server-tokens.json

fn aurowork_server_state_path(app: &AppHandle) -> Result<PathBuf, String>
  → {app_data_dir}/aurowork-server-state.json
```

**Load/Save Functions:**
```rust
fn load_aurowork_server_token_store(path: &Path) -> Result<PersistedAuroworkServerTokenStore, String>
fn save_aurowork_server_token_store(path: &Path, store: &PersistedAuroworkServerTokenStore) -> Result<(), String>
fn load_aurowork_server_state(path: &Path) -> Result<PersistedAuroworkServerState, String>
fn save_aurowork_server_state(path: &Path, state: &PersistedAuroworkServerState) -> Result<(), String>
```

**Token Management (Lines 195-246):**
```rust
fn load_or_create_workspace_tokens(
    app: &AppHandle,
    workspace_key: &str,
) -> Result<PersistedAuroworkServerTokens, String>
```
- Loads existing tokens from token store
- Creates new client_token and host_token if workspace not found
- Returns PersistedAuroworkServerTokens with both tokens

```rust
fn persist_workspace_owner_token(
    app: &AppHandle,
    workspace_key: &str,
    owner_token: &str,
) -> Result<(), String>
```
- Stores owner_token for workspace after server becomes healthy

**Port Management (Lines 143-193):**
```rust
fn read_preferred_aurowork_port(app: &AppHandle, workspace_key: &str) -> Result<Option<u16>, String>
fn reserved_aurowork_ports(app: &AppHandle, exclude_workspace_key: &str) -> Result<HashSet<u16>, String>
fn persist_preferred_aurowork_port(app: &AppHandle, workspace_key: &str, port: u16) -> Result<(), String>
```

**Health & Owner Token Issuance (Lines 248-287):**
```rust
fn wait_for_aurowork_health(base_url: &str, timeout: Duration) -> Result<(), String>
```
- Polls `/health` endpoint every 200ms
- Timeout: 10 seconds
- Returns Ok on 2xx response

```rust
fn issue_owner_token(base_url: &str, host_token: &str) -> Result<String, String>
```
- POST to `{base_url}/tokens`
- Header: `X-AuroWork-Host-Token: {host_token}`
- Body: `{"scope":"owner","label":"AuroWork desktop owner token"}`
- Parses response JSON to extract "token" field

**URL Building (Lines 289-302):**
```rust
fn build_urls(port: u16) -> (Option<String>, Option<String>, Option<String>)
```
Returns tuple of:
1. `connect_url` (LAN or mDNS, whichever available)
2. `mdns_url` (from hostname.local)
3. `lan_url` (from local IP address)

**Server Start Function (Lines 304-429):**
```rust
pub fn start_aurowork_server(
    app: &AppHandle,
    manager: &AuroworkServerManager,
    workspace_paths: &[String],
    opencode_base_url: Option<&str>,
    opencode_username: Option<&str>,
    opencode_password: Option<&str>,
    remote_access_enabled: bool,
) -> Result<AuroworkServerInfo, String>
```

**Server Startup Process:**
1. Stops any existing server via manager
2. Determines host (0.0.0.0 if remote_access_enabled, else 127.0.0.1)
3. Loads or creates workspace tokens
4. Resolves available port (prefers previous port, falls back to range 48000-51000)
5. Spawns aurowork-server process via `spawn_aurowork_server()`
6. Waits for health check (10 second timeout)
7. Issues owner token if not already cached
8. Builds connection URLs (mDNS, LAN)
9. Persists preferred port
10. Spawns async task to monitor server output (stdout/stderr)
11. Returns `AuroworkServerInfo` with all connection details

---

### Manager (manager.rs)

**AuroworkServerManager Structure:**
```rust
pub struct AuroworkServerManager {
    pub inner: Arc<Mutex<AuroworkServerState>>,
}

pub struct AuroworkServerState {
    pub child: Option<CommandChild>,
    pub child_exited: bool,
    pub remote_access_enabled: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub base_url: Option<String>,
    pub connect_url: Option<String>,
    pub mdns_url: Option<String>,
    pub lan_url: Option<String>,
    pub client_token: Option<String>,
    pub owner_token: Option<String>,
    pub host_token: Option<String>,
    pub last_stdout: Option<String>,
    pub last_stderr: Option<String>,
}
```

**Methods:**
```rust
impl AuroworkServerManager {
    pub fn snapshot_locked(state: &mut AuroworkServerState) -> AuroworkServerInfo
```
- Converts internal state to public `AuroworkServerInfo` DTO
- Checks if child process exited and clears if so

```rust
    pub fn stop_locked(state: &mut AuroworkServerState)
```
- Kills child process
- Clears all connection info and tokens
- Marks child_exited = true

---

### Spawn (spawn.rs)

**Port Resolution (Lines 30-66):**
```rust
pub fn resolve_aurowork_port(
    host: &str,
    preferred_port: Option<u16>,
    reserved_ports: &HashSet<u16>,
) -> Result<u16, String>
```

**Port Resolution Strategy:**
1. Use preferred_port if available and not reserved
2. Try random offsets in range 48000-51000
3. Fall back to ephemeral port allocation (bind to port 0)
4. Max 32 attempts for ephemeral ports

**Server Arguments Builder (Lines 115-166):**
```rust
pub fn build_aurowork_args(
    host: &str,
    port: u16,
    workspace_paths: &[String],
    token: &str,
    host_token: &str,
    opencode_base_url: Option<&str>,
    opencode_directory: Option<&str>,
) -> Vec<String>
```

**Generated Arguments:**
```
--host <host>
--port <port>
--token <token> (client token)
--host-token <host_token>
--cors * (always allow all origins)
--approval auto (auto-approve writes)
--workspace <path> (for each workspace)
--opencode-base-url <url> (if provided)
--opencode-directory <dir> (if provided)
```

**Server Spawn Function (Lines 168-219):**
```rust
pub fn spawn_aurowork_server(
    app: &AppHandle,
    host: &str,
    port: u16,
    workspace_paths: &[String],
    token: &str,
    host_token: &str,
    opencode_base_url: Option<&str>,
    opencode_directory: Option<&str>,
    opencode_username: Option<&str>,
    opencode_password: Option<&str>,
) -> Result<(Receiver<CommandEvent>, CommandChild), String>
```

**Spawning Process:**
1. Resolves aurowork-server binary (sidecar or command)
2. Builds argument list
3. Sets CWD to first workspace path
4. Sets environment variables:
   - `AUROWORK_OPENCODE_USERNAME`
   - `AUROWORK_OPENCODE_PASSWORD`
   - `bun_env` overrides
5. Spawns command with event stream
6. Returns (async receiver, child process)

---

## 3. AUROWORK SERVER COMMANDS (Tauri)
**File:** `/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/desktop/src-tauri/src/commands/aurowork_server.rs`

### aurowork_server_info (Lines 10-16)
```rust
#[tauri::command]
pub fn aurowork_server_info(manager: State<AuroworkServerManager>) -> AuroworkServerInfo
```
**Purpose:** Gets current server info
**Returns:** Current snapshot of AuroworkServerInfo from manager state

---

### aurowork_server_restart (Lines 19-69)
```rust
#[tauri::command]
pub fn aurowork_server_restart(
    app: AppHandle,
    manager: State<AuroworkServerManager>,
    engine_manager: State<EngineManager>,
    remote_access_enabled: Option<bool>,
) -> Result<AuroworkServerInfo, String>
```

**Purpose:** Restarts aurowork-server with current workspace configuration
**Workspace Path Collection:**
1. From engine project_dir (if set)
2. From all local workspaces in workspace state
3. Only includes non-empty paths

**Calls:** `start_aurowork_server()` with collected paths

---

## 4. TOKEN SERVICE (TypeScript/Node.js)
**File:** `/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/server/src/tokens.ts`

### Types
```typescript
type TokenScope = "owner" | "collaborator" | "viewer"

type TokenRecord = {
  id: string;
  hash: string;
  scope: TokenScope;
  createdAt: number;
  label?: string;
}

type TokenStoreFile = {
  schemaVersion: number;
  updatedAt: number;
  tokens: TokenRecord[];
}
```

### Token Storage Location
```typescript
resolveTokenStorePath(config: ServerConfig): string
```
Priority:
1. `AUROWORK_TOKEN_STORE` env var (if set)
2. `{config.configPath}/../tokens.json`
3. `{homedir}/.config/aurowork/tokens.json`

### TokenService Class (Lines 84-149)

**Constructor:**
```typescript
constructor(config: ServerConfig)
```
Initializes service and determines token store path

**Key Methods:**

```typescript
async list(): Promise<Array<Omit<TokenRecord, "hash">>>
```
Returns all tokens (hash excluded)

```typescript
async create(scope: TokenScope, options?: { label?: string }): Promise<{ id, token, scope, createdAt, label }>
```
- Generates token: `owt_{shortId}` (no dashes)
- Hashes token with SHA256
- Stores TokenRecord with metadata
- Returns public token and metadata (hash never returned)

```typescript
async revoke(id: string): Promise<boolean>
```
- Removes token by ID from store
- Returns true if found and removed

```typescript
async scopeForToken(token: string): Promise<TokenScope | null>
```
- Validates token against stored tokens
- Special case: if token === config.token → return "collaborator"
- Otherwise looks up hash in token store
- Returns scope or null if invalid

**Token Format:**
- Client tokens: `owt_{16-char-id}` (UUID v4 with dashes removed)
- Hashed with SHA256 before storage
- Only hash stored, never the actual token

**Schema Version:** 1 (schemaVersion: 1)

---

## 5. SERVER AUTH MIDDLEWARE (TypeScript/Node.js)
**File:** `/Users/yangxiao/Documents/github repos/Agent/aurowork/apps/server/src/server.ts`

### requireClient (Lines 659-672)
```typescript
async function requireClient(
    request: Request, 
    config: ServerConfig, 
    tokens: TokenService
): Promise<Actor>
```

**Authentication Flow:**
1. Extracts Bearer token from Authorization header
2. Validates token format with regex: `/^Bearer\s+(.+)$/i`
3. Gets token scope via `tokens.scopeForToken(token)`
4. Throws 401 if no token or invalid scope

**Returns Actor:**
```typescript
{
  type: "remote",
  clientId: string | undefined,  // from X-AuroWork-Client-Id header
  tokenHash: string,              // SHA256(token)
  scope: TokenScope              // "owner" | "collaborator" | "viewer"
}
```

---

### requireHost (Lines 674-692)
```typescript
async function requireHost(
    request: Request, 
    config: ServerConfig, 
    tokens: TokenService
): Promise<Actor>
```

**Authentication Flow (Two Paths):**

**Path 1: X-AuroWork-Host-Token Header**
- Matches against `config.hostToken`
- If match → returns Actor with type: "host", scope: "owner"

**Path 2: Bearer Token (Authorization Header)**
- Extracts Bearer token
- Validates token scope is "owner" only
- Throws 401 if not "owner" scope

**Returns Actor:**
```typescript
{
  type: "host" | "remote",
  clientId: string | undefined,     // from X-AuroWork-Client-Id header
  tokenHash: string,                // SHA256(token)
  scope: "owner"                    // only "owner" allowed
}
```

---

## 6. TYPE DEFINITIONS

### RemoteType (from types.rs)
```rust
enum RemoteType {
    Aurowork,
    // other variants...
}
```

### WorkspaceType (from types.rs)
```rust
enum WorkspaceType {
    Local,
    Remote,
}
```

### WorkspaceInfo (from types.rs)
Stores all workspace metadata including:
- `id`: String
- `name`: String
- `path`: String
- `workspace_type`: WorkspaceType
- `remote_type`: Option<RemoteType>
- `base_url`: Option<String>
- `aurowork_host_url`: Option<String>
- `aurowork_token`: Option<String>
- `aurowork_client_token`: Option<String>
- `aurowork_host_token`: Option<String>
- `aurowork_workspace_id`: Option<String>
- `aurowork_workspace_name`: Option<String>
- `sandbox_backend`: Option<String>
- `sandbox_run_id`: Option<String>
- `sandbox_container_name`: Option<String>

### AuroworkServerInfo
DTO returned by server commands with:
- `running`: bool
- `remote_access_enabled`: bool
- `host`: Option<String> (0.0.0.0 or 127.0.0.1)
- `port`: Option<u16>
- `base_url`: Option<String> (always http://127.0.0.1:{port})
- `connect_url`: Option<String> (mDNS or LAN if remote enabled)
- `mdns_url`: Option<String>
- `lan_url`: Option<String>
- `client_token`: Option<String>
- `owner_token`: Option<String>
- `host_token`: Option<String>
- `pid`: Option<u32>
- `last_stdout`: Option<String> (truncated to 8KB)
- `last_stderr`: Option<String> (truncated to 8KB)

---

## 7. KEY ISOLATION POINTS

### Workspace Configuration
- **Isolated:** Remote workspace credentials (aurowork_token, aurowork_client_token, aurowork_host_token)
- **Isolated:** Remote workspace IDs and names
- **Isolated:** Sandbox configuration per workspace

### Server Tokens
- **Isolated:** Per-workspace tokens stored in persistent token store
- **Isolated:** Client token, host token, owner token stored per workspace
- **Isolated:** Token generation and validation logic

### Server Lifecycle
- **Isolated:** Port allocation per workspace
- **Isolated:** Server process management (start, stop)
- **Isolated:** Process output (stdout/stderr) captured separately

### Authentication
- **Isolated:** Token scopes (owner, collaborator, viewer)
- **Isolated:** Bearer token validation
- **Isolated:** Host token validation separate from client tokens

---

## 8. FILE PATHS & STORAGE

### Desktop App (Tauri)
- Token Store: `{app_data_dir}/aurowork-server-tokens.json`
- Server State: `{app_data_dir}/aurowork-server-state.json`
- Workspace State: `{app_data_dir}/workspace-state.json` (assumed)

### AuroWork Server (Node.js)
- Token Store: `$AUROWORK_TOKEN_STORE` or `~/.config/aurowork/tokens.json`

### Workspace Config
- Export Format: ZIP with manifest.json
- Config Directory: `.opencode/aurowork.json`
- Main Config: `opencode.json` (root)

---

