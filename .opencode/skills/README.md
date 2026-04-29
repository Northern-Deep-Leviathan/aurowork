# OpenCode Skills

AuroWork 项目级的 OpenCode 技能（与 OpenCode CLI 配套使用）。
13 个 skill，全部 active（最近一次盘点：2026-04-29）。

## 清单

| Skill | 用途 |
|-------|------|
| `aurowork-core` | 核心上下文与护栏：贯穿所有 session 的项目背景 |
| `aurowork-debug` | 调试工具集：HTTP / MCP / SQLite 查询命令 |
| `aurowork-docker-chrome-mcp` | 启动 dev stack 并在 Chrome 中验证关键流程 |
| `aurowork-orchestrator-npm-publish` | 发布 orchestrator npm sidecar 二进制 |
| `browser-setup-devtools` | 引导配置 Chrome DevTools MCP；扩展回退方案 |
| `cargo-lock-manager` | 处理 Cargo.lock 同步与 `--locked` flag |
| `get-started` | 新 workspace 欢迎 + Chrome 演示（"hey go google.com"） |
| `opencode-bridge` | OpenCode CLI / DB / MCP 通信模式参考 |
| `opencode-mirror` | 维护 vendor/opencode git mirror |
| `opencode-primitives` | OpenCode 文档参考（skills/plugins/MCP/config） |
| `release` | 发布流程：prepare → tag → ship → verify |
| `solidjs-patterns` | SolidJS signals 与作用域内异步状态模式 |
| `tauri-solidjs` | Tauri 2.x + SolidJS 技术栈指南 |

## 维护

- 新 skill 用小写连字符命名
- 每个 skill 一个目录，主文件 `SKILL.md`，配套脚本放 `scripts/`
- 添加 / 移除时更新本 README
