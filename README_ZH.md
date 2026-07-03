# AuroWork

> 基于 OpenCode 的本地桌面 AI 工作区。

AuroWork 当前专注做一个可靠的本地桌面端软件：选择本地文件夹，启动本地会话，管理本地 `.opencode` 配置，并在用户授权的 workspace 内读写文件。

## 当前范围

- **本地桌面优先**：默认通过 Tauri 运行，服务绑定在本机 loopback。
- **Workspace 工作流**：选择一个本地文件夹，在这个授权范围内工作。
- **会话**：为当前 workspace 创建和切换 OpenCode-backed chat sessions。
- **本地配置**：管理 skills、commands、plugins、MCP config、providers 等 OpenCode 已支持的文件配置。
- **本地文件工具**：在桌面端读取和编辑 workspace 文件。
- **诊断与验证**：用 setup doctor、debug report、launch diagnostics、local eval 保证后续减法有证据。

远程 worker、在线分发、托管控制平面、团队模板不是当前产品目标。

## 快速开始

### 前置要求

| 工具 | 版本 |
|------|------|
| Node.js | LTS |
| pnpm | 10.27+ |
| Bun | 1.3+ |
| Rust toolchain | stable |
| Tauri 依赖 | 按操作系统安装桌面端依赖 |

### 安装与运行

```bash
pnpm install
pnpm setup:doctor
pnpm dev
```

`pnpm dev` 会启动本地桌面端开发环境，并使用隔离的本地开发状态。

`pnpm dev:ui` 只是浏览器里的 UI 预览入口，用于检查布局、路由和文案。它不能验证 Tauri 命令、本地文件夹选择、sidecar、engine 或 workspace 文件读写，所以不要把它当作产品 smoke test。

## 验证命令

```bash
pnpm setup:doctor        # 本地环境与仓库 setup 检查
pnpm docs:check          # 文档索引与当前产品承诺检查
pnpm verify:fast         # app/server/orchestrator TS 检查 + desktop cargo check
pnpm test:server         # server 测试
pnpm test:scripts        # release/publish/stats 脚本测试
pnpm eval:local-desktop  # 本地桌面 smoke eval
```

`pnpm verify:full` 和 `pnpm test:desktop` 包含需要绑定本地端口的测试，需要运行环境允许 loopback listener。

## 文档入口

- [`docs/INDEX.md`](docs/INDEX.md)：当前文档地图。
- [`docs/audit/2026-07-02-feature-audit.md`](docs/audit/2026-07-02-feature-audit.md)：当前功能审计。
- [`docs/specs/2026-07-02-local-desktop-subtraction-pipeline-design.md`](docs/specs/2026-07-02-local-desktop-subtraction-pipeline-design.md)：减法管线设计。
- [`docs/plans/2026-07-02-local-desktop-subtraction-pipeline.md`](docs/plans/2026-07-02-local-desktop-subtraction-pipeline.md)：减法管线实施计划。

旧 specs/plans 保留为历史材料。当前事实以代码和最新 audit 为准。

## 目录结构

```text
.
├── apps/
│   ├── app/             # SolidJS 前端
│   ├── desktop/         # Tauri 桌面壳
│   ├── server/          # 本地 AuroWork API sidecar
│   └── orchestrator/    # 本地进程编排
├── docs/                # 文档、审计、spec、plan、archive
├── scripts/             # setup、verify、docs、eval、release、dev 脚本
└── constants.json       # Auro/OpenCode engine 版本 pin
```

## 安全边界

- 本地服务默认只绑定 loopback。
- 文件访问必须限制在用户显式选择的 workspace 根目录内。
- 凭据和 token 不能提交到仓库。
- debug report 和 setup diagnostics 必须脱敏。

## License

MIT — see [LICENSE](./LICENSE).
