# Workspace 架构梳理与演进方向（讨论笔记）

> 状态：brainstorming 中间产物，**未定稿**，未进入 spec / plan 阶段。
> 用途：把"workspace 切换为什么慢"、"orchestrator / aurowork-server / SQLite 分别是什么"、"多进程演进的中间态"这几次讨论沉淀下来，作为后续设计 RFC 的输入。

---

## 0. 背景：为什么有这份笔记

起因：用户反馈"切换 workspace 有比较大的延迟"。

调查后发现，这不是单点性能 bug，而是一连串"串行 + 懒加载 + 轮询"叠加 + 每个 workspace 都有独立运行时基础设施所致。延伸出三个层层递进的问题：

1. 为什么切 session 几乎 0 延迟，切 workspace 这么重？
2. workspace 为什么必须这么重？是什么需求驱动的？
3. 对照终端多 tab / 多 claude-code 进程的丝滑体验，AuroWork 差在哪里？怎么演进？

最后聚焦到一个具体的中间态方案：**一个 AuroWork 窗口只能打开一个 workspace + 允许多实例**。

---

## 1. 当前 workspace 切换延迟分析

### 1.1 总耗时区间
- **冷启动**：~3–13s
- **二次切换**：~500ms–2s

### 1.2 延迟来源（按贡献排序）

| # | 瓶颈 | 耗时 | 位置 |
|---|---|---|---|
| 1 | Auro 引擎 lazy-load（spawn + SQLite init） | 500ms–3s | orchestrator `/workspaces/{id}/path` |
| 2 | 健康检查 polling（每 200ms 一次） | 200ms–5s | `connectToServer()` in `workspace.ts` |
| 3 | `aurowork-server` 端口扫描 + spawn | 200ms–1s | `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` |
| 4 | 资源串行加载（sessions / skills / plugins / agents） | 500ms–1.5s | 前端 `workspace.ts` |
| 5 | 多次文件读 + Tauri IPC（aurowork.json / token / state） | ~200ms 累计 | 前后端共同 |

### 1.3 关键文件路径

- 前端入口：`apps/app/src/app/context/workspace.ts`
  - `selectWorkspace()` → `activateWorkspace()` → `connectToServer()`
- Tauri 命令：
  - `apps/desktop/src-tauri/src/commands/workspace.rs`
  - `apps/desktop/src-tauri/src/commands/orchestrator.rs`
  - `apps/desktop/src-tauri/src/aurowork_server/spawn.rs`（端口范围 `AUROWORK_PORT_RANGE_START/END` = 48000–51000）
- 后端：orchestrator 的 `/workspaces/{id}/path` 端点（懒加载引擎的实际入口）

---

## 2. 为什么切 session 几乎免费 vs 切 workspace 这么重

| 组件 | 切 session 时 | 切 workspace 时 |
|---|---|---|
| `opencode` 引擎进程 | ✅ 复用 | ❌ 可能要冷启动 |
| SQLite DB 连接 | ✅ 已打开 | ❌ 要重新 open |
| `aurowork-server` sidecar | ✅ 同一个 | ❌ 另起一个（不同端口） |
| 分配的端口 | ✅ 不变 | ❌ 重新分配 |
| Token 三件套 | ✅ 不变 | ❌ 重新加载 |
| OpenCode SDK client 实例 | ✅ 不变 | ❌ 重建 |
| File watcher | ✅ 不变 | ❌ 重新挂载 |
| Skills / Plugins / Agents 列表 | ✅ 已加载 | ❌ 重新拉取 |
| `aurowork.json` blueprint | ✅ 已缓存 | ❌ 重读 |

**本质**：
- **Workspace = 完整的运行时沙箱**（进程 + 端口 + token + watcher + DB scope + 配置）
- **Session = workspace 内部的 SQLite 几行 row**（无任何运行时资源持有）

切 session = `WHERE sessionId = ?`，走的是已建立的 HTTP 连接 + 同一引擎 + 同一 DB。

---

## 3. Workspace 为什么这么重：诚实归因

### 3.1 真需求驱动的"必须重"
- `.opencode/` 配置隔离（agents / skills / commands / MCP / 模型）
- 授权根目录（authorized roots）—— 安全边界
- MCP 子进程隔离（MCP 本来就是 per-ws 子进程）

→ 这三样合理成本应该在 **百毫秒级**

### 3.2 路径依赖 + 抽象成本造成的"额外重"
1. **架构继承自 OpenCode**（server-centric 模型）
2. **为 web / host 模式提前做的抽象**（HTTP API + token + 端口）—— 桌面单机用户在为不存在的场景买单
3. **隔离性的默认最大化**（没人 push back 到"够用"）

### 3.3 结论
> **没有功能需求真的"要求" workspace 这么重。** 它重的真实原因是架构继承 + 多模式预留 + 保守的默认。

---

## 4. 对照终端多 tab / 多 claude-code 模型

### 4.1 终端模型为何丝滑
- 每个 tab = 独立子进程，常驻
- 切 tab = 切 PTY buffer = **0ms**
- 进程隔离由 OS 提供，应用层零成本
- 通信走 stdin/stdout，无 HTTP / 端口 / token
- 故障 / 资源回收都靠 OS

### 4.2 AuroWork 当前差距（5 个 gap）

| Gap | 描述 | 难度 |
|---|---|---|
| 1 | **排他 vs 并发**：orchestrator 的 `activeWorkspaceId` 是单值字段 | ⭐⭐⭐⭐⭐ |
| 2 | **单引擎共享 vs 多进程对等**：opencode 是单实例靠 workspaceId 切片 | ⭐⭐⭐ |
| 3 | **HTTP+token vs stdio**：为远程模式付出的开销 | ⭐⭐⭐⭐ |
| 4 | **Lazy spawn vs eager spawn**：冷启动成本集中在切换路径上 | ⭐⭐ |
| 5 | **进程级隔离 vs 应用级模拟**：自己写代码模拟 OS 已提供的能力 | ⭐⭐ |

### 4.3 量化差距

| 操作 | 终端 + claude | AuroWork 现状 | 差距 |
|---|---|---|---|
| 切换（热） | <1ms | 500ms–2s | ~1000× |
| 切换（冷） | <1ms | 3–13s | ~10000× |
| 新建 | ~50ms | 5–15s | ~200× |

---

## 5. 两条演进路线对比

### 5.1 路线 A：多进程（终端 tab 模型）
- 每个 workspace = 独立 opencode 进程
- 资源天然隔离，OS 负责
- 切换 = OS 切焦点
- **代价**：N × 内存，SQLite 必须 per-ws 拆分

### 5.2 路线 B：单引擎（统一 context 切片）
- 1 个引擎多个 workspace context
- 切换 = 纯前端切视图 + 并行 fetch
- 后台任务天然支持（引擎共享）
- **代价**：服务端要把 workspaceId 变成显式参数；授权边界从进程级降到代码级，安全敏感

### 5.3 对比表

| 维度 | 多进程 | 单引擎 |
|---|---|---|
| 切换性能 | 0ms（已 spawn） | 50–200ms |
| 后台任务 | 天然支持，每个进程独立 | 天然支持，但需 UI 暴露 |
| 资源占用 | N × 100MB | 1 × 100MB + MCP |
| 故障隔离 | OS 级最强 | 应用层，依赖代码质量 |
| 实现难度 | 改 orchestrator 多 active + per-ws DB | 改服务端 + 新增任务管理 UI |
| 适合定位 | 重度多任务，像 IDE | 轻量切换，像 Notion |

---

## 6. 中间态方案：一窗口一 workspace + 允许多实例

> 用户提出的关键中间态。本质上是 **VSCode / Cursor / Xcode 模型**。

### 6.1 核心思路
- 一个 AuroWork 窗口 = 一个 workspace（绑死）
- "Add workspace" UI 改成 "Switch / Open in new window"
- 用户想多 workspace 并行 = 开多个 AuroWork 实例
- **借用 OS 窗口管理实现 tab 模型**，跳过自己写多 active 逻辑

### 6.2 白送红利
1. 多进程并发跑任务，**几乎不用改后端**
2. OS 级故障隔离
3. 切换 = Cmd+\` / Alt+Tab = **0ms**
4. UI 不用做 tab 栏
5. "切 workspace 慢"操作的频次大幅下降

### 6.3 需要解决的真正问题

| 问题 | 解法选项 |
|---|---|
| orchestrator 的 single-active 约束 | (a) 改成 multi-active set ✅ 推荐<br>(b) 每个实例自带 orchestrator<br>(c) 退化成单引擎 |
| `aurowork-server` sidecar 归属 | 顺其自然 per-window（当前架构兼容）|
| **SQLite 多进程冲突** 🚨 | (a) per-ws DB 文件（推荐）<br>(b) WAL + 应用层锁（性能差）<br>(c) orchestrator 做 DB proxy（性能差）|
| Tauri 多窗口实例支持 | spawn 多 Tauri 进程，OS 层面独立 |
| 关闭窗口的清理逻辑 | 引擎 / sidecar / 端口 / token 全部回收 |
| 全局凭据（API key 等）归属 | 机器级共享 vs 窗口级独立（待定）|

### 6.4 改动清单（初估）

| 改动 | 难度 |
|---|---|
| orchestrator `activeWorkspaceId` → `activeWorkspaceIds: Set` | ⭐⭐ |
| 引擎进程改成 per-ws spawn（不是 lazy bind）| ⭐⭐⭐ |
| SQLite 改成 per-ws DB 文件 | ⭐⭐⭐ |
| Tauri 多窗口实例 + 窗口路由 | ⭐⭐ |
| UI："Add" 改成 "Open in new window" 主路径 | ⭐⭐ |
| 窗口关闭时引擎清理 | ⭐⭐ |
| Token / port 的 per-window 生命周期 | ⭐⭐ |

### 6.5 评估
**这不是"中间态"，是"目标态的合理形态"。** VSCode 验证过这个模型可行。后续真要演进到"应用内 tab"也不冲突（窗口管理 + 应用内 tab 可以并存）。

---

## 7. 三大核心组件解释

### 7.1 Orchestrator Daemon (`aurowork-orchestrator`)

**是什么**：机器级守护进程，Bun binary，对外暴露本地 HTTP API（默认 ~4096）。代码在 `apps/orchestrator/src/`。

**做什么**：
- 管理 Auro 引擎进程（spawn/kill/重启）
- 管理 sidecar binary（下载、SHA-256 校验、版本）
- 维护活跃 workspace 注册（SHA-1 哈希前 12 位，`ws-` 前缀）
- 代理认证凭据（写入 `aurowork-orchestrator-auth.json`，启动引擎时注入 env）
- 暴露 workspace 路由 API（`POST /workspaces/{id}/activate` 等）
- 运行时状态查询

**为什么需要它**：
- ✅ 生命周期解耦（GUI 崩了引擎不死）
- ✅ Sidecar binary 集中管理
- ✅ 多实例 / 多入口的机器级协调点
- ✅ 未来 CLI / headless 模式的支撑
- 🟡 sidecar 装载逻辑外置
- ❌ 严格说不是必需的——桌面单机场景 Tauri 自己也能管 sidecar

**一句话**：引擎进程的"管家"，核心价值是让引擎独立于 GUI 生命周期 + 提供机器级单一协调点。

### 7.2 AuroWork Server Sidecar (`aurowork-server`)

**是什么**：Bun binary，**per-workspace 实例**（不是机器级），监听 48000–51000 随机端口。代码在 `apps/server/src/`。

**做什么**：
- Workspace 初始化（preset 模板 → `.opencode/aurowork.json` + 默认结构）
- 文件系统操作的统一入口（前端不直连 Tauri fs，走 server HTTP API，远端模式也用同一套）
- 授权根目录强制（authorized roots 安全防线）
- Token 颁发与验证（client / host / owner 三层）
- 代理 OpenCode SDK 调用
- 文件监视事件转发（`.opencode/aurowork.json` 变更 → SSE → 前端 reload）
- Blueprint / preset 解析

**为什么需要它**：
- ✅ 远程模式对等 API（浏览器没有 Tauri IPC）
- ✅ 授权边界的集中强制点
- ✅ Workspace 初始化逻辑内聚
- ✅ 兼容 OpenCode SDK 的 server-centric 设计
- 🟡 故障隔离（但真正会崩的是 MCP，不是 server）
- ❌ **"per-workspace = 必须独立进程"是实现简化的副产品**，逻辑上完全可以做成单 server 多 context

**一句话**：workspace 的"前台接待 + 保安"，核心价值是 (1) 给浏览器/远端提供 HTTP API，(2) 集中强制授权边界。"每 ws 一个进程"是简化代码的选择，不是架构必要。

### 7.3 SQLite DB (`opencode.db`)

**是什么**：单一文件 `~/.aurowork/aurowork-orchestrator-dev/aurowork-dev-data/xdg/data/opencode/opencode.db`。Auro 引擎进程独占读写。

**存什么**：
- `sessions` —— 对话元数据（id、title、createdAt、workspaceId、model）
- `messages` —— 每条消息（role、content、tool_calls、tool_results、attachments、token usage）
- Auro 引擎视角的 workspace 注册（**和桌面端 workspaces.json 是两个独立注册表！**）
- Task / job runs
- Cache / index（模型列表缓存的一部分）

**不存什么**（避免混淆）：
- ❌ 桌面端 workspace 注册表 → `aurowork-workspaces.json`
- ❌ Token → `aurowork-server-tokens.json`
- ❌ 端口映射 → `aurowork-server-state.json`
- ❌ orchestrator 状态 → `aurowork-orchestrator-state.json`
- ❌ workspace 项目文件 → `~/AuroWork/<name>/`
- ❌ Skills / agents / commands 定义 → `.opencode/skills/` 等文件

**为什么需要它**：
- 对话历史持久化（基础能力）
- 结构化查询（SQL >> 扫文件）
- 事务保证（多步 tool call 要么全成要么回滚）
- 跨 session 全局视图（token usage 统计、tool call 历史检索）

**为什么是 SQLite**：零运维 / 嵌入式 / 单机性能足够 / OpenCode 上游就用它。

**🚨 关键约束**：SQLite 不支持多进程并发写。WAL 模式可以多读单写，但多进程 attach 同一文件有强烈锁竞争。**多进程方案下必须 per-workspace 拆 DB 文件**——这其实符合数据逻辑（一个 ws 的 session 本来就不应该和别的 ws 混）。当前用 `workspaceId` 字段切片是为了配合"单引擎多 ws"的妥协。

---

## 8. 全景架构图

```
┌──────────────────────────────────────────────────────────────┐
│  机器层面 (machine-wide)                                      │
│                                                               │
│  ┌─────────────────────┐                                     │
│  │ Orchestrator daemon │  ← 机器级单例，管理引擎生命周期     │
│  │  (HTTP :~4096)      │                                     │
│  └──────────┬──────────┘                                     │
│             │ spawn / kill                                    │
│             ▼                                                 │
│  ┌─────────────────────┐    独占读写   ┌──────────────────┐ │
│  │ Auro 引擎 (opencode) │ ──────────►  │  SQLite DB       │ │
│  │  (随机端口)          │              │  (sessions /     │ │
│  └─────────────────────┘              │   messages)      │ │
│             ▲                          └──────────────────┘ │
└─────────────┼────────────────────────────────────────────────┘
              │ HTTP (OpenCode SDK)
              │
┌─────────────┼────────────────────────────────────────────────┐
│  Workspace 层 (per-workspace)                                │
│             │                                                 │
│  ┌──────────┴──────────────────────┐                         │
│  │ aurowork-server sidecar          │  ← 每 ws 一个         │
│  │ (HTTP :48000-51000, 随机)       │     提供 HTTP API     │
│  │  - 文件操作 + 授权检查           │     给前端/远端       │
│  │  - Token 颁发                    │                         │
│  │  - Workspace 初始化              │                         │
│  └──────────┬──────────────────────┘                         │
│             │ HTTP + token                                    │
│             ▼                                                 │
│  ┌─────────────────────────┐                                 │
│  │ Tauri 桌面 GUI / 浏览器  │  ← 前端，调 server 而非直连引擎│
│  └─────────────────────────┘                                 │
└──────────────────────────────────────────────────────────────┘
```

通讯路径：**前端 → aurowork-server → Auro 引擎 → SQLite**

---

## 9. 资源归属表（草稿，待中间态方案定稿后细化）

| 资源 | 当前归属 | 中间态（一窗口一 ws + 多实例）归属 | 备注 |
|---|---|---|---|
| orchestrator daemon | 机器级单例 | 机器级单例（需支持 multi-active） | 推荐保留 |
| sidecar binary 文件 | 机器级共享 | 机器级共享 | 不变 |
| API keys / 模型凭据 | 🤔 待定 | 🤔 待定（产品决策） | 倾向机器级共享 |
| Tauri appData（workspaces.json / tokens.json） | 机器级共享 | 🤔 待定 | 需要决策窗口间是否共享 |
| `~/AuroWork/<name>/` 项目文件 | per-ws | per-ws | 不变 |
| Auro 引擎进程 | 单实例 | per-window | 主要改动 |
| `aurowork-server` sidecar | per-ws（lazy） | per-window（常驻）| 改 lazy → eager |
| 端口（48000–51000） | per-ws | per-window | 跟着 sidecar 走 |
| Token 三件套 | per-ws | per-window | 跟着 sidecar 走 |
| MCP 子进程 | per-ws | per-window | 跟着引擎走 |
| 前端 UI / signals | per-ws（当前 active） | per-window（绑死） | 简化 |
| **SQLite DB** | **单文件全 ws 共享** | **per-ws 文件** 🚨 | **关键改动** |
| File watcher | per-ws | per-window | 跟着 sidecar 走 |

---

## 10. 待决策的关键问题

中间态方案要落地，必须先回答：

1. **是否完全禁止"同一窗口切换 workspace"？**
   - (A) 允许切换，UI 引导"开新窗口"为主路径（推荐保守）
   - (B) 完全禁止，只能新窗口（UX 纯粹）
   - (C) 暂时保留切换，未来再决定

2. **API keys / 模型配置 = 机器级共享 vs 窗口级独立？**
   - (A) 机器级共享（用户配一次到处用，推荐）
   - (B) 窗口级独立（隔离强）
   - (C) 双层：账号级共享 + ws 级 override

3. **SQLite 改造策略？**
   - (A) per-ws DB 文件，放在 `~/AuroWork/<name>/.opencode/data.db`（最干净，DB 跟着项目走）
   - (B) per-ws DB 文件，放在 `~/.aurowork/` 下（不污染项目目录）
   - (C) 单 DB + WAL + 应用层锁（最保守，性能差）

4. **orchestrator 的角色**：
   - (a) 改成 multi-active（推荐）
   - (b) 每个实例自带 orchestrator（彻底进程化）
   - (c) 退化成单引擎（放弃中间态）

5. **窗口管理 UX**：
   - 当前窗口已有 ws 想打开另一个 ws → 默认行为？弹窗？
   - 关闭最后一个窗口 = 退出 app？还是 orchestrator 后台跑？
   - Dock 图标点击 = 激活 vs 新开？

---

## 11. 下一步

- [ ] 用户对第 10 节的 5 个问题作出选择
- [ ] 根据选择把"资源归属表（中间态）"细化到可实施粒度
- [ ] 写正式 spec 文档放到 `docs/superpowers/specs/`
- [ ] 用 writing-plans skill 产出实施计划
- [ ] 实施前先做 instrumentation，量化每个阶段实际耗时（避免基于估算优化错地方）

---

## 附录：相关文件路径速查

| 主题 | 路径 |
|---|---|
| 前端 workspace 切换 | `apps/app/src/app/context/workspace.ts` |
| Tauri workspace 命令 | `apps/desktop/src-tauri/src/commands/workspace.rs` |
| Tauri orchestrator 命令 | `apps/desktop/src-tauri/src/commands/orchestrator.rs` |
| aurowork-server spawn | `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` |
| Orchestrator 主代码 | `apps/orchestrator/src/cli.ts` |
| AuroWork server 代码 | `apps/server/src/` |
| Workspace 初始化 | `apps/server/src/workspace-init.ts` |
| Orchestrator 状态 | `~/.aurowork/aurowork-orchestrator-dev/` |
| Tauri appData | `~/Library/Application Support/com.nld.aurowork.dev/` |
| Workspace 项目目录 | `~/AuroWork/<name>/` |
