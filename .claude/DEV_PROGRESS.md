# AuroWork — 开发进度追踪

## Session: 2026-05-06 — opencode → auro 重命名

### 已完成

完成 Phase A-D 全部任务（commits 0831a60..72437b1，分支 `personal/mazziruso/build-rename-auro`）：

- **Phase A (bucket-1 internals)**: 重命名 desktop crate 内部符号 — `OpencodeConfigFile` → `AuroConfigFile`, `OpencodeCommand` → `AuroCommand`, `RemoteType::Opencode` → `RemoteType::Auro`（保留 wire string `"opencode"`）, `engine/spawn.rs` 的 `opencode_config_dir` → `auro_config_dir`，以及 final 内部 grep 清扫。
- **Phase B (Tauri command surface)**: `opencode_command_*` → `auro_command_*`, `read/write_opencode_config` → `read/write_auro_config`, 杂项命令（`reset_opencode_cache`、`opencode_db_migrate`、`opencode_mcp_auth`、`nuke_aurowork_and_opencode_config_and_exit`）批量改名；前端 `EngineStartOptions/EngineInfo` 的 `opencode*` 字段改为 `auro*`；`apps/app/src/app/lib/opencode.ts` 移到 `lib/auro.ts`。
- **Phase C (server lockstep)**: CLI flags `--opencode-base-url` / `--opencode-directory` → `--auro-*`；env vars `AUROWORK_OPENCODE_USERNAME/PASSWORD` → `AUROWORK_AURO_*`；server 内部文件 `opencode-connection.ts` / `opencode-db.ts` / `portable-opencode.ts` → `auro-*`；RemoteType 与 `/opencode-config` 路由审计完成。
- **Phase D (orchestrator JSON wire)**: 重命名 orchestrator 输出的 JSON 字段（auth/health/binaries/sidecar）；desktop 端 `OrchestratorOpencodeState` → `OrchestratorAuroState`；构建确认 desktop 取到新 sidecar。
- **Phase E1 (docs sweep)**: 已在 commit 72437b1 中完成 — `ARCHITECTURE.md`、`CODEBASE.md`、`PRODUCT.md` 内嵌入式引擎品牌词改为 "Auro"；上游引用（`@opencode-ai/sdk`、`.opencode/`、`opencode.jsonc`、`OPENCODE_*` 上游 env、upstream binary 文案）保留 "OpenCode"。

### 当前 session 工作内容

- **Phase E2**: 更新 `.claude/CLAUDE.md`（嵌入式引擎相关 "OpenCode" → "Auro"，保留 `@opencode-ai/sdk/v2` 等上游引用）+ 创建本 `DEV_PROGRESS.md`。
- **Phase E3**: 代码注释 sweep（`apps/`、`packages/`）。
- **Phase F1**: 验证 `.github/workflows/build-desktop.yml`，确认 release asset URL 指向 `Northern-Deep-Leviathan/auro`，发布物 `auro-windows-x64-baseline.zip` 等已对齐。

### ⚠️ Clean-break 警告（Phase D ships 后所有开发者必须执行）

由于 orchestrator 的 JSON 状态文件 schema 改变，**没有迁移 shim**。每个开发者拉到最新代码后第一次启动 desktop dev build 之前，必须清除既有 dev state，否则握手/启动会失败：

```bash
pkill -f 'AuroWork-Dev|aurowork|opencode'
rm -rf ~/.aurowork/aurowork-orchestrator-dev/
rm -rf ~/Library/Application\ Support/com.nld.aurowork.dev/
```

生产用户不受影响（生产分支尚未 cut）。

### 下次继续

- 跑 Phase Z1（最终 repo grep 审计），确认没有遗漏的 bucket-1/2/3 重命名。
- 触发一次 release 工作流 dry run（throwaway tag）验证 CI 绿。
