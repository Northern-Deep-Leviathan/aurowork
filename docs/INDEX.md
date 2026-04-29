# Documentation Index

> AuroWork 项目文档导航。每个文件后写一句作用，方便快速定位。
> 最后整理：2026-04-29

---

## 入口（根目录）

| 文件 | 作用 |
|------|------|
| `README.md` | 项目主介绍（英文） |
| `README_ZH.md` | 简体中文 |
| `README_ZH_hk.md` | 繁体中文 |
| `LICENSE` | 许可证 |
| `SECURITY.md` | 安全漏洞上报流程（GitHub 默认位置） |
| `SUPPORT.md` | 用户支持渠道（GitHub 默认位置） |
| `CODE_OF_CONDUCT.md` | 社区行为准则（GitHub 默认位置） |

## Product — 产品与战略

| 文件 | 作用 |
|------|------|
| [`docs/product/vision.md`](product/vision.md) | 1000× 生产力使命与定位 |
| [`docs/product/product.md`](product/product.md) | 产品需求、目标用户（Bob & Susan）、UX 流程 |
| [`docs/product/principles.md`](product/principles.md) | 设计/产品决策原则与判断框架 |

## Architecture — 系统架构

| 文件 | 作用 |
|------|------|
| [`docs/architecture/overview.md`](architecture/overview.md) | **架构总览**：可预测性优先 / Tauri+server 角色 / 文件系统策略。先看这个 |
| [`docs/architecture/codebase.md`](architecture/codebase.md) | Deep-dive 代码地图：技术栈、目录、各层职责 |
| [`docs/architecture/agents.md`](architecture/agents.md) | OpenCode 三种 runtime 模型与代理开发指南 |
| [`docs/architecture/backend.md`](architecture/backend.md) | 后端实现细节：远程 workspace、automation 等 |
| [`docs/architecture/automation.md`](architecture/automation.md) | AgentLab 调度与 automation 代码参考 |
| [`docs/architecture/infrastructure.md`](architecture/infrastructure.md) | 9 条基础设施原则（CLI-first / sidecar / local-first / ...） |

## Design — 视觉与交互

| 文件 | 作用 |
|------|------|
| [`docs/design/design-language.md`](design/design-language.md) | 视觉语言：扁平、premium、无 glassmorphism；CSS/Tailwind 规范 |

## Ops — 运营与发布

| 文件 | 作用 |
|------|------|
| [`docs/ops/release.md`](ops/release.md) | 构建/打 tag/发布流水线 checklist |
| [`docs/ops/triage.md`](ops/triage.md) | Issue 标签与处理流程 |
| [`docs/ops/translations.md`](ops/translations.md) | i18n / README 翻译贡献指南 |
| [`docs/ops/stats.md`](ops/stats.md) | 下载统计（v2 分类版） |

## Specs — 设计文档（"想做什么、为什么"）

> 命名约定：`YYYY-MM-DD-<short-name>-design.md`

按日期倒序：

| 文件 | 主题 |
|------|------|
| [`docs/specs/2026-04-22-preset-skills-externalization-design.md`](specs/2026-04-22-preset-skills-externalization-design.md) | 预设 skills 外置 |
| [`docs/specs/2026-04-21-workbook-cache-fixes-design.md`](specs/2026-04-21-workbook-cache-fixes-design.md) | Workbook 缓存：路径别名 + 错误分类 |
| [`docs/specs/2026-04-19-file-editor-robustness-design.md`](specs/2026-04-19-file-editor-robustness-design.md) | File editor 健壮性 |
| [`docs/specs/2026-04-17-file-editor-panel-design.md`](specs/2026-04-17-file-editor-panel-design.md) | File editor panel 重设计 |
| [`docs/specs/2026-04-08-sidebar-workspace-session.md`](specs/2026-04-08-sidebar-workspace-session.md) | 左侧栏 workspace & session 管理 |

## Plans — 实施计划（"分几步落地"）

> 命名约定：`YYYY-MM-DD-<short-name>.md`，通常对应一个 spec。

| 文件 | 主题 |
|------|------|
| [`docs/plans/2026-04-22-preset-skills-externalization.md`](plans/2026-04-22-preset-skills-externalization.md) | 预设 skills 外置实施 |
| [`docs/plans/2026-04-21-workbook-cache-fixes.md`](plans/2026-04-21-workbook-cache-fixes.md) | Workbook 缓存修复 |
| [`docs/plans/2026-04-18-file-editor-panel.md`](plans/2026-04-18-file-editor-panel.md) | File editor panel 实施 |
| [`docs/plans/2026-03-29-project-plan-reference.md`](plans/2026-03-29-project-plan-reference.md) | （历史参考）feature isolation roadmap，待重做 |

## Archive — 已完成 / 已废弃 / 历史

| 路径 | 内容 |
|------|------|
| [`docs/archive/blockers/`](archive/blockers/) | 2026-04-13 的 4 个 blocker 备忘（automation 状态、docker sandbox 裁剪、exa 搜索未就绪、skill hub 隐藏） |

---

## 命名约定

- 日期前缀: `YYYY-MM-DD-` (ISO 8601)
- specs 用 `-design.md` 后缀
- plans 不带后缀
- 文件名小写连字符

## 维护说明

- 新文档进对应主题目录，不要堆根目录
- 完成/废弃的 spec/plan 移到 `docs/archive/`
- 新增主题域时在本 INDEX 加一行
