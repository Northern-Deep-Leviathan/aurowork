# Docker Sandbox — 功能已裁剪，UI 已屏蔽

> 2026-04-13

---

## 现状

Docker sandbox 功能已被**显式裁剪（pruned）**。代码中有明确注释：

```typescript
// sandboxCleanupAuroworkContainers was removed (Docker sandbox feature pruned)
// sandboxDoctor was removed (Docker sandbox feature pruned).
// Return a stub result indicating sandbox is not available.
```

**没有任何 Docker CLI 调用、Docker API 调用、容器生命周期管理代码。**

---

## UI 屏蔽内容

| 屏蔽位置 | 原内容 | 文件 |
|---------|--------|------|
| Settings → Advanced → 维护区 | "AuroWork Docker containers" + "Delete containers" 红色按钮 | `settings.tsx` ~L2583 |
| Settings → Debug | "Sandbox probe" 调试工具 | `settings.tsx` ~L2644 |

---

## 残留的 stub 代码（未删除，保留供未来重新实现）

| 位置 | 函数/字段 | 实际行为 |
|------|----------|---------|
| `system-state.ts` ~L430 | `cleanupAuroworkDockerContainers()` | 永远返回空数组，报告 "No AuroWork Docker containers found" |
| `workspace.ts` ~L951 | `sandboxDoctor()` | 永远返回 `{ ready: false, error: "Sandbox feature has been removed." }` |
| `workspace.ts` | `sandboxCreatePhase` signal | 存在但无实际 Docker 操作 |
| `tauri.ts` | `orchestratorStartDetached()` 的 `sandboxBackend` 参数 | 参数传递但不触发任何容器操作 |
| `workspace-session-list.tsx` ~L167 | `workspaceKindLabel()` | 仍可根据 metadata 显示 "Sandbox" 标签 |
| 服务端 `server.ts` | `resolveSandboxBackend()` / `resolveSandboxEnabled()` | 读环境变量但仅报告 capability，无 Docker 调用 |
| i18n `en.ts` / `zh.ts` | 10+ 条 sandbox 相关翻译字符串 | 保留，不影响功能 |
| Rust `orchestrator/mod.rs` | sandbox progress event 基础设施 | 事件机制存在但无发送者 |

---

## 数据结构仍保留

Workspace 元数据中保留了三个字段：
- `sandboxBackend`: `"none" | "docker" | "container"`
- `sandboxRunId`: string
- `sandboxContainerName`: string

这些字段用于在 UI 中将 remote workspace 标记为 "Sandbox"，但**不提供任何实际隔离**。

---

## 恢复路径（如果未来要重新实现）

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | 实现 Docker 容器创建/启动/停止 | 目前完全空白 |
| P0 | 实现 `sandboxDoctor()` | Docker 环境检测（安装、daemon 运行、权限） |
| P0 | 实现 `cleanupAuroworkDockerContainers()` | 列出和删除 AuroWork 创建的容器 |
| P1 | 恢复 settings.tsx 中的 UI | 取消注释即可 |
| P1 | 容器内 orchestrator + opencode 部署 | Dockerfile、镜像构建 |
| P2 | Sandbox 创建进度 UI | 事件基础设施已有，需要接入真实 Docker 操作 |

---

## 搜索定位

屏蔽位置搜索：`docker-sandbox-pruned.md`
所有 sandbox 相关代码搜索：`sandboxBackend|sandboxDoctor|sandboxCleanup|sandbox_probe`
