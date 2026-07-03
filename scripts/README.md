# Scripts

AuroWork 工程脚本。`*.mjs` / `*.ts` 为 Node/Bun，`*.sh` / `*.cmd` 为 shell。

## 顶层

| 脚本 | 作用 | 触发 |
|------|------|------|
| `build.mjs` | 构建本地桌面应用 | `pnpm build` |
| `stats.mjs` | 从 PostHog 聚合下载统计，写入 `docs/ops/stats.md` | 手动 |
| `stats.test.mjs` | `stats.mjs` 的单元测试 | `node --test scripts/stats.test.mjs` |

## `setup/` — 本地环境检查

| 脚本 | 作用 | 触发 |
|------|------|------|
| `setup/doctor.mjs` | 检查本地桌面开发所需工具、frozen lockfile、Tauri/sidecar 入口，并阻止 legacy headless root 入口回流 | `pnpm setup:doctor` / `pnpm setup:doctor:json` |

## `verify/` — 本地桌面减法前置验证

| 脚本 | 作用 | 触发 |
|------|------|------|
| `verify/fast.mjs` | app/server/orchestrator typecheck + desktop `cargo check` | `pnpm verify:fast` |
| `verify/full.mjs` | fast gate + server/app/orchestrator/desktop/script tests | `pnpm verify:full` |
| `verify/release.mjs` | full gate + app build + sidecar prepare + release review | `pnpm verify:release` |
| `verify/script-tests.mjs` | release/publish/stats 脚本测试集合 | `pnpm test:scripts` |

## `docs/` — 文档体系检查

| 脚本 | 作用 | 触发 |
|------|------|------|
| `docs/index-check.mjs` | 确保 `docs/INDEX.md` 覆盖所有 `docs/` 文件 | `pnpm docs:index:check` |
| `docs/claims-check.mjs` | 拦截 README/current docs 里的 remote/cloud/fork 旧产品承诺 | `pnpm docs:claims:check` |
| `docs/check.mjs` | 文档索引与产品承诺组合检查 | `pnpm docs:check` |

## `debug/` — 诊断报告

| 脚本 | 作用 | 触发 |
|------|------|------|
| `debug/report.mjs` | 生成本地桌面 debug report，包含 `setup:doctor --json` 并递归脱敏 token/secret/auth/header/home path | `pnpm debug:report` |

## `eval/` — 产品级本地桌面 smoke eval

| 脚本 | 作用 | 触发 |
|------|------|------|
| `eval/local-desktop.mjs` | 不依赖网络或端口监听的本地 workspace / `.opencode` / setup/debug smoke eval | `pnpm eval:local-desktop` |

## `dev/` — 本地开发启动

根入口：

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 启动 Tauri 本地桌面开发环境；用于验证本地文件夹、sidecar、engine 和 workspace 文件能力 |
| `pnpm dev:ui` | 只启动浏览器 UI 预览；仅用于布局、路由、文案检查，不作为产品 smoke test |

| 脚本 | 作用 | 触发 |
|------|------|------|
| `dev/dev-windows.cmd` | Windows 桌面 dev（自动检测 host arch + VS Build Tools） | `pnpm dev:windows` 或手动 |

Legacy files retained for review:

| 脚本 | 状态 |
|------|------|
| `dev/dev-headless-web.ts` | Legacy headless/web helper; no root npm script exposes it while the product target is local desktop. Delete or archive during the remote/headless subtraction pass. |

## `release/` — 发布流水线

按调用顺序：

| 脚本 | 作用 | 触发 |
|------|------|------|
| `release/review.mjs` | 检查 workspace 版本一致性、root 自动化脚本、默认桌面构建目标、CI/发布质量门禁 | `pnpm release:review` |
| `release/prepare.mjs` | 升版本号、verify、commit、打 tag（不 push） | `pnpm release:prepare` |
| `release/ship.mjs` | push tag + dev 分支，触发 GitHub Actions | `pnpm release:ship` |
| `release/verify-tag.mjs` | CI 中校验 tag 与 package.json 版本一致 | GHA workflow |
| `release/generate-latest-json.mjs` | 生成桌面端 updater 用的 `latest.json` 清单 | GHA workflow |

## `aur/` — Arch Linux AUR 发布

| 脚本 | 作用 | 触发 |
|------|------|------|
| `aur/update-aur.sh` | 更新 PKGBUILD 与 .SRCINFO | 由下面两个脚本调用 |
| `aur/open-pr.sh` | tag 后创建 AUR PR | 手动/CI |
| `aur/publish-aur.sh` | 通过 SSH 发布到 AUR | 手动/CI |

## `snapshot/` — Daytona 镜像

| 脚本 | 作用 | 触发 |
|------|------|------|
| `snapshot/create-daytona-aurowork-snapshot.sh` | 构建并推送 Daytona workspace snapshot 镜像 | 手动（需 Daytona + Docker） |

---

## 维护

- 新增 dev 脚本放 `dev/`，新增发布脚本放 `release/`
- 在 `package.json` 注册 npm 脚本时同步更新本 README
