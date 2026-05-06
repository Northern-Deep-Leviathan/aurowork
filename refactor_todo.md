# Refactor TODO

> 本分支 `yxswe_refactor` 的剩余工作清单。
> 已完成的变更见 git log。
> 详细蓝图与审计报告见 `.claude/plans/2026-04-29-*.md`。

---

## ✅ 已完成（本分支已 commit）

- **f41acac** — 根目录 docs 重组到 `docs/` 子目录（22 → 6 文件），统一 plans/specs 位置，建立 INDEX/README 索引，新增 `.claude/DEV_PROGRESS.md`
- **0119f82** — P0 修复：`scripts/release/{review,verify-tag}.mjs` 删除 opencode-router 校验；`docs/ops/release.md` 包名修正为 `@aurowork/desktop`
- **7cfe343** — 合并 `dev-windows-x64.cmd` 到 `dev-windows.cmd`（自动检测 host arch）；新增 `vendor/README.md` 作 OpenCode mirror setup 入口
- **f93e252** — P1 × 6 修复（agents.md Local Structure 重写；product.md/translations.md/aurowork-core/release skills 路径修正；publish 脚本拼写修正）
- **958a4fc** — opencode-router 阶段 2-3：types 收窄 + 前端 UI 清理（settings/app/session/dashboard/i18n）
- **555e43d** — opencode-router 阶段 4：server.ts 移除路由+代理逻辑（约 −1825 行，tsc 通过）
- **554c8b8** — opencode-router 阶段 5-8：构建/发布脚本、dev/部署、landing、docs 清理
- **d7ae25c** — opencode-router 阶段 9 stragglers：剩余字符串引用清扫，aurowork-server context router polling 移除

---

## 🟡 中优先级（待执行）

### P2 × 12（OpenCode 遗留 + 杂项，按"强化 AuroWork 独立性"方向重写）
- [ ] `docs/product/vision.md` 删 lowercase `opencode`、`opencode.ai` 域名、"thin layer" 措辞
- [ ] `docs/product/principles.md` 重写"thin wrapper"叙事
- [ ] `docs/architecture/overview.md` "we" 语言改为产品视角；L88-121 OpenCode primitives 教程精简到 1-2 段 + 官方链接
- [ ] `docs/architecture/agents.md:163-176` 删/简化 OpenCode SDK section
- [ ] `docs/design/design-language.md` 删 6 处 `_repos/aurowork/...` 前缀
- [ ] `docs/product/product.md:8-17` Susan section 完成 + 修 typo（`certaintly` / `paly aorund` / `ther`）
- [ ] `docs/architecture/automation.md:101-106` preset 列表 `remote` → `minimal`
- [ ] `docs/architecture/codebase.md:32` 硬编码版本号去除（改为脚本生成或 "current" 标识）
- [ ] `docs/architecture/backend.md:4` 删 `/Users/yangxiao/...` 绝对路径
- [ ] `.opencode/skills/cargo-lock-manager/SKILL.md` 路径 `packages/desktop` → `apps/desktop`

---

## 🟢 低优先级

- [ ] 30 天后清理根目录 stub 文件（保留期至 2026-05-29）

---

## 📋 决策记录

| 决定 | 落地范围 |
|------|---------|
| dev-windows-x64.cmd → 合并到 dev-windows.cmd | ✅ 已完成 |
| vendor/opencode 保留 skill + setup 文档 | ✅ 已完成 |
| OpenCode 品牌定位：强化 AuroWork 独立性 | 影响 P2 × 5（vision/principles/overview/agents/design） |
| overview.md primitives 教程：留着但精简 | 列入 P2 |
| opencode-router 全量清理 | ✅ 已完成（阶段 2-9） |
| P1 × 6 事实错误修复 | ✅ 已完成 |

---

## 🔗 参考

- 审计报告: `.claude/plans/2026-04-29-audit-report.md`
- 删除蓝图: `.claude/plans/2026-04-29-opencode-router-removal.md`
- 文档整理方案: `.claude/plans/2026-04-29-docs-and-scripts-cleanup.md`
- 开发追踪: `.claude/DEV_PROGRESS.md`

---

## ⚠️ Stage 9 验证说明

`pnpm typecheck` 在 `apps/app` 上仍有错误，**但全部为 pre-existing**（在 router 清理工作之前已存在），与本批次无关：
- `publishBundle` / `listAudit` / `listScheduledJobs` / `materializeBlueprintSessions` 等方法在 client 上缺失
- `WorkspaceAuroworkConfig.blueprint` 类型字段缺失
- `SettingsViewProps` 缺多个必填 prop
- `SheetEditorView.tsx` 找不到 `react` 模块
- `SandboxDoctorResult.debug` 字段缺失

已通过 `git stash` + 重跑 typecheck 确认这些错误在 baseline 上同样出现。

全仓 grep `opencode-router|opencodeRouter|OpenCode.?Router` 仅剩 2 个文件命中（均为有意保留）：
- `refactor_todo.md`（本文件）
- `.github/workflows/release-macos-aarch64.yml.disabled`（已禁用的历史 workflow）
