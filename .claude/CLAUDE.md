# AuroWork - Claude Code 项目指令

## 项目概述

AuroWork 是一个开源桌面 AI Agent 应用，基于 OpenCode 构建。它为 OpenCode CLI 提供原生桌面 GUI，让非技术用户也能使用 agentic 工作流。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面 Shell | Tauri 2.x (Rust) |
| 前端 | SolidJS + TailwindCSS |
| 状态管理 | Solid stores + IndexedDB |
| IPC | Tauri commands + events |
| 后端服务 | Bun + TypeScript |
| 包管理 | pnpm 10.27+ (monorepo) |
| OpenCode 集成 | @opencode-ai/sdk/v2 |

## 仓库结构

```
apps/app/          → SolidJS 前端 UI (桌面/Web)
apps/desktop/      → Tauri 2 桌面 Shell (Rust)
apps/server/       → AuroWork Server (API/控制层)
apps/orchestrator/ → CLI 编排器
ee/                → 企业版组件 (den-web, den-controller, den-worker-*)
packages/          → 共享包
```

## 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # 启动桌面应用 (dev mode)
pnpm dev:ui           # 仅启动 Web UI
pnpm dev:web          # 启动 den-web
pnpm typecheck        # TypeScript 类型检查
pnpm build            # 生产构建
pnpm test:e2e         # E2E 测试
```

## 架构原则

1. **可预测 > 聪明** — 优先使用显式配置而非启发式推断
2. **服务端优先** — 文件系统变更应通过 AuroWork Server 路由
3. **本地优先** — 单机运行，零云依赖
4. **Web 对等** — Tauri 文件操作仅作为 host 模式的回退

## 编码规范

- 前端组件使用 SolidJS functional components，避免 class components
- 使用 TypeScript strict mode
- UI 动画目标 60fps，交互延迟 < 100ms
- 遵循 WCAG 2.1 AA 无障碍标准
- 不要在代码中硬编码 secrets 或 API keys

## 重要约定

- 修改 `apps/server/src` 后需要重新构建: `pnpm --filter aurowork-server build:bin`
- OpenCode 保持 loopback (127.0.0.1:4096)，不直接暴露
- 桌面端 AuroWork Server 端口范围: 48000-51000
- 优先使用 OpenCode 原生 primitives (sessions, skills, plugins, commands)

## 开发追踪协议

Claude 在本项目中充当开发小助手，需要主动维护开发状态文件。

### 自动追踪规则

1. **每次 session 开始时**：先读取 `.claude/DEV_PROGRESS.md`，了解当前项目状态
2. **遇到问题时**：在 `当前问题` 区域记录问题描述 + 错误信息
3. **尝试解决方案时**：在 `尝试记录` 区域记录尝试了什么、结果如何
4. **完成任务时**：从 Todo 中划掉已完成项，更新进度
5. **session 结束前**：确保 `DEV_PROGRESS.md` 是最新的，写入 `下次继续` 提示

### 追踪触发条件

以下情况必须更新 `DEV_PROGRESS.md`：
- 发现 bug 或遇到报错
- 做出了架构/设计决策
- 完成了一个功能或修复
- 发现了新的待办事项
- 遇到阻塞问题 (blocker)

### 快捷指令

用户说以下内容时，执行对应操作：
- **"记一下"** / **"log"** → 追加到 DEV_PROGRESS.md 的当日记录
- **"看看进度"** / **"status"** → 读取并总结 DEV_PROGRESS.md 当前状态
- **"standup"** → 生成简洁的 standup 报告（昨天做了什么/今天要做什么/有什么阻塞）

## Workspace 本地存储

Workspace 数据分散在三处独立的本地存储中，由不同组件管理，作用各不相同：

### 1. Orchestrator 状态目录 — `~/.aurowork/aurowork-orchestrator-dev/`

**所有者**: aurowork-orchestrator 守护进程（Rust binary）

**作用**: 管理 opencode 后端进程的生命周期和运行时状态，是整个后端服务层的控制中心。

| 文件/目录 | 说明 |
|-----------|------|
| `aurowork-orchestrator-state.json` | 守护进程运行时状态：daemon/opencode 的 PID、端口、baseUrl；sidecar 下载源配置；binary 路径及版本校验；活跃 workspace ID 列表（使用 **SHA1** 哈希生成 ID） |
| `aurowork-orchestrator-auth.json` | opencode 的临时认证凭据（username/password），由桌面端写入，orchestrator 启动 opencode 时传入，应用退出时失效 |
| `aurowork-dev-data/` | opencode 进程的隔离数据沙箱（遵循 XDG 规范）：`xdg/data/opencode/opencode.db` 为 SQLite 数据库（存储 session、message、workspace 等业务数据）；`xdg/cache/opencode/models.json` 为模型列表缓存；`xdg/data/opencode/log/` 为运行日志 |

**生命周期**: 桌面端启动 → 写入 auth → 拉起 orchestrator daemon → daemon 拉起 opencode serve → 写入 state.json。关闭时进程退出，但文件保留。

**清除效果**: 删除后下次启动会重新生成全部状态，opencode 数据库（session 历史等）会丢失。

### 2. Tauri 桌面端数据目录 — `~/Library/Application Support/com.nld.aurowork.dev/`

**所有者**: Tauri 桌面 Shell（Rust，通过 `app.path().app_data_dir()` 获取路径）

**作用**: 桌面 GUI 的持久化状态，管理 workspace 列表、认证 token、端口分配。这是用户在 UI 上看到 "workspace 还在" 的根本原因。

| 文件 | 说明 |
|------|------|
| `aurowork-workspaces.json` | **workspace 注册表**：包含 workspace 列表（ID、名称、路径、preset 类型、远程连接信息）、当前选中/监视的 workspace ID。ID 使用 **SHA256** 哈希生成，与 orchestrator 的 SHA1 ID 独立 |
| `aurowork-server-tokens.json` | 每个 workspace 的认证 token（clientToken、hostToken、ownerToken），按 workspace 路径索引 |
| `aurowork-server-state.json` | workspace 端口映射（workspace 路径 → 分配的端口号，范围 48000-51000） |

**生命周期**: 创建 workspace 时写入 → 每次启动时读取恢复 UI 状态 → 切换/删除 workspace 时更新。

**清除效果**: 删除后 UI 中的 workspace 列表清空，会进入 onboarding 引导流程。但实际的 workspace 项目文件不受影响。

### 3. Workspace 项目目录 — `~/AuroWork/<workspace-name>/`

**所有者**: workspace 初始化系统（`apps/server/src/workspace-init.ts`）+ 用户

**作用**: 实际的工作区项目文件，包含 AI agent 的配置、技能、命令等。这是唯一可以（也应该）被版本控制的部分。

| 文件/目录 | 说明 |
|-----------|------|
| `.opencode/aurowork.json` | workspace 元数据：名称、创建时间、preset 类型、授权根目录（安全边界）、blueprint（空状态 UI、预设 session、starters）、reload 配置 |
| `opencode.jsonc` | opencode 运行时配置：默认模型、MCP server 声明、插件列表、默认 agent |
| `.opencode/agents/` | 自定义 agent 定义（如 `aurowork.md`） |
| `.opencode/skills/` | 自定义 skill 定义 |
| `.opencode/commands/` | 自定义 slash command 定义 |

**生命周期**: 由 preset 模板初始化（starter/minimal/automation）→ 用户可自由编辑 → 桌面端通过文件监视（file watcher）检测 `.opencode/aurowork.json` 变更并触发 reload 事件。

**清除效果**: 删除后该 workspace 的所有配置和自定义内容丢失。如果仅删除上面两层但保留此目录，重新添加 workspace 时配置会恢复。

### 彻底清除 workspace 的操作

```bash
# 1. 停止所有进程
pkill -f 'AuroWork-Dev|aurowork|opencode'

# 2. 清除 orchestrator 运行时状态 + opencode 数据库
rm -rf ~/.aurowork/aurowork-orchestrator-dev/

# 3. 清除桌面端 workspace 列表 + token + 端口映射
rm -rf ~/Library/Application\ Support/com.nld.aurowork.dev/

# 4. 清除 workspace 项目文件（可选，按需）
rm -rf ~/AuroWork/
```

> ⚠️ 注意: 生产版本的路径是 `com.nld.aurowork`（不带 `.dev` 后缀），orchestrator 目录是 `~/.aurowork/aurowork-orchestrator/`（不带 `-dev` 后缀）。

## 关键参考文档

- @docs/architecture/overview.md — 系统架构设计 (runtime flow, server ownership)
- @docs/architecture/agents.md — 代理开发指南
- @docs/product/product.md — 产品需求和用户流程
- @docs/design/design-language.md — 视觉设计参考
- @docs/architecture/infrastructure.md — 部署和控制平面
- @docs/INDEX.md — 文档总索引（按主题导航）
- @.claude/DEV_PROGRESS.md — 开发进度追踪（每次 session 必读）
