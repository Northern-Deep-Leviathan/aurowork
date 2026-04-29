# Exa Web Search — 未就绪，UI 已屏蔽

> 2026-04-13

---

## 现状

Settings → Advanced → OpenCode 下原有一个 "Enable Exa web search" 开关。**功能未就绪**，链路在 orchestrator 层断裂。

**UI 已屏蔽**：整个 OpenCode panel（含 Exa toggle）已从 `settings.tsx` 中注释隐藏。

UI hint 原文：
> "Applies when AuroWork Orchestrator launches OpenCode. **Off by default until the integration is fully rolled out.**"

---

## 链路追踪

| 层 | 状态 | 文件 | 说明 |
|----|------|------|------|
| UI Toggle | ✅ | `settings.tsx:2064-2079` | 按钮正常，on/off 切换 |
| State 持久化 | ✅ | `app.tsx:1030` + localStorage `aurowork.opencodeEnableExa` | 正常 |
| Tauri Command | ✅ | `tauri.ts:159,167` → `engine.rs:199,222` | 参数传递正确 |
| Rust Orchestrator | ✅ | `orchestrator/mod.rs:76,288-289` | 设置 `env("OPENCODE_ENABLE_EXA", "1")` |
| **Node.js Orchestrator** | ❌ 断裂 | `orchestrator/src/cli.ts` ~L2455-2528 | `startOpencode()` 函数不读此 env var，不传给 OpenCode |
| **OpenCode (Go)** | ❌ 不可达 | 二进制，无法确认 | 永远收不到 `OPENCODE_ENABLE_EXA` |
| **Exa API Key** | ❌ 完全缺失 | 全局搜索 `EXA_API_KEY` 零结果 | 无配置入口、无 UI、无传递 |

---

## 断点详情

`apps/orchestrator/src/cli.ts` 中 `startOpencode()` 函数构建 OpenCode 子进程 env 时：

```typescript
const child = spawnProcess(options.bin, args, {
  cwd: options.workspace,
  env: {
    ...process.env,
    OPENCODE_CLIENT: "aurowork-orchestrator",
    AUROWORK: "1",
    OPENCODE_SERVER_USERNAME: options.username,
    OPENCODE_SERVER_PASSWORD: options.password,
    OPENCODE_HOT_RELOAD: options.hotReload.enabled ? "1" : "0",
    // ❌ 没有 OPENCODE_ENABLE_EXA
    // ❌ 没有 EXA_API_KEY
  },
});
```

注意：`...process.env` 展开的是 orchestrator 进程自身的 env。Rust 层确实把 `OPENCODE_ENABLE_EXA=1` 注入了 orchestrator 进程，所以 `process.env.OPENCODE_ENABLE_EXA` 理论上存在。

**但问题是**：`startOpencode()` 用 `{ ...process.env, ... }` 重建了 env 对象，而后续的显式赋值可能覆盖。更重要的是，即使 env var 传到了 OpenCode，**没有 `EXA_API_KEY` 就无法调用 Exa API**。

---

## 修复路径

| 优先级 | 任务 | 复杂度 |
|--------|------|--------|
| P0 | orchestrator `startOpencode()` 显式传递 `OPENCODE_ENABLE_EXA` | 低（1 行代码） |
| P0 | 确认 OpenCode Go 二进制是否支持 `OPENCODE_ENABLE_EXA` env var | 需查 opencode 源码 |
| P0 | 添加 `EXA_API_KEY` 配置：UI 输入框 → localStorage → Tauri → Rust → Orchestrator → OpenCode | 中 |
| P1 | 验证 Exa 集成端到端：搜索能力、结果格式、错误处理 | 中 |
| P2 | 用量监控 / API key 验证 / 余额提示 | 低 |

---

## 决策

**已从 UI 屏蔽**（2026-04-13）：
- `settings.tsx` 中整个 OpenCode panel（仅含 Exa toggle）注释隐藏
- 后端 state、Tauri 命令、Rust 层代码**保留不动**，恢复时只需取消注释
- 搜索 `exa-search-not-ready.md` 或 `enable_exa` 可定位所有相关代码

---

## 相关文件

- `apps/app/src/app/pages/settings.tsx` L2064-2079 — UI toggle
- `apps/app/src/app/app.tsx` L1030 — state signal
- `apps/app/src/app/lib/tauri.ts` L159,167,414,418 — Tauri 调用
- `apps/desktop/src-tauri/src/commands/engine.rs` L199,222,421 — Rust 命令
- `apps/desktop/src-tauri/src/orchestrator/mod.rs` L76,288-289 — Rust spawn
- `apps/orchestrator/src/cli.ts` ~L2455-2528 — **断点**：startOpencode()
- `apps/app/src/i18n/locales/en.ts` L1030-1031 — i18n
- `apps/app/src/i18n/locales/zh.ts` L952-953 — i18n 中文
