# Skill Hub UI — 暂时屏蔽

> 2026-04-13

---

## 做了什么

在 `apps/app/src/app/pages/skills.tsx` 中屏蔽了以下 UI 元素：

| 屏蔽内容 | 原因 |
|---------|------|
| **"Hub available" 统计卡片** | Hub 后端未实现，数量始终为 0，误导用户 |
| **"Mode: Local / Server" 卡片** | 对用户无实际价值，增加认知负担 |
| **"Install skills" 整个区块** | Hub 功能不可用（见下方分析） |
| **"Add custom GitHub repo" 弹窗** | 随 Hub 区块一起屏蔽 |
| **搜索框 placeholder** | "Search installed or hub skills" → "Search installed skills" |

统计卡片从 4 列缩为 2 列（Installed + Skill creator），更简洁。

---

## 为什么 Skill Hub 目前不可用

### 服务端缺失

`apps/app/src/app/lib/aurowork-server.ts` 中定义了两个 Hub API：

```
GET  /hub/skills                              — 列出 hub 中的 skills
POST /workspace/:id/skills/hub/:name          — 从 hub 安装 skill
```

但 `apps/server/src/server.ts` 中**这两个端点均未实现**。

### 前端有 fallback 但不可靠

`apps/app/src/app/context/extensions.ts` 有一个 GitHub API 直接调用的 fallback：

```typescript
// 直接从 GitHub API 列出 skills 目录
GET https://api.github.com/repos/{owner}/{repo}/contents/skills?ref={ref}
```

问题：
- 默认 hub `different-ai/aurowork-hub` 仓库可能不存在或为私有
- GitHub API 未认证调用限额 60 次/小时
- 安装功能仍依赖服务端（无 fallback）

### 安装功能完全依赖服务端

即使前端能列出 hub skills，点击 "Add" 时调用 `POST /workspace/:id/skills/hub/:name` 仍然会失败，因为服务端没有这个路由。

---

## 恢复 Skill Hub 需要什么

| 任务 | 优先级 | 说明 |
|------|--------|------|
| 实现 `GET /hub/skills` 端点 | P0 | server.ts 中添加路由，从 GitHub 拉取 skill 列表 |
| 实现 `POST /workspace/:id/skills/hub/:name` | P0 | 下载 skill 内容并写入 `.opencode/skills/` |
| 确认 hub 仓库存在且公开 | P0 | `different-ai/aurowork-hub` 或替换为可用仓库 |
| 添加 GitHub token 认证 | P1 | 避免 60 次/小时的 rate limit |
| 恢复 UI | P1 | 取消 skills.tsx 中的注释 |
| Hub 搜索/过滤 | P2 | 服务端 skill 元数据索引 |

---

## 相关文件

- `apps/app/src/app/pages/skills.tsx` — UI（已屏蔽 hub 区块）
- `apps/app/src/app/context/extensions.ts` — Hub 逻辑（DEFAULT_HUB_REPO、refreshHubSkills、installHubSkill）
- `apps/app/src/app/lib/aurowork-server.ts` — API 客户端定义（listHubSkills、installHubSkill）
- `apps/server/src/server.ts` — 服务端（缺失 hub 端点）

---

## 屏蔽的代码定位

搜索以下注释可快速找到屏蔽位置：

```
See .claude/plans/skill-hub-hidden.md
```

在 `skills.tsx` 中出现两处：
1. Hub skills 列表区块（原 "Install skills" 标题下）
2. Custom repo modal（原文件末尾）
