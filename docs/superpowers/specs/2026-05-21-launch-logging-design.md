# AuroWork Launch-Phase 统一日志 + Dev Mode 收敛 — 设计文档

- 日期: 2026-05-21
- 分支: `feat/launch-logging-dev-mode`
- 适用范围: `apps/desktop` (Tauri/Rust)、`apps/app` (SolidJS 前端)、`apps/orchestrator` (Bun, 仅消费侧无改动)

## 1. 背景与问题

AuroWork 冷启动跨越 5 个组件（Tauri shell → orchestrator daemon → Auro 引擎 `opencode serve` → aurowork-server sidecar → 前端 UI），但目前几乎没有可复盘的 launch 日志:

- Rust 桌面层只用 `eprintln!`，且把 sidecar 的 stdout/stderr **截断到 8KB** 存内存 → 多分钟的启动序列早期上下文被覆盖丢失。
- 没有任何统一的日志文件，所有输出散在 stdout/stderr，应用退出后无法回溯。
- 前端 bootstrap 阶段（theme/i18n/deep-link/providers）没有任何 launch 日志。
- "开发者模式" 概念散落在 3 处 (`lib.rs`、`engine/spawn.rs`、`orchestrator/mod.rs`)，每处独立读 `AUROWORK_DEV_MODE`。

## 2. 目标

1. **dev 模式下**，把 5 个阶段的 launch 日志按统一格式 + 5 个 tag 写到 per-launch 文件，sidecar 输出全量转发（不截断）。
2. **非 dev 模式下**，行为与现状完全一致 (8KB 截断、stdout 输出、零文件写入、零性能开销)。
3. 把 `AUROWORK_DEV_MODE` 解析收敛到单一来源 `dev_mode::is_enabled()`。
4. Settings UI 增加 "Open launch log folder" 入口，可视化当次 log 路径。

## 3. 非目标

- 不做 UI 内置的 Launch Log 面板（留给后续迭代）。
- 不做 `RUST_LOG` 级别动态切换、不引入 `tracing` 全套生态（局部、低成本注入即可，避免大改）。
- 不打 Tauri command 调用入参/返回（噪音太大，未来如需另开开关）。
- 不做 E2E 测试，启动流程改动主要靠 dogfood 验证。

## 4. 总体架构

新增 Rust 模块 `apps/desktop/src-tauri/src/launch_log/`，作为**单一写者**的日志聚合器:

```
┌────────────────────────────────────────────────────────────┐
│                    LaunchLogAggregator                     │
│            (Mutex<BufWriter<File>>, dev gate)              │
└────────────────────────────────────────────────────────────┘
       ▲             ▲             ▲             ▲
       │             │             │             │
  [launch:shell] [launch:orchestr] [launch:engine] [launch:server]
   lib.rs        orchestrator/    engine/        aurowork_server/
   setup         mod.rs spawn     spawn.rs       spawn.rs
                 +health poll     +stdio fwd     +stdio fwd
                                                  +port/token
       ▲
       │ Tauri invoke (batched, throttled)
       │
  [launch:ui]
  apps/app/src/index.tsx, entry.tsx, lib/launch-log.ts
```

**跨进程时间统一**: sidecar (Bun/OpenCode) 不直接写文件; 现有 stdout/stderr 经 Rust event reader 接收时由 Rust 打 timestamp 并 append。误差 ms 级，可接受。Rust 单写者 = 无锁竞争 = 实现最简单。

## 5. Tag 规范

| Tag | 来源 | 职责 |
|---|---|---|
| `[launch:shell]` | Tauri Rust 主进程 | `lib.rs run()/setup()`、manager 初始化、command 注册、退出钩子、summary |
| `[launch:orchestr]` | Rust 侧的 orchestrator 启动器 | spawn 命令、health polling、ready/timeout |
| `[launch:engine]` | Rust 侧的 engine 启动器 + Bun 进程转发 | 沙箱 XDG、auth 准备、spawn、stdout/stderr 全量 |
| `[launch:server]` | Rust 侧的 aurowork-server 启动器 + Bun 进程转发 | port 解析、token 生成、spawn、stdout/stderr 全量、listening 确认 |
| `[launch:ui]` | SolidJS 前端 | theme/i18n/deep-link/platform/providers/first-paint、未捕获异常 |

### 日志行格式（一行一条）

```
2026-05-21T10:23:45.123+08:00  INFO  [launch:engine]    pid=12345  spawning opencode serve --port 41337
2026-05-21T10:23:46.891+08:00  ERROR [launch:server]    pid=12346  port allocation failed: address in use
    └─ stack: aurowork_server::spawn::resolve_aurowork_port at spawn.rs:42
              aurowork_server::spawn::spawn_aurowork_server at spawn.rs:135
              engine::start at engine.rs:519
```

- timestamp: ISO 8601 带本地时区，毫秒精度
- level: `TRACE | DEBUG | INFO | WARN | ERROR`（5 字符等宽）
- tag: 左对齐填充到 18 字符
- `pid=N` 可选字段
- stack: 仅 ERROR 行，缩进 4 空格 + `└─` 引导

### 文件 Header

```
=== AuroWork Launch Log ===
started_at:    2026-05-21T10:23:45.123+08:00
app_version:   0.1.0
auro_version:  v0.1.0
platform:      macos-aarch64
dev_mode:      true
log_file:      /Users/yangxiao/Library/Logs/com.nld.aurowork.dev/launch-20260521-102345.log
============================
```

## 6. 各阶段埋点详表

### 6.1 `[launch:shell]` — `apps/desktop/src-tauri/src/lib.rs`

| 时机 | 级别 | 内容示例 |
|---|---|---|
| `run()` 进入 | INFO | `aurowork desktop starting, version=0.1.0, dev_mode=true, log_file=<path>` |
| `setup()` 每个 manager 初始化前后 | DEBUG | `initializing EngineManager` / `initialized in 3ms` |
| commands 注册完成 | DEBUG | `registered N invoke handlers` |
| `setup()` 完成 | INFO | `setup complete in <ms>ms` |
| 退出钩子 | INFO | `shutdown requested, stopping managed services` |
| 前端调 `launch_log_summary` 时 | INFO | `=== launch summary === shell=Xms orchestr=Yms engine=Zms server=Wms ui=Vms total=Tms` |

### 6.2 `[launch:orchestr]` — `apps/desktop/src-tauri/src/orchestrator/mod.rs` + `commands/engine.rs`

| 时机 | 级别 | 内容 |
|---|---|---|
| spawn 前 | INFO | `spawning orchestrator daemon, port=N, data_dir=<path>, args=[...]` |
| spawn 后 | INFO | `orchestrator spawned pid=N` |
| health polling 开始 | DEBUG | `polling http://127.0.0.1:N/health, timeout=180s` |
| 每次 polling 失败 | TRACE | `health check attempt #N: connection refused` |
| polling 成功 | INFO | `orchestrator ready in <ms>ms, opencode_port=N` |
| polling 超时 | ERROR | `orchestrator health timeout after 180s` + 最后 stdout/stderr 摘要 |

### 6.3 `[launch:engine]` — `apps/desktop/src-tauri/src/engine/spawn.rs`

| 时机 | 级别 | 内容 |
|---|---|---|
| dev 沙箱目录创建 | DEBUG | `dev sandbox: XDG_DATA_HOME=<path>, XDG_CACHE_HOME=<path>` |
| auth 凭据准备 | DEBUG | `auth credentials prepared (length=512)` |
| spawn 前 | INFO | `spawning opencode serve --port N --hostname 127.0.0.1` |
| spawn 后 | INFO | `engine spawned pid=N` |
| 所有 stdout/stderr (dev only) | DEBUG (stdout) / WARN (stderr) | 逐行全量转发，附 `pid` |

### 6.4 `[launch:server]` — `apps/desktop/src-tauri/src/aurowork_server/spawn.rs`

| 时机 | 级别 | 内容 |
|---|---|---|
| 端口解析 | DEBUG | `port resolution: preferred=N, resolved=M (range 48000-51000)` |
| token 生成 | DEBUG | `tokens generated for workspace=<path>` |
| spawn 前 | INFO | `spawning aurowork-server --port N --workspace <path>` |
| spawn 后 | INFO | `aurowork-server spawned pid=N` |
| 所有 stdout/stderr (dev only) | DEBUG / WARN | 逐行全量转发 |
| listening 确认（首次 GET /health 成功） | INFO | `aurowork-server ready in <ms>ms` |

### 6.5 `[launch:ui]` — `apps/app/src/index.tsx` + `app/entry.tsx`

前端通过 Tauri command `launch_log_append_batch(entries[])` 写入同一文件。

| 时机 | 级别 | 内容 |
|---|---|---|
| `bootstrapTheme()` 前后 | DEBUG | `theme bootstrapping` / `theme ready in <ms>ms` |
| `initLocale()` 前后 | DEBUG | `i18n loading` / `i18n ready, locale=zh-CN` |
| deep-link bridge 安装 | DEBUG | `deep-link bridge installed (tauri/web)` |
| platform provider 创建 | DEBUG | `platform=desktop, runtime=tauri` |
| `render()` 完成 | INFO | `ui first paint in <ms>ms` |
| 任意未捕获错误 | ERROR | 完整 `error.stack` |

## 7. Dev Mode 收敛

新增 `apps/desktop/src-tauri/src/dev_mode.rs`:

```rust
use std::sync::OnceLock;

static ENABLED: OnceLock<bool> = OnceLock::new();

pub fn is_enabled() -> bool {
    *ENABLED.get_or_init(|| {
        std::env::var("AUROWORK_DEV_MODE")
            .map(|v| v == "1")
            .unwrap_or(cfg!(debug_assertions))
    })
}
```

- debug build 默认开（与现状一致）。
- release build 默认关，需显式 `AUROWORK_DEV_MODE=1`。
- 一次解析、进程内缓存，避免散落 `std::env::var` 调用。

**调用方迁移**:

| 文件 | 旧写法 | 新写法 |
|---|---|---|
| `lib.rs` | `std::env::var("AUROWORK_DEV_MODE")` 内联 | `dev_mode::is_enabled()` |
| `engine/spawn.rs` | 同上 | 同上 |
| `orchestrator/mod.rs` | 同上 | 同上 |

**前端访问**: 新增 Tauri command `dev_mode_info()` 返回 `{ enabled: bool, logFilePath: string | null }`，前端启动时 invoke 一次缓存到 signal。

## 8. 文件管理

### 路径

用 Tauri 的 `app.path().app_log_dir()` 自动跨平台:

| 平台 | 路径 |
|---|---|
| macOS | `~/Library/Logs/com.nld.aurowork.dev/` |
| Linux | `~/.local/share/com.nld.aurowork.dev/logs/` |
| Windows | `%LOCALAPPDATA%\com.nld.aurowork.dev\logs\` |

### 命名

`launch-YYYYMMDD-HHMMSS.log`，本地时区秒级精度。同秒冲突追加 `-<pid>` 后缀。

### 保留策略

启动时 `LaunchLogAggregator` 初始化的第一步：扫描 `app_log_dir` 下所有 `launch-*.log`，按 mtime 排序，**保留最新 10 个**，其余 unlink。

### 单文件大小

不设硬上限。一次启动 < 10MB 是正常的；超大本身就是异常信号。

### 写入策略

- `std::sync::Mutex<BufWriter<File>>`
- 每条日志后立即 `flush()`（启动崩溃风险高，不能丢日志）
- 写文件失败时降级到 `eprintln!`，禁用 aggregator，不阻塞启动

### 前端批处理

- 节流 100ms，用 `requestIdleCallback` 触发 `launch_log_append_batch`
- 首屏 paint 后强制 flush 一次

## 9. Settings UI 增强

在 `apps/app/src/components/settings.tsx` 的 Developer Mode 区域新增:

1. **"Open launch log folder" 按钮** — 调用 Tauri `shell.open(<log_dir>)` 弹 Finder/Explorer
2. **当前 log 路径显示** — 单行 monospace 文本，右侧带复制按钮

仅在 `dev_mode_info().enabled === true` 时显示。

## 10. 改动文件清单

### 新增（4 个）

1. `apps/desktop/src-tauri/src/dev_mode.rs`
2. `apps/desktop/src-tauri/src/launch_log/mod.rs` — Aggregator + 文件管理 + Tauri state
3. `apps/desktop/src-tauri/src/launch_log/format.rs` — 行格式化、stack 渲染
4. `apps/desktop/src-tauri/src/commands/launch_log.rs` — commands: `launch_log_append`, `launch_log_append_batch`, `launch_log_path`, `launch_log_summary`, `dev_mode_info`, `open_launch_log_folder`

### 修改（7 个）

1. `apps/desktop/src-tauri/src/lib.rs` — `run()` 最早期初始化 aggregator；setup 埋点；注册新 commands
2. `apps/desktop/src-tauri/src/orchestrator/mod.rs` — spawn/health polling 埋点；event reader dev 模式全量转发
3. `apps/desktop/src-tauri/src/commands/engine.rs` — orchestrator health polling 阶段补埋点
4. `apps/desktop/src-tauri/src/engine/spawn.rs` — 沙箱/auth/spawn 埋点；stdout/stderr dev 全量转发
5. `apps/desktop/src-tauri/src/aurowork_server/spawn.rs` — port/token/spawn 埋点；stdout/stderr dev 全量转发
6. `apps/app/src/index.tsx` + `apps/app/src/app/entry.tsx` — `[launch:ui]` 埋点 + invoke 批处理
7. `apps/app/src/components/settings.tsx` — Developer Mode 区域加 "Open launch log folder" + log 路径展示

### 新增前端模块

- `apps/app/src/lib/launch-log.ts` — 节流 + 批处理 + dev gate 缓存的客户端

## 11. 测试方案

**手动验证**（主战场）:

1. `pnpm dev` 启动 → `~/Library/Logs/com.nld.aurowork.dev/launch-*.log` 是否生成
2. 检查 5 个 tag 全部出现、时间线连贯、各阶段耗时合理
3. 模拟故障：把 orchestrator binary 改名 → ERROR 日志含完整 stack
4. release build (不带 `AUROWORK_DEV_MODE=1`) → 确认没有日志文件、行为不变
5. 启动 11 次 → 目录始终保持 10 个文件，最老的被清理
6. Settings → "Open launch log folder" → Finder/Explorer 正确打开

**单元测试**（少量、针对纯函数）:

- `launch_log/format.rs` — 格式化输出符合规范
- `launch_log/mod.rs::prune_old_logs` — mock fs 模拟 11 个文件 → 删 1 个
- `dev_mode.rs` — env var 解析

**不做的**: E2E 测试; 日志内容字符串断言（脆弱）。

## 12. 性能与安全

- **性能**: 非 dev 模式下 aggregator 是 no-op stub，无文件 I/O、无锁、无内存分配。dev 模式下每条日志一次 mutex acquire + flush，启动期间总量 < 1000 条，开销可忽略。
- **安全**: auth 凭据相关日志只记录长度，不记录内容（`auth credentials prepared (length=512)`）。token 日志同理只记 workspace 路径，不记 token 值。
- **崩溃恢复**: 文件 flush 失败时不阻塞启动；后续 append 静默降级。

## 13. 后续可能的迭代（不在本次范围）

- UI 内置 Launch Log 面板（实时查看 / 过滤 tag / 复制）
- 把 launch_log 扩展为 runtime_log（覆盖整个会话，按天滚动）
- 引入 `tracing` crate 做结构化日志（JSON 输出）
- Tauri command 调用日志（独立开关）
