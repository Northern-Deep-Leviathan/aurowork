# AuroWork Automation System - Detailed Code Reference

## 1. Type Definitions (apps/server/src/server.ts, Lines 216-237)

### AgentLabSchedule Type (Lines 216-219)
```typescript
type AgentLabSchedule =
  | { kind: "interval"; seconds: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number };
```

### AgentLabAutomation Type (Lines 221-231)
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

### AgentLabAutomationStore Type (Lines 233-237)
```typescript
type AgentLabAutomationStore = {
  schemaVersion: number;
  updatedAt: number;
  items: AgentLabAutomation[];
};
```

## 2. Path Resolution (apps/server/src/server.ts, Lines 799-809)

**AgentLab Directory** (Line 800):
```
.opencode/aurowork/agentlab/
```

**Automations File** (Line 804):
```
.opencode/aurowork/agentlab/automations.json
```

**Logs Directory** (Line 808):
```
.opencode/aurowork/agentlab/logs/
```

## 3. Schedule Constraints (Lines 823-844)

- **interval**: min 60 seconds, max 604800 seconds (7 days)
- **daily**: hour 0-23, minute 0-59
- **weekly**: weekday 1-7, hour 0-23, minute 0-59

## 4. Read/Write Functions (Lines 861-910)

### readAgentLabAutomations (Lines 861-904)
- Reads from automations.json
- Returns empty store if file doesn't exist
- Validates and normalizes all items
- Returns: `AgentLabAutomationStore`

### writeAgentLabAutomations (Lines 906-910)
- Writes to automations.json with timestamp
- Creates parent directories
- JSON formatting: 2-space indent, newline at end

## 5. API Routes (Lines 3327-3486)

### GET /workspace/:id/agentlab/automations (Line 3327)
Returns all automations for workspace.

### POST /workspace/:id/agentlab/automations (Line 3333)
Creates or updates automation.
- Requires: collaborator scope
- Auto-generates ID: `agentlab_{shortId}`
- Returns: `{ items, updatedAt }` with 201 status

### DELETE /workspace/:id/agentlab/automations/:automationId (Line 3390)
Deletes automation by ID.

### POST /workspace/:id/agentlab/automations/:automationId/run (Line 3414)
Manually triggers automation.
- Creates OpenCode session with title: "Automation: {name}"
- Submits automation.prompt to session
- Updates: lastRunAt, lastRunSessionId, updatedAt
- Returns: `{ ok, automationId, sessionId, ranAt }`

### GET /workspace/:id/agentlab/automations/logs (Line 3452)
Lists all .log files in logs directory.

### GET /workspace/:id/agentlab/automations/logs/:automationId (Line 3476)
Reads specific log file: `logs/{automationId}.log`

## 6. Workspace Initialization (apps/server/src/workspace-init.ts, Lines 278-280)

**Plugin Requirements by Preset**:
- starter: `["opencode-scheduler"]`
- automation: `["opencode-scheduler"]`
- minimal: `[]` (no plugins)

## 7. Toy UI - Automation Management (apps/server/src/toy-ui.ts, Lines 434-480)

**Automation Tab** (Line 382):
```html
<button class="tab" data-tab="automations">Automations</button>
```

**Key UI Elements**:
- Refresh button (#btn-auto-refresh)
- Automations list (#automations)
- Log viewer (#auto-log)
- Create form:
  - Name input (#auto-name)
  - Kind selector (#auto-kind): interval/daily/weekly
  - Interval input (#auto-interval, min 60s)
  - Daily inputs (#auto-hour, #auto-minute)
  - Weekly inputs (#auto-weekday, #auto-weekly-hour, #auto-weekly-minute)
  - Prompt textarea (#auto-prompt)
  - Save button (#btn-auto-save)

**JavaScript Functions** (Lines 1212-1350):
- `refreshAutomations()`: Fetches and renders list
- `saveAutomation()`: Creates/updates automation
- Manual run: Creates session and submits prompt
- Log viewer: Fetches and displays logs

## 8. Frontend References (apps/app/src/app/)

**app.tsx**: Preset handling for "automation" and "minimal"

**proto-v1-ux.tsx**: Beta UI for automations (Lines 529-577)
- Tab: "automations"
- Message: "Automate work by setting up scheduled tasks"
- "New automation" button
- Shows Beta badge

## 9. CRITICAL FINDING: Orchestrator Analysis

**NO SCHEDULER/CRON CODE EXISTS** in `apps/orchestrator/src/cli.ts`

Orchestrator contains:
- Child process management
- Activity heartbeat
- Hot reload watching
- TUI management

Orchestrator does NOT contain:
- Automation execution
- Cron job scheduling
- Automation triggers

**Conclusion**: Automations are executed by the `opencode-scheduler` plugin (external), not by the orchestrator.

## 10. Directory Structure

```
.opencode/aurowork/
├── inbox/                    (file uploads)
├── outbox/                   (file downloads)
└── agentlab/
    ├── automations.json      (automation store)
    └── logs/
        └── {automationId}.log (per-automation logs)
```

## 11. Constants

```json
{
  "opencodeVersion": "v1.2.27"
}
```

## 12. Automation Execution Flow

1. **Creation**: User creates automation via Toy UI → API creates entry in automations.json
2. **Manual Trigger**: User clicks "Run" → API creates OpenCode session → submits prompt
3. **Scheduled Execution**: opencode-scheduler plugin reads automations.json → executes per schedule
4. **Logging**: Execution results saved to .../agentlab/logs/{id}.log

## Key Takeaways

- Type-safe automation definitions with three schedule types
- Full CRUD API backed by JSON file storage
- Manual trigger capability via session creation
- Scheduled execution delegated to opencode-scheduler plugin
- Complete Toy UI for management
- Beta frontend UI in proto-v1-ux.tsx
- Preset-based plugin installation
