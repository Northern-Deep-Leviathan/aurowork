# AuroWork Automation System — Code Reference

> Symbol-based references (not line numbers) so this stays accurate across refactors.
> Last verified against code: 2026-05-07.

## 1. Type Definitions (`apps/server/src/server.ts`)

### `AgentLabSchedule`
```typescript
type AgentLabSchedule =
  | { kind: "interval"; seconds: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number };
```

### `AgentLabAutomation`
```typescript
type AgentLabAutomation = {
  id: string;
  name: string;
  enabled: boolean;
  schedule: AgentLabSchedule;
  prompt: string;
  createdAt: number;
  updatedAt?: number;
  lastRunAt?: number;
  lastRunSessionId?: string;
};
```

### `AgentLabAutomationStore`
```typescript
type AgentLabAutomationStore = {
  schemaVersion: number;
  updatedAt: number;
  items: AgentLabAutomation[];
};
```

## 2. Path Resolution (`apps/server/src/server.ts`)

Resolved relative to the workspace root:

| Purpose | Path |
| --- | --- |
| AgentLab directory | `.opencode/aurowork/agentlab/` |
| Automations file | `.opencode/aurowork/agentlab/automations.json` |
| Logs directory | `.opencode/aurowork/agentlab/logs/` |

## 3. Schedule Constraints (validated by `parseAgentLabSchedule`)

- **interval**: min `60` seconds, max `604800` seconds (7 days)
- **daily**: `hour` 0-23, `minute` 0-59
- **weekly**: `weekday` 1-7, `hour` 0-23, `minute` 0-59

## 4. Read / Write Functions (`apps/server/src/server.ts`)

### `readAgentLabAutomations`
- Reads from `automations.json`
- Returns empty store if file does not exist
- Validates and normalizes all items
- Returns: `AgentLabAutomationStore`

### `writeAgentLabAutomations`
- Writes to `automations.json` with timestamp
- Creates parent directories
- Output formatting: 2-space JSON indent, trailing newline

## 5. API Routes (`apps/server/src/server.ts`)

| Method + Path | Behavior |
| --- | --- |
| `GET    /workspace/:id/agentlab/automations` | List all automations for the workspace |
| `POST   /workspace/:id/agentlab/automations` | Create or update an automation. Requires collaborator scope. Auto-generates ID `agentlab_{shortId}`. Returns `{ items, updatedAt }` with HTTP 201 |
| `DELETE /workspace/:id/agentlab/automations/:automationId` | Delete an automation by ID |
| `POST   /workspace/:id/agentlab/automations/:automationId/run` | Manually trigger. Creates an OpenCode session titled `Automation: {name}`, submits `automation.prompt`, updates `lastRunAt` / `lastRunSessionId` / `updatedAt`. Returns `{ ok, automationId, sessionId, ranAt }` |
| `GET    /workspace/:id/agentlab/automations/logs` | List all `.log` files in the logs directory |
| `GET    /workspace/:id/agentlab/automations/logs/:automationId` | Read a specific log file (`logs/{automationId}.log`) |

## 6. Workspace Initialization (`apps/server/src/workspace-init.ts`)

Plugin requirements per preset:

| Preset | Plugins |
| --- | --- |
| `starter` | `["opencode-scheduler"]` |
| `automation` | `["opencode-scheduler"]` |
| `minimal` | `[]` (no plugins) |

## 7. Toy UI — Automation Management (`apps/server/src/toy-ui.ts`)

The Toy UI exposes an `Automations` tab with a CRUD form. Element IDs:

| ID | Purpose |
| --- | --- |
| `#btn-auto-refresh` | Refresh button |
| `#automations` | List container |
| `#auto-log` | Log viewer |
| `#auto-name` | Name input |
| `#auto-kind` | Schedule kind selector (`interval`/`daily`/`weekly`) |
| `#auto-interval` | Interval input (min 60s) |
| `#auto-hour`, `#auto-minute` | Daily inputs |
| `#auto-weekday`, `#auto-weekly-hour`, `#auto-weekly-minute` | Weekly inputs |
| `#auto-prompt` | Prompt textarea |
| `#btn-auto-save` | Save button |

Key JS functions: `refreshAutomations()`, `saveAutomation()`, manual run (creates session + submits prompt), log viewer (fetches and displays).

## 8. Frontend References

- `apps/app/src/app/app.tsx` — Preset handling for `automation` and `minimal`
- `apps/app/src/app/pages/proto-v1-ux.tsx` — Beta UI for automations:
  - Tab: `automations`
  - Empty-state copy: "Automate work by setting up scheduled tasks"
  - "New automation" button
  - Beta badge

## 9. Orchestrator Role

`apps/orchestrator/src/cli.ts` does **not** schedule or execute automations. It only handles:

- Child process management (OpenCode + AuroWork server)
- Activity heartbeat
- Hot reload watching
- TUI management

Scheduled execution is delegated to the **`opencode-scheduler` plugin** loaded inside OpenCode itself, which reads `automations.json` and triggers prompts on schedule.

## 10. Directory Layout

```
.opencode/aurowork/
├── inbox/                      (file uploads)
├── outbox/                     (file downloads)
└── agentlab/
    ├── automations.json        (automation store)
    └── logs/
        └── {automationId}.log  (per-automation logs)
```

## 11. OpenCode Version Pin

```json
{ "opencodeVersion": "v1.2.27" }
```

(`constants.json` at repo root.)

## 12. Execution Flow

1. **Creation** — User creates automation via Toy UI → API persists entry in `automations.json`.
2. **Manual trigger** — User clicks "Run" → API creates OpenCode session → submits prompt.
3. **Scheduled execution** — `opencode-scheduler` plugin reads `automations.json` → executes per schedule.
4. **Logging** — Execution results written to `.../agentlab/logs/{id}.log`.

## Key Takeaways

- Type-safe automation definitions with three schedule kinds.
- Full CRUD API backed by JSON file storage.
- Manual trigger via session creation.
- Scheduled execution delegated to the `opencode-scheduler` plugin.
- Complete Toy UI for management.
- Beta frontend UI in `proto-v1-ux.tsx`.
- Preset-based plugin installation.
