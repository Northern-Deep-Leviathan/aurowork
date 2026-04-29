# Scripts

AuroWork 工程脚本。`*.mjs` / `*.ts` 为 Node/Bun，`*.sh` / `*.cmd` 为 shell。

## 顶层

| 脚本 | 作用 | 触发 |
|------|------|------|
| `build.mjs` | 条件构建：Vercel 环境只构建 web，否则构建桌面 | `pnpm build` |
| `stats.mjs` | 从 PostHog 聚合下载统计，写入 `docs/ops/stats.md` | 手动 |
| `stats.test.mjs` | `stats.mjs` 的单元测试 | `node --test scripts/stats.test.mjs` |

## `dev/` — 本地开发启动

| 脚本 | 作用 | 触发 |
|------|------|------|
| `dev/dev-headless-web.ts` | 无头启动 web dev server（用于自动化/CI） | `pnpm dev:headless-web` |
| `dev/dev-web-local.sh` | Docker 本地启动 den-controller + den-web | `pnpm dev:web-local` |
| `dev/dev-windows.cmd` | Windows ARM64 桌面 dev（含 VS Build Tools 检查） | `pnpm dev:windows` 或手动 |
| `dev/dev-windows-x64.cmd` | Windows x64 桌面 dev | 手动 |

## `release/` — 发布流水线

按调用顺序：

| 脚本 | 作用 | 触发 |
|------|------|------|
| `release/review.mjs` | 检查所有 workspace 版本一致性 | `pnpm release:review` |
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
