# Refactor TODO

> 本分支 `yxswe_refactor` 的剩余工作清单。
> 已完成的变更见 git log（commit `f41acac`、`0119f82`、`7cfe343`）。
> 详细蓝图与审计报告见 `.claude/plans/2026-04-29-*.md`。

---

## ✅ 已完成（本分支已 commit）

- **f41acac** — 根目录 docs 重组到 `docs/` 子目录（22 → 6 文件），统一 plans/specs 位置，建立 INDEX/README 索引，新增 `.claude/DEV_PROGRESS.md`
- **0119f82** — P0 修复：`scripts/release/{review,verify-tag}.mjs` 删除 opencode-router 校验；`docs/ops/release.md` 包名修正为 `@aurowork/desktop`
- **7cfe343** — 合并 `dev-windows-x64.cmd` 到 `dev-windows.cmd`（自动检测 host arch）；新增 `vendor/README.md` 作 OpenCode mirror setup 入口

---

## 🔴 高优先级

### 1. opencode-router 全量清理（蓝图阶段 3-8，约 35 文件）
> 蓝图: `.claude/plans/2026-04-29-opencode-router-removal.md`

- [ ] **阶段 2 - 收窄类型**
  - `apps/server/src/types.ts` 删 `opencodeRouter: boolean`
  - `apps/app/src/app/lib/aurowork-server.ts` 删 `proxy.opencodeRouter` + `RuntimeServiceName` union
  - `apps/app/src/app/lib/feedback.ts` 删 `opencodeRouterVersion`
  - `ee/apps/den-web/app/(den)/_lib/den-flow.ts` 同步 union
- [ ] **阶段 3 - 前端 UI**
  - `apps/app/src/app/pages/settings.tsx`（46 处，含整个状态卡片块）
  - `apps/app/src/app/app.tsx`（4 处 signal/props）
  - `apps/app/src/app/pages/{session,dashboard}.tsx`
  - `apps/app/src/i18n/locales/{en,zh}.ts` 删 4 条 key
- [ ] **阶段 4 - 后端服务器（最危险）**
  - `apps/server/src/server.ts`（60 处，约 800 行路由+代理逻辑）
  - `apps/server/README.md`
- [ ] **阶段 5 - 构建/发布脚本**
  - `apps/orchestrator/scripts/build-bin.ts` / `build-sidecars.mjs`
  - `apps/orchestrator/scripts/build-opencode-router.mjs` — **整文件 git rm**
  - `apps/orchestrator/scripts/publish-npm.mjs`
  - `apps/app/scripts/bump-version.mjs`
  - `apps/desktop/package.json` 删 `opencodeRouterVersion` 字段
- [ ] **阶段 6 - Dev/部署**
  - `scripts/dev/dev-headless-web.ts`（~13 处）
  - `ee/apps/den-controller/src/workers/{provisioner,daytona}.ts` 删 `--no-opencode-router` flag
  - `packaging/docker/{Dockerfile,docker-compose.dev.yml}`
- [ ] **阶段 7 - Landing/Feedback**
  - `ee/apps/landing/components/app-feedback-form.tsx`
  - `ee/apps/landing/app/feedback/page.tsx`
  - `ee/apps/landing/app/api/app-feedback/route.ts`
- [ ] **阶段 8 - 文档**
  - `docs/architecture/{overview,codebase,infrastructure}.md`
  - `docs/ops/release.md`
  - `.opencode/commands/release.md`
  - `.vercelignore` 删 `packages/opencode-router`
- [ ] **阶段 9 - 验证**
  - `pnpm typecheck` / `pnpm build:ui`
  - 全仓 grep 0 引用（`opencode-router|opencodeRouter|OPENCODE_ROUTER|opencode_router`）

### 2. P1 × 6（事实错误，详见 `.claude/plans/2026-04-29-audit-report.md`）
- [ ] `docs/architecture/agents.md` "Local Structure" 重写（L137-161 已严重过时）
- [ ] `docs/product/product.md:112` `./design.ts` → `docs/design/design-language.md`
- [ ] `docs/ops/translations.md:18` `packages/app/src/i18n/` → `apps/app/src/i18n/`，补 `pt-BR`
- [ ] `.opencode/skills/aurowork-core/SKILL.md` 路径 `packages/*` → `apps/*`
- [ ] `.opencode/skills/release/SKILL.md` 主分支 `main` → `dev`，路径 `packages/*` → `apps/*`
- [ ] `.opencode/skills/aurowork-orchestrator-npm-publish/SKILL.md:60` 脚本名拼写（"openwork" 残留）

---

## 🟡 中优先级

### 3. P2 × 12（OpenCode 遗留 + 杂项，按"强化 AuroWork 独立性"方向重写）
- [ ] `docs/product/vision.md` 删 lowercase `opencode`、`opencode.ai` 域名、"thin layer" 措辞
- [ ] `docs/product/principles.md` 重写"thin wrapper"叙事
- [ ] `docs/architecture/overview.md` "we" 语言改为产品视角；L88-121 OpenCode primitives 教程精简到 1-2 段 + 官方链接
- [ ] `docs/architecture/agents.md:163-176` 删/简化 OpenCode SDK section
- [ ] `docs/design/design-language.md` 删 6 处 `_repos/aurowork/...` 前缀
- [ ] `docs/product/product.md:8-17` Susan section 完成 + 修 typo（`certaintly` / `paly aorund` / `ther`）
- [ ] `docs/architecture/overview.md:145` 删 `/apps/opencode-router/` 引用（与阶段 8 合并）
- [ ] `docs/architecture/automation.md:101-106` preset 列表 `remote` → `minimal`
- [ ] `docs/architecture/codebase.md:32` 硬编码版本号去除（改为脚本生成或 "current" 标识）
- [ ] `docs/architecture/backend.md:4` 删 `/Users/yangxiao/...` 绝对路径
- [ ] `.opencode/skills/cargo-lock-manager/SKILL.md` 路径 `packages/desktop` → `apps/desktop`

---

## 🟢 低优先级

- [ ] 30 天后清理根目录 stub 文件（保留期至 2026-05-29）

---

## 📋 决策记录（已拍板，待落地）

| 决定 | 落地范围 |
|------|---------|
| dev-windows-x64.cmd → 合并到 dev-windows.cmd | ✅ 已完成 |
| vendor/opencode 保留 skill + setup 文档 | ✅ 已完成 |
| OpenCode 品牌定位：强化 AuroWork 独立性 | 影响 P2 × 5（vision/principles/overview/agents/design） |
| overview.md primitives 教程：留着但精简 | 列入 P2 |

---

## 🔗 参考

- 审计报告: `.claude/plans/2026-04-29-audit-report.md`
- 删除蓝图: `.claude/plans/2026-04-29-opencode-router-removal.md`
- 文档整理方案: `.claude/plans/2026-04-29-docs-and-scripts-cleanup.md`
- 开发追踪: `.claude/DEV_PROGRESS.md`
