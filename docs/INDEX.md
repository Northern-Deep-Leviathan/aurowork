# Documentation Index

> AuroWork 项目文档导航。最后整理：2026-07-02。
>
> 当前整理原则：**代码和最新 audit 是事实依据；旧 spec/plan/README 是历史输入，使用前必须重新核对代码。**

---

## How To Read These Docs

| 状态 | 含义 |
|------|------|
| Current | 当前可作为工作入口或维护依据，但仍建议改代码前快速核对实现。 |
| Audit | 当前减法、清理、风险判断依据。优先级高于旧产品文档。 |
| Historical | 历史计划、设计或诊断材料。不要直接当作当前功能承诺。 |
| Runbook | 运维流程文档。执行前需核对当前 CI/release 脚本。 |
| Todo | 明确待办事项，用于后续一起执行。 |

## Root Entry Points

| 文件 | 状态 | 作用 |
|------|------|------|
| `README.md` | Current | 英文项目入口；已收敛为本地桌面优先范围。 |
| `README_ZH.md` | Current | 简体中文项目入口；已收敛为本地桌面优先范围。 |
| `README_ZH_hk.md` | Current | 繁体中文项目入口；已收敛为本地桌面优先范围。 |
| `LICENSE` | Current | 许可证。 |

## Audit And Todo

| 文件 | 状态 | 作用 |
|------|------|------|
| [`docs/audit/2026-07-02-feature-audit.md`](audit/2026-07-02-feature-audit.md) | Audit | 当前功能完整性审计；后续做功能减法的主要依据。 |
| [`docs/specs/2026-07-02-local-desktop-subtraction-pipeline-design.md`](specs/2026-07-02-local-desktop-subtraction-pipeline-design.md) | Current | 本地桌面优先减法工程管线设计：release/setup/test/debug/eval/docs。 |
| [`docs/plans/2026-07-02-local-desktop-subtraction-pipeline.md`](plans/2026-07-02-local-desktop-subtraction-pipeline.md) | Current | 减法前置自动化管线实施计划。 |
| [`docs/superpowers/todo/2026-07-02-feature-subtraction-todo.md`](superpowers/todo/2026-07-02-feature-subtraction-todo.md) | Todo | 从审计中提炼出的 7 个高优先级减法/修复事项。 |
| [`docs/superpowers/todo/2026-05-24-workspace-architecture-notes.md`](superpowers/todo/2026-05-24-workspace-architecture-notes.md) | Historical | Workspace 切换延迟与多实例架构讨论笔记，未定稿。 |

## Product

| 文件 | 状态 | 作用 |
|------|------|------|
| [`docs/product/vision.md`](product/vision.md) | Historical | 1000x 生产力使命、chat/cloud mental model；部分内容已被审计标记为过度承诺。 |
| [`docs/product/product.md`](product/product.md) | Historical | Bob/Susan 目标用户与产品想法；拼写和功能承诺需重做。 |
| [`docs/product/principles.md`](product/principles.md) | Current | 产品/工程判断原则；使用时以最新 audit 约束范围。 |

## Architecture

| 文件 | 状态 | 作用 |
|------|------|------|
| [`docs/architecture/overview.md`](architecture/overview.md) | Current | 架构总览：predictable-first、Tauri/server 角色、文件系统策略。 |
| [`docs/architecture/backend.md`](architecture/backend.md) | Historical | Backend symbol reference；最后核对 2026-05-07，使用前需复核代码。 |
| [`docs/architecture/automation.md`](architecture/automation.md) | Historical | AgentLab automation 代码参考；automation 当前被审计为半成品。 |
| [`docs/architecture/codebase.md`](architecture/codebase.md) | Historical | 代码库 deep-dive；最后更新 2026-04-12。 |
| [`docs/architecture/agents.md`](architecture/agents.md) | Historical | Agent/skill/MCP 产品与 runtime 说明；含 cloud-ready 旧定位。 |
| [`docs/architecture/infrastructure.md`](architecture/infrastructure.md) | Current | CLI-first、sidecar、local-first 等基础设施原则。 |

## Design

| 文件 | 状态 | 作用 |
|------|------|------|
| [`docs/design/design-language.md`](design/design-language.md) | Current | 应用视觉语言与 UI 约束。 |

## Ops

| 文件 | 状态 | 作用 |
|------|------|------|
| [`docs/ops/release.md`](ops/release.md) | Current | 本地桌面发布 runbook；以 `pnpm verify:release`、`pnpm release:review` 和 active workflows 为准。 |
| [`docs/ops/azure-release-mirror.md`](ops/azure-release-mirror.md) | Runbook | Azure Blob release mirror 运维说明。 |
| [`docs/ops/triage.md`](ops/triage.md) | Current | Issue triage 标签与处理规则。 |
| [`docs/ops/translations.md`](ops/translations.md) | Current | README/UI 翻译贡献指南。 |
| [`docs/ops/stats.md`](ops/stats.md) | Historical | 下载统计快照。 |

## Specs

> Specs 描述“想做什么、为什么”。日期越早越可能与当前代码偏离。

| 文件 | 状态 | 主题 |
|------|------|------|
| [`docs/specs/2026-07-02-local-desktop-subtraction-pipeline-design.md`](specs/2026-07-02-local-desktop-subtraction-pipeline-design.md) | Current | 本地桌面优先减法工程管线设计。 |
| [`docs/specs/2026-05-11-first-launch-starter-task-load-error.md`](specs/2026-05-11-first-launch-starter-task-load-error.md) | Historical | First-launch starter task load error 竞态诊断。 |
| [`docs/specs/2026-05-06-frontend-type-errors-cleanup.md`](specs/2026-05-06-frontend-type-errors-cleanup.md) | Historical | Frontend type errors cleanup 诊断与计划。 |
| [`docs/specs/2026-04-28-opencode-to-auro-rename-design.md`](specs/2026-04-28-opencode-to-auro-rename-design.md) | Historical | OpenCode 到 Auro 命名迁移设计。 |
| [`docs/specs/2026-04-22-preset-skills-externalization-design.md`](specs/2026-04-22-preset-skills-externalization-design.md) | Historical | Preset skills externalization 设计。 |
| [`docs/specs/2026-04-21-workbook-cache-fixes-design.md`](specs/2026-04-21-workbook-cache-fixes-design.md) | Historical | Workbook cache path aliasing 与 error-class 修复设计。 |
| [`docs/specs/2026-04-19-file-editor-robustness-design.md`](specs/2026-04-19-file-editor-robustness-design.md) | Historical | File editor robustness 改进设计。 |
| [`docs/specs/2026-04-17-file-editor-panel-design.md`](specs/2026-04-17-file-editor-panel-design.md) | Historical | File editor panel redesign。 |
| [`docs/specs/2026-04-08-sidebar-workspace-session.md`](specs/2026-04-08-sidebar-workspace-session.md) | Historical | 左侧栏 workspace/session 产品逻辑。 |

## Plans

> Plans 描述“分几步落地”。完成状态需要通过代码和 git 历史确认。

| 文件 | 状态 | 主题 |
|------|------|------|
| [`docs/plans/2026-07-02-local-desktop-subtraction-pipeline.md`](plans/2026-07-02-local-desktop-subtraction-pipeline.md) | Current | 减法前置自动化管线实施计划。 |
| [`docs/plans/2026-05-11-global-model-selection.md`](plans/2026-05-11-global-model-selection.md) | Historical | 全局共享 model 选择重构方案。 |
| [`docs/plans/2026-05-06-frontend-type-errors-cleanup.md`](plans/2026-05-06-frontend-type-errors-cleanup.md) | Historical | Frontend type errors cleanup 实施计划。 |
| [`docs/plans/2026-04-28-opencode-to-auro-rename.md`](plans/2026-04-28-opencode-to-auro-rename.md) | Historical | OpenCode 到 Auro rename 实施计划。 |
| [`docs/plans/2026-04-22-preset-skills-externalization.md`](plans/2026-04-22-preset-skills-externalization.md) | Historical | Preset skills externalization 实施计划。 |
| [`docs/plans/2026-04-21-workbook-cache-fixes.md`](plans/2026-04-21-workbook-cache-fixes.md) | Historical | Workbook cache fixes 实施计划。 |
| [`docs/plans/2026-04-18-file-editor-panel.md`](plans/2026-04-18-file-editor-panel.md) | Historical | File editor panel 实施计划。 |
| [`docs/plans/2026-03-29-project-plan-reference.md`](plans/2026-03-29-project-plan-reference.md) | Historical | 早期 feature isolation roadmap，当前只作参考。 |

## Superpowers Specs

| 文件 | 状态 | 主题 |
|------|------|------|
| [`docs/superpowers/specs/2026-05-24-windows-launch-perf-and-tags-design.md`](superpowers/specs/2026-05-24-windows-launch-perf-and-tags-design.md) | Historical | Windows launch performance 与 launch-log tag 修复设计。 |
| [`docs/superpowers/specs/2026-05-24-launch-log-internal-phases-design.md`](superpowers/specs/2026-05-24-launch-log-internal-phases-design.md) | Historical | Launch-log internal phases 设计。 |
| [`docs/superpowers/specs/2026-05-23-debug-tab-and-launch-diagnostic-design.md`](superpowers/specs/2026-05-23-debug-tab-and-launch-diagnostic-design.md) | Historical | Debug tab consolidation 与 launch diagnostic 设计。 |
| [`docs/superpowers/specs/2026-05-21-launch-logging-design.md`](superpowers/specs/2026-05-21-launch-logging-design.md) | Historical | Launch-phase 统一日志与 dev mode 收敛设计。 |
| [`docs/superpowers/specs/2026-05-17-build-desktop-pr-bump-design.md`](superpowers/specs/2026-05-17-build-desktop-pr-bump-design.md) | Historical | build-desktop PR-based version bump 设计。 |
| [`docs/superpowers/specs/2026-05-15-sync-auro-version-design.md`](superpowers/specs/2026-05-15-sync-auro-version-design.md) | Historical | Sync Auro version workflow 设计。 |

## Superpowers Plans

| 文件 | 状态 | 主题 |
|------|------|------|
| [`docs/superpowers/plans/2026-05-26-azure-blob-release-mirror.md`](superpowers/plans/2026-05-26-azure-blob-release-mirror.md) | Historical | Azure Blob release mirror 实施计划。 |
| [`docs/superpowers/plans/2026-05-24-windows-launch-perf-and-tags.md`](superpowers/plans/2026-05-24-windows-launch-perf-and-tags.md) | Historical | Windows launch performance 与 tag 修复实施计划。 |
| [`docs/superpowers/plans/2026-05-24-launch-log-internal-phases.md`](superpowers/plans/2026-05-24-launch-log-internal-phases.md) | Historical | Launch-log internal phases 实施计划。 |
| [`docs/superpowers/plans/2026-05-23-debug-tab-launch-diagnostic.md`](superpowers/plans/2026-05-23-debug-tab-launch-diagnostic.md) | Historical | Debug tab + launch diagnostic 实施计划。 |
| [`docs/superpowers/plans/2026-05-21-launch-logging-dev-mode.md`](superpowers/plans/2026-05-21-launch-logging-dev-mode.md) | Historical | Launch logging + dev mode 实施计划。 |
| [`docs/superpowers/plans/2026-05-17-build-desktop-pr-bump.md`](superpowers/plans/2026-05-17-build-desktop-pr-bump.md) | Historical | build-desktop PR-based bump 实施计划。 |
| [`docs/superpowers/plans/2026-05-17-sync-auro-version.md`](superpowers/plans/2026-05-17-sync-auro-version.md) | Historical | Sync Auro version 实施计划。 |

## Archive

| 文件 | 状态 | 作用 |
|------|------|------|
| [`docs/archive/blockers/2026-04-13-automation-status.md`](archive/blockers/2026-04-13-automation-status.md) | Historical | Automation 能力现状评估；当前 audit 也确认 automation 主 UI 未产品化。 |
| [`docs/archive/blockers/2026-04-13-docker-sandbox-pruned.md`](archive/blockers/2026-04-13-docker-sandbox-pruned.md) | Historical | Docker sandbox 已裁剪记录。 |
| [`docs/archive/blockers/2026-04-13-exa-search-not-ready.md`](archive/blockers/2026-04-13-exa-search-not-ready.md) | Historical | Exa web search 未就绪记录。 |
| [`docs/archive/blockers/2026-04-13-skill-hub-hidden.md`](archive/blockers/2026-04-13-skill-hub-hidden.md) | Historical | Skill Hub UI 暂时屏蔽记录。 |

---

## Naming And Maintenance

- 日期前缀使用 `YYYY-MM-DD-`。
- Specs 用 `-design.md` 后缀，plans 不带后缀。
- 新文档进入对应主题目录，不堆根目录。
- 新增文档时必须更新本索引。
- 完成、废弃、被代码证明过时的文档，优先移动到 `docs/archive/` 或标记为 Historical。
- 产品文案和 README 可作为当前范围入口；具体行为仍以代码、audit、自动化验证结果为准。
