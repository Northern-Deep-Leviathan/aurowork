# Left Sidebar: Workspace & Session Management

> 产品逻辑梳理 — 2026-04-08

---

## 1. 整体结构

左侧栏是一个**两层列表**：

```
Workspace A  (可折叠)
  ├── Session 1  (可展开子 session)
  │   └── Child Session 1.1
  ├── Session 2
  ├── Session 3
  └── [Show 3 more]

Workspace B  (可折叠)
  ├── Session 4
  └── [No tasks yet. → + New task]

[+ Add workspace]
```

左侧栏有**两套独立实现**，在不同场景下使用：

| 组件 | 使用场景 | 特点 |
|------|---------|------|
| `workspace-session-list` | Session 页面左侧（主列表） | 完整的 session 树、分页、菜单 |
| `sidebar` | Dashboard / 右侧 sidebar | 扁平列表、可拖拽排序、localStorage 持久化折叠状态 |

两套实现接收相同的数据源 (`workspaceSessionGroups`)，但在 UI 交互和状态管理上完全独立。

---

## 2. Workspace 层

### 2.1 数据来源

每个 workspace 来自后端的 workspace 列表，前端做了：
- **去重**：相同远程 workspace（按 host + workspaceId + directory 判断）只保留一个，优先保留当前选中/正在连接的
- **分组**：每个 workspace 关联一组 sessions（按 directory 匹配）

### 2.2 Workspace 状态

| 状态 | 含义 |
|------|------|
| `idle` | 还未加载 session 列表 |
| `loading` | 正在从后端拉取 sessions |
| `ready` | 加载完毕，有或没有 sessions |
| `error` | 加载失败（连接中断 / 后端报错） |

### 2.3 连接状态指示

每个 workspace 头部显示连接状态：

| 视觉 | 状态 |
|------|------|
| 绿点 + "Active" | 当前选中且连接正常 |
| 黄点 + 旋转图标 | 正在连接中 |
| 红点 + "Needs attention" | 连接错误 |
| 灰色 "Switch" | 非选中，点击可切换 |

### 2.4 折叠/展开

**workspace-session-list（主列表）**：
- 折叠态：只显示 **1 个** session 预览（`COLLAPSED_SESSIONS_PREVIEW = 1`）
- 展开态：显示最多 **6 个** root sessions（`MAX_SESSIONS_PREVIEW = 6`），可 "Show more" 分页
- 当前选中的 workspace 在初次挂载和切换时自动展开
- 用户手动折叠后不会被自动重新展开（除非切换到另一个 workspace 再切回来）
- 折叠状态**不持久化**，刷新后重置

**sidebar（Dashboard 等场景）**：
- 折叠态：完全隐藏 session 列表
- 展开态：显示最多 **8 个** sessions（扁平，无树）
- 折叠状态**持久化到 localStorage**（`aurowork.workspace-collapse.v1`）
- 支持拖拽调整 workspace 排序

### 2.5 Workspace 操作

| 操作 | 条件 | 说明 |
|------|------|------|
| 切换 workspace | 非正在连接 | 点击 workspace 头部 |
| 编辑名称 | 始终 | 弹出 rename modal |
| 分享 | 始终 | 弹出 share modal |
| 在资源管理器中打开 | 仅 local | 调用系统文件管理器 |
| 测试连接 | 仅 remote | 验证 remote workspace 可达 |
| 编辑连接 | 仅 remote | 修改 remote 连接参数 |
| 恢复 | remote + error | 尝试重新连接 |
| 停止 sandbox | 有 sandbox container | 停止容器 |
| 移除 workspace | 始终 | 从列表中移除（红色危险操作） |
| 新建 workspace | 始终 | 底部 "+ Add workspace" 按钮 |

---

## 3. Session 层

### 3.1 Session 的树结构

Sessions 支持**父子关系**：

```
Root Session (parentID 为空 或 指向不存在的 session)
└── Child Session (parentID = 父 session 的 ID)
    └── Grandchild Session (递归嵌套)
```

- **根 session 检测**：session 的 `parentID` 为空，或 `parentID` 指向的 session 不在当前 workspace 的 session 列表中
- **最大嵌套缩进**：4 层（`min(depth, 4) * 16px`）

### 3.2 Session 的展开/折叠

只有**有子 session** 的 session 才显示折叠箭头。

展开逻辑有两个来源：
1. **用户手动**展开（点击箭头）→ 记入 `expandedSessionIds`
2. **自动展开祖先路径**：当用户选中一个深层嵌套的 session 时，自动展开它的所有祖先节点 → `forcedExpandedSessionIds`

**冲突处理**：如果用户手动折叠了一个被自动展开的节点 → 记入 `userCollapsedSessionIds`，覆盖自动展开。当用户切换到另一个 session 时，重置 `userCollapsedSessionIds`，让新路径正常展开。

### 3.3 分页

- **默认展示**：最多 6 个 root sessions（展开态）或 1 个（折叠态）
- **加载更多**：点击 "Show N more" 每次增加 6 个
- **计数**：只计算 root sessions。子 session 在父 session 展开后自动显示，不计入分页

### 3.4 Session 展示

每一行 session 显示：

```
[缩进] [折叠箭头/连接线] [活跃指示灯] Session 标题     [操作按钮]
```

- **缩进**：根据深度
- **折叠箭头**：有子 session 时显示 `>` 或 `v`
- **连接线**：depth > 0 且无子 session 时显示一条短横线
- **活跃灯**：后端 session 状态非 idle 时显示黄色脉冲点
- **标题**：空标题或自动生成标题（"New session - <timestamp>"）显示为 "New session"
- **操作按钮**：仅当前选中的 session 显示 "..." 菜单

### 3.5 Session 操作

| 操作 | 触发方式 | 说明 |
|------|---------|------|
| 打开 session | 点击 session 行 | 加载该 session 的消息和状态 |
| 新建 session | 点击 "+ New task" 或空状态按钮 | 在当前 workspace 创建新 session |
| 重命名 | 操作菜单 → "Rename session" | 弹出 rename modal |
| 删除 | 操作菜单 → "Delete session" | 弹出确认 modal |

### 3.6 Session 标题规则

| 情况 | 显示 |
|------|------|
| `title` 为空 | "New session" |
| `title` = "New session - 2026-04-08T..." | "New session"（被识别为自动生成标题） |
| `title` = 正常文字 | 原样显示 |

自动生成标题的判断：以 `"New session - "` 开头，后面是可解析的日期字符串。

---

## 4. 数据流

### 4.1 Session 数据的两条通道

```
                  ┌────────────────────┐
                  │    OpenCode 后端    │
                  │  (session.list API) │
                  └────────┬───────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              v            │            v
     ┌─────────────┐      │     ┌──────────────┐
     │ Session Store│      │     │ Sidebar Store │
     │ (context/    │      │     │ (sidebarSess  │
     │  session.ts) │      │     │  ionsByWork-  │
     │              │ SSE  │     │  spaceId)     │
     │ 通过 SSE 实时 │◄─────┘     │ 通过 HTTP 批量  │
     │ 更新单条 session│           │ 拉取整个列表     │
     └──────┬───────┘           └──────┬────────┘
            │                          │
            │    Bridge Effect         │
            │    (sessions() 变化时     │
            │     同步到 sidebar)       │
            └─────────►┌───────────────┘
                       │
                       v
              ┌─────────────────┐
              │ sidebarWorkspace │
              │ Groups (memo)    │
              │                  │
              │ 最终传给 sidebar  │
              │ 组件的 props      │
              └─────────────────┘
```

**两条通道的作用**：
- **Session Store (SSE)**：实时更新当前 session 的状态（消息、标题、权限等）。是"活"的单条 session 数据。
- **Sidebar Store (HTTP)**：批量拉取某个 workspace 下所有 sessions 的摘要信息。是"列表"数据。
- **Bridge Effect**：当 Session Store 变化时，把更新同步到 Sidebar Store（单向，只在当前 workspace status = "ready" 时）

### 4.2 何时刷新 Sidebar Sessions

| 触发条件 | 说明 |
|---------|------|
| 首次选中 workspace | status = "idle" → 触发刷新 |
| Session Store 变化 | Bridge effect 同步（仅 "ready" 状态时） |
| 手动刷新 | 引擎重启、workspace 连接变化后 |
| 创建 session 后 | 新 session 立即注入 sidebar，不等 refresh |
| Rename session 后 | 先 patch sidebar，再后台 refresh |

### 4.3 Session 创建流程

```
用户点击 "+ New task"
  │
  ├── 1. 确保 workspace runtime 在运行
  ├── 2. 调用 c.session.create({ directory })
  ├── 3. selectSession(newId) → 加载消息
  ├── 4. 注入新 session 到 sessions() store
  ├── 5. 注入到 sidebarSessionsByWorkspaceId
  ├── 6. 路由导航到 /session/<id>
  └── 7. SSE "session.created" 事件后续同步
```

### 4.4 Session Rename 流程

```
用户在 rename modal 提交
  │
  ├── 1. c.session.update({ sessionID, title }) → 后端持久化
  ├── 2. 更新 Session Store（upsertSession）
  ├── 3. 立即 patch Sidebar Store 中的 title（乐观更新）
  ├── 4. 后台 refreshSidebarWorkspaceSessions → 拉取最新列表
  └── 5. SSE "session.updated" 事件同步
```

### 4.5 Session 删除流程

```
用户在确认 modal 点击删除
  │
  ├── 1. c.session.delete({ sessionID })
  ├── 2. SSE "session.deleted" 事件 → 从 Session Store 移除
  ├── 3. 如果删的是当前 session → 自动路由到下一个
  └── 4. Bridge effect → Sidebar Store 同步
```

---

## 5. Directory Scope（目录作用域）

每个 workspace 都有一个 `path`（本地路径 / 远程目录），session 有 `directory` 字段。两者通过 normalize 后的路径匹配：

```
Workspace path:  C:\Users\EdgeAppDefaults
                        ↓ normalize
                 c:/users/edgeappdefaults

Session directory: C:\Users\EdgeAppDefaults
                        ↓ normalize
                   c:/users/edgeappdefaults
                        ↓ 匹配 ✓ → 属于该 workspace
```

Normalize 规则：
1. 去掉 `\\?\` 和 `\\?\UNC\` 前缀
2. `\` → `/`
3. 去掉尾部 `/`
4. Windows/Mac 下转小写

**边界情况**：
- Session directory 为空 → 如果 workspace 也无特定 root → 归入该 workspace
- Session directory 与 workspace 不匹配 → 不在该 workspace 的 sidebar 中显示
- 服务端 `session.list` 支持 directory 过滤，但前端也做了一层防御性客户端过滤

---

## 6. 已知问题与近期修复

### 已修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 所有 workspace 折叠开关联动（同开同关） | workspace-session-list 中每个 workspace 的折叠箭头错误调用了 `toggleAllWorkspacesExpanded()` | 改为 `toggleWorkspaceExpanded(workspace().id)` |
| Workspace 折叠后几秒自动展开 | `createEffect` 在 SSE 更新时重新触发，调用 `expandWorkspace` 强制展开 | 改用 `on()` + `defer: true`，只在 workspace 真正切换时触发 |
| Session 折叠后自动展开 | 同上，`selectedSessionId` 的 effect 在 SSE 更新时清空 `userCollapsedSessionIds` | 改用 `on()` + `defer: true` |
| Rename 后名字消失 | rename 更新了 session store，但 sidebar store 在后续 refresh 中可能用旧数据覆盖 | rename 成功后立即 patch sidebar store（乐观更新） |

### 待观察

| 问题 | 可能原因 |
|------|---------|
| AI 自动生成标题不生效 | 后端逻辑问题，session title 保持 "New session - <timestamp>" 格式 |
| 两套 sidebar 实现不一致 | 历史原因，`sidebar.tsx` 和 `workspace-session-list.tsx` 功能重叠但行为不同 |

---

## 7. 架构观察

### 两个 Sidebar 实现的差异

`sidebar.tsx` 和 `workspace-session-list.tsx` 是独立开发的两套实现：

| 维度 | sidebar.tsx | workspace-session-list.tsx |
|------|-------------|--------------------------|
| Session 结构 | 扁平列表 | 树形（支持 parent-child） |
| 折叠持久化 | localStorage | 内存 signal |
| 拖拽排序 | 支持 | 不支持 |
| Session 操作 | 右键菜单 | 选中后 "..." 菜单 |
| 分页 | 硬截断（8 个） | "Show more" 渐进加载 |
| 使用位置 | Dashboard / 右侧 sidebar | Session 页面左栏 |

这两套实现独立维护各自的状态，可能导致行为不一致。

### Session Store 和 Sidebar Store 双源同步

当前架构中 session 数据有两个独立的 store：
- **Session Store**（context/session.ts）：通过 SSE 实时更新
- **Sidebar Store**（app.tsx 中的 signal）：通过 HTTP batch 拉取 + bridge effect 同步

Bridge effect 是单向的（Session Store → Sidebar Store），且有 scope 条件限制。这导致某些场景下数据不一致，是 rename 消失等问题的根因之一。
