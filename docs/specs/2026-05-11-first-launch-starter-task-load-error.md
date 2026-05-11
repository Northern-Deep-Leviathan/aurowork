# First-launch Starter "Failed to load tasks" 竞态分析

> 状态：诊断完成，待确认根因后再修复
> 日期：2026-05-11
> 关联文件：
> - `apps/app/src/app/app.tsx`
> - `apps/app/src/app/context/workspace.ts`
> - `apps/app/src/app/components/session/workspace-session-list.tsx`
> - `apps/app/src/app/utils/index.ts`

## 现象

用户**首次安装并启动**桌面端，从 onboarding 走 "Get Started"（或在欢迎页直接点 starter 卡片）创建 starter workspace 时：

1. 侧边栏 starter workspace 条目右侧出现红色 **"Error"** 角标
2. 该 workspace 展开后，session 列表区域显示 **"Failed to load tasks"** 文本
3. 即使 workspace 实际已成功创建并能正常使用，错误标志**不会自动消失**——必须手动切换其他 workspace 再切回来，或刷新应用

## 错误文案来源

`apps/app/src/app/utils/index.ts:333` `getWorkspaceTaskLoadErrorDisplay`：

```ts
export function getWorkspaceTaskLoadErrorDisplay(workspace, error) {
  const raw = error?.trim() ?? "";
  const fallbackTitle = raw || "Failed to load tasks";
  if (!raw || !isSandboxWorkspace(workspace)) {
    return {
      tone: "error",
      label: "Error",
      message: "Failed to load tasks",   // ← 这条
      title: fallbackTitle,
    };
  }
  // ... sandbox 特殊处理
}
```

调用方在 `workspace-session-list.tsx:719-732, 916-931`：当 `group.status === "error"` 时渲染 "Error" 角标 + "Failed to load tasks" fallback 文本。

主面板（`pages/dashboard.tsx:22`）也引用了同一个函数，所以**主面板里的相同错误是同一个 error 源**，不是另一个独立 bug。

## 时序竞态（推断的根因）

```
用户点 "Get Started" / starter 卡片
  → quickStartWorkspaceFlow                       (workspace.ts:2790)
  → createWorkspaceFlow("starter", folder)        (workspace.ts:1776)
      ├─ server.createLocalWorkspace 创建 workspace 记录
      │  → applyServerLocalWorkspaces 更新 workspaces() 信号
      │  ↓
      │  ⚡ createEffect 立刻触发                  (app.tsx:3675-3683)
      │     发现 status === "idle" → 调用
      │     refreshSidebarWorkspaceSessions(id)
      │     ↓
      │     此时 engine().baseUrl 可能已存在但：
      │       - workspace 在 engine 里还没 activate
      │       - auth/path/db 还没就绪
      │       - 或 baseUrl 指向上一个会话的旧 engine
      │     ↓
      │     c.session.list() 抛错（404 / 401 / connection refused / ...）
      │     ↓
      │     setSidebarSessionStatusByWorkspaceId(... = "error")
      │     setSidebarSessionErrorByWorkspaceId(... = message)
      │
      └─ activateFreshLocalWorkspace               (workspace.ts:1757)
          → startHost / activateWorkspace
          ↓ engine 真正就绪、workspace activated、session DB 就绪
          ↓
          但 createEffect 的守卫
            if (status !== "idle") return         (app.tsx:3681)
          已经把自动重试堵死了
          → "Error" 角标 + "Failed to load tasks" 永久停留
```

## 关键代码证据

| 位置 | 行为 | 问题 |
|---|---|---|
| `app.tsx:3681` | `if (status !== "idle") return;` | 自动 sidebar 加载只在 idle 时触发一次，error 后不再重试 |
| `app.tsx:3496-3512` | 仅当 `baseUrl` 为空时静音返回 idle | 其他错误（baseUrl 已有但请求失败）一律落 catch 置 error |
| `app.tsx:3587-3593` | catch 块只 set error，不 reset 回 idle | 自动重试机制无法被重新触发 |
| `workspace.ts:1837` | `activateFreshLocalWorkspace` 完成后无任何代码触发 sidebar refresh | 即使 engine 终于就绪，UI 不知道该再试一次 |

## 候选修复方案

按"动作小 → 影响面小"排序：

### 方案 A：activation 成功后强制重新拉一次（推荐）

在 `createWorkspaceFlow` 走完 `activateFreshLocalWorkspace` 且返回 true 之后，显式触发 sidebar 重新加载：

- 把 `refreshSidebarWorkspaceSessions` 暴露给 workspace context（通过 options），或
- 在 `app.tsx` 里加一个对 `connectingWorkspaceId` 完成 / `engine().baseUrl` 变化的 effect，发现 status==error 时强制重试一次

**改动点最少**，但要小心避免重复并发调用。

### 方案 B：扩展 effect 守卫条件（更通用）

`app.tsx:3681` 改成：

```ts
if (status === "loading") return;       // 不并发
if (status === "ready") return;         // 已加载就不再自动加载
// status === "error" 且 engine 刚就绪 / workspace 刚 activate 时，应当重试一次
```

需要引入"engine 就绪信号"或"workspace activated 时间戳"作为依赖。

### 方案 C：catch 时延迟重试 N 次（不推荐）

最简单但最不优雅，会遮蔽真正持久性的错误。

## 待确认事项（修复前必做）

需要在下次复现时打开 DevTools console 并搜索：

```
[sidebar:error]
```

捕捉具体的错误消息，才能确定**真正的上游断点**：

| 错误类型 | 可能根因 | 对应方案 |
|---|---|---|
| `404 Not Found` / "session list endpoint missing" | workspace 在 engine 里还没注册 | A |
| `401 / 403` / auth 相关 | engine auth 还没就绪 | A 或 B |
| `ECONNREFUSED` / `fetch failed` | baseUrl 指向旧 engine 或端口刚换 | B（依赖 engine baseUrl 变化）|
| `database is locked` 等 SQLite | session DB 还在初始化 | A 加重试 |

## 不要盲改

- `refreshSidebarWorkspaceSessions` 内部已有 `sidebarRefreshSeqByWorkspaceId` 防并发计数器，重试机制必须配合该计数器使用，否则会引入"晚到的错误覆盖正确结果"的二次竞态
- 任何"延迟重试"都要有明确的最大次数和时间窗口，避免在远端真挂时无限重试
- 修复后必须验证：sandbox workspace 的 "Sandbox is offline" 提示**不被误清除**（utils/index.ts:351-365 的 docker offline 分支）

## 下一步

1. 用户下次复现时贴 DevTools console 里 `[sidebar:error]` 的具体 message
2. 根据 message 定位是哪一类上游断点
3. 确认方案 A / B 后再动代码（带最小修复 PR + 手动验证步骤）
