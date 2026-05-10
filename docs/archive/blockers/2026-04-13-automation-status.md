# Automation 能力现状评估

> 2026-04-13 — 基于代码库全面审计

---

## 1. 总览

AuroWork 的 automation 功能**约 40% 完成**。数据模型、存储、API、手动触发均已就位，但**自动定时执行的核心引擎完全缺失**。

```
已完成        ████████░░░░░░░░░░░░  40%
  - 数据模型 & 存储
  - REST API (CRUD + 手动触发)
  - 浏览器自动化 (Chrome DevTools MCP)
  - Skills / Commands / MCP 工具链
  - Toy UI 管理界面

未实现        ░░░░░░░░████████████  60%
  - 定时调度引擎 (cron loop)
  - 后台守护进程
  - 主 UI (SolidJS) 管理界面
  - CLI 命令
  - opencode-scheduler 插件
```

---

## 2. 已实现的能力

### 2.1 Automation 数据模型

**文件**：`apps/server/src/server.ts` (L216-237)

```typescript
type AgentLabSchedule =
  | { kind: "interval"; seconds: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; dayOfWeek: number; hour: number; minute: number };

type AgentLabAutomation = {
  id: string;                    // "agentlab_xyz123"
  name: string;
  enabled: boolean;
  schedule: AgentLabSchedule;
  prompt: string;                // AI 执行的指令
  createdAt: number;
  lastRunAt?: number;
  lastRunSessionId?: string;
};
```

**存储路径**：`.opencode/aurowork/agentlab/automations.json`
**日志路径**：`.opencode/aurowork/agentlab/logs/{automationId}.log`

### 2.2 REST API

**文件**：`apps/server/src/server.ts`

| 端点 | 方法 | 行号 | 功能 |
|------|------|------|------|
| `/workspace/:id/agentlab/automations` | GET | L3327 | 列出所有 automation |
| `/workspace/:id/agentlab/automations` | POST | L3333 | 创建/更新 automation |
| `/workspace/:id/agentlab/automations/:id` | DELETE | L3390 | 删除 automation |
| `/workspace/:id/agentlab/automations/:id/run` | POST | L3414 | **手动触发执行** |
| `/workspace/:id/agentlab/automations/logs` | GET | L3452 | 查看所有日志 |
| `/workspace/:id/agentlab/automations/logs/:id` | GET | L3476 | 查看指定 automation 日志 |

**手动触发流程** (L3414-3450)：
1. 查找 automation 配置
2. 创建新 OpenCode session
3. 异步发送 automation prompt
4. 更新 `lastRunAt` 和 `lastRunSessionId`
5. 返回 `{ok: true, sessionId, automationId, ranAt}`

### 2.3 Chrome 浏览器自动化

| 组件 | 状态 | 说明 |
|------|------|------|
| `chrome-devtools-mcp` sidecar | ✅ 已编译 | 独立二进制，约 115MB |
| CDP 协议集成 | ✅ 可用 | 通过 MCP 工具暴露浏览器操作 |
| 设置 UI | ✅ 存在 | `control-chrome-setup-modal.tsx` |

### 2.4 Skills & Commands 系统

**完整实现**，支持：
- SKILL.md / COMMAND.md 文件格式
- Frontmatter 元数据解析
- Global + Project 两级作用域
- 全套 CRUD API
- 触发检测

### 2.5 MCP 工具系统

**完整实现**，支持：
- MCP server 配置管理（CRUD）
- 工具白名单/黑名单
- Global + Project 配置
- 认证流程（`mcp-auth-modal.tsx`）

### 2.6 Agent 系统

- 默认 agent 定义：`.opencode/agents/aurowork.md`
- Sub-agent 能力：session 树结构（parent-child）
- 但**无自主运行能力**——需要用户发消息触发

### 2.7 Toy UI 管理界面

**文件**：`apps/server/src/toy-ui.ts` (L434-480, L1212-1350)

提供基础管理功能：
- 列表展示 automation（名称、状态、schedule）
- 创建/编辑表单
- 手动 Run 按钮
- 日志查看
- **仅调试用途**，非生产级 UI

### 2.8 前端 Proto UI

**文件**：`apps/app/src/app/pages/proto-v1-ux.tsx` (L529-577)

有一个 Beta 标签页 "Automations"，显示 "Automate work by setting up scheduled tasks"，但功能未完整接入。

---

## 3. 关键缺失

### 3.1 定时调度引擎 — ❌ 完全缺失

**这是最关键的缺失。**

Schedule 数据（interval / daily / weekly）被存储在 `automations.json` 中，但**整个代码库中没有任何地方读取并执行这些 schedule**。

已检查的位置：
- `apps/orchestrator/src/cli.ts` (2000+ 行) — **零调度代码**，只做进程管理和心跳
- `apps/server/src/server.ts` — 只有 CRUD 和手动触发
- `apps/desktop/src-tauri/src/` — 只有 workspace 管理

**结果**：设置 `daily 9:00` 的 automation 永远不会在 9 点执行。

### 3.2 后台守护进程 — ❌ 缺失

没有常驻进程负责：
- 定期检查 `automations.json`
- 评估 schedule 是否到时
- 调用 `/run` API 执行

### 3.3 opencode-scheduler 插件 — ❌ 未包含

**文件**：`apps/server/src/workspace-init.ts` (L278-280)

```typescript
const requiredPlugins = preset === "starter" || preset === "automation"
  ? ["opencode-scheduler"]
  : [];
```

代码引用了 `opencode-scheduler` 插件，但：
- 仓库中没有这个插件的代码
- 没有安装指引
- 没有 npm 包

### 3.4 主 UI (SolidJS) — ❌ 缺失

生产前端中没有 automation 管理页面。`proto-v1-ux.tsx` 有原型但未完整实现：
- 无法创建 automation
- 无法查看执行日志
- 无法管理 schedule

### 3.5 CLI 命令 — ❌ 缺失

不支持：
- `aurowork automation list`
- `aurowork automation run <id>`
- `aurowork automation daemon`

---

## 4. 实际可用流程

### 能做的

```
1. 通过 API 创建 automation
   POST /workspace/:id/agentlab/automations
   { name, prompt, schedule, enabled }

2. 手动触发执行
   POST /workspace/:id/agentlab/automations/:id/run
   → 创建 session → AI 执行 prompt

3. 通过 Chrome DevTools MCP 自动化浏览器操作
   （需要先在设置中配置 Chrome）

4. 查看执行日志
   GET /workspace/:id/agentlab/automations/logs/:id
```

### 不能做的

```
× 定时自动执行（schedule 字段被忽略）
× 后台无人值守运行
× 从主 UI 管理 automation
× 命令行管理
× 多 automation 编排/串联
× 失败重试
× 执行通知
```

---

## 5. 三个 Workspace 预设对比

| 能力 | starter | automation | minimal |
|------|---------|-----------|---------|
| workspace-guide 技能 | ✓ | ✓ | ✓ |
| get-started 教程 | ✓ | ✗ | ✗ |
| learn-* 命令 | ✓ | ✓ | ✓ |
| chrome-devtools MCP | ✓ | ✗ | ✗ |
| creator skills (enterprise) | ✓ | ✗ | ✗ |
| opencode-scheduler 插件 | ✓ (引用) | ✓ (引用) | ✗ |
| 欢迎 session | ✓ | ✗ | ✗ |

**注意**：automation 预设并没有比 starter 多什么独有的能力。两者都引用 `opencode-scheduler`（但都未包含）。

---

## 6. 架构图

```
┌─────────────────────────────────────────────────┐
│                AuroWork Desktop                  │
│                                                  │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ SolidJS App  │  │ Tauri (Rust)            │  │
│  │              │  │                          │  │
│  │ proto-v1-ux  │  │ workspace creation      │  │
│  │ (Beta tab)   │  │ sidecar management      │  │
│  │ ❌ 未完整    │  │                          │  │
│  └──────┬───────┘  └──────────┬───────────────┘  │
│         │                     │                  │
│  ┌──────▼─────────────────────▼───────────────┐  │
│  │         aurowork-server (Node.js)          │  │
│  │                                            │  │
│  │  ✅ Automation CRUD API                    │  │
│  │  ✅ Manual /run endpoint                   │  │
│  │  ✅ automations.json read/write            │  │
│  │  ✅ Toy UI management                      │  │
│  │  ❌ NO scheduler loop                      │  │
│  └──────────────────┬─────────────────────────┘  │
│                     │                            │
│  ┌──────────────────▼─────────────────────────┐  │
│  │      aurowork-orchestrator                 │  │
│  │                                            │  │
│  │  ✅ Process management                     │  │
│  │  ✅ Heartbeat / hot reload                 │  │
│  │  ❌ NO automation scheduler                │  │
│  └──────────────────┬─────────────────────────┘  │
│                     │                            │
│  ┌──────────────────▼─────────────────────────┐  │
│  │           opencode (Go binary)             │  │
│  │                                            │  │
│  │  ✅ Session 执行引擎                       │  │
│  │  ✅ AI 对话 + 工具调用                      │  │
│  │  ✅ MCP 工具集成                           │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │    opencode-scheduler (plugin)    ❌ 缺失  │  │
│  │                                            │  │
│  │  应该负责：                                 │  │
│  │  - 读取 automations.json                   │  │
│  │  - 评估 schedule 是否到时                   │  │
│  │  - 调用 /run API 执行                      │  │
│  │  - 管理执行日志和失败重试                    │  │
│  └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## 7. 临时替代方案

如果现阶段需要定时执行 automation：

### 方案 A：外部 Cron + API

```bash
# Windows 任务计划程序 / Linux crontab
# 每天 9:00 执行
0 9 * * * curl -X POST http://localhost:<port>/workspace/<ws-id>/agentlab/automations/<auto-id>/run
```

### 方案 B：Auto-Approve 模式

```bash
# 允许 session 无需人工批准自动执行
AUROWORK_APPROVAL_MODE=auto aurowork-server ...
```

### 方案 C：CI/CD 集成

```yaml
# GitHub Actions 定时触发
on:
  schedule:
    - cron: '0 9 * * *'
jobs:
  run-automation:
    steps:
      - run: curl -X POST .../run
```

---

## 8. 补全 Automation 的路径（待规划）

| 优先级 | 任务 | 复杂度 | 影响 |
|--------|------|--------|------|
| **P0** | 实现调度引擎（cron loop in server or orchestrator） | 中 | 核心缺失，无此则 automation 不成立 |
| **P0** | 集成 opencode-scheduler 或内建替代 | 中 | 消除外部依赖 |
| **P1** | 主 UI：Automation 管理页面 | 中 | 用户可视化管理 |
| **P1** | 执行状态通知（成功/失败/超时） | 低 | 用户感知 |
| **P2** | CLI 命令支持 | 低 | 开发者便利 |
| **P2** | 失败重试策略 | 低 | 可靠性 |
| **P3** | 多 automation 编排/依赖 | 高 | 复杂工作流 |
| **P3** | Webhook 触发（非定时） | 中 | 事件驱动自动化 |
