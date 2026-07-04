# AuroWork

> 基於 OpenCode 的本地桌面 AI 工作區。

AuroWork 目前專注做一個可靠的本地桌面端軟件：選擇本地資料夾，啟動本地會話，管理本地 `.opencode` 配置，並在使用者授權的 workspace 內讀寫檔案。

## 目前範圍

- **本地桌面優先**：預設透過 Tauri 運行，服務綁定在本機 loopback。
- **Workspace 工作流**：選擇一個本地資料夾，在這個授權範圍內工作。
- **會話**：為目前 workspace 建立和切換 OpenCode-backed chat sessions。
- **本地配置**：管理 skills、commands、plugins、MCP config、providers 等 OpenCode 已支援的檔案配置。
- **本地檔案工具**：在桌面端讀取和編輯 workspace 檔案。
- **診斷與驗證**：用 setup doctor、debug report、launch diagnostics、local eval 保證後續減法有證據。

遠端 worker、線上分發、託管控制平面、協作範本不是目前產品目標。

## 快速開始

### 前置要求

| 工具 | 版本 |
|------|------|
| Node.js | LTS |
| pnpm | 10.27+ |
| Bun | 1.3+ |
| Rust toolchain | stable |
| Tauri 依賴 | 按操作系統安裝桌面端依賴 |

### 安裝與運行

```bash
pnpm install
pnpm setup:doctor
pnpm dev
```

`pnpm dev` 會啟動本地桌面端開發環境，並使用隔離的本地開發狀態。

`pnpm dev:ui` 只是瀏覽器裡的 UI 預覽入口，用於檢查佈局、路由和文案。它不能驗證 Tauri 命令、本地文件夾選擇、sidecar、engine 或 workspace 文件讀寫，所以不要把它當作產品 smoke test。

## 驗證命令

```bash
pnpm setup:doctor        # 本地環境與倉庫 setup 檢查
pnpm docs:check          # 文檔索引與目前產品承諾檢查
pnpm verify:fast         # app/server/orchestrator TS 檢查 + desktop cargo check
pnpm test:server         # server 測試
pnpm test:scripts        # release/publish/stats 腳本測試
pnpm eval:local-desktop  # 本地桌面 smoke eval
```

`pnpm verify:full` 和 `pnpm test:desktop` 包含需要綁定本地端口的測試，需要運行環境允許 loopback listener。

## 文檔入口

- [`docs/INDEX.md`](docs/INDEX.md)：目前文檔地圖。
- [`docs/audit/2026-07-02-feature-audit.md`](docs/audit/2026-07-02-feature-audit.md)：目前功能審計。
- [`docs/specs/2026-07-02-local-desktop-subtraction-pipeline-design.md`](docs/specs/2026-07-02-local-desktop-subtraction-pipeline-design.md)：減法管線設計。
- [`docs/plans/2026-07-02-local-desktop-subtraction-pipeline.md`](docs/plans/2026-07-02-local-desktop-subtraction-pipeline.md)：減法管線實施計劃。

舊 specs/plans 保留為歷史材料。目前事實以代碼和最新 audit 為準。

## 目錄結構

```text
.
├── apps/
│   ├── app/             # SolidJS 前端
│   ├── desktop/         # Tauri 桌面殼
│   ├── server/          # 本地 AuroWork API sidecar
│   └── orchestrator/    # 本地進程編排
├── docs/                # 文檔、審計、spec、plan、archive
├── scripts/             # setup、verify、docs、eval、release、dev 腳本
└── constants.json       # Auro/OpenCode engine 版本 pin
```

## 安全邊界

- 本地服務預設只綁定 loopback。
- 檔案訪問必須限制在使用者明確選擇的 workspace 根目錄內。
- 憑據和 token 不能提交到倉庫。
- debug report 和 setup diagnostics 必須脫敏。

## License

MIT — see [LICENSE](./LICENSE).
