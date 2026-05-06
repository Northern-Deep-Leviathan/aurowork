# AuroWork — 开发进度追踪

## Session: 2026-05-06 — opencode → auro 重命名（已完成）

### 已完成的 Phases

分支: `personal/mazziruso/build-rename-auro`（27+ commits, working tree clean）

- **Phase A (bucket-1 internals)** — desktop crate 内部符号: `OpencodeConfigFile/Command` → `AuroConfigFile/Command`, `RemoteType::Opencode` → `Auro`（保留 wire string `"opencode"`）, `engine/spawn.rs` 字段, final grep 清扫。
- **Phase B (Tauri command surface)** — `opencode_command_*` / `read|write_opencode_config` / `reset_opencode_cache` / `opencode_db_migrate` / `opencode_mcp_auth` / `nuke_aurowork_and_opencode_config_and_exit` → `auro_*`；前端 `EngineStartOptions/EngineInfo.opencode*` → `auro*`；`lib/opencode.ts` → `lib/auro.ts`。
- **Phase C (server lockstep)** — CLI `--opencode-base-url|directory` → `--auro-*`; env `AUROWORK_OPENCODE_USERNAME|PASSWORD` → `AUROWORK_AURO_*`; server 文件 `opencode-{connection,db}.ts` / `portable-opencode.ts` → `auro-*`; RemoteType + `/opencode-config` 审计。
- **Phase D (orchestrator JSON wire)** — 重命名 orchestrator JSON 字段（auth/health/binaries/sidecar）；desktop `OrchestratorOpencodeState` → `OrchestratorAuroState`；sidecar 重建。
- **Phase E1-E3 (docs + comments sweep)** — 仓库 docs、`.claude/CLAUDE.md`、code comments；上游引用（`@opencode-ai/sdk`、`.opencode/`、`opencode.jsonc`、`OPENCODE_*` env、upstream binary）保留 "OpenCode"。
- **Phase F1 (CI verify)** — `.github/workflows/build-desktop.yml` 确认 `Northern-Deep-Leviathan/auro` + `auro-windows-x64-baseline.zip` 已对齐。无变更需要提交。
- **Phase Z1 (final audit)** — Repo grep 审计完成，所有遗留 `opencode` 命中均落在 bucket-4 preserve allowlist。
- **Clippy + cosmetic** — 修复 12 个 `-Dwarnings` clippy lints（commit `6e787a3`）+ 内部 Rust 参数 `auro_*` 同步。
- **Triage spec** — 53 个预存在前端 TS 错误（与本次重命名无关，已确认在 branch point `d3ad56a` 上同样存在）记录于 `docs/superpowers/specs/2026-05-06-frontend-type-errors-cleanup.md`（commit `794bd7a`），延后处理。

### 验证状态（GREEN）

- `cargo check` ✅
- `cargo clippy --all-features --all-targets -p aurowork -- --no-deps -Dwarnings` ✅
- `pnpm --filter aurowork-server typecheck` ✅
- `pnpm --filter aurowork-orchestrator typecheck` — 1 个预存在 TUI 选项漂移错误（无关）
- 根 `bun run typecheck` — 53 个预存在前端错误（已转入独立 ticket）

### ⚠️ Clean-break 警告（PR 合并后所有开发者必须执行）

orchestrator JSON 状态文件 schema 已改变，**无迁移 shim**。拉到最新代码后第一次启动 desktop dev build 前必须清除既有 dev state：

```bash
pkill -f 'AuroWork-Dev|aurowork|opencode'
rm -rf ~/.aurowork/aurowork-orchestrator-dev/
rm -rf ~/Library/Application\ Support/com.nld.aurowork.dev/
```

生产用户不受影响（生产分支尚未 cut）。

### 下次继续

- 推送分支 + 创建 PR。
- （独立任务）按 `docs/superpowers/specs/2026-05-06-frontend-type-errors-cleanup.md` 启动 53 个前端 TS 错误的清理 ticket。
