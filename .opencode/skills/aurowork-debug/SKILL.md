---
name: aurowork-debug
description: Debug AuroWork sidecars, config, and audit trail
---

## Credential check

Set these before running the HTTP checks:

- `AUROWORK_SERVER_URL`
- `AUROWORK_SERVER_TOKEN`
- `AUROWORK_WORKSPACE_ID` (optional; use `/workspaces` to discover)

## Quick usage (read-only)

```bash
curl -s "$AUROWORK_SERVER_URL/health"
curl -s "$AUROWORK_SERVER_URL/capabilities" \
  -H "Authorization: Bearer $AUROWORK_SERVER_TOKEN"

curl -s "$AUROWORK_SERVER_URL/workspaces" \
  -H "Authorization: Bearer $AUROWORK_SERVER_TOKEN"
```

## Workspace config snapshot

```bash
curl -s "$AUROWORK_SERVER_URL/workspace/$AUROWORK_WORKSPACE_ID/config" \
  -H "Authorization: Bearer $AUROWORK_SERVER_TOKEN"
```

## Audit log (recent)

```bash
curl -s "$AUROWORK_SERVER_URL/workspace/$AUROWORK_WORKSPACE_ID/audit?limit=25" \
  -H "Authorization: Bearer $AUROWORK_SERVER_TOKEN"
```

## OpenCode engine checks

```bash
opencode -p "ping" -f json -q
opencode mcp list
opencode mcp debug <name>
```

## DB fallback (read-only)

When the engine API is unavailable, you can inspect the SQLite db:

```bash
sqlite3 ~/.opencode/opencode.db "select id, title, status from sessions order by updated_at desc limit 5;"
sqlite3 ~/.opencode/opencode.db "select role, content from messages order by created_at desc limit 10;"
```

## Notes

- Audit logs are stored at `.opencode/aurowork/audit.jsonl` in the workspace root.
- AuroWork server writes only within approved workspace roots.
